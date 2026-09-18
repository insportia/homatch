import { parseNumber, round } from './numbers.ts';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Six decimals is roughly 11cm - far more precision than any listing has, and
 * enough that two sources quoting the same point produce the same key.
 */
const PRECISION = 6;

export function normalizeGeoPoint(lat: unknown, lng: unknown): GeoPoint | null {
  const latitude = parseNumber(typeof lat === 'string' || typeof lat === 'number' ? lat : null, {
    ambiguousTripleGroup: 'decimal',
  });
  const longitude = parseNumber(typeof lng === 'string' || typeof lng === 'number' ? lng : null, {
    ambiguousTripleGroup: 'decimal',
  });
  if (latitude === null || longitude === null) return null;
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  // 0,0 is Null Island: almost always a missing value rather than a location.
  if (latitude === 0 && longitude === 0) return null;
  return { lat: round(latitude, PRECISION), lng: round(longitude, PRECISION) };
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Parse "41.7151, 44.8271" or "41.7151,44.8271". */
export function parseGeoPair(text: string): GeoPoint | null {
  const match = text.match(/(-?\d{1,3}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;
  return normalizeGeoPoint(match[1], match[2]);
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))), 1);
}

export function withinRadius(a: GeoPoint, b: GeoPoint, radiusM: number): boolean {
  return haversineDistanceM(a, b) <= radiusM;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Approximate bounding box for a radius search - cheap pre-filter before haversine. */
export function boundingBox(center: GeoPoint, radiusM: number): BoundingBox {
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(Math.cos((center.lat * Math.PI) / 180), 1e-6);
  return {
    minLat: round(center.lat - latDelta, PRECISION),
    maxLat: round(center.lat + latDelta, PRECISION),
    minLng: round(center.lng - lngDelta, PRECISION),
    maxLng: round(center.lng + lngDelta, PRECISION),
  };
}

export function geoKey(point: GeoPoint, decimals = 4): string {
  return `${round(point.lat, decimals)},${round(point.lng, decimals)}`;
}
