// HOMATCH — the browser's end of Georgian recognition.
//
// A WebSocket on this worker, one Google stream behind each socket, and a
// grant that proves Homatch sent the browser here.
//
// WHY A GRANT RATHER THAN A LOGIN
//
// AI TALK's visitors are anonymous by design — there is no Supabase user to
// verify. So the edge function that already decides whether somebody may talk
// mints a short-lived token over the session id, signed with WORKER_TOKEN,
// which this worker and that function already share and which never reaches
// the browser. The browser carries the signature, not the secret. A token is
// good for one session id and expires in minutes, so a copied one is worth
// nothing by the time anybody notices it.
//
// WHY THE SOCKET CARRIES PCM AND NOT AUDIO FILES
//
// The browser already captures, resamples and frames PCM16 for the two
// existing transcribers. Sending the same frames here means no new encoder,
// no container, and no waiting for a file to exist before recognition starts.

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
// From node:url rather than the global: the test build compiles without the
// DOM lib, where the ambient URL is a different and much smaller type.
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GoogleSpeechStream, speechConfigFromEnv, speechConfigProblem,
  configuredLanguages, MAX_STREAM_LANGUAGES,
} from './GoogleSpeechStream.js';

export const SPEECH_PATH = '/speech/stream';

/**
 * How long to wait for Google's final after the speaker stops.
 *
 * Long enough for the endpointer to flush a sentence, short enough that a
 * provider which has silently stopped answering does not hold the socket. Both
 * outcomes are reported, so a session that ends without its last sentence says
 * so rather than looking identical to one that did not.
 */
const FINAL_GRACE_MS = 4000;

/** A grant older than this is refused even if the signature is good. */
const MAX_GRANT_AGE_MS = 10 * 60 * 1000;

/** One conversation per socket, and a ceiling so nothing runs forever. */
const MAX_SESSION_MS = 15 * 60 * 1000;

interface Grant { sessionId: string; expiresAt: number }

/**
 * Verify a grant minted by the edge function.
 *
 * `<sessionId>.<expiresAtMs>.<hexHmac>` — the payload is readable, which is
 * fine: it is a session id the holder already has. What it cannot do is
 * change either half without the secret.
 */
export function verifyGrant(token: string, secret: string): Grant | null {
  if (!secret) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [sessionId, expiresRaw, signature] = parts;
  if (!sessionId || !expiresRaw || !signature) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;
  if (expiresAt < Date.now()) return null;
  if (expiresAt - Date.now() > MAX_GRANT_AGE_MS) return null;

  const expected = createHmac('sha256', secret)
    .update(`${sessionId}.${expiresRaw}`)
    .digest('hex');

  // Constant time. A comparison that returns early leaks the signature one
  // byte at a time to anybody willing to measure.
  const a = new Uint8Array(Buffer.from(expected, 'utf8'));
  const b = new Uint8Array(Buffer.from(signature, 'utf8'));
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { sessionId, expiresAt };
}

interface Send { (payload: Record<string, unknown>): void }

/**
 * Whatever `ws` handed over, as bytes.
 *
 * It delivers a Buffer, an ArrayBuffer, or an ARRAY of Buffers depending on
 * how the frame arrived — the array form only under fragmentation, which is
 * to say only on somebody's slow network and never on the developer's. All
 * three are handled here rather than assumed.
 */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const parts = data.map((d) => toBytes(d));
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    return out;
  }
  const view = data as ArrayBufferView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Attach the speech socket to the worker's existing HTTP server.
 *
 * Returns a description of what it can do, so /health can tell the truth
 * about whether Georgian recognition is actually available on this instance
 * rather than merely deployed to it.
 */
