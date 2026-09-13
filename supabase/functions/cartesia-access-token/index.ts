// HOMATCH — a short-lived Cartesia grant for an authenticated user.
//
// THIS FUNCTION ALREADY EXISTED IN PRODUCTION AND NOT IN THE REPOSITORY.
//
// It was deployed directly (version 7) and has been returning HTTP 200 with a
// real Cartesia token. Bringing it into source control unchanged would have
// been dishonest about three things it was missing, so this is that function
// with those three fixed and its behaviour otherwise preserved:
//
//   no timeout        a hung fetch held the isolate until the platform killed
//                     it, and the caller saw nothing at all
//   no rate limit     verify_jwt=true is satisfied by Supabase's PUBLISHABLE
//                     anon key, so "authenticated" did not mean "a person".
//                     Anyone with the public key could mint 300-second agent
//                     grants in a loop.
//   fixed 300s TTL    a grant lives as long as it needs to and no longer
//
// The homepage demo does NOT use this endpoint. It uses ai-talk-session, which
// applies the anonymous allowance in §28. This is for authenticated in-product
// voice: Voice Studio's live test, and agent preview.
//
// CARTESIA_API_KEY never reaches the browser (§139).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { authenticate, serviceClient, json, preflight, checkRateLimit, logEvent } from '../_shared/comm/auth.ts';
import {
  createCartesiaProvider, cartesiaCredentialsPresent, listCartesiaVoices, synthesizePreview,
  cloneCartesiaVoice, deleteCartesiaVoice, clipRejectionReason,
} from '../_shared/comm/cartesia.ts';

/**
 * Enough for a live test of an agent, short enough that a leaked token is
 * worth little. Cartesia's own ceiling is applied in the adapter.
 */
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 600;

/** A person testing voices does that a handful of times, not a hundred. */
const MINTS_PER_HOUR = 30;

/** Previews synthesise billable audio, so they are counted separately. */
const PREVIEWS_PER_HOUR = 60;

/** Cloning is slow, billable and rarely repeated. A low ceiling is correct. */
const CLONES_PER_DAY = 10;

/**
 * The sentence the customer agrees to, verbatim, and its version.
 *
 * Stored WITH each consent row rather than referenced, so changing the
 * wording later cannot be read backwards onto confirmations already given.
 */
