// HOMATCH — the Voice AI control surface.
//
// WHAT THIS IS FOR
//
// Every previous voice integration in this product needed a deploy to change
// anything: the model was a constant, the voice was a constant, the
// vocabulary was a constant, and the only way to answer "why does it sound
// like that?" was to read the source. This is the endpoint that makes those
// things data.
//
// TWO AUDIENCES, ONE FUNCTION, TWO GATES
//
// A customer needs exactly two things: the voices an admin turned on, and a
// real audio preview of one. Everything else — providers, models, corpus,
// pronunciation, personality, spend — is an operator's, and is behind
// requireAdmin.
//
// They share a function because they share the provider module and the same
// library table, and because a second function is a second place for the two
// to drift apart about what "enabled" means.
//
// WHAT IT NEVER RETURNS
//
// ELEVENLABS_API_KEY, or any other credential, in any response, at any
// permission level. Previews return audio bytes. Health returns whether a
// name is set, never what it is set to.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  authenticate, requireAdmin, serviceClient, json, preflight, logEvent, checkRateLimit,
} from '../_shared/comm/auth.ts';
import {
  addSharedVoice, checkElevenLabs, chooseTtsModel, elevenLabsCredentialsPresent,
  listElevenLabsVoices, listSharedVoices,
  listElevenLabsModels, synthesizeElevenLabs, createPronunciationDictionary,
  pronunciationMethodsFor, mintRealtimeToken, ELEVENLABS_DEFAULTS,
  KEYTERM_LIMITS_DEFAULT,
} from '../_shared/comm/elevenlabs.ts';
import { selectKeyterms, type VocabularyTerm } from '../_shared/comm/generated/keyterms.ts';
import { syncVoiceLibrary } from '../_shared/comm/voiceLibrary.ts';
import {
  speechSocketUrl, mintSpeechGrant, googleSpeechDiagnosis, GRANT_TTL_MS,
} from '../_shared/comm/speechGrant.ts';
import {
  streamCartesiaPcm, listCartesiaVoices, cartesiaCredentialsPresent,
} from '../_shared/comm/cartesia.ts';

type Sb = SupabaseClient;

interface VoiceAiRequest {
  action: string;
  [key: string]: unknown;
}

/** What a customer may ask for without being an operator. */
const CUSTOMER_ACTIONS = new Set(['voices', 'preview']);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: VoiceAiRequest;
  try { body = await req.json() as VoiceAiRequest; } catch { return json({ error: 'bad_request' }, 400); }

  const action = String(body.action ?? '');

  if (CUSTOMER_ACTIONS.has(action)) {
    const caller = await authenticate(req);
    if (!caller) return json({ error: 'unauthorized' }, 401);
    const sb = serviceClient();
    switch (action) {
      case 'voices':  return await customerVoices(sb);
      case 'preview': return await voicePreview(sb, caller.userId, body);
      default:        return json({ error: 'unknown_action' }, 400);
    }
  }

  const admin = await requireAdmin(req);
  if (!admin) return json({ error: 'forbidden' }, 403);
  const { sb, caller } = admin;

  switch (action) {
    case 'overview':             return await overview(sb);
    case 'models':               return await models();
    case 'sync-voices':          return await syncVoices(sb);
    case 'set-voice':            return await setVoice(sb, body);
    case 'vocabulary':           return await vocabularyList(sb, body);
    case 'vocabulary-save':      return await vocabularySave(sb, caller.userId, body);
    case 'vocabulary-delete':    return await vocabularyDelete(sb, body);
    case 'vocabulary-import':    return await vocabularyImport(sb, caller.userId, body);
    case 'vocabulary-export':    return await vocabularyExport(sb);
    case 'keyterm-preview':      return await keytermPreview(sb, body);
    case 'pronunciation':        return await pronunciationList(sb);
    case 'pronunciation-save':   return await pronunciationSave(sb, body);
    case 'pronunciation-preview': return await pronunciationPreview(sb, body);
    case 'pronunciation-approve': return await pronunciationApprove(sb, caller.userId, body);
    case 'pronunciation-delete': return await pronunciationDelete(sb, body);
    case 'personality':          return await personalityGet(sb);
    case 'personality-save':     return await personalitySave(sb, body);
    case 'routes':               return await routesGet(sb);
    case 'routes-save':          return await routesSave(sb, body);
    case 'shared-voices':        return await sharedVoices(body);
    case 'add-shared-voice':     return await addSharedVoiceAction(sb, body);
    case 'audition':             return await audition(sb, caller.userId, body);
    case 'audition-results':     return await auditionResults(sb, body);
    case 'language-voices':      return await languageVoices(sb);
    case 'approve-language-voice': return await approveLanguageVoice(sb, caller.userId, body);
    case 'revoke-language-voice': return await revokeLanguageVoice(sb, body);
    case 'fallback-policy':      return await fallbackPolicyGet(sb);
    case 'fallback-policy-save': return await fallbackPolicySave(sb, body);
    case 'usage':                return await usage(sb, body);
    case 'talk-cogs':            return await talkCogs(sb, body);
    case 'talk-session-cogs':    return await talkSessionCogs(sb, body);
    case 'speech-probe':         return await speechProbe(body);
    case 'voice-languages':      return await voiceLanguageProbe(body);
    case 'cartesia-voices':      return await cartesiaVoiceCatalogue();
    default:                     return json({ error: 'unknown_action' }, 400);
  }
});

// ── Customer ────────────────────────────────────────────────────────────────

/**
 * The voices a customer may choose from.
 *
 * Only what an admin enabled, and only metadata the provider actually
 * returned. A voice described as speaking a language it cannot is worse than
 * one with no description at all.
 */
async function customerVoices(sb: Sb): Promise<Response> {
  const { data } = await sb.from('voice_library_voices')
    .select('provider_voice_id, name, category, description, preview_url, labels, languages, recommended, is_default, sort_order')
    .eq('provider', 'ELEVENLABS').eq('enabled', true)
    .order('recommended', { ascending: false })
    .order('sort_order')
    .order('name');

  return json({
    ok: true,
    voices: (data ?? []).map((v) => ({
      voiceId: v.provider_voice_id,
      name: v.name,
      category: v.category,
      description: v.description,
      previewUrl: v.preview_url,
      labels: v.labels,
      languages: v.languages,
      recommended: v.recommended,
      isDefault: v.is_default,
    })),
  });
}

/**
 * Real audio for one voice.
 *
 * Real, because a preview that plays a stock clip is a preview of somebody
 * else's sentence. Short and rate limited, because it is a paid generation
 * behind a button anybody signed in can press.
 */
async function voicePreview(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  const voiceId = String(body.voiceId ?? '');
  if (!voiceId) return json({ ok: false, reason: 'VOICE_REQUIRED' }, 400);

  const limit = await checkRateLimit(sb, 'voice_preview', 40, 3600, { userId });
  if (!limit.allowed) return json({ ok: false, reason: 'RATE_LIMITED', retryAfter: limit.retryAfterSeconds }, 429);

  // Only a voice an admin turned on may be previewed: the picker shows those,
  // and an endpoint that renders any voice id is an endpoint that rents the
  // whole library to anybody with a session.
  const { data: allowed } = await sb.from('voice_library_voices')
    .select('provider_voice_id')
    .eq('provider', 'ELEVENLABS').eq('enabled', true).eq('provider_voice_id', voiceId)
    .maybeSingle();
  if (!allowed) return json({ ok: false, reason: 'VOICE_NOT_AVAILABLE' }, 404);

  const language = String(body.language ?? 'en').toLowerCase().slice(0, 5);
  const text = previewSentence(language);

  // The preview says a Georgian sentence in Georgian, so the model has to be
  // one that lists the language. eleven_flash_v2_5 does not, and answers 400
  // rather than ignoring the parameter.
  const choice = await chooseTtsModel(await ttsModel(sb), language);
  const model = choice.modelId;
  const started = Date.now();
  const out = await synthesizeElevenLabs({
    voiceId, text, modelId: model, languageCode: language,
    sendLanguage: choice.sendLanguage, format: 'mp3',
  });

  await recordUsage(sb, {
    ownerId: userId, surface: 'VOICE_PREVIEW', provider: 'ELEVENLABS', role: 'TTS',
    model, characters: text.length, latencyMs: Date.now() - started,
    ok: out.ok, errorCode: out.ok ? null : out.error?.code ?? null,
    providerStatus: out.ok ? null : Number(out.error?.providerCode) || null,
  });

  if (!out.ok || !out.data) {
    return json({
      ok: false, reason: 'PREVIEW_FAILED',
      providerCode: out.error?.code ?? null,
      providerStatus: Number(out.error?.providerCode) || null,
    }, 502);
  }

  return json({
    ok: true, audioBase64: out.data.audioBase64, mime: out.data.mime,
    voiceId, model: out.data.model, ms: Date.now() - started, text,
  });
}

