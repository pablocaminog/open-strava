/**
 * Workout export — ZWO (Zwift) and a minimal FIT-Workout encoder.
 *
 * ZWO: XML, no schema published; reverse-engineered from Zwift's
 *      community workouts. Power targets are FTP fractions [0..1].
 *
 * FIT-Workout: a tiny subset of the FIT profile — file_id + workout +
 *      workout_step messages. Garmin watches read this.
 *
 * Both exporters accept the same Workout type; the same JSON DSL the
 * web builder produces.
 */

export interface WorkoutStep {
  kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'rest';
  durationSec?: number;
  distM?: number;
  target?: { type: 'ftp_pct' | 'hr_pct' | 'hr_bpm' | 'watts' | 'pace'; low: number; high: number };
  repeat?: number;
  children?: WorkoutStep[];
}

export interface Workout {
  id: string;
  name: string;
  sport: 'cycling' | 'running' | 'swimming' | 'other';
  steps: WorkoutStep[];
}

// ---------------- ZWO ----------------
export function workoutToZwo(w: Workout): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const steps = w.steps.flatMap((s) => zwoNode(s, 1));
  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>Pacelore</author>
  <name>${esc(w.name)}</name>
  <description></description>
  <sportType>${w.sport === 'running' ? 'run' : 'bike'}</sportType>
  <tags/>
  <workout>
${steps.join('\n')}
  </workout>
