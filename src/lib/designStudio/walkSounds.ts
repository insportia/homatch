// HOMATCH Design Studio — what a walked home sounds like when it is used.
//
// Each interaction (a door, a tap, a toilet, a switch, a TV) is heard as it
// happens: the cue is chosen here from the machine's role and the state it is
// moving into, and synthesised by the browser (canvas/walkSounds.ts) — no
// recordings are downloaded, nothing is sent anywhere, and the visitor can
// switch it off (PlayerSettings.sound).
//
// Pure: no Web Audio, no three.js.

import type { InteractionRole } from './interactions.ts';

export type SoundCue =
  | 'DOOR_OPEN' | 'DOOR_CLOSE' | 'WINDOW_OPEN' | 'WINDOW_CLOSE'
  | 'CABINET_OPEN' | 'CABINET_CLOSE' | 'DRAWER_OPEN' | 'DRAWER_CLOSE' | 'FRIDGE_OPEN' | 'FRIDGE_CLOSE'
  | 'SWITCH' | 'TV_ON' | 'TV_OFF' | 'FLUSH' | 'WATER_ON' | 'WATER_OFF' | 'CURTAIN'
  | 'HOB_CLICK' | 'COFFEE' | 'MOTOR' | 'SIT' | 'STAND'
  | 'SIZZLE' | 'SIZZLE_END' | 'PLATE' | 'SLURP';

/** Cues that keep sounding while their machine stays in the state (running water), until it leaves it. */
export const LOOPING: ReadonlySet<SoundCue> = new Set(['WATER_ON', 'SIZZLE']);

/**
 * The cue for one transition: `active` is whether the state moved into is the machine's "on/open" one
 * (interactions.ts isActiveState), `to` the state's id (a toilet's FLUSHING). Null: nothing worth hearing.
 */
export function soundFor(role: InteractionRole, active: boolean, to: string): SoundCue | null {
  switch (role) {
    case 'DOOR': case 'BALCONY_DOOR': return active ? 'DOOR_OPEN' : 'DOOR_CLOSE';
    case 'WINDOW': return active ? 'WINDOW_OPEN' : 'WINDOW_CLOSE';
    case 'WARDROBE': case 'CABINET': case 'OVEN': case 'DISHWASHER': case 'WASHER': case 'MIRROR':
      return active ? 'CABINET_OPEN' : 'CABINET_CLOSE';
    case 'DRAWER': return active ? 'DRAWER_OPEN' : 'DRAWER_CLOSE';
    case 'APPLIANCE': case 'FREEZER': return active ? 'FRIDGE_OPEN' : 'FRIDGE_CLOSE';
    case 'LIGHT': case 'LAMP': return 'SWITCH';
    case 'TV': return active ? 'TV_ON' : 'TV_OFF';
    // A toilet's one active state is its flush; it settles back by itself (no sound for that).
    case 'TOILET': return active ? 'FLUSH' : null;
    case 'FAUCET': case 'SHOWER': case 'BATH':
      // Draining a bath, or a tap turned off: the water stops (a short squeak of the handle).
      return active && !/DRAIN/i.test(to) ? 'WATER_ON' : 'WATER_OFF';
    case 'CURTAIN': case 'BLIND': return 'CURTAIN';
    // A pan on the hob: it sizzles from the moment it goes on until it is done; served, a plate.
    case 'STOVE':
      if (/SEAR/.test(to)) return 'SIZZLE';
      if (/COOKING/.test(to)) return null;
      if (/DONE/.test(to)) return 'SIZZLE_END';
      if (/SERVE/.test(to)) return 'PLATE';
      return active ? 'HOB_CLICK' : 'SWITCH';
    // The machine brews; the cup is sipped (a slurp, not a machine); settling back is silent.
    case 'COFFEE':
      if (/SIP|DRINK/.test(to)) return 'SLURP';
      if (/BREW/.test(to)) return 'COFFEE';
      return null;
    case 'RECLINER': return 'MOTOR';
    case 'SEAT': case 'BED': return active ? 'SIT' : 'STAND';
  }
  return null;
}

/** How loud a cue is from this far away (m): full within a metre, fading with distance, silent past 12 m. */
export function distanceGain(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM > 12) return 0;
  return Math.min(1, 1 / Math.max(1, distanceM) ** 1.1);
}