const CONSENT_VERSION = '2026-09-13';
const CONSENT_TEXT =
  'I confirm that I own this voice or have permission to use it.';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  if (!cartesiaCredentialsPresent().ok) {
    return json({ error: 'not_configured' }, 503);
  }

  const sb = serviceClient();

  // GET lists voices for Voice Studio. Read-only, and it costs nothing, so it
  // shares the endpoint rather than needing its own.
  if (req.method === 'GET') {
    const voices = await listCartesiaVoices(100);
    if (!voices.ok) return json({ error: 'voices_unavailable', code: voices.error?.code ?? null }, 502);
    return json({ ok: true, voices: voices.data });
  }

  // Read the body once: both the preview action and the mint path need it.
  let body: {
    ttlSeconds?: number; scopes?: string[]; action?: string; voiceId?: string; language?: string;
    name?: string; mime?: string; clipBase64?: string; consent?: boolean;
    source?: string; description?: string;
  } = {};
  try { body = await req.json(); } catch { /* an empty body means "the defaults" */ }

  /*
   * VOICE PREVIEW.
   *
   * Choosing a voice from a list of names is choosing blind — §12 forbids
   * inventing a description of how a speaker sounds, so the only honest way to
   * tell a customer what a voice sounds like is to let them hear it.
   *
   * It shares this endpoint because it shares everything that matters: the
   * same credential, the same authenticated caller, the same reason the key
   * must never reach the browser. It gets its OWN rate limit because a preview
   * synthesises billable audio and a grant does not.
   */
  if (body.action === 'preview') {
    const voiceId = String(body.voiceId ?? '').trim();
    if (!voiceId) return json({ error: 'voice_required' }, 400);

    const previewLimit = await checkRateLimit(sb, 'cartesia_voice_preview', PREVIEWS_PER_HOUR, 3600, { userId: caller.userId });
    if (!previewLimit.allowed) {
      logEvent('cartesia-token', 'preview_rate_limited', { userId: caller.userId });
      return json({ error: 'rate_limited', retryAfter: previewLimit.retryAfterSeconds }, 429);
    }

    const audio = await synthesizePreview({ voiceId, language: String(body.language ?? 'en') });
    if (!audio.ok || !audio.data) {
      logEvent('cartesia-token', 'preview_failed', {
        code: audio.error?.code ?? null,
        status: audio.error?.providerCode ?? null,
        detail: audio.error?.message ?? null,
      });
      return json({ error: 'preview_unavailable' }, 502);
    }

    logEvent('cartesia-token', 'preview_ok', { model: audio.data.model });
    return json({ ok: true, audioBase64: audio.data.audioBase64, mime: audio.data.mime });
  }

  /*
   * CUSTOM VOICE.
   *
   * The order below is the feature. Consent is written to the database BEFORE
   * the provider is contacted, so a clone cannot exist without a record of who
   * authorised it — including a clone whose provider call then fails, which is
   * exactly the case where evidence matters most.
   *
   * The clip itself is never persisted by Homatch. It is decoded, validated,
   * streamed to the provider and dropped. A library of voice samples is the
   * liability this whole flow exists to bound.
   */
  if (body.action === 'clone') {
    const name = String(body.name ?? '').trim();
    const mime = String(body.mime ?? '').trim();
    const base64 = String(body.clipBase64 ?? '');
    const source = body.source === 'RECORD' ? 'RECORD' : 'UPLOAD';

    if (!name) return json({ error: 'name_required', code: 'NAME_REQUIRED' }, 400);

    // Consent is not a field on a form the server trusts loosely. The client
    // must send the exact confirmation, and anything else is refused outright
    // rather than defaulted to "yes".
    if (body.consent !== true) {
      return json({ error: 'consent_required', code: 'CONSENT_REQUIRED' }, 422);
    }

    let clip: Uint8Array;
    try {
      const binary = atob(base64);
      clip = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) clip[i] = binary.charCodeAt(i);
    } catch {
      return json({ error: 'clip_unreadable', code: 'CLIP_INVALID' }, 400);
    }

    const rejection = clipRejectionReason(clip.byteLength, mime);
    if (rejection) return json({ error: rejection, code: rejection.toUpperCase() }, 422);

    const cloneLimit = await checkRateLimit(sb, 'cartesia_voice_clone', CLONES_PER_DAY, 86_400, { userId: caller.userId });
    if (!cloneLimit.allowed) {
      return json({ error: 'rate_limited', retryAfter: cloneLimit.retryAfterSeconds }, 429);
    }

    const { data: consentRow, error: consentErr } = await sb.from('comm_voice_consents').insert({
      owner_id: caller.userId,
      voice_name: name,
      provider: 'CARTESIA',
      consent_text: CONSENT_TEXT,
      consent_version: CONSENT_VERSION,
      source,
      clip_bytes: clip.byteLength,
      clip_mime: mime,
      status: 'PENDING',
    }).select('id').maybeSingle();

    // No record, no clone. This is the one failure here that must not degrade
    // into "carry on anyway".
    if (consentErr || !consentRow) {
      logEvent('cartesia-token', 'consent_write_failed', { code: consentErr?.code ?? null });
      return json({ error: 'consent_not_recorded', code: 'CONSENT_NOT_RECORDED' }, 500);
    }

    const cloned = await cloneCartesiaVoice({
      clip, mime, name,
      language: String(body.language ?? 'en'),
      description: typeof body.description === 'string' ? body.description : undefined,
    });

    if (!cloned.ok || !cloned.data) {
      await sb.from('comm_voice_consents').update({
        status: 'FAILED',
        failure_reason: cloned.error?.code ?? 'UNKNOWN',
        updated_at: new Date().toISOString(),
      }).eq('id', consentRow.id);

      logEvent('cartesia-token', 'clone_failed', {
        code: cloned.error?.code ?? null,
        status: cloned.error?.providerCode ?? null,
        detail: cloned.error?.message ?? null,
      });
      return json({ error: 'clone_failed', code: 'CLONE_FAILED' }, 502);
    }

    await sb.from('comm_voice_consents').update({
      status: 'READY',
      provider_voice_id: cloned.data.voiceId,
      updated_at: new Date().toISOString(),
    }).eq('id', consentRow.id);

    logEvent('cartesia-token', 'clone_ok', { userId: caller.userId });
    return json({ ok: true, voiceId: cloned.data.voiceId, name });
  }

  /*
   * Removing a custom voice.
   *
   * Only a voice this account actually cloned, proved by a consent row. The
   * provider would happily delete any voice the API key owns, which includes
   * every other customer's.
   */
  if (body.action === 'delete_voice') {
    const voiceId = String(body.voiceId ?? '').trim();
    if (!voiceId) return json({ error: 'voice_required' }, 400);

    const { data: owned } = await sb.from('comm_voice_consents')
      .select('id').eq('owner_id', caller.userId).eq('provider_voice_id', voiceId).limit(1).maybeSingle();
    if (!owned) return json({ error: 'not_found', code: 'NOT_YOURS' }, 404);

    const removed = await deleteCartesiaVoice(voiceId);
    if (!removed.ok) {
      logEvent('cartesia-token', 'voice_delete_failed', { code: removed.error?.code ?? null });
      return json({ error: 'delete_failed' }, 502);
    }
    await sb.from('comm_voice_consents').delete().eq('id', owned.id);
    return json({ ok: true });
  }

  const limit = await checkRateLimit(sb, 'cartesia_token_mint', MINTS_PER_HOUR, 3600, { userId: caller.userId });
  if (!limit.allowed) {
    logEvent('cartesia-token', 'rate_limited', { userId: caller.userId });
    return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);
  }

  let requestedTtl = DEFAULT_TTL_SECONDS;
  let scopes = ['agent'];
  {
    if (Number.isFinite(body?.ttlSeconds)) {
      requestedTtl = Math.min(MAX_TTL_SECONDS, Math.max(30, Math.floor(Number(body.ttlSeconds))));
    }
    if (Array.isArray(body?.scopes) && body.scopes.length) {
      // Only scopes this product actually uses. A caller asking for something
      // else gets the default rather than a wider grant.
      scopes = body.scopes.filter((s) => ['agent', 'tts', 'stt'].includes(String(s)));
      if (!scopes.length) scopes = ['agent'];
    }
  }

  const provider = createCartesiaProvider();
  const grant = await provider.mintGrant({ ttlSeconds: requestedTtl, scopes });

  if (!grant.ok || !grant.data) {
    logEvent('cartesia-token', 'mint_failed', { code: grant.error?.code ?? null });
    // The provider's own message is not forwarded: it can echo request
    // details, and a customer has no use for it (§92, §106).
    return json({ error: 'token_unavailable' }, 502);
  }

  logEvent('cartesia-token', 'minted', { userId: caller.userId, ttl: requestedTtl, scopes: scopes.join(',') });

  return json({
    token: grant.data.token,
    expiresAt: grant.data.expiresAt,
    expiresIn: requestedTtl,
    grants: scopes,
    provider: 'CARTESIA',
  });
});
