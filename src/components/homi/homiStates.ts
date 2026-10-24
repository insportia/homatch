/*
 * HOMI's states, and which render of the 3D model shows each one.
 *
 * On the site HOMI is the 3D model everywhere (owner decision, 2026-10-24).
 * Large placements run the live model (HomiStage3D); small ones — the chat
 * header, message avatars, the "one moment" indicator — show renders of the
 * SAME model in the same poses, made from the approved Blender master by
 * scripts/homi/render-stills.py. One WebGL scene per message would be far too
 * heavy on a phone; a 10 KB render of the identical character is not.
 *
 * "thinking" is a friendly progress pose, never a claim about the model's
 * reasoning.
 */

export const HOMI_STATES = [
  'idle', 'greeting', 'listening', 'thinking', 'searching', 'explaining',
  'happy', 'surprised', 'encouraging', 'success', 'error', 'goodbye', 'pointing', 'writing',
] as const;
export type HomiState = typeof HOMI_STATES[number];

/** States that share a render. */
const RENDER_OF: Partial<Record<HomiState, HomiState>> = { goodbye: 'greeting' };

export type HomiCrop = 'head' | 'upper' | 'bust' | 'full';

export function homiStillUrl(state: HomiState, crop: HomiCrop): string {
  const pose = RENDER_OF[state] ?? state;
  return `/images/homi/homi-${crop === 'full' ? 'bust' : crop}-${pose}.webp`;
}

/** A light idle motion per state (Web Animations keyframes), never required to understand the state. */
export function homiMotion(state: HomiState): { frames: Keyframe[]; duration: number } | null {
  switch (state) {
    case 'thinking':
    case 'searching':
      return { frames: [{ transform: 'rotate(-2deg)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(-2deg)' }], duration: 2400 };
    case 'greeting':
    case 'goodbye':
    case 'happy':
    case 'success':
      return { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-4%)' }, { transform: 'translateY(0)' }], duration: 1400 };
    case 'writing':
      /* A light, quick keystroke rhythm. */
      return { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-1.2%)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-0.6%)' }, { transform: 'translateY(0)' }], duration: 700 };
    case 'surprised':
      return { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.04) translateY(-3%)' }, { transform: 'scale(1)' }], duration: 900 };
    case 'error':
      return null;
    default:
      return { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-1.5%)' }, { transform: 'translateY(0)' }], duration: 3600 };
  }
}