/**
 * What a preview says.
 *
 * Editable copy belongs in the product's translation system; this is the
 * server-side default for a button that has to work before anybody has
 * written anything. The Georgian line is here because Georgian is the hardest
 * case and the one worth hearing.
 */
function previewSentence(language: string): string {
  const lines: Record<string, string> = {
    ka: 'გამარჯობა, მე Homatch-ის AI ასისტენტი ვარ. როგორ შემიძლია დაგეხმაროთ?',
    ru: 'Здравствуйте, я AI-ассистент Homatch. Чем могу помочь?',
    tr: 'Merhaba, ben Homatch yapay zekâ asistanıyım. Nasıl yardımcı olabilirim?',
    ar: 'مرحبًا، أنا مساعد Homatch الذكي. كيف يمكنني مساعدتك؟',
    he: 'שלום, אני עוזר ה-AI של Homatch. איך אפשר לעזור?',
    en: 'Hello, I am the Homatch AI assistant. How can I help you today?',
  };
  return lines[language] ?? lines[language.split('-')[0]] ?? lines.en;
}

// ── Overview and providers ──────────────────────────────────────────────────

async function overview(sb: Sb): Promise<Response> {
  const [health, routes, lastSession, lastUsage, defaultVoice, counts] = await Promise.all([
    elevenLabsCredentialsPresent() ? checkElevenLabs() : Promise.resolve(null),
    sb.from('comm_provider_routes').select('role, provider, priority, enabled, kill_switch, config, last_error, last_success_at').order('role').order('priority'),
    sb.from('comm_talk_sessions').select('id, created_at, state, turns, consumed_seconds').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('voice_usage_events').select('provider, role, model, latency_ms, ok, error_code, provider_status, occurred_at').order('occurred_at', { ascending: false }).limit(20),
    sb.from('voice_library_voices').select('provider_voice_id, name').eq('is_default', true).maybeSingle(),
    sb.from('voice_vocabulary_terms').select('id', { count: 'exact', head: true }),
  ]);

  const token = health?.status === 'HEALTHY' ? await mintRealtimeToken() : null;

  // Measured, from what actually happened. Never a benchmark number.
  const recent = (lastUsage.data ?? []).filter((u) => u.ok && typeof u.latency_ms === 'number');
  const latencyByRole: Record<string, number> = {};
  for (const role of ['STT', 'TTS', 'LLM']) {
    const values = recent.filter((u) => u.role === role).map((u) => Number(u.latency_ms)).sort((a, b) => a - b);
    if (values.length) latencyByRole[role] = values[Math.floor(values.length / 2)];
  }

  return json({
    ok: true,
    elevenLabs: health ? {
      status: health.status,
      voiceCount: health.voiceCount,
      modelCount: health.modelCount,
      tier: health.tier,
      charactersRemaining: health.charactersRemaining,
      charactersLimit: health.charactersLimit,
      canMintRealtimeToken: token?.ok === true,
      canUsePronunciationDictionaries: health.canUsePronunciationDictionaries,
      latencyMs: health.latencyMs,
      detail: health.detail,
    } : { status: 'MISSING' },
    credentials: [
      { name: 'ELEVENLABS_API_KEY', present: elevenLabsCredentialsPresent() },
      { name: 'CARTESIA_API_KEY', present: Boolean(Deno.env.get('CARTESIA_API_KEY')) },
      { name: 'VAPI_PRIVATE_API_KEY', present: Boolean(Deno.env.get('VAPI_PRIVATE_API_KEY')) },
      { name: 'OPENAI_API_KEY', present: Boolean(Deno.env.get('OPENAI_API_KEY')) },
    ],
    routes: routes.data ?? [],
    defaultVoice: defaultVoice.data ?? null,
    vocabularyCount: counts.count ?? 0,
    lastSession: lastSession.data ?? null,
    recentUsage: lastUsage.data ?? [],
    latencyMedianMs: latencyByRole,
  });
}

async function models(): Promise<Response> {
  if (!elevenLabsCredentialsPresent()) return json({ ok: false, reason: 'MISSING' }, 200);
  const out = await listElevenLabsModels();
  if (!out.ok) return json({ ok: false, reason: 'PROVIDER_ERROR', providerCode: out.error?.code ?? null }, 200);
  return json({ ok: true, models: out.data?.models ?? [] });
}

// ── Voice library ───────────────────────────────────────────────────────────

/**
 * Pull the account's real voices into the library.
 *
 * UPSERT, never replace. A voice an admin enabled and a customer selected
 * must not lose that because a sync ran — so provider metadata is refreshed
 * and Homatch's own decisions about it are left exactly as they were.
 */
async function syncVoices(sb: Sb): Promise<Response> {
  const out = await syncVoiceLibrary(sb);
  if (out.error) {
    return json({ ok: false, reason: out.error }, 200);
  }
  logEvent('voice-ai', 'voices_synced', { count: out.synced });
  return json({ ok: true, synced: out.synced });
}

async function setVoice(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const voiceId = String(body.voiceId ?? '');
  if (!voiceId) return json({ ok: false, reason: 'VOICE_REQUIRED' }, 400);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.recommended === 'boolean') patch.recommended = body.recommended;
  if (typeof body.sortOrder === 'number') patch.sort_order = Math.max(0, Math.min(999, body.sortOrder));

  if (body.isDefault === true) {
    // One default, and the database enforces it — so the old one is cleared
    // in the same breath rather than left to a unique-index violation.
    await sb.from('voice_library_voices').update({ is_default: false })
      .eq('provider', 'ELEVENLABS').eq('is_default', true);
    patch.is_default = true;
    // A default nobody may choose is not a default.
    patch.enabled = true;
  } else if (body.isDefault === false) {
    patch.is_default = false;
  }

  const { error } = await sb.from('voice_library_voices').update(patch)
    .eq('provider', 'ELEVENLABS').eq('provider_voice_id', voiceId);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  return json({ ok: true });
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

async function vocabularyList(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const search = String(body.search ?? '').trim().slice(0, 80);
  const category = String(body.category ?? '').trim().slice(0, 60);
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));

  let query = sb.from('voice_vocabulary_terms')
    .select('id, term, category, language_hint, scope, priority, enabled, provider_eligible, notes, owner_id, agent_id, updated_at')
    .order('priority', { ascending: false })
    .order('term')
    .limit(limit);

  if (search) query = query.ilike('term', `%${search}%`);
  if (category) query = query.eq('category', category);

  const [{ data }, { data: categories }] = await Promise.all([
    query,
    sb.from('voice_vocabulary_terms').select('category').limit(2000),
  ]);

  const counts = new Map<string, number>();
  for (const row of categories ?? []) {
    counts.set(String(row.category), (counts.get(String(row.category)) ?? 0) + 1);
  }

  return json({
    ok: true,
    terms: data ?? [],
    categories: [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  });
}

async function vocabularySave(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  const term = String(body.term ?? '').trim().slice(0, 120);
  if (!term) return json({ ok: false, reason: 'TERM_REQUIRED' }, 400);

  const row: Record<string, unknown> = {
    term,
    category: String(body.category ?? 'custom').trim().slice(0, 60) || 'custom',
    language_hint: body.languageHint ? String(body.languageHint).slice(0, 5) : null,
    scope: ['GLOBAL', 'TENANT', 'AGENT', 'PROPERTY', 'PROJECT'].includes(String(body.scope))
      ? String(body.scope) : 'GLOBAL',
    priority: Math.max(0, Math.min(100, Number(body.priority) || 50)),
    enabled: body.enabled !== false,
    provider_eligible: body.providerEligible !== false,
    notes: body.notes ? String(body.notes).slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  };
  if (row.scope !== 'GLOBAL') row.owner_id = body.ownerId ?? userId;

  if (body.id) {
    const { error } = await sb.from('voice_vocabulary_terms').update(row).eq('id', String(body.id));
    if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);
    return json({ ok: true, id: body.id });
  }

  row.created_by = userId;
  const { data, error } = await sb.from('voice_vocabulary_terms').insert(row).select('id').maybeSingle();
  if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);
  return json({ ok: true, id: data?.id ?? null });
}

async function vocabularyDelete(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const id = String(body.id ?? '');
  if (!id) return json({ ok: false, reason: 'ID_REQUIRED' }, 400);
  const { error } = await sb.from('voice_vocabulary_terms').delete().eq('id', id);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  return json({ ok: true });
}

/**
 * Bulk import, in the shape the seed corpus already has.
 *
 * Rows that collide are skipped rather than overwritten: an import must never
 * silently undo an edit somebody made by hand, and the count of what was
 * skipped is reported so nobody has to guess.
 */
