/*
 * HOMI voice: a long dictation is one message made of parts.
 *
 * The server takes at most two minutes (two Google segments) per request, a
 * technical cap and not a product limit. So the recorder hands over a finished
 * part shortly before that cap and keeps recording; each part is transcribed
 * in the background while the person carries on talking, and when they press
 * send the parts become ONE message, in the order they were spoken.
 *
 * Pure: no React, no network. The button and node:test import it.
 */
/** Must equal useVoiceRecorder's SEGMENT_MS (a test keeps them equal; no import, so node:test needs no bundler). */
export const RECORDER_SEGMENT_MS = 58_000;

/**
 * When a part is cut: 1.5 s before the second segment would roll over, so a
 * part is always two segments at most (the server's cap per request).
 */
export const PART_CUT_MS = 2 * RECORDER_SEGMENT_MS - 1_500;

export interface PartTranscript { transcript: string; noSpeech: boolean; durationSeconds: number }

/** The words of every part, in order, with silent parts left out. */
export function joinTranscripts(parts: ReadonlyArray<PartTranscript | null | undefined>): string {
  return parts
    .map((p) => (p && !p.noSpeech ? String(p.transcript ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The message's length: the server's measured seconds per part, else what was recorded. */
export function totalSeconds(parts: ReadonlyArray<{ durationMs: number; result: PartTranscript | null }>): number {
  return parts.reduce((s, p) => s + (p.result?.durationSeconds || p.durationMs / 1000), 0);
}

/** Whether the next part should be cut now. */
export function partDue(elapsedMs: number, partStartedAtMs: number): boolean {
  return elapsedMs - partStartedAtMs >= PART_CUT_MS;
}
