/**
 * Synthetic FIT file builder used by tests.
 *
 * Emits the minimum bytes needed to exercise the decoder without
 * depending on a vendored real-device sample. Layout:
 *   header(14) + body[ defs + records ] + crc(2)
 */

import { fitCrc } from '../../src/fit/crc.js';

export interface BuiltFile {
  bytes: Uint8Array;
}

const FIT_EPOCH_OFFSET = 631065600;
export function unixToFit(unixSeconds: number): number {
  return unixSeconds - FIT_EPOCH_OFFSET;
}

interface Builder {
  push(bytes: number[] | Uint8Array): void;
  pushUint8(v: number): void;
  pushUint16LE(v: number): void;
  pushUint32LE(v: number): void;
  pushInt32LE(v: number): void;
  finalize(): Uint8Array;
}

export function buf(): Builder {
  const out: number[] = [];
  return {
    push(b) {
      for (const x of b) out.push(x);
    },
    pushUint8(v) {
      out.push(v & 0xff);
    },
    pushUint16LE(v) {
      out.push(v & 0xff, (v >> 8) & 0xff);
    },
    pushUint32LE(v) {
      out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    },
    pushInt32LE(v) {
      const u = v >>> 0;
      out.push(u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff, (u >>> 24) & 0xff);
    },
    finalize() {
      return new Uint8Array(out);
    },
  };
}

/**
 * Build a single-session, multi-record FIT file.
 *
 * - Defines record (global 20) with 4 fields: timestamp(u32), heart_rate(u8),
 *   power(u16), distance(u32).
 * - Defines session (global 18) with 4 fields: timestamp(u32), start_time(u32),
 *   total_elapsed_time(u32 scale=1000), sport(enum).
 * - Emits N records and 1 session.
 */
export function buildSimpleFit(opts: {
  startUnix: number;
  records: { hr: number; power: number; distanceMeters: number }[];
  sport: number;
  totalElapsedSeconds: number;
}): BuiltFile {
  const body = buf();

  // Record definition — local mesg 0
  body.pushUint8(0x40);
  body.pushUint8(0); // reserved
  body.pushUint8(0); // arch = LE
  body.pushUint16LE(20); // global mesg num = record
  body.pushUint8(4); // 4 fields
  // timestamp: defNum=253, size=4, baseType=0x86 (u32)
  body.push([253, 4, 0x86]);
  // heart_rate: defNum=3, size=1, baseType=0x02 (u8)
  body.push([3, 1, 0x02]);
  // power: defNum=7, size=2, baseType=0x84 (u16)
  body.push([7, 2, 0x84]);
  // distance: defNum=5, size=4, baseType=0x86 (u32). Stored as cm; profile scale=100.
  body.push([5, 4, 0x86]);

  // Record data records
  for (let i = 0; i < opts.records.length; i++) {
    const r = opts.records[i]!;
    body.pushUint8(0x00); // data record, local 0
    body.pushUint32LE(unixToFit(opts.startUnix + i));
    body.pushUint8(r.hr);
    body.pushUint16LE(r.power);
    body.pushUint32LE(Math.round(r.distanceMeters * 100));
  }

  // Session definition — local mesg 1
  body.pushUint8(0x40 | 1);
  body.pushUint8(0);
  body.pushUint8(0);
  body.pushUint16LE(18);
  body.pushUint8(4);
  body.push([253, 4, 0x86]); // timestamp
  body.push([2, 4, 0x86]); // start_time
  body.push([7, 4, 0x86]); // total_elapsed_time (scale=1000)
  body.push([5, 1, 0x00]); // sport (enum)

  body.pushUint8(0x01); // data record, local 1
  body.pushUint32LE(unixToFit(opts.startUnix + opts.totalElapsedSeconds));
  body.pushUint32LE(unixToFit(opts.startUnix));
  body.pushUint32LE(opts.totalElapsedSeconds * 1000);
  body.pushUint8(opts.sport);

  const bodyBytes = body.finalize();

  // Build header
  const header = buf();
  header.pushUint8(14);
  header.pushUint8(0x20); // protocol version
  header.pushUint16LE(2140); // profile version
  header.pushUint32LE(bodyBytes.length);
  header.push([0x2e, 0x46, 0x49, 0x54]); // ".FIT"
  // Header CRC computed over bytes 0..11
  const headerWithoutCrc = header.finalize();
  const headerCrc = fitCrc(headerWithoutCrc);
  const headerFull = new Uint8Array(14);
  headerFull.set(headerWithoutCrc, 0);
  headerFull[12] = headerCrc & 0xff;
  headerFull[13] = (headerCrc >> 8) & 0xff;

  // Concatenate header + body, then append file CRC
  const fileNoCrc = new Uint8Array(14 + bodyBytes.length);
  fileNoCrc.set(headerFull, 0);
  fileNoCrc.set(bodyBytes, 14);
  const fileCrc = fitCrc(fileNoCrc);

  const out = new Uint8Array(fileNoCrc.length + 2);
  out.set(fileNoCrc, 0);
  out[fileNoCrc.length] = fileCrc & 0xff;
  out[fileNoCrc.length + 1] = (fileCrc >> 8) & 0xff;
  return { bytes: out };
}
