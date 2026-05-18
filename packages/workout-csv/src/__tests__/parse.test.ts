import { describe, it, expect } from 'vitest';
import { parseWorkoutCsv, WorkoutCsvError } from '../index.js';

describe('parseWorkoutCsv', () => {
  it('parses a minimal cycling workout', () => {
    const result = parseWorkoutCsv(
      'Z2 Ride, cycling, Easy aerobic\nWarm up, 600, 80-150W\nMain Block, 2000, 170W\nCool down, 600, 80-150W',
    );
    expect(result.name).toBe('Z2 Ride');
    expect(result.sport).toBe('cycling');
    expect(result.description).toBe('Easy aerobic');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].kind).toBe('warmup');
    expect(result.steps[0].durationSec).toBe(600);
    expect(result.steps[0].target).toEqual({ type: 'watts', low: 80, high: 150 });
    expect(result.steps[1].kind).toBe('work');
    expect(result.steps[1].target).toEqual({ type: 'watts', low: 170, high: 170 });
    expect(result.steps[2].kind).toBe('cooldown');
  });

  it('parses % FTP targets', () => {
    const result = parseWorkoutCsv('Threshold, cycling\nWork, 1200, 95-105%');
    expect(result.steps[0].target).toEqual({ type: 'ftp_pct', low: 95, high: 105 });
  });

  it('parses HR bpm targets', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 130-150bpm');
    expect(result.steps[0].target).toEqual({ type: 'hr_bpm', low: 130, high: 150 });
  });

  it('parses pace targets in min:sec/km', () => {
    const result = parseWorkoutCsv('Tempo Run, running\nWork, 1200, 4:30/km');
    expect(result.steps[0].target).toEqual({ type: 'pace', low: 270, high: 270 });
  });

  it('parses pace range in min:sec/km', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 4:30-5:00/km');
    expect(result.steps[0].target).toEqual({ type: 'pace', low: 270, high: 300 });
  });

  it('converts mi pace to km', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 7:15/mi');
    // 7:15 = 435 sec/mi → 435 / 1.60934 ≈ 270 sec/km
    expect(result.steps[0].target?.type).toBe('pace');
    expect(result.steps[0].target?.low).toBeCloseTo(270, 0);
  });

  it('maps block names to kinds correctly', () => {
    const result = parseWorkoutCsv(
      'Test, cycling\nWarm up, 300\nWork, 600\nRecovery, 120\nCool down, 300',
    );
    expect(result.steps[0].kind).toBe('warmup');
    expect(result.steps[1].kind).toBe('work');
    expect(result.steps[2].kind).toBe('recover');
    expect(result.steps[3].kind).toBe('cooldown');
  });

  it('allows no target (step without target is valid)', () => {
    const result = parseWorkoutCsv('Test, cycling\nWork, 600');
    expect(result.steps[0].target).toBeUndefined();
  });

  it('throws WorkoutCsvError on empty input', () => {
    expect(() => parseWorkoutCsv('')).toThrow(WorkoutCsvError);
    expect(() => parseWorkoutCsv('  \n  ')).toThrow(WorkoutCsvError);
  });

  it('throws WorkoutCsvError with row number on invalid sport', () => {
    const err = (() => {
      try { parseWorkoutCsv('My ride, soccer\nWork, 600'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(1);
    expect(err.message).toMatch(/sport/i);
  });

  it('throws WorkoutCsvError on non-integer duration', () => {
    const err = (() => {
      try { parseWorkoutCsv('Test, cycling\nWork, abc'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(2);
  });

  it('throws WorkoutCsvError on unparseable target', () => {
    const err = (() => {
      try { parseWorkoutCsv('Test, cycling\nWork, 600, ???'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(2);
  });

  it('ignores blank lines', () => {
    const result = parseWorkoutCsv(
      '\nZ2 Ride, cycling\n\nWarm up, 600\n\nWork, 2000\n',
    );
    expect(result.steps).toHaveLength(2);
  });

  it('throws on fractional duration', () => {
    const err = (() => {
      try { parseWorkoutCsv('Test, cycling\nWork, 1.5'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(2);
  });

  it('throws on inverted watts range', () => {
    expect(() => parseWorkoutCsv('Test, cycling\nWork, 600, 150-80W')).toThrow(WorkoutCsvError);
  });

  it('throws on inverted pace range', () => {
    expect(() => parseWorkoutCsv('Test, running\nWork, 600, 5:00-4:30/km')).toThrow(WorkoutCsvError);
  });
});