</workout_file>
`;
}

function zwoNode(step: WorkoutStep, mult: number): string[] {
  if (step.children && step.children.length) {
    const reps = Math.max(1, step.repeat ?? 1) * mult;
    const out: string[] = [];
    for (let i = 0; i < reps; i++) {
      for (const child of step.children) out.push(...zwoNode(child, 1));
    }
    return out;
  }
  const dur = step.durationSec ?? 0;
  const tag = mapZwoTag(step.kind);
  const intensity = ftpFraction(step);
  if (intensity == null) {
    return [`    <${tag} Duration="${dur}" Power="0.6"/>`];
  }
  return [`    <${tag} Duration="${dur}" Power="${intensity.toFixed(3)}"/>`];
}

function mapZwoTag(kind: WorkoutStep['kind']): string {
  switch (kind) {
    case 'warmup':
      return 'Warmup';
    case 'cooldown':
      return 'Cooldown';
    case 'rest':
    case 'recover':
      return 'SteadyState';
    case 'work':
    default:
      return 'SteadyState';
  }
}

function ftpFraction(step: WorkoutStep): number | null {
  const t = step.target;
  if (!t) return null;
  if (t.type === 'ftp_pct') return (t.low + t.high) / 2 / 100;
  return null;
}

// ---------------- FIT (minimal) ----------------
// Spec ref: FIT SDK profile.xlsx, messages 0 (file_id), 26 (workout),
// 27 (workout_step). Encoded as a fixed-definition single-record stream.
//
// Layout:
//   [12B header]
//   [definition_msg file_id]
//   [data_msg file_id]
//   [definition_msg workout]
//   [data_msg workout]
//   [definition_msg workout_step]
//   [data_msg workout_step] × N
//   [2B CRC]
export function workoutToFit(w: Workout): ArrayBuffer {
  const flat = flattenSteps(w.steps);
  const enc = new TextEncoder();
  const nameBytes = enc.encode(w.name.slice(0, 15) + '\0');
  const namePadded = new Uint8Array(16);
  namePadded.set(nameBytes.subarray(0, Math.min(16, nameBytes.length)));

  // Build payload (everything after header, before CRC).
  const chunks: Uint8Array[] = [];

  // file_id local 0: type(1)=workout=5, manufacturer(uint16)=255 dev,
  // product(uint16)=0, time_created(uint32)=now
  chunks.push(
    fitDef(0, 0, [
      [4, 4, 0x86], // time_created uint32
      [1, 2, 0x84], // manufacturer uint16
      [2, 2, 0x84], // product uint16
      [0, 1, 0x00], // type enum
    ]),
  );
  const tCreated = Math.max(0, Math.floor(Date.now() / 1000) - 631_065_600); // FIT epoch 1989-12-31
  chunks.push(fitData(0, [u32(tCreated), u16(255), u16(0), u8(5)]));

  // workout local 1: capabilities(uint32z)=0, num_valid_steps(uint16)=N,
  // wkt_name(string,16), sport(enum)
  chunks.push(
    fitDef(1, 26, [
      [3, 4, 0x8c], // capabilities uint32z
      [6, 2, 0x84], // num_valid_steps uint16
      [8, 16, 0x07], // wkt_name string
      [4, 1, 0x00], // sport enum
    ]),
  );
  chunks.push(fitData(1, [u32(0), u16(flat.length), namePadded, u8(fitSport(w.sport))]));

  // workout_step local 2: message_index(uint16), wkt_step_name(string,16),
  // duration_type(enum), duration_value(uint32), target_type(enum),
  // target_value(uint32), custom_target_low(uint32), custom_target_high(uint32),
  // intensity(enum)
  chunks.push(
    fitDef(2, 27, [
      [254, 2, 0x84], // message_index uint16
      [1, 16, 0x07], // wkt_step_name string
      [2, 1, 0x00], // duration_type enum
      [3, 4, 0x86], // duration_value uint32
      [4, 1, 0x00], // target_type enum
      [5, 4, 0x86], // target_value uint32
      [6, 4, 0x86], // custom_target_value_low uint32
      [7, 4, 0x86], // custom_target_value_high uint32
      [9, 1, 0x00], // intensity enum
    ]),
  );
  flat.forEach((step, i) => {
    const stepName = new Uint8Array(16);
    stepName.set(enc.encode((step.kind + '\0').slice(0, 16)));
    const intensity = fitIntensity(step.kind);
    const { durationType, durationValue } = fitDuration(step);
    const { targetType, low, high } = fitTarget(step);
    chunks.push(
      fitData(2, [
        u16(i),
        stepName,
        u8(durationType),
        u32(durationValue),
        u8(targetType),
        u32(0), // target_value (zone), unused when custom range supplied
        u32(low),
        u32(high),
        u8(intensity),
      ]),
    );
  });

  const payload = concat(chunks);
  // Header (12 bytes): size=12, protocol=0x10, profile=2169 (LE), data_size=u32 LE, ".FIT", crc=0
  const header = new Uint8Array(12);
  header[0] = 12;
  header[1] = 0x10;
  header[2] = 0x79;
  header[3] = 0x08; // profile 2169
  const dv = new DataView(header.buffer);
  dv.setUint32(4, payload.length, true);
  header[8] = 0x2e; // .
  header[9] = 0x46; // F
  header[10] = 0x49; // I
  header[11] = 0x54; // T

  const headerAndPayload = concat([header, payload]);
  const crc = fitCrc(headerAndPayload);
  return concat([headerAndPayload, u16(crc)]).buffer as ArrayBuffer;
}

function flattenSteps(steps: WorkoutStep[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  const visit = (list: WorkoutStep[], mult: number) => {
    for (const s of list) {
      const reps = Math.max(1, s.repeat ?? 1) * mult;
      if (s.children && s.children.length) {
        for (let i = 0; i < reps; i++) visit(s.children, 1);
        continue;
      }
      for (let i = 0; i < reps; i++) out.push(s);
    }
  };
  visit(steps, 1);
  return out;
}

function fitSport(sport: Workout['sport']): number {
  // sport enum: 0=generic, 1=running, 2=cycling, 5=swimming
  switch (sport) {
    case 'running':
      return 1;
    case 'cycling':
      return 2;
    case 'swimming':
      return 5;
    default:
      return 0;
  }
}

function fitIntensity(kind: WorkoutStep['kind']): number {
  switch (kind) {
    case 'work':
      return 0;
    case 'rest':
    case 'recover':
      return 1;
    case 'warmup':
      return 2;
    case 'cooldown':
      return 3;
  }
}

function fitDuration(step: WorkoutStep): { durationType: number; durationValue: number } {
  if (step.distM != null) {
    // distance, value in cm (uint32, scale 100)
    return { durationType: 1, durationValue: Math.round(step.distM * 100) };
  }
  // time, value in milliseconds (uint32, scale 1000)
  return { durationType: 0, durationValue: Math.round((step.durationSec ?? 0) * 1000) };
}

function fitTarget(step: WorkoutStep): { targetType: number; low: number; high: number } {
  // target_type enum: 0=speed, 1=heart_rate, 2=open, 4=power, 6=cadence,
  // ranges in custom_target_low/high (W for power; bpm for HR)
  const t = step.target;
  if (!t) return { targetType: 2, low: 0, high: 0 };
  if (t.type === 'ftp_pct') {
    return {
      targetType: 4,
      low: Math.round(t.low * 1000 + 1000),
      high: Math.round(t.high * 1000 + 1000),
    };
    // FIT power custom: low/high stored as W+1000 sentinel offset. Garmin reads value-1000.
  }
  if (t.type === 'hr_pct') {
    return { targetType: 1, low: Math.round(t.low + 100), high: Math.round(t.high + 100) };
  }
  return { targetType: 2, low: 0, high: 0 };
}

// FIT framing helpers ----------------------------------------------
function fitDef(local: number, globalNum: number, fields: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(6 + fields.length * 3);
  out[0] = 0x40 | (local & 0x0f); // definition header
  out[1] = 0; // reserved
  out[2] = 0; // little-endian
  const dv = new DataView(out.buffer);
  dv.setUint16(3, globalNum, true);
  out[5] = fields.length;
  let p = 6;
  for (const [num, size, type] of fields) {
    out[p++] = num;
    out[p++] = size;
    out[p++] = type;
  }
  return out;
}

function fitData(local: number, payloads: Uint8Array[]): Uint8Array {
  const total = payloads.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(1 + total);
  out[0] = local & 0x0f;
  let p = 1;
  for (const part of payloads) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function u8(n: number): Uint8Array {
  return new Uint8Array([n & 0xff]);
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf]!;
  }
  return crc & 0xffff;
}
