import { describe, expect, it } from 'vitest';
import { decode, decodeMessages } from '../src/fit/decoder.js';
import { buildSimpleFit } from './fixtures/build.js';

describe('FIT decoder', () => {
  it('decodes records, session, and produces ActivityRecord', () => {
    const startUnix = Math.floor(Date.UTC(2026, 0, 1, 12, 0, 0) / 1000);
    const built = buildSimpleFit({
      startUnix,
      records: [
        { hr: 120, power: 200, distanceMeters: 0 },
        { hr: 130, power: 220, distanceMeters: 5 },
        { hr: 135, power: 240, distanceMeters: 10 },
      ],
      sport: 2, // cycling
      totalElapsedSeconds: 3,
    });

    const ar = decode(built.bytes);
    expect(ar.source).toBe('fit');
    expect(ar.session.sport).toBe('cycling');
    expect(ar.session.totalSeconds).toBe(3);
    expect(ar.session.startedAt.getTime()).toBe(startUnix * 1000);

    expect(ar.samples).toHaveLength(3);
    expect(ar.samples[0]).toMatchObject({ t: 0, hr: 120, power: 200, distance: 0 });
    expect(ar.samples[1]).toMatchObject({ t: 1, hr: 130, power: 220, distance: 5 });
    expect(ar.samples[2]).toMatchObject({ t: 2, hr: 135, power: 240, distance: 10 });
  });

  it('handles invalid sentinels by omitting fields', () => {
    const startUnix = Math.floor(Date.UTC(2026, 0, 1) / 1000);
    const built = buildSimpleFit({
      startUnix,
      records: [
        { hr: 0xff, power: 0xffff, distanceMeters: 0 }, // both sentinels
      ],
      sport: 2,
      totalElapsedSeconds: 1,
    });

    const ar = decode(built.bytes);
    const s = ar.samples[0]!;
    expect(s.hr).toBeUndefined();
    expect(s.power).toBeUndefined();
    expect(s.distance).toBe(0);
  });

  it('detects CRC mismatch', () => {
    const built = buildSimpleFit({
      startUnix: 1735689600,
      records: [{ hr: 100, power: 100, distanceMeters: 0 }],
      sport: 2,
      totalElapsedSeconds: 1,
    });
    const tampered = new Uint8Array(built.bytes);
    tampered[20] ^= 0xff; // flip a body byte
    expect(() => decode(tampered)).toThrow(/CRC/);
  });

  it('decodeMessages enumerates raw messages', () => {
    const built = buildSimpleFit({
      startUnix: 1735689600,
      records: [
        { hr: 100, power: 100, distanceMeters: 0 },
        { hr: 110, power: 110, distanceMeters: 5 },
      ],
      sport: 1, // running
      totalElapsedSeconds: 2,
    });

    const msgs = Array.from(decodeMessages(built.bytes));
    const records = msgs.filter((m) => m.mesg === 'record');
    const sessions = msgs.filter((m) => m.mesg === 'session');
    expect(records).toHaveLength(2);
    expect(sessions).toHaveLength(1);
  });
});