async function vocabularyImport(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  const csv = String(body.csv ?? '');
  if (!csv.trim()) return json({ ok: false, reason: 'EMPTY' }, 400);
  if (csv.length > 2_000_000) return json({ ok: false, reason: 'TOO_LARGE' }, 413);

  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return json({ ok: false, reason: 'EMPTY' }, 400);

  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const at = (name: string) => header.indexOf(name);
  const iTerm = at('term');
  const iCategory = at('category');
  if (iTerm === -1 || iCategory === -1) return json({ ok: false, reason: 'MISSING_COLUMNS' }, 400);

  const iLang = at('language_hint');
  const iEligible = at('realtime_keyterm_candidate');
  const iNotes = at('notes');
  const iPriority = at('priority');

  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1, 5001)) {
    const cells = splitCsvLine(line);
    const term = (cells[iTerm] ?? '').trim();
    const category = (cells[iCategory] ?? '').trim();
    if (!term || !category) continue;
    const eligibleCell = iEligible === -1 ? 'YES' : (cells[iEligible] ?? '').trim().toUpperCase();
    rows.push({
      term: term.slice(0, 120),
      category: category.slice(0, 60),
      language_hint: iLang === -1 ? null : ((cells[iLang] ?? '').trim().slice(0, 5) || null),
      provider_eligible: eligibleCell === 'YES' || eligibleCell === 'TRUE' || eligibleCell === '1',
      priority: iPriority === -1 ? 50 : Math.max(0, Math.min(100, Number(cells[iPriority]) || 50)),
      notes: iNotes === -1 ? null : ((cells[iNotes] ?? '').trim().slice(0, 500) || null),
      scope: 'GLOBAL',
      created_by: userId,
    });
  }

  if (!rows.length) return json({ ok: false, reason: 'NO_ROWS' }, 400);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { data } = await sb.from('voice_vocabulary_terms')
      .upsert(chunk, { onConflict: 'category,normalized_term,owner_id', ignoreDuplicates: true })
      .select('id');
    inserted += data?.length ?? 0;
  }

  logEvent('voice-ai', 'vocabulary_imported', { read: rows.length, inserted });
  return json({ ok: true, read: rows.length, inserted, skipped: rows.length - inserted });
}

/** Quoted CSV, because Georgian notes contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cell); cell = ''; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

async function vocabularyExport(sb: Sb): Promise<Response> {
  const { data } = await sb.from('voice_vocabulary_terms')
    .select('category, term, language_hint, provider_eligible, priority, scope, enabled, notes')
    .order('category').order('term').limit(5000);

  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [
    'category,term,language_hint,realtime_keyterm_candidate,priority,scope,enabled,notes',
    ...(data ?? []).map((r) => [
      r.category, r.term, r.language_hint ?? '',
      r.provider_eligible ? 'YES' : 'NO',
      r.priority, r.scope, r.enabled ? 'YES' : 'NO', r.notes ?? '',
    ].map(escape).join(',')),
  ];

  return json({ ok: true, csv: rows.join('\n'), count: (data ?? []).length });
}

/**
 * What the selector would actually send, for a context an admin describes.
 *
 * The same function the live session calls, with the same limits, so this is
 * an answer rather than an illustration.
 */
async function keytermPreview(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const limits = await keytermLimits(sb);

  const { data } = await sb.from('voice_vocabulary_terms')
    .select('id, term, category, language_hint, scope, priority, provider_eligible, enabled, owner_id, agent_id')
    .eq('enabled', true)
    .order('priority', { ascending: false })
    .limit(2000);

  const terms: VocabularyTerm[] = (data ?? []).map((row) => ({
    id: String(row.id),
    term: String(row.term),
    category: String(row.category),
    languageHint: row.language_hint as string | null,
    scope: String(row.scope) as VocabularyTerm['scope'],
    priority: Number(row.priority ?? 50),
    providerEligible: row.provider_eligible !== false,
    enabled: true,
    tenantId: row.owner_id as string | null,
    agentId: row.agent_id as string | null,
  }));

  const selection = selectKeyterms(terms, {
    language: body.language ? String(body.language).slice(0, 5) : null,
    feature: body.feature ? String(body.feature).slice(0, 40) : null,
    agentId: body.agentId ? String(body.agentId) : null,
    agentPurpose: body.agentPurpose ? String(body.agentPurpose).slice(0, 400) : null,
    tenantId: body.tenantId ? String(body.tenantId) : null,
    locations: asStrings(body.locations),
    developers: asStrings(body.developers),
    projects: asStrings(body.projects),
    entities: asStrings(body.entities),
    abusiveContext: body.abusiveContext === true,
  }, limits);

  return json({
    ok: true,
    limits: selection.limits,
    considered: selection.considered,
    selected: selection.selected,
    // Only the interesting refusals; BELOW_CUTOFF is most of a corpus.
    dropped: selection.dropped.filter((d) => d.reason !== 'BELOW_CUTOFF').slice(0, 60),
  });
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v).slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];
}

async function keytermLimits(sb: Sb): Promise<{ maxTerms: number; maxCharsPerTerm: number }> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'STT').eq('provider', 'ELEVENLABS').maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    maxTerms: num(cfg.max_keyterms, KEYTERM_LIMITS_DEFAULT.maxTerms),
    maxCharsPerTerm: num(cfg.max_keyterm_chars, KEYTERM_LIMITS_DEFAULT.maxCharsPerTerm),
  };
}

// ── Pronunciation ───────────────────────────────────────────────────────────

async function pronunciationList(sb: Sb): Promise<Response> {
  const [{ data }, model] = await Promise.all([
    sb.from('voice_pronunciation_rules')
      .select('id, term, language, provider, method, value, alphabet, scope, priority, enabled, approved_at, model_compatibility, provider_dictionary_id, notes, updated_at')
      .order('priority', { ascending: false }).order('term').limit(500),
    ttsModel(sb),
  ]);

  return json({
    ok: true,
    rules: data ?? [],
    // Only the methods the CURRENT model honours are offered. A phoneme rule
    // silently ignored is worse than one refused: the owner approves audio
    // that customers will never hear.
    methods: pronunciationMethodsFor(model),
    model,
  });
}

async function pronunciationSave(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const term = String(body.term ?? '').trim().slice(0, 120);
  const value = String(body.value ?? '').trim().slice(0, 200);
  const method = String(body.method ?? 'alias');
  if (!term || !value) return json({ ok: false, reason: 'TERM_AND_VALUE_REQUIRED' }, 400);
  if (method !== 'alias' && method !== 'phoneme') return json({ ok: false, reason: 'BAD_METHOD' }, 400);

  const row: Record<string, unknown> = {
    term, value, method,
    language: body.language ? String(body.language).slice(0, 5) : null,
    provider: 'ELEVENLABS',
    alphabet: method === 'phoneme' ? (String(body.alphabet ?? 'ipa') === 'cmu-arpabet' ? 'cmu-arpabet' : 'ipa') : null,
    scope: 'GLOBAL',
    priority: Math.max(0, Math.min(100, Number(body.priority) || 50)),
    model_compatibility: asStrings(body.modelCompatibility),
    notes: body.notes ? String(body.notes).slice(0, 400) : null,
    updated_at: new Date().toISOString(),
  };

  // Editing a rule un-approves it: the audio somebody signed off on is no
  // longer the audio this rule produces.
  row.enabled = false;
  row.approved_at = null;
  row.approved_by = null;

  if (body.id) {
    const { error } = await sb.from('voice_pronunciation_rules').update(row).eq('id', String(body.id));
    if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);
    return json({ ok: true, id: body.id });
  }

  const { data, error } = await sb.from('voice_pronunciation_rules').insert(row).select('id').maybeSingle();
  if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);
  return json({ ok: true, id: data?.id ?? null });
}

/**
 * Hear the rule before approving it.
 *
 * Two clips from one request: the sentence as it sounds now, and the sentence
 * with the candidate rule applied. Comparing them is the only way to know
 * whether "Homatch" came out as a word or as letters, and no amount of
 * phonetic theory substitutes for listening.
 */
