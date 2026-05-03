/**
 * FIT data record decoder.
 *
 * Walks the data section of a FIT file emitting parsed messages.
 * Implements:
 *   - Normal record header (definition + data)
 *   - Compressed timestamp header (5-bit time offset relative to last absolute timestamp)
 *
 * Skips developer field definitions and data — those carry custom fields
 * the normalized ActivityRecord does not yet consume. Their bytes are
 * counted so message boundaries stay aligned.
 */

import { baseTypeMeta, readBaseValue, type FieldValue } from './baseType.js';
import {
  fitTimestampToDate,
  MESG_NUM,
  PROFILE,
  SPORT_ENUM,
  type FieldName,
  type MesgName,
} from './profile.js';
import { FitParseError, readHeader } from './header.js';
import { fitCrc } from './crc.js';
import type { ActivityRecord, Lap, Sample, Session, Sport } from '../types.js';

interface FieldDefRaw {
  fieldDefNum: number;
  size: number;
  baseType: number;
}

interface MessageDef {
  globalMesgNum: number;
  littleEndian: boolean;
  fields: FieldDefRaw[];
  devFieldsTotalSize: number;
}

export interface DecodedMessage {
  mesg: MesgName | 'unknown';
  globalMesgNum: number;
  fields: Partial<Record<FieldName, FieldValue>>;
}

const HEADER_TYPE_DEF = 0x40;
const HEADER_HAS_DEV_FLAG = 0x20;
const COMPRESSED_TIMESTAMP_FLAG = 0x80;

export function* decodeMessages(buf: Uint8Array): Generator<DecodedMessage> {
  const header = readHeader(buf);
  const dataStart = header.headerSize;
  const dataEnd = dataStart + header.dataLength;
  if (dataEnd + 2 > buf.length) {
    throw new FitParseError(
      `truncated FIT body: header says ${header.dataLength} data bytes, buffer has ${buf.length - dataStart - 2}`,
      dataStart,
    );
  }

  const localDefs = new Map<number, MessageDef>();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let lastTimestamp = 0; // FIT seconds since epoch — for compressed timestamp resolution
  let offset = dataStart;

  while (offset < dataEnd) {
    const recHeader = view.getUint8(offset++);

    if ((recHeader & COMPRESSED_TIMESTAMP_FLAG) !== 0) {
      // Compressed timestamp data record:
      //   bit7 = 1; bits6..5 = local mesg type; bits4..0 = 5-bit time offset
      const localType = (recHeader >> 5) & 0x03;
      const timeOffset = recHeader & 0x1f;
      const def = localDefs.get(localType);
      if (!def) {
        throw new FitParseError(`compressed-ts data for undefined local mesg ${localType}`, offset);
      }
      const prevLow5 = lastTimestamp & 0x1f;
      if (timeOffset >= prevLow5) {
        lastTimestamp = (lastTimestamp & ~0x1f) + timeOffset;
      } else {
        lastTimestamp = (lastTimestamp & ~0x1f) + 0x20 + timeOffset;
      }
      const out = decodeData(view, offset, def);
      offset += out.consumed;
      out.message.fields.timestamp ??= lastTimestamp;
      yield out.message;
      continue;
    }

    const isDef = (recHeader & HEADER_TYPE_DEF) !== 0;
    const hasDev = (recHeader & HEADER_HAS_DEV_FLAG) !== 0;
    const localType = recHeader & 0x0f;

    if (isDef) {
      const consumed = decodeDefinition(view, offset, localType, hasDev, localDefs);
      offset += consumed;
    } else {
      const def = localDefs.get(localType);
      if (!def) {
        throw new FitParseError(`data record for undefined local mesg ${localType}`, offset);
      }
      const out = decodeData(view, offset, def);
      offset += out.consumed;
      const ts = out.message.fields.timestamp;
      if (typeof ts === 'number') lastTimestamp = ts;
      yield out.message;
    }
  }

  // CRC trailer validation. fitCrc result of (data + stored CRC bytes) must equal 0,
  // since CRC-of-stream-including-CRC == 0 for this polynomial.
  const fileCrc = view.getUint16(dataEnd, true);
  const computed = fitCrc(buf.subarray(0, dataEnd));
  if (computed !== fileCrc) {
    throw new FitParseError(`CRC mismatch: computed ${computed}, file ${fileCrc}`, dataEnd);
  }
}

