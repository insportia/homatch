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
    case 'usage':                return await usage(sb, body);
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
      url: r.storage_path ? signed.get(String(r.storage_path)) ?? null : null,
    })),
  });
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