async function pronunciationPreview(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  if (!elevenLabsCredentialsPresent()) return json({ ok: false, reason: 'MISSING' }, 200);

  const text = String(body.text ?? '').trim().slice(0, 300);
  if (!text) return json({ ok: false, reason: 'TEXT_REQUIRED' }, 400);

  const { data: voiceRow } = await sb.from('voice_library_voices')
    .select('provider_voice_id')
    .eq('provider', 'ELEVENLABS')
    .eq('provider_voice_id', String(body.voiceId ?? ''))
    .eq('enabled', true).maybeSingle();

  const { data: fallback } = voiceRow ? { data: null } : await sb.from('voice_library_voices')
    .select('provider_voice_id').eq('provider', 'ELEVENLABS').eq('is_default', true).maybeSingle();

  const voiceId = voiceRow?.provider_voice_id ?? fallback?.provider_voice_id ?? null;
  if (!voiceId) return json({ ok: false, reason: 'NO_VOICE' }, 400);

  const language = body.language ? String(body.language).slice(0, 5) : null;
  // An admin may pin a model; otherwise the one that can speak the language
  // the rule is written for.
  const choice = await chooseTtsModel(String(body.model ?? '') || await ttsModel(sb), language);
  const model = choice.modelId;

  const before = await synthesizeElevenLabs({
    voiceId, text, modelId: model, languageCode: language,
    sendLanguage: choice.sendLanguage, format: 'mp3',
  });

  // The candidate rule is published as its own dictionary version rather than
  // mutated into an existing one, so audio approved last week can still be
  // explained.
  let after = before;
  let dictionary: { id: string; versionId: string } | null = null;
  const method = String(body.method ?? '');
  const value = String(body.value ?? '').trim();
  const term = String(body.term ?? '').trim();

  if (term && value && (method === 'alias' || method === 'phoneme')) {
    const made = await createPronunciationDictionary(
      `homatch-${term.slice(0, 24)}-${Date.now()}`,
      [{
        stringToReplace: term,
        type: method as 'alias' | 'phoneme',
        ...(method === 'alias' ? { alias: value } : { phoneme: value, alphabet: (String(body.alphabet ?? 'ipa') === 'cmu-arpabet' ? 'cmu-arpabet' : 'ipa') as 'ipa' | 'cmu-arpabet' }),
      }],
    );
    if (made.ok && made.data) {
      dictionary = { id: made.data.id, versionId: made.data.versionId };
      after = await synthesizeElevenLabs({
        voiceId, text, modelId: model, languageCode: language,
        sendLanguage: choice.sendLanguage, format: 'mp3',
        dictionaries: [dictionary],
      });
    } else {
      return json({
        ok: false, reason: 'DICTIONARY_FAILED',
        providerCode: made.error?.code ?? null,
        providerStatus: Number(made.error?.providerCode) || null,
        // A model that will not take phonemes is an answer, not a crash.
        methods: pronunciationMethodsFor(model),
      }, 200);
    }
  }

  return json({
    ok: before.ok,
    voiceId,
    model,
    before: before.ok && before.data ? { audioBase64: before.data.audioBase64, mime: before.data.mime } : null,
    after: after.ok && after.data ? { audioBase64: after.data.audioBase64, mime: after.data.mime } : null,
    dictionary,
    providerCode: before.ok ? null : before.error?.code ?? null,
    providerStatus: before.ok ? null : Number(before.error?.providerCode) || null,
  });
}