function decodeDefinition(
  view: DataView,
  start: number,
  localType: number,
  hasDev: boolean,
  localDefs: Map<number, MessageDef>,
): number {
  let p = start;
  p++; // reserved
  const arch = view.getUint8(p++);
  const littleEndian = arch === 0;
  const globalMesgNum = view.getUint16(p, littleEndian);
  p += 2;
  const fieldCount = view.getUint8(p++);

  const fields: FieldDefRaw[] = [];
  for (let i = 0; i < fieldCount; i++) {
    const fieldDefNum = view.getUint8(p++);
    const size = view.getUint8(p++);
    const baseType = view.getUint8(p++);
    fields.push({ fieldDefNum, size, baseType });
  }

  let devFieldsTotalSize = 0;
  if (hasDev) {
    const devCount = view.getUint8(p++);
    for (let i = 0; i < devCount; i++) {
      // dev field def: field_def_num(1), size(1), dev_data_idx(1)
      p++;
      const size = view.getUint8(p++);
      p++;
      devFieldsTotalSize += size;
    }
  }

  localDefs.set(localType, { globalMesgNum, littleEndian, fields, devFieldsTotalSize });
  return p - start;
}

function decodeData(
  view: DataView,
  start: number,
  def: MessageDef,
): { message: DecodedMessage; consumed: number } {
  const mesg = MESG_NUM[def.globalMesgNum] ?? 'unknown';
  const fieldMap = mesg === 'unknown' ? undefined : PROFILE[mesg];
  const out: DecodedMessage = {
    mesg,
    globalMesgNum: def.globalMesgNum,
    fields: {},
  };

  let p = start;
  for (const f of def.fields) {
    const meta = baseTypeMeta(f.baseType);
    const fieldSize = meta?.size ?? 1;
    const raw = readBaseValue(view, p, f.baseType, def.littleEndian, f.size);
    p += f.size;

    if (!fieldMap || raw === null || typeof raw === 'string') {
      if (fieldMap && raw !== null && typeof raw === 'string') {
        const profile = fieldMap[f.fieldDefNum];
        if (profile) out.fields[profile.name] = raw;
      }
      continue;
    }

    const profile = fieldMap[f.fieldDefNum];
    if (!profile) continue;

    let value: number | bigint = raw;
    if (typeof value === 'number') {
      if (profile.scale && profile.scale !== 1) value = value / profile.scale;
      if (profile.offset) value = value - profile.offset;
      if (profile.postMultiplier) value = value * profile.postMultiplier;
    }
    out.fields[profile.name] = value;
    void fieldSize;
  }

  if (def.devFieldsTotalSize > 0) p += def.devFieldsTotalSize;
  return { message: out, consumed: p - start };
}

/**
 * Reduce decoded messages into a normalized ActivityRecord.
 */
