/**
 * Geo primitives — points, bboxes, haversine distance.
 *
 * Coordinates are decimal degrees throughout.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in meters between two lat/lng points.
 */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sLng * sLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxOf(points: readonly LatLng[]): Bbox {
  if (points.length === 0) {
    return { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 };
  }
  const first = points[0]!;
  let minLat = first.lat;
  let maxLat = first.lat;
  let minLng = first.lng;
  let maxLng = first.lng;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}

/**
 * Returns true when the two bboxes overlap, with an optional pad in meters
 * applied symmetrically. Pad is computed at the latitude of `a` to keep
 * the math cheap.
 */
export function bboxesOverlap(a: Bbox, b: Bbox, padMeters = 0): boolean {
  if (padMeters === 0) {
    return !(
      a.maxLat < b.minLat ||
      a.minLat > b.maxLat ||
      a.maxLng < b.minLng ||
      a.minLng > b.maxLng
    );
  }
  const latPad = padMeters / 111_320; // 1° latitude ≈ 111.32 km
  const cosLat = Math.cos(toRadians((a.minLat + a.maxLat) / 2));
  const lngPad = padMeters / (111_320 * Math.max(0.01, cosLat));
  const padded: Bbox = {
    minLat: a.minLat - latPad,
    maxLat: a.maxLat + latPad,
    minLng: a.minLng - lngPad,
    maxLng: a.maxLng + lngPad,
  };
  return !(
    padded.maxLat < b.minLat ||
    padded.minLat > b.maxLat ||
    padded.maxLng < b.minLng ||
    padded.minLng > b.maxLng
  );
}