/** A rule goes live only when a person says the audio was right. */
async function pronunciationApprove(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  const id = String(body.id ?? '');
  if (!id) return json({ ok: false, reason: 'ID_REQUIRED' }, 400);

  const { error } = await sb.from('voice_pronunciation_rules').update({
    approved_by: userId,
    approved_at: new Date().toISOString(),
    enabled: body.enabled !== false,
    provider_dictionary_id: body.dictionaryId ? String(body.dictionaryId) : null,
    provider_version_id: body.versionId ? String(body.versionId) : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);
  logEvent('voice-ai', 'pronunciation_approved', { id });
  return json({ ok: true });
}

async function pronunciationDelete(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const id = String(body.id ?? '');
  if (!id) return json({ ok: false, reason: 'ID_REQUIRED' }, 400);
  const { error } = await sb.from('voice_pronunciation_rules').delete().eq('id', id);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  return json({ ok: true });
}

// ── Personality ─────────────────────────────────────────────────────────────

async function personalityGet(sb: Sb): Promise<Response> {
  const [{ data }, model] = await Promise.all([
    sb.from('voice_personality_profiles').select('*').eq('scope', 'GLOBAL').eq('is_default', true).maybeSingle(),
    ttsModel(sb),
  ]);
  return json({
    ok: true,
    profile: data ?? null,
    // Which provider dials this model actually honours. Showing a slider that
    // does nothing is the same lie as a pronunciation rule nobody applies.
    supports: {
      stability: true,
      similarityBoost: true,
      style: !model.includes('flash'),
      speakerBoost: true,
      speed: true,
    },
    model,
  });
}

async function personalitySave(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const unit = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
  };

  const patch = {
    brevity: clamp(body.brevity, 0, 100, 80),
    warmth: clamp(body.warmth, 0, 100, 70),
    formality: clamp(body.formality, 0, 100, 40),
    sales_intensity: clamp(body.salesIntensity, 0, 100, 20),
    proactivity: clamp(body.proactivity, 0, 100, 55),
    confirmation: clamp(body.confirmation, 0, 100, 40),
    interruption_sensitivity: clamp(body.interruptionSensitivity, 0, 100, 60),
    speaking_rate: clamp(body.speakingRate, 0.5, 2, 1),
    stability: unit(body.stability),
    similarity_boost: unit(body.similarityBoost),
    style: unit(body.style),
    use_speaker_boost: typeof body.useSpeakerBoost === 'boolean' ? body.useSpeakerBoost : null,
    extra_instructions: body.extraInstructions ? String(body.extraInstructions).slice(0, 1200) : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('voice_personality_profiles')
    .update(patch).eq('scope', 'GLOBAL').eq('is_default', true);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  return json({ ok: true });
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function routesGet(sb: Sb): Promise<Response> {
  const { data } = await sb.from('comm_provider_routes')
    .select('id, role, provider, priority, enabled, kill_switch, config, last_success_at, last_error, last_latency_ms')
    .order('role').order('priority');
  return json({ ok: true, routes: data ?? [] });
}

/**
 * Change which provider leads, and with which model.
 *
 * A kill switch may be raised from here and never lowered: §R keeps outbound
 * telephony fail-closed, and an endpoint that can turn spending on is not the
 * same kind of endpoint as one that can turn it off.
 */
async function routesSave(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const id = String(body.id ?? '');
  if (!id) return json({ ok: false, reason: 'ID_REQUIRED' }, 400);

  const { data: existing } = await sb.from('comm_provider_routes')
    .select('role, kill_switch, config').eq('id', id).maybeSingle();
  if (!existing) return json({ ok: false, reason: 'NOT_FOUND' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.priority === 'number') patch.priority = Math.max(0, Math.min(999, body.priority));

  if (body.killSwitch === true) patch.kill_switch = true;
  if (body.killSwitch === false) {
    // Lowering a telephony kill switch is a money decision and does not happen
    // through a voice settings screen.
    if (existing.role === 'TELEPHONY' || existing.role === 'WHATSAPP_CALL') {
      return json({ ok: false, reason: 'KILL_SWITCH_PROTECTED' }, 403);
    }
    patch.kill_switch = false;
  }

  if (body.config && typeof body.config === 'object') {
    patch.config = { ...(existing.config ?? {}), ...(body.config as Record<string, unknown>) };
  }

  const { error } = await sb.from('comm_provider_routes').update(patch).eq('id', id);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  logEvent('voice-ai', 'route_saved', { id, role: existing.role });
  return json({ ok: true });
}

// ── The Georgian audition ───────────────────────────────────────────────────

/**
 * Which voices does the provider have whose SPEAKER actually speaks this
 * language?
 *
 * Not which voices a multilingual model can render in it -- every stock voice
 * on this account can be rendered in Georgian, and every one of them sounds
 * like an American reading it, because every one of them is labelled
 * `language: en`. The shared library is where speakers of other languages
 * are, and `verified_languages` is the provider saying so rather than Homatch
 * inferring it.
 */
async function sharedVoices(body: VoiceAiRequest): Promise<Response> {
  if (!elevenLabsCredentialsPresent()) return json({ ok: false, reason: 'MISSING' }, 200);

  const out = await listSharedVoices({
    language: body.language ? String(body.language).slice(0, 5) : null,
    search: body.search ? String(body.search).slice(0, 60) : null,
    pageSize: Number(body.limit) || 40,
  });
  if (!out.ok || !out.data) {
    return json({
      ok: false, reason: 'PROVIDER_ERROR',
      providerCode: out.error?.code ?? null,
      providerStatus: Number(out.error?.providerCode) || null,
    }, 200);
  }
  return json({ ok: true, voices: out.data.voices });
}

/**
 * Put one shared voice into this account so it can be auditioned.
 *
 * A change to the owner's provider account, so it takes an explicit voice id
 * rather than a search and never runs on its own. Reversible from the
 * ElevenLabs dashboard; nothing here deletes voices.
 */
async function addSharedVoiceAction(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const publicOwnerId = String(body.publicOwnerId ?? '');
  const voiceId = String(body.voiceId ?? '');
  const name = String(body.name ?? '').trim();
  if (!publicOwnerId || !voiceId || !name) {
    return json({ ok: false, reason: 'OWNER_VOICE_AND_NAME_REQUIRED' }, 400);
  }

  const out = await addSharedVoice({ publicOwnerId, voiceId, name });
  if (!out.ok || !out.data) {
    return json({
      ok: false, reason: 'PROVIDER_ERROR',
      providerCode: out.error?.code ?? null,
      providerStatus: Number(out.error?.providerCode) || null,
      detail: out.error?.message?.slice(0, 200) ?? null,
    }, 200);
  }

  // Pull the account's catalogue again so the new voice exists in the library
  // with the provider's own metadata rather than with what we just typed.
  await syncVoiceLibrary(sb);
  logEvent('voice-ai', 'shared_voice_added', { voiceId: out.data.voiceId });
  return json({ ok: true, voiceId: out.data.voiceId });
}

/**
 * Say the same sentences in every candidate voice, and keep the audio.
 *
 * THE POINT IS THAT NOBODY HERE CAN JUDGE THE RESULT.
 *
 * No test can tell whether Georgian sounds native. A transcript round-trip
 * cannot: Scribe reads an American saying Georgian words perfectly well, and
 * that is exactly how a foreign accent passed every automated check while
 * being obviously wrong to the first person who listened. So this generates
 * the comparison and stores it, and a human decides.
 *
 * Each sample records what produced it -- voice, model, whether the language
 * was declared, the settings -- because "that one" is only a useful answer
 * when it can be turned back into a configuration.
 */
async function audition(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  if (!elevenLabsCredentialsPresent()) return json({ ok: false, reason: 'MISSING' }, 200);

  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 24) : [];
  const sentences = Array.isArray(body.sentences) ? body.sentences.slice(0, 12) : [];
  if (!candidates.length || !sentences.length) {
    return json({ ok: false, reason: 'CANDIDATES_AND_SENTENCES_REQUIRED' }, 400);
  }

  // Paid generation, and a batch of them. Bounded so a mistyped request cannot
  // spend an afternoon's credit in one call.
  const pairs = candidates.length * sentences.length;
  if (pairs > 80) return json({ ok: false, reason: 'TOO_MANY', pairs }, 400);

  const limit = await checkRateLimit(sb, 'voice_audition', 8, 3600, { userId });
  if (!limit.allowed) {
    return json({ ok: false, reason: 'RATE_LIMITED', retryAfter: limit.retryAfterSeconds }, 429);
  }

  const batchId = crypto.randomUUID();
  const language = body.language ? String(body.language).slice(0, 5) : null;
  const { data: known } = await sb.from('voice_library_voices')
    .select('provider_voice_id, name').eq('provider', 'ELEVENLABS');
  const nameOf = new Map((known ?? []).map((v) => [String(v.provider_voice_id), String(v.name)]));

  const rows: Array<Record<string, unknown>> = [];

  for (const raw of candidates) {
    const c = raw as Record<string, unknown>;
    const voiceId = String(c.voiceId ?? '');
    if (!voiceId) continue;
    const modelId = String(c.modelId ?? '') || ELEVENLABS_DEFAULTS.ttsModel;
    const sendLanguage = c.sendLanguage === true;
    const settings = (c.settings && typeof c.settings === 'object')
      ? c.settings as Record<string, number | boolean>
      : null;

    for (const rawSentence of sentences) {
      const item = rawSentence as Record<string, unknown>;
      const key = String(item.key ?? '').slice(0, 40) || 'line';
      const text = String(item.text ?? '').slice(0, 600);
      if (!text) continue;

      const at = Date.now();
      const out = await synthesizeElevenLabs({
        voiceId, text, modelId,
        languageCode: language,
        sendLanguage,
        settings: settings as never,
        format: 'mp3',
      });
      const ms = Date.now() - at;

      const row: Record<string, unknown> = {
        batch_id: batchId,
        voice_id: voiceId,
        voice_name: nameOf.get(voiceId) ?? (c.name ? String(c.name).slice(0, 80) : null),
        model_id: modelId,
        language,
        sent_language: sendLanguage,
        settings: settings ?? {},
        sentence_key: key,
        sentence: text,
        latency_ms: ms,
        ok: out.ok,
        error_code: out.ok ? null : (out.error?.code ?? null),
        provider_status: out.ok ? null : (Number(out.error?.providerCode) || null),
        // The provider's own sentence, bounded. "401" alone cannot tell a
        // revoked key from a voice this plan may not use, and those are
        // completely different things for somebody to act on.
        error_detail: out.ok ? null : (out.error?.message?.slice(0, 300) ?? null),
        created_by: userId,
      };

      if (out.ok && out.data) {
        const bytes = base64ToBytes(out.data.audioBase64);
        const path = `${batchId}/${voiceId}__${modelId}__${sendLanguage ? 'lang' : 'nolang'}__${key}.mp3`;
        const up = await sb.storage.from('voice-auditions')
          .upload(path, bytes, { contentType: out.data.mime, upsert: true });
        if (!up.error) {
          row.storage_path = path;
          row.mime = out.data.mime;
          row.bytes = bytes.byteLength;
        } else {
          row.ok = false;
          row.error_code = 'STORE_FAILED';
        }
      }

      rows.push(row);
    }
  }

  if (rows.length) await sb.from('voice_audition_samples').insert(rows);

  logEvent('voice-ai', 'audition_generated', {
    batchId, candidates: candidates.length, sentences: sentences.length,
    made: rows.filter((r) => r.ok).length,
  });

  return json({
    ok: true, batchId,
    generated: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
  });
}

/**
 * One batch, with links a person can actually press.
 *
 * Signed and short-lived: the bucket is private, and an audition sample is
 * operator material rather than something that should acquire a permanent
 * public URL because it was convenient once.
 */
async function auditionResults(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const batchId = String(body.batchId ?? '');
  let query = sb.from('voice_audition_samples')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(400);
  if (batchId) query = query.eq('batch_id', batchId);

  const { data } = await query;
  const rows = data ?? [];

  const ttl = Math.min(86_400, Math.max(300, Number(body.expiresIn) || 3600));
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await sb.storage.from('voice-auditions').createSignedUrls(paths, ttl);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  return json({
    ok: true,
    batches: [...new Set(rows.map((r) => String(r.batch_id)))],
    samples: rows.map((r) => ({
      id: r.id, batchId: r.batch_id,
      voiceId: r.voice_id, voiceName: r.voice_name,
      modelId: r.model_id, language: r.language, sentLanguage: r.sent_language,
      settings: r.settings, sentenceKey: r.sentence_key, sentence: r.sentence,
      latencyMs: r.latency_ms, bytes: r.bytes, ok: r.ok,
      errorCode: r.error_code, providerStatus: r.provider_status,
      errorDetail: r.error_detail,
      url: r.storage_path ? signed.get(String(r.storage_path)) ?? null : null,
    })),
  });
}

/**
 * Which languages have a voice somebody has actually listened to.
 *
 * Reported with the gap included: a language with no row is a language the
 * product speaks in whatever the global default is, and an operator should be
 * able to see that rather than discover it from a customer.
 */
async function languageVoices(sb: Sb): Promise<Response> {
  const [{ data: approved }, { data: fallback }] = await Promise.all([
    sb.from('voice_language_defaults')
      .select('language, voice_id, voice_name, model_id, send_language, settings, notes, approved_at')
      .eq('provider', 'ELEVENLABS')
      .order('language'),
    sb.from('voice_library_voices')
      .select('provider_voice_id, name, labels')
      .eq('provider', 'ELEVENLABS').eq('is_default', true).maybeSingle(),
  ]);

  const labels = (fallback?.labels ?? {}) as Record<string, string>;
  return json({
    ok: true,
    approved: approved ?? [],
    /*
     * The global fallback, WITH what the provider says about its speaker.
     *
     * The accent label is the whole point. A voice labelled `language: en,
     * accent: american` speaking Georgian is an American reading Georgian
     * letters, and that fact belongs on the screen next to the word
     * "fallback" rather than in a support conversation later.
     */
    fallback: fallback ? {
      voiceId: fallback.provider_voice_id,
      name: fallback.name,
      speakerLanguage: labels.language ?? null,
      speakerAccent: labels.accent ?? null,
    } : null,
  });
}

/**
 * A person listened, and this is the one.
 *
 * Approval is of a COMBINATION -- voice, model, whether the language is
 * declared, the settings -- because the same voice on a different model is a
 * different sound. Recording only the voice id would let a later change swap
 * the thing that was approved for something nobody has heard.
 */
async function approveLanguageVoice(sb: Sb, userId: string, body: VoiceAiRequest): Promise<Response> {
  const language = String(body.language ?? '').toLowerCase().slice(0, 5);
  const voiceId = String(body.voiceId ?? '');
  if (!language || !voiceId) return json({ ok: false, reason: 'LANGUAGE_AND_VOICE_REQUIRED' }, 400);

  // Only a voice this account actually has. An id typed by hand that the
  // provider refuses would make the product silent in that language.
  const { data: known } = await sb.from('voice_library_voices')
    .select('name').eq('provider', 'ELEVENLABS').eq('provider_voice_id', voiceId).maybeSingle();
  if (!known) return json({ ok: false, reason: 'VOICE_NOT_IN_LIBRARY' }, 404);

  const { error } = await sb.from('voice_language_defaults').upsert({
    provider: 'ELEVENLABS',
    language,
    voice_id: voiceId,
    voice_name: known.name,
    model_id: body.modelId ? String(body.modelId).slice(0, 60) : null,
    send_language: body.sendLanguage !== false,
    settings: (body.settings && typeof body.settings === 'object') ? body.settings : {},
    audition_sample_id: body.auditionSampleId ? String(body.auditionSampleId) : null,
    notes: body.notes ? String(body.notes).slice(0, 400) : null,
    approved_by: userId,
    approved_at: new Date().toISOString(),
  }, { onConflict: 'provider,language' });

  if (error) return json({ ok: false, reason: 'STORE_FAILED', detail: error.message.slice(0, 160) }, 500);

  // A voice the product speaks with must be a voice customers can see and
  // pick. Approving it for a language turns it on if it was off.
  await sb.from('voice_library_voices')
    .update({ enabled: true, updated_at: new Date().toISOString() })
    .eq('provider', 'ELEVENLABS').eq('provider_voice_id', voiceId);

  logEvent('voice-ai', 'language_voice_approved', { language, voiceId });
  return json({ ok: true });
}

/**
 * May a language with no approved voice speak with a foreign one?
 *
 * Stored on the TTS route beside the model, because it is a property of how
 * this provider is allowed to be used rather than a global preference.
 */
async function fallbackPolicyGet(sb: Sb): Promise<Response> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  const policy = (data?.config as Record<string, unknown> | null)?.fallback_policy;
  const allowsForeign = policy === 'OWNER_APPROVED_FOREIGN_FALLBACK';
  return json({
    ok: true,
    policy: allowsForeign ? 'OWNER_APPROVED_FOREIGN_FALLBACK' : 'SAME_LANGUAGE_APPROVED_ONLY',
    allowsForeign,
  });
}

async function fallbackPolicySave(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const allow = body.allowForeign === true;
  const { data: existing } = await sb.from('comm_provider_routes')
    .select('id, config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  if (!existing) return json({ ok: false, reason: 'NO_ROUTE' }, 404);

  const config = {
    ...(existing.config as Record<string, unknown> ?? {}),
    fallback_policy: allow ? 'OWNER_APPROVED_FOREIGN_FALLBACK' : 'SAME_LANGUAGE_APPROVED_ONLY',
  };
  const { error } = await sb.from('comm_provider_routes')
    .update({ config, updated_at: new Date().toISOString() }).eq('id', existing.id);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);

  // Worth a log line: this is the switch that decides whether a customer can
  // hear the wrong accent, and somebody should be able to see when it moved.
  logEvent('voice-ai', 'fallback_policy_changed', { allowForeign: allow });
  return json({ ok: true, policy: config.fallback_policy });
}

/** Withdraw an approval. The language falls back and the screen says so. */
async function revokeLanguageVoice(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const language = String(body.language ?? '').toLowerCase().slice(0, 5);
  if (!language) return json({ ok: false, reason: 'LANGUAGE_REQUIRED' }, 400);
  const { error } = await sb.from('voice_language_defaults')
    .delete().eq('provider', 'ELEVENLABS').eq('language', language);
  if (error) return json({ ok: false, reason: 'STORE_FAILED' }, 500);
  logEvent('voice-ai', 'language_voice_revoked', { language });
  return json({ ok: true });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Usage ───────────────────────────────────────────────────────────────────

/**
 * What the providers cost, in the units they bill in.
 *
 * COGS only, and labelled with where each number came from. §R: a provider
 * cost moving must never move what a customer pays, and nothing here is
 * customer pricing.
 */
async function usage(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const days = Math.min(90, Math.max(1, Number(body.days) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data } = await sb.from('voice_usage_events')
    .select('provider, role, model, characters, audio_seconds, input_tokens, output_tokens, latency_ms, cost_basis, cost_usd, ok, error_code, provider_status')
    .gte('occurred_at', since)
    .limit(5000);

  const rows = data ?? [];
  const key = (r: typeof rows[number]) => `${r.provider}|${r.role}|${r.model ?? ''}`;
  const groups = new Map<string, {
    provider: string; role: string; model: string | null;
    calls: number; failures: number; characters: number; audioSeconds: number;
    inputTokens: number; outputTokens: number; latencies: number[];
    costUsd: number; costBasis: Set<string>;
  }>();

  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) {
      groups.set(k, {
        provider: r.provider, role: r.role, model: r.model,
        calls: 0, failures: 0, characters: 0, audioSeconds: 0,
        inputTokens: 0, outputTokens: 0, latencies: [], costUsd: 0, costBasis: new Set(),
      });
    }
    const g = groups.get(k)!;
    g.calls += 1;
    if (!r.ok) g.failures += 1;
    g.characters += Number(r.characters ?? 0);
    g.audioSeconds += Number(r.audio_seconds ?? 0);
    g.inputTokens += Number(r.input_tokens ?? 0);
    g.outputTokens += Number(r.output_tokens ?? 0);
    if (typeof r.latency_ms === 'number') g.latencies.push(r.latency_ms);
    if (r.cost_usd !== null && r.cost_usd !== undefined) g.costUsd += Number(r.cost_usd);
    if (r.cost_basis) g.costBasis.add(String(r.cost_basis));
  }

  return json({
    ok: true,
    days,
    groups: [...groups.values()].map((g) => {
      const sorted = [...g.latencies].sort((a, b) => a - b);
      return {
        provider: g.provider, role: g.role, model: g.model,
        calls: g.calls, failures: g.failures,
        characters: g.characters || null,
        audioSeconds: g.audioSeconds || null,
        inputTokens: g.inputTokens || null,
        outputTokens: g.outputTokens || null,
        latencyP50Ms: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        latencyP90Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null,
        // Null, not zero. A provider that has not told us what it charged has
        // not charged nothing.
        costUsd: g.costUsd || null,
        costBasis: g.costBasis.size ? [...g.costBasis] : null,
      };
    }).sort((a, b) => b.calls - a.calls),
    // Said plainly, because a dashboard that looks like an invoice becomes one
    // in somebody's memory.
    note: 'Provider cost of goods only. Not customer pricing.',
  });
}

// ── Shared ──────────────────────────────────────────────────────────────────

async function ttsModel(sb: Sb): Promise<string> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  return typeof cfg.model === 'string' && cfg.model ? cfg.model : ELEVENLABS_DEFAULTS.ttsModel;
}

