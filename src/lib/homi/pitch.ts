/*
 * HOMI'S LIGHT MARKETING: a short, true note about a HOMATCH service.
 *
 * The owner wants HOMI to tell people, now and then, about a service that
 * genuinely fits and why it is strong. Two things make that safe:
 *
 *   1. THE WORDS ARE OURS. The model only picks WHICH service (an ID from a
 *      closed list). The note itself is code-owned copy in the i18n bundle
 *      (homi_pitch_<id>_title / _body), written once, reviewed once, and
 *      never improvised. A model cannot overclaim in a sentence it does not
 *      write, and cannot say "confirmed buyer".
 *   2. THE RATE IS CODE'S. At most once per conversation per service, never
 *      in two turns running, and never on the first answer.
 *
 * Pure and runtime-neutral.
 */

import type { ServiceActionId } from '../ai/serviceActions.ts';

/** Services that have reviewed pitch copy. Anything else is never pitched. */
export const PITCHABLE_SERVICES = [
  'VERIFY', 'FIND_PROPERTY', 'FIND_BUYERS_TENANTS', 'CONTRACT_INTELLIGENCE', 'MORTGAGE', 'INVESTMENT', 'FOR_EXPATS',
] as const;
export type PitchableService = typeof PITCHABLE_SERVICES[number] & ServiceActionId;

export function isPitchable(v: unknown): v is PitchableService {
  return typeof v === 'string' && (PITCHABLE_SERVICES as readonly string[]).includes(v.trim().toUpperCase());
}

/** The i18n keys of a pitch (resolved by the client). */
export function pitchKeys(id: PitchableService): { title: string; body: string } {
  const k = id.toLowerCase();
  return { title: `homi_pitch_${k}_title`, body: `homi_pitch_${k}_body` };
}

/**
 * May this turn carry a pitch for `candidate`?
 *
 * `history` is the pitch (or null) of every EARLIER assistant answer in this
 * conversation, oldest first.
 */
export function allowPitch(candidate: unknown, history: ReadonlyArray<string | null>): PitchableService | null {
  if (!isPitchable(candidate)) return null;
  const id = String(candidate).trim().toUpperCase() as PitchableService;
  if (history.length === 0) return null;               // never on the very first answer
  if (history.includes(id)) return null;               // once per conversation per service
  if (history.slice(-2).some((p) => p !== null)) return null; // never two turns running, and a breather after
  return id;
}

/** Sanitise a client- or DB-supplied history list. */
export function parsePitchHistory(raw: unknown): Array<string | null> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-40).map((v) => (isPitchable(v) ? String(v).trim().toUpperCase() : null));
}

export const HOMI_PITCH_INSTRUCTION = [
  'A WORD ABOUT HOMATCH, SOMETIMES',
  `In the same JSON block you may return "pitch_service": one ID from ${PITCHABLE_SERVICES.join(', ')}, or null.`,
  'Choose one only when that service is genuinely the right help for what this person is dealing with right now and they',
  'have not used it in this conversation. HOMATCH shows a short, reviewed note about it under your answer, so do NOT praise',
  'or advertise the service in your own prose. Most turns return null; never when somebody is upset or the topic is not a',
  'property decision.',
].join('\n');
