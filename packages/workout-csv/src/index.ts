export class WorkoutCsvError extends Error {
  constructor(
    message: string,
    public readonly row: number,
  ) {
    super(`Row ${row}: ${message}`);
    this.name = 'WorkoutCsvError';
  }
}

export interface CsvTarget {
  type: 'ftp_pct' | 'hr_bpm' | 'watts' | 'pace';
  low: number;
  high: number;
}

export interface CsvStep {
  kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'rest';
  durationSec: number;
  target?: CsvTarget;
}

export interface ParsedWorkout {
  name: string;
  sport: 'cycling' | 'running' | 'swimming' | 'other';
  description?: string;
  steps: CsvStep[];
}

const VALID_SPORTS = new Set(['cycling', 'running', 'swimming', 'other']);

export function parseWorkoutCsv(text: string): ParsedWorkout {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new WorkoutCsvError('empty input', 0);
  if (lines.length < 2) throw new WorkoutCsvError('need header row + at least one block row', 0);

  const headerParts = lines[0].split(',').map((p) => p.trim());
  if (headerParts.length < 2) {
    throw new WorkoutCsvError('header row must be: name, sport[, description]', 1);
  }
  const name = headerParts[0];
  if (!name) throw new WorkoutCsvError('name is required', 1);

  const sport = headerParts[1].toLowerCase();
  if (!VALID_SPORTS.has(sport)) {
    throw new WorkoutCsvError(
      `invalid sport "${sport}" — must be cycling|running|swimming|other`,
      1,
    );
  }
  const description = headerParts[2]?.trim() || undefined;

  const steps: CsvStep[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < 2) {
      throw new WorkoutCsvError('block row must be: block_name, duration_secs[, target]', rowNum);
    }
    const blockName = parts[0];
    if (!blockName) throw new WorkoutCsvError('block name is required', rowNum);

    const rawDur = parts[1];
    const durationSec = parseInt(rawDur, 10);
    if (!Number.isInteger(durationSec) || durationSec < 1 || rawDur.includes('.')) {
      throw new WorkoutCsvError(
        `invalid duration "${rawDur}" — must be positive integer seconds`,
        rowNum,
      );
    }

    const kind = blockNameToKind(blockName);
    const target = parts[2] ? parseTarget(parts[2], rowNum) : undefined;
    steps.push({ kind, durationSec, ...(target ? { target } : {}) });
  }

  return {
    name,
    sport: sport as ParsedWorkout['sport'],
    ...(description ? { description } : {}),
    steps,
  };
}

function blockNameToKind(name: string): CsvStep['kind'] {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n === 'warm up' || n === 'warmup') return 'warmup';
  if (n === 'cool down' || n === 'cooldown') return 'cooldown';
  if (n === 'recover' || n === 'recovery') return 'recover';
  if (n === 'rest') return 'rest';
  return 'work';
}

function parseTarget(raw: string, row: number): CsvTarget {
  const s = raw.trim();

  // % FTP: "75%" or "80-90%"
  const ftpMatch = s.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%$/);
  if (ftpMatch) {
    const low = parseFloat(ftpMatch[1]);
    const high = ftpMatch[2] ? parseFloat(ftpMatch[2]) : low;
    if (low > high) throw new WorkoutCsvError(`range "${raw}" is inverted — write low-high`, row);
    return { type: 'ftp_pct', low, high };
  }

  // HR bpm: "140bpm", "130-150bpm", "140hr", "130-150hr"
  const hrMatch = s.match(/^(\d+)(?:-(\d+))?(?:bpm|hr)$/i);
  if (hrMatch) {
    const low = parseInt(hrMatch[1], 10);
    const high = hrMatch[2] ? parseInt(hrMatch[2], 10) : low;
    if (low > high) throw new WorkoutCsvError(`range "${raw}" is inverted — write low-high`, row);
    return { type: 'hr_bpm', low, high };
  }

  // Pace: "4:30/km", "4:30-5:00/km", "4:30/mi", "4:30", "4:30-5:00"
  // Must come before watts to avoid matching plain numbers as watts
  const paceMatch = s.match(/^(\d+):(\d{2})(?:-(\d+):(\d{2}))?(?:\/(km|mi))?$/i);
  if (paceMatch) {
    const lowSec = parseInt(paceMatch[1], 10) * 60 + parseInt(paceMatch[2], 10);
    const highSec = paceMatch[3]
      ? parseInt(paceMatch[3], 10) * 60 + parseInt(paceMatch[4], 10)
      : lowSec;
    if (lowSec > highSec) throw new WorkoutCsvError(`pace range "${raw}" is inverted — write fast-slow (e.g. 4:30-5:00)`, row);
    const unit = paceMatch[5]?.toLowerCase() ?? 'km';
    const toKm = (sec: number) => (unit === 'mi' ? Math.round(sec / 1.60934) : sec);
    return { type: 'pace', low: toKm(lowSec), high: toKm(highSec) };
  }

  // Watts: "170W", "80-150W", "170", "80-150"
  const wattsMatch = s.match(/^(\d+)(?:-(\d+))?W?$/i);
  if (wattsMatch) {
    const low = parseInt(wattsMatch[1], 10);
    const high = wattsMatch[2] ? parseInt(wattsMatch[2], 10) : low;
    if (low > high) throw new WorkoutCsvError(`range "${raw}" is inverted — write low-high`, row);
    return { type: 'watts', low, high };
  }

  throw new WorkoutCsvError(`cannot parse target "${raw}"`, row);
}
