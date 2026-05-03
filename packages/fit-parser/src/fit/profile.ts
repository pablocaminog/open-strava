/**
 * Minimal FIT message + field profile.
 *
 * Only the messages and fields needed to populate the normalized
 * ActivityRecord are listed. Full profile lives in Garmin's
 * Profile.xlsx; we add fields here on demand.
 *
 * Field scaling: real_value = (raw / scale) - offset.
 */

export type FieldName =
  // record
  | 'timestamp'
  | 'position_lat'
  | 'position_long'
  | 'altitude'
  | 'enhanced_altitude'
  | 'distance'
  | 'heart_rate'
  | 'cadence'
  | 'speed'
  | 'enhanced_speed'
  | 'power'
  | 'temperature'
  | 'left_right_balance'
  // lap
  | 'start_time'
  | 'total_elapsed_time'
  | 'total_timer_time'
  | 'total_distance'
  | 'total_ascent'
  | 'total_descent'
  | 'avg_heart_rate'
  | 'max_heart_rate'
  | 'avg_power'
  | 'normalized_power'
  | 'max_power'
  | 'avg_speed'
  | 'max_speed'
  | 'total_calories'
  // session
  | 'sport';

export interface FieldDef {
  name: FieldName;
  scale?: number;
  offset?: number;
  /** Multiply numeric value by this after scale/offset (e.g. semicircles → degrees). */
  postMultiplier?: number;
}

export type MesgName = 'record' | 'lap' | 'session' | 'file_id';

export const MESG_NUM: Record<number, MesgName> = {
  0: 'file_id',
  18: 'session',
  19: 'lap',
  20: 'record',
};

/**
 * Field number → field metadata, per message.
 * Source: FIT SDK Profile.xlsx (record/lap/session message tabs).
 */
export const PROFILE: Record<MesgName, Record<number, FieldDef>> = {
  file_id: {},
  record: {
    253: { name: 'timestamp' },
    0: { name: 'position_lat', postMultiplier: 180 / 2 ** 31 },
    1: { name: 'position_long', postMultiplier: 180 / 2 ** 31 },
    2: { name: 'altitude', scale: 5, offset: 500 },
    78: { name: 'enhanced_altitude', scale: 5, offset: 500 },
    5: { name: 'distance', scale: 100 },
    3: { name: 'heart_rate' },
    4: { name: 'cadence' },
    6: { name: 'speed', scale: 1000 },
    73: { name: 'enhanced_speed', scale: 1000 },
    7: { name: 'power' },
    13: { name: 'temperature' },
    30: { name: 'left_right_balance' },
  },
  lap: {
    253: { name: 'timestamp' },
    2: { name: 'start_time' },
    7: { name: 'total_elapsed_time', scale: 1000 },
    8: { name: 'total_timer_time', scale: 1000 },
    9: { name: 'total_distance', scale: 100 },
    21: { name: 'total_ascent' },
    22: { name: 'total_descent' },
    15: { name: 'avg_heart_rate' },
    16: { name: 'max_heart_rate' },
    19: { name: 'avg_power' },
    33: { name: 'normalized_power' },
    20: { name: 'max_power' },
    13: { name: 'avg_speed', scale: 1000 },
    14: { name: 'max_speed', scale: 1000 },
    11: { name: 'total_calories' },
  },
  session: {
    253: { name: 'timestamp' },
    2: { name: 'start_time' },
    7: { name: 'total_elapsed_time', scale: 1000 },
    8: { name: 'total_timer_time', scale: 1000 },
    9: { name: 'total_distance', scale: 100 },
    22: { name: 'total_ascent' },
    23: { name: 'total_descent' },
    16: { name: 'avg_heart_rate' },
    17: { name: 'max_heart_rate' },
    20: { name: 'avg_power' },
    34: { name: 'normalized_power' },
    21: { name: 'max_power' },
    14: { name: 'avg_speed', scale: 1000 },
    15: { name: 'max_speed', scale: 1000 },
    11: { name: 'total_calories' },
    5: { name: 'sport' },
  },
};

/**
 * FIT timestamp epoch — 1989-12-31T00:00:00Z.
 * Add to Unix epoch seconds = 631065600.
 */
export const FIT_EPOCH_SECONDS = 631065600;

export function fitTimestampToDate(raw: number): Date {
  return new Date((FIT_EPOCH_SECONDS + raw) * 1000);
}

export const SPORT_ENUM: Record<number, string> = {
  0: 'generic',
  1: 'running',
  2: 'cycling',
  3: 'transition',
  4: 'fitness_equipment',
  5: 'swimming',
  6: 'basketball',
  7: 'soccer',
  8: 'tennis',
  9: 'american_football',
  10: 'training',
  11: 'walking',
  12: 'cross_country_skiing',
  13: 'alpine_skiing',
  14: 'snowboarding',
  15: 'rowing',
  16: 'mountaineering',
  17: 'hiking',
  18: 'multisport',
  19: 'paddling',
};