export function attachSpeechGateway(server: Server, opts: { token: string }): {
  available: boolean;
  reason: string | null;
  model: string | null;
  language: string | null;
} {
  const problem = speechConfigProblem();
  const cfg = speechConfigFromEnv();
  if (problem || !cfg) {
    // Deployed without credentials is a normal state for the second instance
    // of this image, and it must not pretend otherwise. Neither must a region
    // that cannot serve the configured model: that one reported `available`
    // for hours while every stream died on a hostname that does not exist.
    return { available: false, reason: problem ?? 'GOOGLE_SPEECH_NOT_CONFIGURED', model: null, language: null };
  }
  if (!opts.token) {
    return { available: false, reason: 'WORKER_TOKEN_NOT_SET', model: null, language: null };
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try { url = new URL(req.url || '', 'http://worker'); } catch { socket.destroy(); return; }
    if (url.pathname !== SPEECH_PATH) return; // another upgrade handler's business

    const grant = verifyGrant(url.searchParams.get('grant') || '', opts.token);
    if (!grant) {
      // A plain 401 on the upgrade, so a browser sees a refusal rather than a
      // socket that opens and then goes quiet.
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      serve(ws, cfg, grant, url.searchParams.get('language'), url.searchParams.get('languages'),
        url.searchParams.get('detect') === '1');
    });
  });

  return { available: true, reason: null, model: cfg.model, language: cfg.languageCode };
}

