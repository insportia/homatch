/*
 * HOMI voice messages: the browser side of homi-voice-transcribe.
 *
 * Free and unlimited in every plan (owner, 2026-10-29): there is no price to
 * show, nothing to accept and no balance to check. The browser asks whether
 * voice is on and how long a message may be; the server keeps the limits and
 * a burst rate a person speaking never reaches.
 */
import { supabase } from '@/db/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FN = `${SUPABASE_URL}/functions/v1/homi-voice-transcribe`;

export interface VoiceStatus {
  available: boolean;
  maxSeconds: number;
}

export type VoiceErrorCode =
  | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'TOO_LONG' | 'TOO_LARGE'
  | 'EMPTY' | 'UNAVAILABLE' | 'SERVICE_DISABLED' | 'TRANSCRIBE_FAILED' | 'NETWORK';

export interface VoiceTranscript {
  transcript: string;
  noSpeech: boolean;
  languageCode: string | null;
  durationSeconds: number;
}

export class VoiceError extends Error {
  constructor(public code: VoiceErrorCode, message = code) { super(message); }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new VoiceError('UNAUTHORIZED');
  return { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY };
}

function codeOf(status: number, body: any): VoiceErrorCode {
  const c = String(body?.code ?? '');
  if (c === 'SERVICE_DISABLED' || body?.serviceDisabled) return 'SERVICE_DISABLED';
  const known: VoiceErrorCode[] = ['UNAUTHORIZED', 'RATE_LIMITED', 'TOO_LONG', 'TOO_LARGE', 'EMPTY', 'UNAVAILABLE', 'TRANSCRIBE_FAILED'];
  if ((known as string[]).includes(c)) return c as VoiceErrorCode;
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'UNAUTHORIZED';
  return 'TRANSCRIBE_FAILED';
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  let res: Response;
  try {
    res = await fetch(FN, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    });
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('NETWORK');
  }
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new VoiceError(codeOf(res.status, b));
  return { available: b.available !== false, maxSeconds: Number(b.maxSeconds ?? 120) };
}

/**
 * Send one recorded message (one or two segments, in order) and get its text.
 * `idempotencyKey` is minted once per message so a retry is recognisable.
 */
export async function transcribeVoiceMessage(opts: {
  segments: Blob[]; durationMs: number; locale: string; idempotencyKey: string;
}): Promise<VoiceTranscript> {
  const form = new FormData();
  opts.segments.forEach((blob, i) => {
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append(`segment${i}`, blob, `voice-${i}.${ext}`);
  });
  form.append('durationMs', String(Math.round(opts.durationMs)));
  form.append('locale', opts.locale);
  form.append('idempotencyKey', opts.idempotencyKey);
  let res: Response;
  try {
    res = await fetch(FN, { method: 'POST', headers: await authHeaders(), body: form });
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok !== true) throw new VoiceError(codeOf(res.status, body));
  return {
    transcript: String(body.transcript ?? '').trim(),
    noSpeech: body.noSpeech === true || !String(body.transcript ?? '').trim(),
    languageCode: body.languageCode ?? null,
    durationSeconds: Number(body.durationSeconds ?? 0),
  };
}
