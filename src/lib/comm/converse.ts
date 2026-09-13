// HOMATCH AI TALK — reading a turn as it is produced.
//
// The turn endpoint answers with server-sent events rather than one JSON
// object, because the useful parts arrive at very different times: the first
// words within a few hundred milliseconds, the first audio a moment later,
// the rest while the voice is already playing.
//
// supabase-js `functions.invoke` is not used here, deliberately. It reads the
// whole body before resolving, which would throw away the only thing this
// endpoint exists to provide.

import type { ConverseEvent } from './voiceClient.ts';

/** Split an SSE body into `event:`/`data:` pairs as they arrive. */
export function parseSseChunk(
  buffer: string,
): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;

  // A frame ends at a blank line. Anything after the last one is a partial
  // frame and has to wait for more bytes — splitting on every newline is how
  // a JSON payload gets cut in half.
  let cut = rest.indexOf('\n\n');
  while (cut !== -1) {
    const frame = rest.slice(0, cut);
    rest = rest.slice(cut + 2);
    cut = rest.indexOf('\n\n');

    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) events.push({ event, data: dataLines.join('\n') });
  }

  return { events, rest };
}

export interface ConverseRequest {
  url: string;
  /** The publishable key. Public by design — it is in every bundle already. */
  anonKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * One streamed turn, as events.
 *
 * Yields whatever the server sends in the order it sends it, and ends. A
 * transport failure is reported as a `failed` event rather than thrown,
 * because every caller has the same thing to do about it — say so and keep
 * listening — and none of them should have to write a try/catch to find out.
 */
export async function* converseStream(req: ConverseRequest): AsyncGenerator<ConverseEvent> {
  let response: Response;
  try {
    response = await fetch(req.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        apikey: req.anonKey,
        authorization: `Bearer ${req.anonKey}`,
      },
      body: JSON.stringify(req.body),
      signal: req.signal,
    });
  } catch {
    yield { type: 'failed', reason: 'NETWORK' };
    return;
  }

  if (!response.ok || !response.body) {
    yield { type: 'failed', reason: response.status === 409 ? 'SESSION_NOT_ACTIVE' : 'ASSISTANT_FAILED' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;

      for (const frame of events) {
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(frame.data) as Record<string, unknown>; } catch { continue; }
        const event = toConverseEvent(frame.event, payload);
        if (event) yield event;
      }
    }
  } catch {
    yield { type: 'failed', reason: 'NETWORK' };
  } finally {
    try { await reader.cancel(); } catch { /* already finished */ }
  }
}

/**
 * One frame, validated into the shape the runtime expects.
 *
 * Unknown event names are dropped rather than passed through: the server may
 * grow a diagnostic event tomorrow, and a browser that has not been
 * redeployed must ignore it rather than break the turn.
 */
function toConverseEvent(name: string, data: Record<string, unknown>): ConverseEvent | null {
  switch (name) {
    case 'open':
      return { type: 'open', ms: num(data.ms), language: str(data.language) };
    case 'text':
      return typeof data.delta === 'string' ? { type: 'text', delta: data.delta } : null;
    case 'reply':
      return typeof data.text === 'string'
        ? { type: 'reply', text: data.text, language: str(data.language) }
        : null;
    case 'audio':
      return typeof data.pcmBase64 === 'string' && Number.isFinite(Number(data.sampleRate))
        ? {
          type: 'audio',
          pcmBase64: data.pcmBase64,
          sampleRate: Number(data.sampleRate),
          index: num(data.index),
        }
        : null;
    case 'voiceless':
      return {
        type: 'voiceless',
        reason: str(data.reason),
        providerCode: str(data.providerCode),
        providerStatus: num(data.providerStatus),
      };
    case 'state':
      return 'state' in data ? { type: 'state', state: data.state } : null;
    case 'done':
      return {
        type: 'done',
        firstTextMs: num(data.firstTextMs),
        firstAudioMs: num(data.firstAudioMs),
        totalMs: num(data.totalMs),
        ttsMs: num(data.ttsMs),
      };
    case 'failed':
      return { type: 'failed', reason: str(data.reason) ?? 'ASSISTANT_FAILED' };
    default:
      return null;
  }
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
