/**
 * FIT base types — the encoding used in every data field.
 * See FIT SDK Profile.xlsx → "Types" tab.
 */

export type BaseTypeId =
  | 0x00 // enum
  | 0x01 // sint8
  | 0x02 // uint8
  | 0x83 // sint16
  | 0x84 // uint16
  | 0x85 // sint32
  | 0x86 // uint32
  | 0x07 // string (null-terminated utf-8)
  | 0x88 // float32
  | 0x89 // float64
  | 0x0a // uint8z
  | 0x8b // uint16z
  | 0x8c // uint32z
  | 0x0d // byte
  | 0x8e // sint64
  | 0x8f // uint64
  | 0x90; // uint64z

export interface BaseTypeMeta {
  size: number;
  /** "Invalid" sentinel — when a field reads to this, it's missing. */
  invalid: number | bigint | string;
  endianAware: boolean;
}

const META: Record<number, BaseTypeMeta> = {
  0x00: { size: 1, invalid: 0xff, endianAware: false }, // enum
  0x01: { size: 1, invalid: 0x7f, endianAware: false }, // sint8
  0x02: { size: 1, invalid: 0xff, endianAware: false }, // uint8
  0x83: { size: 2, invalid: 0x7fff, endianAware: true }, // sint16
  0x84: { size: 2, invalid: 0xffff, endianAware: true }, // uint16
  0x85: { size: 4, invalid: 0x7fffffff, endianAware: true }, // sint32
  0x86: { size: 4, invalid: 0xffffffff, endianAware: true }, // uint32
  0x07: { size: 1, invalid: 0x00, endianAware: false }, // string
  0x88: { size: 4, invalid: 0xffffffff, endianAware: true }, // float32 — sentinel as bit pattern
  0x89: { size: 8, invalid: 0xffffffffffffffffn, endianAware: true }, // float64
  0x0a: { size: 1, invalid: 0x00, endianAware: false }, // uint8z
  0x8b: { size: 2, invalid: 0x0000, endianAware: true }, // uint16z
  0x8c: { size: 4, invalid: 0x00000000, endianAware: true }, // uint32z
  0x0d: { size: 1, invalid: 0xff, endianAware: false }, // byte
  0x8e: { size: 8, invalid: 0x7fffffffffffffffn, endianAware: true }, // sint64
  0x8f: { size: 8, invalid: 0xffffffffffffffffn, endianAware: true }, // uint64
  0x90: { size: 8, invalid: 0x0000000000000000n, endianAware: true }, // uint64z
};

export function baseTypeMeta(id: number): BaseTypeMeta | undefined {
  return META[id];
}

export type FieldValue = number | bigint | string | null;

export function readBaseValue(
  view: DataView,
  offset: number,
  typeId: number,
  littleEndian: boolean,
  size: number,
): FieldValue {
  const meta = META[typeId];
  if (!meta) return null;
  const elementSize = meta.size;
  const count = elementSize > 0 ? Math.max(1, Math.floor(size / elementSize)) : size;

  if (typeId === 0x07) {
    let end = offset;
    while (end < offset + size && view.getUint8(end) !== 0) end++;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, end - offset);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Single-element decode for the common case.
  const decode = (eOff: number): number | bigint | null => {
    let raw: number | bigint;
    switch (typeId) {
      case 0x00:
      case 0x02:
      case 0x0d:
        raw = view.getUint8(eOff);
        break;
      case 0x01:
        raw = view.getInt8(eOff);
        break;
      case 0x83:
        raw = view.getInt16(eOff, littleEndian);
        break;
      case 0x84:
      case 0x8b:
        raw = view.getUint16(eOff, littleEndian);
        break;
      case 0x85:
        raw = view.getInt32(eOff, littleEndian);
        break;
      case 0x86:
      case 0x8c:
        raw = view.getUint32(eOff, littleEndian);
        break;
      case 0x88:
        raw = view.getFloat32(eOff, littleEndian);
        if (!Number.isFinite(raw)) return null;
        return raw;
      case 0x89:
        raw = view.getFloat64(eOff, littleEndian);
        if (!Number.isFinite(raw)) return null;
        return raw;
      case 0x0a:
        raw = view.getUint8(eOff);
        break;
      case 0x8e:
        raw = view.getBigInt64(eOff, littleEndian);
        break;
      case 0x8f:
      case 0x90:
        raw = view.getBigUint64(eOff, littleEndian);
        break;
      default:
        return null;
    }
    if (typeof meta.invalid === 'bigint') {
      if (typeof raw === 'bigint' && raw === meta.invalid) return null;
    } else if (typeof raw === 'number' && raw === meta.invalid) {
      return null;
    }
    return raw;
  };

  // For arrays, return the first non-null element. Most record fields are
  // single-valued; the exotic multi-element fields (e.g. compressed_speed_distance)
  // are not needed for the normalized ActivityRecord.
  for (let i = 0; i < count; i++) {
    const v = decode(offset + i * elementSize);
    if (v !== null) return v;
  }
  return null;
}
