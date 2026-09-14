// HOMATCH SPEECH GATEWAY — proving the whole chain works, from inside the
// machine that is the only one able to prove it.
//
// WHY THE WORKER TESTS ITSELF
//
// The chain is: edge function mints an HMAC grant -> browser opens a WebSocket
// to this worker -> this worker opens a gRPC StreamingRecognize to Google ->
// Georgian text comes back. Every link is verifiable EXCEPT by anybody
// outside, because the two things that authorise it -- WORKER_TOKEN and the
// Google service account -- live here and must never leave.
//
// That produced a genuine deadlock. The only door that mints a grant is the
// live AI TALK route, and that route only opens when an operator has enabled
// Google in comm_provider_routes. So the sole way to find out whether realtime
// Georgian recognition actually worked was to switch it on for real visitors
// and watch what happened to them. This workstream did exactly that once, and
// it was the wrong order.
//
// The worker holds both secrets already. So it mints its own grant and
// connects to its OWN public gateway as an ordinary client -- over the real
// socket path, through the real signature check, into the real gRPC stream. If
// any link is broken this says so, and no visitor was ever routed at it.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not reach inside GoogleSpeechStream and call it directly. A
// diagnostic that takes a shortcut past the thing it is diagnosing proves
// only that the shortcut works. It connects over 127.0.0.1 because that is
// this process's own listening socket, and everything above the TCP layer --
// the upgrade, the grant, the config frame, the audio framing -- is the code
// a browser reaches.
//
// WHAT IT NEVER RETURNS
//
// No credential, no grant, no token. The report is: did it connect, did audio
// reach Google, what did Google say, and how long did each step take.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
// URL from node:url, not the global: the test build has no DOM lib and the
// two declarations are not the same type. SpeechGateway.ts does the same.
import { fileURLToPath, URL } from 'node:url';
import WebSocket from 'ws';

/** The known Georgian sentence in the fixture. See fixtures/README.md. */
export const FIXTURE_TEXT =
  'გამარჯობა, მე მარიამი ვარ, Homatch-ის AI ასისტენტი. რით შემიძლია დაგეხმაროთ?';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/ka-selftest.pcm', import.meta.url));

const SAMPLE_RATE = 16_000;
/** 20ms of 16-bit mono audio, the same cadence a browser capture node emits. */
const FRAME_BYTES = (SAMPLE_RATE / 50) * 2;
/** A 6-second clip plus recognition time; well under any sane request timeout. */
const OVERALL_TIMEOUT_MS = 45_000;
/** How long to keep waiting for a final after the audio has all been sent. */
const FINAL_GRACE_MS = 12_000;

export interface SelfTestReport {
  ok: boolean;
  /** Short machine-readable outcome, safe to show an operator. */
  reason: string | null;
  socketAccepted: boolean;
  audioBytesSent: number;
  framesSent: number;
  interimCount: number;
  firstInterim: string | null;
  finalText: string | null;
  /** Did the transcript come back in Georgian script at all? */
  georgianScript: boolean;
  /** Rough word overlap with the known sentence, 0..1. */
  resemblance: number;
  timings: {
    connectMs: number | null;
    firstInterimMs: number | null;
    finalMs: number | null;
    totalMs: number;
  };
  expectedText: string;
}

/**
 * One run of the whole chain.
 *
 * `port` is this process's own listening port: the test is a client of the
 * server it is running inside.
 */
