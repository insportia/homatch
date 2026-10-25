/*
 * HOMI voice messages: the browser side of homi-voice-transcribe.
 *
 * The browser never decides money. It asks the server what a minute costs,
 * whether this account already accepted that price, and how long a message
 * the balance can pay for; the server reserves, settles and refuses.
 */
import { supabase } from '@/db/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FN = `${SUPABASE_URL}/functions/v1/homi-voice-transcribe`;

export interface VoiceStatus {
  available: boolean;
  consented: boolean;
  creditsPerMinute: number;
  incrementSeconds: number;
  maxSeconds: number;
  minimumCredits: number;
  balance: number | null;
  /** How long a message the balance pays for; null when the balance is unknown. */
  affordableSeconds: number | null;
}

export type VoiceErrorCode =
  | 'UNAUTHORIZED' | 'CONSENT_REQUIRED' | 'INSUFFICIENT_CREDITS' | 'TOO_LONG' | 'TOO_LARGE'
  | 'EMPTY' | 'UNAVAILABLE' | 'SERVICE_DISABLED' | 'TRANSCRIBE_FAILED' | 'BILLING_UNAVAILABLE' | 'NETWORK';

export interface VoiceTranscript {
  transcript: string;
  noSpeech: boolean;
  languageCode: string | null;
  durationSeconds: number;
  chargedCredits: number;
}

export class VoiceError extends Error {
  constructor(public code: VoiceErrorCode, message = code) { super(message); }
}

/** A local remember-flag, used only when the server cannot be asked. */
const CONSENT_KEY = 'homatch.homiVoice.consent.v1';
export function rememberedConsent(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; }
}
function rememberConsent() {
  try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* the server copy is the real one */ }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new VoiceError('UNAUTHORIZED');
  return { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY };
}

function codeOf(status: number, body: any): VoiceErrorCode {
  const c = String(body?.code ?? '');
  if (c === 'SERVICE_DISABLED' || body?.serviceDisabled) return 'SERVICE_DISABLED';
  const known: VoiceErrorCode[] = ['UNAUTHORIZED', 'CONSENT_REQUIRED', 'INSUFFICIENT_CREDITS', 'TOO_LONG', 'TOO_LARGE',
    'EMPTY', 'UNAVAILABLE', 'TRANSCRIBE_FAILED', 'BILLING_UNAVAILABLE'];
  if ((known as string[]).includes(c)) return c as VoiceErrorCode;
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 401) return 'UNAUTHORIZED';
  return 'TRANSCRIBE_FAILED';
}

async function postJson(action: 'status' | 'consent'): Promise<any> {
  let res: Response;
  try {
    res = await fetch(FN, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch (e) {
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new VoiceError(codeOf(res.status, body));
  return body;
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  const b = await postJson('status');
  const consented = b.consented === true;
  if (consented) rememberConsent();
  return {
    available: b.available !== false,
    consented,
    creditsPerMinute: Number(b.creditsPerMinute ?? 0.3),
    incrementSeconds: Number(b.incrementSeconds ?? 10),
    maxSeconds: Number(b.maxSeconds ?? 120),
    minimumCredits: Number(b.minimumCredits ?? 0.05),
    balance: b.balance == null ? null : Number(b.balance),
    affordableSeconds: b.affordableSeconds == null ? null : Number(b.affordableSeconds),
  };
}

export async function acceptVoiceConsent(): Promise<void> {
  await postJson('consent');
  rememberConsent();
}

/**
 * Send one recorded message (one or two segments, in order) and get its text.
 * `idempotencyKey` is minted once per message, so a retry of the same message
 * can never be charged twice.
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
    chargedCredits: Number(body.chargedCredits ?? 0),
  };
}
