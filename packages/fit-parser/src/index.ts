export type { ActivityRecord, Sample, Lap, Session, Sport, SourceFormat } from './types.js';
export { readHeader, FitParseError, FIT_MAGIC } from './fit/header.js';
export type { FitHeader } from './fit/header.js';
export { fitCrc } from './fit/crc.js';
export { decode, decodeMessages } from './fit/decoder.js';
export type { DecodedMessage } from './fit/decoder.js';