export async function runSpeechSelfTest(
  port: number,
  opts: { token: string; language?: string } = { token: '' },
): Promise<SelfTestReport> {
  const started = Date.now();
  const language = opts.language || 'ka-GE';

  const base = (): SelfTestReport => ({
    ok: false, reason: null, socketAccepted: false,
    audioBytesSent: 0, framesSent: 0, interimCount: 0,
    firstInterim: null, finalText: null, georgianScript: false, resemblance: 0,
    timings: { connectMs: null, firstInterimMs: null, finalMs: null, totalMs: Date.now() - started },
    expectedText: FIXTURE_TEXT,
  });

  if (!opts.token) {
    return { ...base(), reason: 'NO_WORKER_TOKEN' };
  }

  let audio: Buffer;
  try {
    audio = readFileSync(FIXTURE_PATH);
  } catch {
    return { ...base(), reason: 'FIXTURE_MISSING' };
  }

  // The same grant the edge function mints, minted here so the signature check
  // on the other side of this socket is the real one.
  const sessionId = `selftest-${Date.now().toString(36)}`;
  const expiresAt = Date.now() + 2 * 60_000;
  const payload = `${sessionId}.${expiresAt}`;
  const grant = `${payload}.${createHmac('sha256', opts.token).update(payload).digest('hex')}`;

  const url = `ws://127.0.0.1:${port}/speech/stream`
    + `?grant=${encodeURIComponent(grant)}&language=${encodeURIComponent(language)}`;

  return await new Promise<SelfTestReport>((resolve) => {
    const report = base();
    let settled = false;
    let readyAt = 0;
    let firstAudioAt = 0;
    let lastAudioAt = 0;
    let sendTimer: NodeJS.Timeout | null = null;

    const ws = new WebSocket(url);

    const finish = (reason: string | null) => {
      if (settled) return;
      settled = true;
      if (sendTimer) clearInterval(sendTimer);
      clearTimeout(overall);
      clearTimeout(grace);
      try { ws.close(); } catch { /* already */ }

      report.reason = reason;
      report.timings.totalMs = Date.now() - started;
      report.georgianScript = /[Ⴀ-ჿ]/.test(report.finalText ?? '');
      report.resemblance = similarity(report.finalText ?? '', FIXTURE_TEXT);
      // A pass means every link carried: the socket took the grant, audio went
      // out, Google answered while speech was still happening, and it answered
      // in Georgian. Any one of those missing is a failure worth a red line.
      report.ok = report.socketAccepted
        && report.audioBytesSent > 0
        && report.interimCount > 0
        && Boolean(report.finalText)
        && report.georgianScript;
      resolve(report);
    };

    const overall = setTimeout(() => finish('OVERALL_TIMEOUT'), OVERALL_TIMEOUT_MS);
    let grace: NodeJS.Timeout = setTimeout(() => { /* armed after audio */ }, OVERALL_TIMEOUT_MS);

    ws.on('unexpected-response', (_req, res) => {
      // A 401 here means the grant was refused, which is a different and much
      // more useful answer than "the socket did not open".
      finish(res.statusCode === 401 ? 'GRANT_REFUSED' : `UPGRADE_${res.statusCode}`);
    });

    ws.on('error', () => finish(report.socketAccepted ? 'SOCKET_ERROR' : 'CONNECT_FAILED'));

    ws.on('open', () => {
      report.socketAccepted = true;
      report.timings.connectMs = Date.now() - started;
    });

    ws.on('message', (data) => {
      let msg: { type?: string; text?: string; reason?: string };
      try { msg = JSON.parse(String(data)); } catch { return; }

      switch (msg.type) {
        case 'ready':
          readyAt = Date.now();
          report.timings.connectMs = readyAt - started;
          startSending();
          break;

        case 'interim': {
          const text = String(msg.text ?? '').trim();
          if (!text) break;
          report.interimCount += 1;
          if (!report.firstInterim) {
            report.firstInterim = text;
            // Measured from the first byte of audio, which is the only moment
            // that means anything to a person waiting to see their words.
            report.timings.firstInterimMs = firstAudioAt ? Date.now() - firstAudioAt : null;
          }
          break;
        }

        case 'final': {
          const text = String(msg.text ?? '').trim();
          if (!text) break;
          report.finalText = text;
          // From the END of the audio: this is the silence a speaker sits in
          // after they stop talking, waiting for the assistant to react.
          report.timings.finalMs = lastAudioAt ? Date.now() - lastAudioAt : null;
          finish(null);
          break;
        }

        case 'unavailable':
          finish(`PROVIDER_${String(msg.reason ?? 'ERROR').slice(0, 30)}`);
          break;

        default:
          break;
      }
    });

    /**
     * Paced at real time on purpose.
     *
     * Dumping six seconds of audio in one write would measure how fast Google
     * can chew a buffer, which is not a number anybody experiences. Sending it
     * at the rate a microphone produces it makes "first interim" mean what it
     * means in a conversation.
     */
    function startSending(): void {
      let offset = 0;
      sendTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset >= audio.length) {
          if (sendTimer) clearInterval(sendTimer);
          sendTimer = null;
          lastAudioAt = Date.now();
          // Tell the gateway the utterance is over, exactly as the browser
          // client does, then allow a bounded wait for the endpointer.
          try { ws.send(JSON.stringify({ type: 'close' })); } catch { /* closing */ }
          clearTimeout(grace);
          grace = setTimeout(() => finish(report.interimCount ? 'NO_FINAL' : 'NO_TRANSCRIPT'), FINAL_GRACE_MS);
          return;
        }

        const frame = audio.subarray(offset, Math.min(offset + FRAME_BYTES, audio.length));
        offset += frame.length;
        if (!firstAudioAt) firstAudioAt = Date.now();
        report.audioBytesSent += frame.length;
        report.framesSent += 1;
        try { ws.send(frame); } catch { /* the error handler reports it */ }
      }, 20);
    }
  });
}

/**
 * How much of the known sentence came back.
 *
 * Not a correctness score and not presented as one. Word overlap is enough to
 * separate "recognised Georgian speech" from "returned a confident sentence in
 * the wrong language", which is the failure this is here to catch. Accuracy is
 * a question for real speakers, not for a fixture whose answer is checked in.
 */
function similarity(got: string, want: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const a = norm(got);
  const b = new Set(norm(want));
  if (!a.length || !b.size) return 0;
  const hits = a.filter((w) => b.has(w)).length;
  return Math.round((hits / b.size) * 100) / 100;
}