export function decode(buf: Uint8Array): ActivityRecord {
  const samples: Sample[] = [];
  const laps: Lap[] = [];
  let session: Session | undefined;
  let activityStart: number | undefined;

  for (const msg of decodeMessages(buf)) {
    switch (msg.mesg) {
      case 'record': {
        const ts = numField(msg.fields.timestamp);
        if (ts === undefined) continue;
        if (activityStart === undefined) activityStart = ts;
        const sample: Sample = { t: ts - activityStart };
        const lat = numField(msg.fields.position_lat);
        const lng = numField(msg.fields.position_long);
        if (lat !== undefined) sample.lat = lat;
        if (lng !== undefined) sample.lng = lng;
        const alt = numField(msg.fields.enhanced_altitude) ?? numField(msg.fields.altitude);
        if (alt !== undefined) sample.altitude = alt;
        const dist = numField(msg.fields.distance);
        if (dist !== undefined) sample.distance = dist;
        const hr = numField(msg.fields.heart_rate);
        if (hr !== undefined) sample.hr = hr;
        const power = numField(msg.fields.power);
        if (power !== undefined) sample.power = power;
        const cad = numField(msg.fields.cadence);
        if (cad !== undefined) sample.cadence = cad;
        const spd = numField(msg.fields.enhanced_speed) ?? numField(msg.fields.speed);
        if (spd !== undefined) sample.speed = spd;
        const tmp = numField(msg.fields.temperature);
        if (tmp !== undefined) sample.temperature = tmp;
        const lrb = numField(msg.fields.left_right_balance);
        if (lrb !== undefined) sample.leftRightBalance = lrb;
        samples.push(sample);
        break;
      }
      case 'lap': {
        const startRaw = numField(msg.fields.start_time);
        const elapsed = numField(msg.fields.total_elapsed_time);
        if (startRaw === undefined || elapsed === undefined) break;
        const lap: Lap = {
          startedAt: fitTimestampToDate(startRaw),
          totalSeconds: elapsed,
        };
        const ascent = numField(msg.fields.total_ascent);
        const descent = numField(msg.fields.total_descent);
        const dist = numField(msg.fields.total_distance);
        const aHr = numField(msg.fields.avg_heart_rate);
        const mHr = numField(msg.fields.max_heart_rate);
        const aPwr = numField(msg.fields.avg_power);
        const mPwr = numField(msg.fields.max_power);
        const aSpd = numField(msg.fields.avg_speed);
        const mSpd = numField(msg.fields.max_speed);
        if (dist !== undefined) lap.totalDistance = dist;
        if (ascent !== undefined) lap.totalAscent = ascent;
        if (descent !== undefined) lap.totalDescent = descent;
        if (aHr !== undefined) lap.avgHr = aHr;
        if (mHr !== undefined) lap.maxHr = mHr;
        if (aPwr !== undefined) lap.avgPower = aPwr;
        if (mPwr !== undefined) lap.maxPower = mPwr;
        if (aSpd !== undefined) lap.avgSpeed = aSpd;
        if (mSpd !== undefined) lap.maxSpeed = mSpd;
        laps.push(lap);
        break;
      }
      case 'session': {
        const startRaw = numField(msg.fields.start_time);
        const elapsed = numField(msg.fields.total_elapsed_time);
        const sportRaw = numField(msg.fields.sport);
        if (startRaw === undefined || elapsed === undefined) break;
        const sport = sportFromEnum(sportRaw);
        session = {
          sport,
          startedAt: fitTimestampToDate(startRaw),
          totalSeconds: elapsed,
        };
        const dist = numField(msg.fields.total_distance);
        const ascent = numField(msg.fields.total_ascent);
        const descent = numField(msg.fields.total_descent);
        const aHr = numField(msg.fields.avg_heart_rate);
        const mHr = numField(msg.fields.max_heart_rate);
        const aPwr = numField(msg.fields.avg_power);
        const np = numField(msg.fields.normalized_power);
        const mPwr = numField(msg.fields.max_power);
        const aSpd = numField(msg.fields.avg_speed);
        const mSpd = numField(msg.fields.max_speed);
        const cal = numField(msg.fields.total_calories);
        if (dist !== undefined) session.totalDistance = dist;
        if (ascent !== undefined) session.totalAscent = ascent;
        if (descent !== undefined) session.totalDescent = descent;
        if (aHr !== undefined) session.avgHr = aHr;
        if (mHr !== undefined) session.maxHr = mHr;
        if (aPwr !== undefined) session.avgPower = aPwr;
        if (np !== undefined) session.normalizedPower = np;
        if (mPwr !== undefined) session.maxPower = mPwr;
        if (aSpd !== undefined) session.avgSpeed = aSpd;
        if (mSpd !== undefined) session.maxSpeed = mSpd;
        if (cal !== undefined) session.totalCalories = cal;
        break;
      }
      default:
    }
  }

  if (!session) {
    throw new FitParseError('no session message in FIT file', 0);
  }
  return { source: 'fit', session, laps, samples };
}

function numField(v: FieldValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

function sportFromEnum(raw: number | undefined): Sport {
  if (raw === undefined) return 'other';
  const name = SPORT_ENUM[raw];
  switch (name) {
    case 'cycling':
      return 'cycling';
    case 'running':
      return 'running';
    case 'walking':
      return 'walking';
    case 'hiking':
      return 'hiking';
    case 'swimming':
      return 'swimming';
    case 'rowing':
      return 'rowing';
    case 'cross_country_skiing':
    case 'alpine_skiing':
    case 'snowboarding':
      return 'skiing';
    case 'training':
      return 'strength';
    default:
      return 'other';
  }
}