function serve(
  ws: WebSocket,
  cfg: ReturnType<typeof speechConfigFromEnv> & object,
  grant: Grant,
  languageOverride: string | null,
  /** Every language the caller expects, comma-separated, or null for the default set. */
  languagesOverride: string | null,
  /**
   * Let the recogniser decide the language for itself, for THIS socket only.
   *
   * Chirp 3 takes exactly one language code or the single code `auto`, and
   * nothing in between -- an explicit list is INVALID_ARGUMENT. `auto` was
   * measured to damage short Georgian badly enough to be switched off
   * globally, so it is not a mode this service runs in.
   *
   * It is still the only way to answer "what language is this person
   * speaking", which is the question a visitor who simply starts talking
   * poses. Per-socket and opt-in, so that question can be asked on a stream
   * that expects it without changing what every other stream does.
   */
  detect: boolean,
): void {
  const send: Send = (payload) => {
    if (ws.readyState !== ws.OPEN) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* the close handler tidies up */ }
  };

  /*
   * One session's language, never the whole catalogue.
   *
   * The override exists because a caller may be speaking Russian on a
   * Georgian page, and asking for one language beats asking for detection
   * across several — detection costs accuracy on the one that matters.
   * Anything unrecognised falls back to the configured default rather than
   * being passed to Google as-is.
   */
  const language = /^[a-z]{2}-[A-Z]{2}$/.test(String(languageOverride ?? ''))
    ? String(languageOverride)
    : cfg.languageCode;

  /*
   * EVERY LANGUAGE THIS SOCKET WILL ACCEPT.
   *
   * The caller sends the set the conversation could plausibly be in, and the
   * recogniser decides per utterance which one it heard. A visitor never
   * picks: they start talking.
   *
   * Validated the same way the single tag is, and capped at the provider's
   * per-stream limit, because everything here arrives in a query string a
   * browser controls. `language` is put first so an established conversation
   * keeps its language as the primary candidate rather than being re-decided
   * from scratch every turn.
   */
  const requested = String(languagesOverride ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^[a-z]{2,3}-[A-Z]{2}$/.test(x));

  const languages: string[] = [];
  for (const tag of [language, ...requested, ...configuredLanguages()]) {
    if (!languages.includes(tag)) languages.push(tag);
    if (languages.length === MAX_STREAM_LANGUAGES) break;
  }

  const started = Date.now();
  let ended = false;

  const stream = new GoogleSpeechStream(
    { ...cfg, languageCode: language, languageCodes: detect ? ['auto'] : languages, detect }, {
    onInterim: (text, heard) => send({ type: 'interim', text, language: heard ?? language }),
    onFinal: (text, confidence, heard) => {
      // The language the PROVIDER decided it heard, not the one we guessed.
      // It is the only thing that separates English from Turkish here.
      send({ type: 'final', text, confidence, language: heard ?? language });
      // The sentence the half-close was waiting for. Ordinary mid-conversation
      // finals leave awaitingFinal null and change nothing here.
      if (awaitingFinal) {
        clearTimeout(awaitingFinal);
        awaitingFinal = null;
        finish(1000, 'CLIENT_DONE');
      }
    },
    onRestart: () => send({ type: 'restarted' }),
    /*
     * Forwarded so the browser can stop counting silence for itself when the
     * recogniser has already decided. It is a fact from the provider, not an
     * instruction: the session decides what to do with it.
     */
    onSpeechEvent: (kind) => send({ type: 'speech_event', kind }),
    onUnavailable: (reason) => {
      send({ type: 'unavailable', reason });
      finish(1011, reason);
    },
  });

  function finish(code: number, reason: string): void {
    if (ended) return;
    ended = true;
    stream.close();
    clearTimeout(ceiling);
    try { ws.close(code, reason.slice(0, 120)); } catch { /* already closing */ }
  }

  const ceiling = setTimeout(() => finish(1000, 'SESSION_LIMIT'), MAX_SESSION_MS);

  ws.on('message', (data, isBinary) => {
    if (ended) return;
    if (isBinary) {
      /*
       * The common case: raw PCM16 frames, sent as they are captured.
       *
       * `ws` hands over a Buffer, an ArrayBuffer, or an array of Buffers
       * depending on how the frame arrived. All three are normalised here
       * rather than assumed, because the array form appears only under
       * fragmentation and would otherwise fail on somebody's slow network
       * and nowhere else.
       */
      stream.write(toBytes(data));
      return;
    }
    // The only text message worth understanding is "I have stopped".
    try {
      const msg = JSON.parse(String(data));
      if (msg?.type === 'close') endOfSpeech();
    } catch { /* anything else is ignored rather than trusted */ }
  });

  /**
   * "I have stopped talking" is not "close this socket".
   *
   * It used to be, and the last utterance of every conversation paid for it:
   * Google flushes the final transcript AFTER the input half-closes, so
   * tearing the stream down on the client's own end-of-turn threw away the
   * only version of that sentence anybody was going to act on. Interim text
   * had been arriving the whole time, which made it look like it worked.
   *
   * Now the audio side closes, the listeners stay, and the socket waits --
   * briefly, and never forever. If the final arrives the socket closes on it;
   * if it does not, the wait ends on its own rather than holding a paid
   * connection open on the chance.
   */
  let awaitingFinal: NodeJS.Timeout | null = null;

  function endOfSpeech(): void {
    if (ended || awaitingFinal) return;
    stream.halfClose();
    awaitingFinal = setTimeout(() => finish(1000, 'CLIENT_DONE_NO_FINAL'), FINAL_GRACE_MS);
  }

  ws.on('close', () => {
    if (awaitingFinal) clearTimeout(awaitingFinal);
    finish(1000, 'SOCKET_CLOSED');
  });
  ws.on('error', () => finish(1011, 'SOCKET_ERROR'));

  stream.start();
  send({
    type: 'ready',
    provider: 'GOOGLE',
    model: cfg.model,
    language,
    // Every candidate this stream will accept, so a client can show what it
    // is prepared to hear rather than assuming one.
    languages,
    sampleRate: cfg.sampleRate,
    // Echoed so a browser can prove the socket it is on belongs to the
    // session it thinks it is in.
    sessionId: grant.sessionId,
  });

  ws.on('close', () => {
    // Counts only. Never a word of what was said: a transcript is the
    // speaker's, and this process has no business keeping one.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      at: new Date().toISOString(), service: 'speech',
      event: 'session_closed', ms: Date.now() - started,
      frames: stream.frames, bytes: stream.bytes, language,
    }));
  });
}
