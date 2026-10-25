/*
 * Records one HOMI voice message from the microphone.
 *
 * WHY SEGMENTS
 *
 * Google's unary recogniser takes at most one minute of audio per request, and
 * a voice message may be two minutes. So the recorder rolls over to a fresh
 * MediaRecorder on the same microphone stream every SEGMENT_MS. Each segment
 * is a complete, independently decodable file; the server transcribes them in
 * order and joins the text.
 *
 * LEVELS
 *
 * An AnalyserNode reads the loudness ~15 times a second for the live
 * waveform, and every reading is kept (downsampled later) so the sent bubble
 * can draw the shape of what was actually said.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const SEGMENT_MS = 58_000;

export type RecorderSupport = 'ok' | 'unsupported' | 'insecure';

export function recorderSupport(): RecorderSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') return 'unsupported';
  return 'ok';
}

/** The first container this browser records that Google decodes. */
export function pickMimeType(): string | undefined {
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
    .find((t) => MR.isTypeSupported(t));
}

/** Downsample a level history to `bars` values in 0..1, keeping the peaks. */
export function shapeOf(levels: number[], bars: number): number[] {
  if (levels.length === 0) return Array.from({ length: bars }, () => 0.15);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i * levels.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / bars));
    let peak = 0;
    for (let j = a; j < b && j < levels.length; j++) peak = Math.max(peak, levels[j]);
    out.push(Math.max(0.12, Math.min(1, peak)));
  }
  return out;
}

export type StartError = 'denied' | 'no-device' | 'unsupported' | 'insecure' | 'failed';

export interface Recording {
  segments: Blob[];
  durationMs: number;
  levels: number[];
  mimeType: string;
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [live, setLive] = useState<number[]>([]);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const segments = useRef<Blob[]>([]);
  const chunks = useRef<Blob[]>([]);
  const levels = useRef<number[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const tick = useRef<number>(0);
  const rollover = useRef<number>(0);
  const startedAt = useRef<number>(0);
  const mime = useRef<string>('');
  const finishing = useRef<((r: Recording | null) => void) | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    window.clearInterval(tick.current);
    window.clearTimeout(rollover.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    recorder.current = null;
    setRecording(false);
  }, []);

  useEffect(() => () => {
    finishing.current = null;
    try { recorder.current?.stop(); } catch { /* already stopped */ }
    teardown();
  }, [teardown]);

  /* One MediaRecorder for one segment. On stop it files its blob, then either
     rolls over to the next segment or hands the whole recording back. */
  const startSegment = useCallback(() => {
    const s = stream.current;
    if (!s) return;
    chunks.current = [];
    const r = mime.current ? new MediaRecorder(s, { mimeType: mime.current }) : new MediaRecorder(s);
    if (!mime.current) mime.current = r.mimeType || 'audio/webm';
    r.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: mime.current || r.mimeType });
      if (blob.size > 0) segments.current.push(blob);
      if (finishing.current) {
        const done = finishing.current;
        finishing.current = null;
        const durationMs = Date.now() - startedAt.current;
        const result: Recording = { segments: segments.current.slice(), durationMs, levels: levels.current.slice(), mimeType: mime.current };
        teardown();
        done(result);
      } else if (stream.current) {
        startSegment();
      }
    };
    recorder.current = r;
    r.start(1000);
    rollover.current = window.setTimeout(() => { try { r.stop(); } catch { /* finishing */ } }, SEGMENT_MS);
  }, [teardown]);

  const start = useCallback(async (): Promise<StartError | null> => {
    const support = recorderSupport();
    if (support !== 'ok') return support;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
      return 'failed';
    }
    stream.current = s;
    segments.current = [];
    levels.current = [];
    mime.current = pickMimeType() ?? '';
    setLive([]);
    setElapsedMs(0);

    /* The live level meter. Optional: a browser without Web Audio still records. */
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ac = new AC();
        ctx.current = ac;
        const an = ac.createAnalyser();
        an.fftSize = 512;
        ac.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let last = 0;
        const loop = (t: number) => {
          raf.current = requestAnimationFrame(loop);
          if (t - last < 66) return;
          last = t;
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
          levels.current.push(level);
          setLive((prev) => [...prev.slice(-39), level]);
        };
        raf.current = requestAnimationFrame(loop);
      }
    } catch { /* no meter, still recording */ }

    try {
      startedAt.current = Date.now();
      startSegment();
    } catch {
      teardown();
      return 'failed';
    }
    tick.current = window.setInterval(() => setElapsedMs(Date.now() - startedAt.current), 200);
    setRecording(true);
    return null;
  }, [startSegment, teardown]);

  /** Stop and hand back everything recorded. */
  const stop = useCallback((): Promise<Recording | null> => new Promise((resolve) => {
    const r = recorder.current;
    if (!r || r.state === 'inactive') { teardown(); resolve(null); return; }
    window.clearTimeout(rollover.current);
    finishing.current = resolve;
    try { r.stop(); } catch { finishing.current = null; teardown(); resolve(null); }
  }), [teardown]);

  /** Stop and throw everything away. */
  const cancel = useCallback(() => {
    finishing.current = null;
    const r = recorder.current;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    try { if (r && r.state !== 'inactive') r.stop(); } catch { /* gone */ }
    segments.current = [];
    teardown();
  }, [teardown]);

  return { recording, elapsedMs, live, start, stop, cancel };
}