async function recordUsage(sb: Sb, event: {
  ownerId: string | null; surface: string; provider: string;
  role: 'STT' | 'TTS' | 'LLM' | 'ORCHESTRATOR' | 'TELEPHONY';
  model: string | null; characters?: number | null; latencyMs: number | null;
  ok: boolean; errorCode: string | null; providerStatus: number | null;
}): Promise<void> {
  try {
    await sb.from('voice_usage_events').insert({
      owner_id: event.ownerId,
      surface: event.surface,
      provider: event.provider,
      role: event.role,
      model: event.model,
      characters: event.characters ?? null,
      latency_ms: event.latencyMs,
      ok: event.ok,
      error_code: event.errorCode,
      provider_status: event.providerStatus,
    });
  } catch {
    // Telemetry must never take the thing it measures down with it.
  }
}

/**
 * A grant for proving the Google speech socket works, WITHOUT switching the
 * production route on.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The live path mints a grant only when comm_provider_routes says GOOGLE is
 * enabled. That is correct: the route is the operator's decision and nothing
 * should be able to route a visitor around it. But it creates a trap — the
 * only way to find out whether realtime Georgian recognition actually works
 * is to turn it on for real visitors and watch, which is precisely the order
 * of operations this workstream got wrong once already.
 *
 * So verification gets its own door. An admin asks for a grant, opens the
 * socket themselves, streams a known recording and reads the transcript back.
 * If it fails, no visitor was ever routed to it. If it succeeds, THEN the
 * route is enabled, with evidence instead of optimism.
 *
 * WHAT THIS DOES NOT WEAKEN
 *
 * The grant is the same short-lived HMAC over the same payload with the same
 * secret, minted by the same function the live path uses — a diagnostic that
 * takes a different route to the thing it is diagnosing proves nothing about
 * the thing. It expires on the same clock. It carries no credential: the
 * Google service account stays on the worker, which is the entire reason the
 * browser is handed a signature rather than a key.
 *
 * The door itself is requireAdmin, the same gate as every other action here,
 * reached only after authenticate(). An anonymous AI TALK visitor cannot call
 * this, and a signed-in customer cannot either.
 */
