// HOMI helpers for homatch-ai: the deterministic answer, SSE framing, and the
// OpenAI Responses stream reader. Kept beside index.ts so the request flow in
// index.ts stays readable; nothing here touches money or the database.

import { HOMI_TEMPLATES, pick, type HomiDeterministicIntent } from '../../../src/lib/homi/content.ts';
import type { HomiCardRef } from '../../../src/lib/homi/cards.ts';
import { parseServiceActions, type ServiceAction } from '../../../src/lib/ai/serviceActions.ts';
import { stripAiDashes } from '../../../src/lib/homi/style.ts';
export { stripAiDashes };

export interface HomiReplyChip { id: string; label: string; value: string; intent?: string }

export interface DeterministicPayload {
  text: string;
  suggestedReplies: HomiReplyChip[];
  actions: ServiceAction[];
  cards: HomiCardRef[];
  mood: string;
}

/** A written answer, localised. Actions are still filtered by the caller (Service Control). */
export function deterministicPayload(intent: HomiDeterministicIntent, locale: string): DeterministicPayload {
  const t = HOMI_TEMPLATES[intent];
  const suggestedReplies = (t.chips ?? []).slice(0, 4).map((c, i) => {
    const label = pick(c.label, locale);
    return { id: `h${i + 1}`, label, value: label, ...(c.intent ? { intent: c.intent } : {}) };
  });
  return {
    text: pick(t.text, locale),
    suggestedReplies,
    actions: parseServiceActions(t.actions ?? []),
    cards: [...(t.cards ?? [])],
    mood: t.mood ?? 'happy',
  };
}

/* ── Server-sent events ─────────────────────────────────────────────── */

const enc = new TextEncoder();
export function sseFrame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

/* ── The hidden JSON block, held back while streaming ───────────────── */

const FENCE = '```json';

/**
 * How much of `raw` may be shown right now. The model appends a fenced JSON
 * block that must never reach the screen; while streaming we cannot know a
 * fence is starting until its characters arrive, so the last few characters
 * are held until they cannot be the beginning of one.
 */
export function visibleLength(raw: string): number {
  const at = raw.indexOf(FENCE);
  if (at >= 0) return at;
  /* Hold back a trailing partial "```json" (any prefix of it). */
  for (let k = Math.min(FENCE.length - 1, raw.length); k > 0; k--) {
    if (raw.endsWith(FENCE.slice(0, k))) return raw.length - k;
  }
  return raw.length;
}

/* ── OpenAI Responses stream ────────────────────────────────────────── */

export interface StreamedResponse {
  /** The final response object (usage, output, annotations), as non-streaming would return it. */
  response: any | null;
  rawText: string;
  firstDeltaMs: number | null;
  error: string | null;
}

/**
 * Reads an OpenAI Responses SSE body, calling onDelta with each newly
 * VISIBLE piece of text. Returns the completed response for accounting.
 */
export async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  startedAt: number,
  onDelta: (text: string) => void,
): Promise<StreamedResponse> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let raw = '';
  let shown = 0;
  let firstDeltaMs: number | null = null;
  let response: any = null;
  let error: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const dataLine = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!dataLine || dataLine === '[DONE]') continue;
      let evt: any;
      try { evt = JSON.parse(dataLine); } catch { continue; }
      if (evt?.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        raw += evt.delta;
        const v = visibleLength(raw);
        if (v > shown) {
          if (firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt;
          onDelta(stripAiDashes(raw.slice(shown, v)));
          shown = v;
        }
      } else if (evt?.type === 'response.completed') {
        response = evt.response ?? null;
      } else if (evt?.type === 'response.failed' || evt?.type === 'error') {
        error = String(evt?.response?.error?.message ?? evt?.message ?? evt?.error?.message ?? 'stream failed').slice(0, 200);
      }
    }
  }
  return { response, rawText: raw, firstDeltaMs, error };
}

/**
 * Keep the conversation inside a character budget, newest first, always
 * keeping the opening question (it usually states the goal). Returns how many
 * messages were dropped so the prompt can say so.
 */
export function trimConversation<T extends { role: string; content: string }>(msgs: T[], budget = 24_000): { kept: T[]; dropped: number } {
  if (!msgs.length) return { kept: msgs, dropped: 0 };
  const out: T[] = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const len = msgs[i].content.length;
    if (out.length > 0 && used + len > budget) break;
    out.unshift(msgs[i]);
    used += len;
  }
  const dropped = msgs.length - out.length;
  if (dropped > 0 && msgs[0].role === 'user' && out[0] !== msgs[0] && msgs[0].content.length < 2_000) {
    out.unshift(msgs[0]);
  }
  /* The Responses API expects the conversation to start with the user. */
  while (out.length && out[0].role !== 'user') out.shift();
  return { kept: out, dropped };
}
