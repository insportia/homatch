import type { GeometryState } from '@/lib/designStudio/types';
import type { SpaceModel } from '@/lib/designStudio/space';

type T = (key: string, vars?: Record<string, string>) => string;

const KIND_KEY: Record<string, string> = {
  LIVING: 'ds_room_living',
  BEDROOM: 'ds_room_bedroom',
  KITCHEN: 'ds_room_kitchen',
  BATHROOM: 'ds_room_bathroom',
  WC: 'ds_room_wc',
  HALL: 'ds_room_hall',
  CORRIDOR: 'ds_room_corridor',
  STORAGE: 'ds_room_storage',
  BALCONY: 'ds_room_balcony',
  TERRACE: 'ds_room_terrace',
  UNKNOWN: 'ds_room_unknown',
};

/**
 * Room names in the reader's language: "Bedroom", and "Bedroom 2" when a
 * space has two. The drawing's own label is data in the drawing's language
 * and is not what the interface speaks.
 */
export function roomNames(space: SpaceModel, t: T): Map<string, string> {
  const byKind = new Map<string, string[]>();
  for (const room of space.rooms) {
    const list = byKind.get(room.kind) ?? [];
    list.push(room.id);
    byKind.set(room.kind, list);
  }
  const names = new Map<string, string>();
  for (const room of space.rooms) {
    const base = t(KIND_KEY[room.kind] ?? 'ds_room_unknown');
    const siblings = byKind.get(room.kind) ?? [];
    names.set(room.id, siblings.length > 1 ? `${base} ${siblings.indexOf(room.id) + 1}` : base);
  }
  return names;
}

/**
 * An area, honest about how well it is known: "≈ 42 m²" for an estimate,
 * "42 m²" once calibrated or verified. Never more precision than the source.
 */
export function formatArea(m2: number, state: GeometryState, t: T): string {
  const value = state === 'ESTIMATED' ? String(Math.round(m2)) : (Math.round(m2 * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return t(state === 'ESTIMATED' ? 'ds_area_estimated' : 'ds_area_m2', { value });
}

export function formatLength(m: number, state: GeometryState, t: T): string {
  const value = state === 'ESTIMATED' ? (Math.round(m * 10) / 10).toFixed(1) : (Math.round(m * 100) / 100).toFixed(2);
  return t(state === 'ESTIMATED' ? 'ds_length_estimated' : 'ds_length_m', { value });
}