async function speechProbe(body: VoiceAiRequest): Promise<Response> {
  const health = await googleSpeechDiagnosis();

  // A session id that is obviously a probe, so anything the worker logs about
  // this stream is distinguishable from a real conversation.
  const sessionId = `probe-${crypto.randomUUID()}`;
  const grant = await mintSpeechGrant(sessionId);

  await logEvent('voice-ai', 'speech_probe_granted', {
    reachable: health.reachable,
    available: health.available,
    reason: health.reason,
    granted: Boolean(grant),
  });

  return json({
    ok: true,
    sessionId,
    // Null when WORKER_TOKEN is absent from THIS runtime, which is a real
    // answer: without it there is no way to authorise the socket and the live
    // path would be just as stuck.
    grant,
    grantExpiresInMs: grant ? GRANT_TTL_MS : null,
    wsUrl: speechSocketUrl(),
    language: String(body.language ?? 'ka-GE'),
    sampleRate: 16_000,
    worker: health,
  });
}


/**
 * Does this voice actually speak these languages?
 *
 * WHY A PROBE AND NOT A DOCUMENTATION LOOKUP
 *
 * A TTS API accepts almost any text in almost any language and returns 200.
 * What comes back may be the right words in the right script, or it may be a
 * speaker reading unfamiliar letters phonetically, which is exactly the
 * failure that made the previous provider unusable for Georgian — and the API
 * response looked identical in both cases.
 *
 * So this synthesises a REAL sentence in each language, through the same
 * streaming path a conversation uses, and reports what happened: whether the
 * provider accepted it, which model answered, how long the first audio byte
 * took, and how much audio came back. Bytes-per-character is included because
 * a provider that silently gives up mid-sentence returns success and very
 * little audio.
 *
 * It cannot tell you whether the result SOUNDS native. Nothing automated can;
 * that is why the audition harness exists and why a person listens. What it
 * can do is stop a language being declared supported on the strength of an
 * HTTP status.
 */
const PROBE_LINES: Array<{ language: string; text: string }> = [
  // Each carries a price and a Tbilisi district, because numbers, currency
  // and place names are where a mismatched voice falls apart first.
  { language: 'ka', text: 'გამარჯობა, ვაკეში ორსაძინებლიანი ბინა ას ორმოცდაათი ათასი დოლარი ღირს.' },
  { language: 'en', text: 'Hello, a two bedroom flat in Vake costs one hundred and fifty thousand dollars.' },
  { language: 'ru', text: 'Здравствуйте, двухкомнатная квартира в Ваке стоит сто пятьдесят тысяч долларов.' },
  { language: 'tr', text: 'Merhaba, Vake semtinde iki odalı bir daire yüz elli bin dolar.' },
  { language: 'ar', text: 'مرحبا، شقة بغرفتي نوم في فاكي تكلف مئة وخمسين ألف دولار.' },
  { language: 'he', text: 'שלום, דירת שני חדרים בוואקה עולה מאה וחמישים אלף דולר.' },
];

async function voiceLanguageProbe(body: VoiceAiRequest): Promise<Response> {
  if (!cartesiaCredentialsPresent().ok) {
    return json({ ok: false, reason: 'CARTESIA_NOT_CONFIGURED' }, 503);
  }

  const voiceId = /^[0-9a-f-]{16,64}$/i.test(String(body.voiceId ?? ''))
    ? String(body.voiceId)
    : null;
  if (!voiceId) return json({ ok: false, reason: 'VOICE_ID_REQUIRED' }, 400);

  const sampleRate = Number(body.sampleRate) || 24_000;
  const wanted = Array.isArray(body.languages) && body.languages.length
    ? PROBE_LINES.filter((l) => (body.languages as string[]).includes(l.language))
    : PROBE_LINES;

  const results: Array<Record<string, unknown>> = [];
  for (const line of wanted) {
    let chunks = 0;
    let bytes = 0;
    const started = Date.now();
    const out = await streamCartesiaPcm({
      voiceId, language: line.language, text: line.text, sampleRate,
    }, (chunk) => { chunks += 1; bytes += chunk.byteLength; });

    results.push({
      language: line.language,
      ok: out.ok,
      model: out.ok ? out.data.model : null,
      firstByteMs: out.ok ? out.data.firstByteMs : null,
      totalMs: out.ok ? out.data.totalMs : Date.now() - started,
      sampleRate: out.ok ? out.data.sampleRate : null,
      chunks,
      bytes,
      // Seconds of speech per character. A provider that stops early answers
      // success with almost no audio, and this is where that shows.
      secondsPerChar: bytes
        ? Math.round((bytes / 2 / sampleRate / line.text.length) * 1000) / 1000
        : 0,
      characters: line.text.length,
      // The provider's own sentence when it refused. Never a credential.
      error: out.ok ? null : String(out.error?.message ?? '').slice(0, 300),
      errorCode: out.ok ? null : (out.error?.code ?? null),
    });
  }

  await logEvent('voice-ai', 'voice_language_probe', {
    voiceId, languages: results.length,
    failed: results.filter((r) => !r.ok).length,
  });

  return json({ ok: true, voiceId, sampleRate, results });
}

/** The provider's own catalogue, so a voice's languages are read and not assumed. */
async function cartesiaVoiceCatalogue(): Promise<Response> {
  if (!cartesiaCredentialsPresent().ok) {
    return json({ ok: false, reason: 'CARTESIA_NOT_CONFIGURED' }, 503);
  }
  const out = await listCartesiaVoices(200);
  if (!out.ok) {
    return json({ ok: false, reason: out.error?.code ?? 'UNKNOWN', detail: String(out.error?.message ?? '').slice(0, 300) }, 502);
  }
  return json({ ok: true, voices: out.data });
}

// ── AI Talk cost of goods ───────────────────────────────────────────────────

/**
 * WHAT A CONVERSATION COSTS US, AND WHAT WE STILL CANNOT SEE.
 *
 * COGS ONLY. Not a price, not a margin, not anything a customer is shown.
 *
 * Every figure here is either measured or explicitly absent. The one rule the
 * finance surfaces in this project are built on applies without exception:
 * a number that is not known renders as unknown, never as zero, because a
 * cost centre that reports $0.00 is one nobody investigates again.
 *
 * Two kinds of cost, kept apart on purpose:
 *
 *   VARIABLE   what a provider billed for this conversation -- Cartesia by the
 *              character, Google by the second, OpenAI by the token. Metered.
 *   ALLOCATED  a share of a fixed monthly subscription. Railway and Supabase
 *              charge by the month whether anybody talks or not, so there is
 *              no per-call price to report and inventing one would be a lie
 *              with a decimal point in it. See ai_talk_infra_allocation.
 */
