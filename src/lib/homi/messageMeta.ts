/*
 * WHAT TRAVELS WITH ONE HOMI ANSWER BESIDES ITS WORDS.
 *
 * The designed blocks, the service cards and the (rate-limited) service
 * note belong to the answer they were written for: they are stored beside
 * it (ai_messages.meta) so a reopened conversation looks the way it did, and
 * so the server can see which services were already pitched.
 *
 * Suggested replies are deliberately NOT here. They belong only to the
 * latest answer, and a chip from an old answer must never come back.
 *
 * Parsed on both sides with the same validators, so a stored value is never
 * trusted just because it came out of our own database.
 */

import { parseAnswerBlocks, type HomiAnswerBlock } from './answerBlocks.ts';
import { isPitchable, type PitchableService } from './pitch.ts';
import { parseServiceActions, type ServiceActionId } from '../ai/serviceActions.ts';

export interface HomiMessageMeta {
  blocks: HomiAnswerBlock[];
  services: ServiceActionId[];
  pitch: PitchableService | null;
}

export const EMPTY_MESSAGE_META: HomiMessageMeta = Object.freeze({ blocks: [], services: [], pitch: null }) as HomiMessageMeta;

export function parseMessageMeta(raw: unknown): HomiMessageMeta {
  if (!raw || typeof raw !== 'object') return { blocks: [], services: [], pitch: null };
  const o = raw as Record<string, unknown>;
  return {
    blocks: parseAnswerBlocks(o.blocks),
    services: parseServiceActions(o.services).map((a) => a.id),
    pitch: isPitchable(o.pitch) ? (String(o.pitch).trim().toUpperCase() as PitchableService) : null,
  };
}

export function hasMeta(meta: HomiMessageMeta | null | undefined): boolean {
  return Boolean(meta && (meta.blocks.length || meta.services.length || meta.pitch));
}