async function talkCogs(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const days = body.days === null || body.days === undefined ? 7 : Number(body.days);
  // 0 means all time, which for this product is a handful of days anyway.
  const allTime = !Number.isFinite(days) || days <= 0;
  const from = allTime ? new Date(0) : new Date(Date.now() - Math.min(365, days) * 86_400_000);
  const to = new Date();

  const [sessionsRes, eventsRes, infraRes] = await Promise.all([
    sb.from('comm_talk_sessions')
      .select('id, created_at, consumed_seconds, turns')
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000),
    sb.from('voice_usage_events')
      .select('session_id, provider, role, model, characters, audio_seconds, input_tokens, cached_input_tokens, output_tokens, cost_usd, cost_basis, ok, error_code, occurred_at')
      .eq('surface', 'AI_TALK')
      .gte('occurred_at', from.toISOString())
      .limit(20000),
    sb.rpc('ai_talk_infra_allocation', { p_from: from.toISOString(), p_to: to.toISOString() }),
  ]);

  const sessions = sessionsRes.data ?? [];
  const events = eventsRes.data ?? [];
  const infra = (Array.isArray(infraRes.data) ? infraRes.data[0] : infraRes.data) ?? null;

  const seconds = sessions.reduce((n: number, s: Record<string, unknown>) => n + Number(s.consumed_seconds ?? 0), 0);
  const minutes = seconds / 60;
  const turns = sessions.reduce((n: number, s: Record<string, unknown>) => n + Number(s.turns ?? 0), 0);

  /*
   * A leg of the chain, summed. `unknownCalls` is the number that matters
   * most: it is how much of this product's cost is still invisible, and it is
   * reported beside the cost rather than folded into it.
   */
  const leg = (role: string) => {
    const mine = events.filter((e: Record<string, unknown>) => e.role === role);
    let cost = 0;
    let priced = 0;
    let unknown = 0;
    for (const e of mine) {
      if (e.cost_usd === null || e.cost_usd === undefined) unknown += 1;
      else { cost += Number(e.cost_usd); priced += 1; }
    }
    const sum = (f: string) => mine.reduce((n: number, e: Record<string, unknown>) =>
      n + Number(e[f] ?? 0), 0);
    return {
      calls: mine.length,
      failures: mine.filter((e: Record<string, unknown>) => e.ok === false).length,
      cancelled: mine.filter((e: Record<string, unknown>) => e.error_code === 'CANCELLED').length,
      characters: sum('characters'),
      audioSeconds: Math.round(sum('audio_seconds') * 1000) / 1000,
      inputTokens: sum('input_tokens'),
      cachedInputTokens: sum('cached_input_tokens'),
      outputTokens: sum('output_tokens'),
      // Null, not zero, when nothing in this leg could be priced at all.
      costUsd: priced ? Math.round(cost * 1e6) / 1e6 : null,
      pricedCalls: priced,
      unknownCalls: unknown,
    };
  };

  const stt = leg('STT');
  const tts = leg('TTS');
  const llm = leg('LLM');

  const variable = [stt.costUsd, tts.costUsd, llm.costUsd]
    .filter((n): n is number => n !== null)
    .reduce((a, b) => a + b, 0);
  const allocated = infra?.period_usd === null || infra?.period_usd === undefined
    ? null : Number(infra.period_usd);
  const knownTotal = Math.round((variable + (allocated ?? 0)) * 1e6) / 1e6;

  /*
   * The honest denominator. Averages over a window with no conversations in
   * it are not zero-cost conversations, they are no conversations, and the
   * difference is the whole point of this panel.
   */
  const per = (total: number | null, n: number) =>
    total === null || !(n > 0) ? null : Math.round((total / n) * 1e6) / 1e6;

  return json({
    window: { days: allTime ? null : Math.min(365, days), from: from.toISOString(), to: to.toISOString() },
    sessions: sessions.length,
    turns,
    minutes: Math.round(minutes * 10) / 10,
    stt, tts, llm,
    infra: infra
      ? {
        monthlyUsd: Number(infra.monthly_usd),
        months: Math.round(Number(infra.months) * 1e4) / 1e4,
        periodUsd: allocated,
        usdPerMinute: infra.usd_per_minute === null || infra.usd_per_minute === undefined
          ? null : Number(infra.usd_per_minute),
        // Stated, not implied: this is how the number was produced.
        method: 'Fixed monthly subscriptions (Railway worker, Supabase share) pro-rated to '
          + 'this window and divided by the AI Talk minutes actually served in it. '
          + 'ALLOCATED, not metered.',
      }
      : null,
    totals: {
      variableUsd: Math.round(variable * 1e6) / 1e6,
      allocatedUsd: allocated,
      knownUsd: knownTotal,
      // How much of the chain is still dark. Never presented as free.
      unknownCalls: stt.unknownCalls + tts.unknownCalls + llm.unknownCalls,
      // A session with no recognition row at all predates the measurement and
      // is counted here rather than quietly averaged into a cheaper number.
      sessionsWithoutStt: sessions.filter((s: Record<string, unknown>) =>
        !events.some((e: Record<string, unknown>) => e.session_id === s.id && e.role === 'STT')).length,
      sessionsWithoutLlm: sessions.filter((s: Record<string, unknown>) =>
        !events.some((e: Record<string, unknown>) => e.session_id === s.id && e.role === 'LLM')).length,
    },
    averages: {
      perSessionUsd: per(knownTotal, sessions.length),
      perMinuteUsd: per(knownTotal, minutes),
      perTurnUsd: per(knownTotal, turns),
    },
    note: 'Provider cost of goods only. Not customer pricing. Variable cost is metered; '
      + 'infrastructure is allocated from fixed monthly subscriptions.',
  });
}

/** One conversation, priced leg by leg, for when an average is not enough. */
async function talkSessionCogs(sb: Sb, body: VoiceAiRequest): Promise<Response> {
  const id = String(body.sessionId ?? '').trim();
  if (!id) return json({ error: 'session_required' }, 400);

  const [sessionRes, eventsRes] = await Promise.all([
    sb.from('comm_talk_sessions')
      .select('id, created_at, ended_at, state, consumed_seconds, granted_seconds, turns, locale, ended_reason')
      .eq('id', id).maybeSingle(),
    sb.from('voice_usage_events')
      .select('provider, role, model, characters, audio_seconds, input_tokens, cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis, ok, error_code, occurred_at')
      .eq('session_id', id)
      .order('occurred_at', { ascending: true })
      .limit(2000),
  ]);

  const session = sessionRes.data;
  if (!session) return json({ error: 'not_found' }, 404);
  const events = eventsRes.data ?? [];

  const minutes = Number(session.consumed_seconds ?? 0) / 60;
  const infraRes = await sb.rpc('ai_talk_infra_allocation', {
    p_from: new Date(new Date(session.created_at).getTime() - 1000).toISOString(),
    p_to: new Date(new Date(session.ended_at ?? session.created_at).getTime() + 86_400_000).toISOString(),
  });
  const infra = (Array.isArray(infraRes.data) ? infraRes.data[0] : infraRes.data) ?? null;
  const perMinute = infra?.usd_per_minute === null || infra?.usd_per_minute === undefined
    ? null : Number(infra.usd_per_minute);
  const allocated = perMinute === null ? null : Math.round(perMinute * minutes * 1e6) / 1e6;

  const byRole = (role: string) => {
    const mine = events.filter((e: Record<string, unknown>) => e.role === role);
    const priced = mine.filter((e: Record<string, unknown>) => e.cost_usd !== null && e.cost_usd !== undefined);
    const sum = (f: string) => mine.reduce((n: number, e: Record<string, unknown>) => n + Number(e[f] ?? 0), 0);
    return {
      calls: mine.length,
      failures: mine.filter((e: Record<string, unknown>) => e.ok === false).length,
      cancelled: mine.filter((e: Record<string, unknown>) => e.error_code === 'CANCELLED').length,
      characters: sum('characters'),
      audioSeconds: Math.round(sum('audio_seconds') * 1000) / 1000,
      inputTokens: sum('input_tokens'),
      cachedInputTokens: sum('cached_input_tokens'),
      outputTokens: sum('output_tokens'),
      costUsd: priced.length
        ? Math.round(priced.reduce((n: number, e: Record<string, unknown>) => n + Number(e.cost_usd), 0) * 1e6) / 1e6
        : null,
      unknownCalls: mine.length - priced.length,
    };
  };

  const stt = byRole('STT');
  const tts = byRole('TTS');
  const llm = byRole('LLM');
  const variable = [stt.costUsd, tts.costUsd, llm.costUsd]
    .filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
  const known = Math.round((variable + (allocated ?? 0)) * 1e6) / 1e6;

  return json({
    session: {
      id: session.id, createdAt: session.created_at, endedAt: session.ended_at,
      state: session.state, endedReason: session.ended_reason, locale: session.locale,
      seconds: session.consumed_seconds, minutes: Math.round(minutes * 100) / 100,
      turns: session.turns,
    },
    stt, tts, llm,
    infra: { allocatedUsd: allocated, usdPerMinute: perMinute },
    totals: {
      variableUsd: Math.round(variable * 1e6) / 1e6,
      knownUsd: known,
      unknownCalls: stt.unknownCalls + tts.unknownCalls + llm.unknownCalls,
      // Named plainly: a conversation from before a leg was measured has a
      // hole in it, and the hole is the answer, not a zero.
      missingLegs: [
        stt.calls ? null : 'STT',
        llm.calls ? null : 'LLM',
        tts.calls ? null : 'TTS',
      ].filter(Boolean),
    },
    averages: {
      perMinuteUsd: minutes > 0 ? Math.round((known / minutes) * 1e6) / 1e6 : null,
      perTurnUsd: Number(session.turns) > 0 ? Math.round((known / Number(session.turns)) * 1e6) / 1e6 : null,
    },
    events: events.map((e: Record<string, unknown>) => ({
      at: e.occurred_at, provider: e.provider, role: e.role, model: e.model,
      characters: e.characters, audioSeconds: e.audio_seconds,
      inputTokens: e.input_tokens, cachedInputTokens: e.cached_input_tokens, outputTokens: e.output_tokens,
      latencyMs: e.latency_ms, costUsd: e.cost_usd, costBasis: e.cost_basis,
      ok: e.ok, errorCode: e.error_code,
    })),
  });
}
