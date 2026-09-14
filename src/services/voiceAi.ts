// HOMATCH — the Voice AI control surface, from the browser.
//
// Every call here goes to ONE edge function, `voice-ai`, which is where the
// ElevenLabs credential lives. Nothing in this file has a provider key, a
// provider hostname or a provider protocol in it, and that is the point: the
// browser asks Homatch what the provider said, it never asks the provider.
//
// Two of these actions (`voices`, `preview`) are reachable by any signed-in
// customer. Everything else is admin-only and the edge function enforces it —
// this module's shape is a convenience, never a gate.

import { supabase } from '@/db/supabase';

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke('voice-ai', {
    body: { action, ...body },
  });
  if (error) return null;
  return data as T;
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface ProviderRoute {
  id?: string;
  role: string;
  provider: string;
  priority: number;
  enabled: boolean;
  kill_switch: boolean;
  config: Record<string, unknown> | null;
  last_error: string | null;
  last_success_at: string | null;
  last_latency_ms?: number | null;
}

export interface UsageEvent {
  provider: string;
  role: string;
  model: string | null;
  latency_ms: number | null;
  ok: boolean;
  error_code: string | null;
  provider_status: number | null;
  occurred_at: string;
}

export interface VoiceOverview {
  ok: boolean;
  elevenLabs: {
    status: string;
    voiceCount?: number | null;
    modelCount?: number | null;
    tier?: string | null;
    charactersRemaining?: number | null;
    charactersLimit?: number | null;
    canMintRealtimeToken?: boolean;
    canUsePronunciationDictionaries?: boolean;
    latencyMs?: number | null;
    detail?: string | null;
  };
  credentials: Array<{ name: string; present: boolean }>;
  routes: ProviderRoute[];
  defaultVoice: { provider_voice_id: string; name: string } | null;
  vocabularyCount: number;
  lastSession: { id: string; created_at: string; state: string; turns: number | null; consumed_seconds: number | null } | null;
  recentUsage: UsageEvent[];
  latencyMedianMs: Record<string, number>;
}

export const getVoiceOverview = () => call<VoiceOverview>('overview');

// ── Models and voices ───────────────────────────────────────────────────────

export interface ProviderModel {
  modelId: string;
  name: string;
  canDoTts: boolean;
  canDoStt: boolean;
  languages: string[];
}

export const getVoiceModels = () =>
  call<{ ok: boolean; reason?: string; models?: ProviderModel[] }>('models');

export interface LibraryVoice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string> | null;
  languages: string[] | null;
  recommended: boolean;
  isDefault: boolean;
}

export const listLibraryVoices = () =>
  call<{ ok: boolean; voices: LibraryVoice[] }>('voices');

export const syncVoiceLibrary = () =>
  call<{ ok: boolean; synced?: number; reason?: string }>('sync-voices');

export const setVoiceFlags = (voiceId: string, patch: {
  enabled?: boolean; recommended?: boolean; isDefault?: boolean; sortOrder?: number;
}) => call<{ ok: boolean; reason?: string }>('set-voice', { voiceId, ...patch });

export const previewLibraryVoice = (voiceId: string, language: string) =>
  call<{
    ok: boolean; audioBase64?: string; mime?: string; model?: string;
    ms?: number; text?: string; reason?: string;
    providerCode?: string | null; providerStatus?: number | null;
  }>('preview', { voiceId, language });

// ── Vocabulary ──────────────────────────────────────────────────────────────

export interface VocabularyRow {
  id: string;
  term: string;
  category: string;
  language_hint: string | null;
  scope: string;
  priority: number;
  enabled: boolean;
  provider_eligible: boolean;
  notes: string | null;
  owner_id: string | null;
  agent_id: string | null;
  updated_at: string;
}

export const listVocabulary = (filter: { search?: string; category?: string; limit?: number } = {}) =>
  call<{ ok: boolean; terms: VocabularyRow[]; categories: Array<{ name: string; count: number }> }>(
    'vocabulary', filter,
  );

export const saveVocabularyTerm = (row: {
  id?: string; term: string; category?: string; languageHint?: string | null;
  scope?: string; priority?: number; enabled?: boolean; providerEligible?: boolean;
  notes?: string | null;
}) => call<{ ok: boolean; id?: string; reason?: string }>('vocabulary-save', row);

export const deleteVocabularyTerm = (id: string) =>
  call<{ ok: boolean; reason?: string }>('vocabulary-delete', { id });

export const importVocabulary = (csv: string) =>
  call<{ ok: boolean; read?: number; inserted?: number; skipped?: number; reason?: string }>(
    'vocabulary-import', { csv },
  );

export const exportVocabulary = () =>
  call<{ ok: boolean; csv: string; count: number }>('vocabulary-export');

// ── Keyterms ────────────────────────────────────────────────────────────────

export interface KeytermSelection {
  ok: boolean;
  limits: { maxTerms: number; maxCharsPerTerm: number };
  considered: number;
  selected: Array<{ id: string; term: string; category: string; score: number; reasons: string[] }>;
  dropped: Array<{ term: string; reason: string }>;
}

export const previewKeyterms = (context: {
  language?: string | null; feature?: string | null; agentId?: string | null;
  agentPurpose?: string | null; tenantId?: string | null;
  locations?: string[]; developers?: string[]; projects?: string[];
  entities?: string[]; abusiveContext?: boolean;
}) => call<KeytermSelection>('keyterm-preview', context);

// ── Pronunciation ───────────────────────────────────────────────────────────

export interface PronunciationRule {
  id: string;
  term: string;
  language: string | null;
  provider: string;
  method: string;
  value: string;
  alphabet: string | null;
  scope: string;
  priority: number;
  enabled: boolean;
  approved_at: string | null;
  model_compatibility: string[] | null;
  provider_dictionary_id: string | null;
  notes: string | null;
  updated_at: string;
}

export const listPronunciation = () =>
  call<{ ok: boolean; rules: PronunciationRule[]; methods: string[]; model: string }>('pronunciation');

export const savePronunciation = (rule: {
  id?: string; term: string; value: string; method: string;
  language?: string | null; alphabet?: string; priority?: number; notes?: string | null;
}) => call<{ ok: boolean; id?: string | null; reason?: string; detail?: string }>('pronunciation-save', rule);

export const previewPronunciation = (input: {
  text: string; term?: string; value?: string; method?: string;
  alphabet?: string; language?: string | null; voiceId?: string | null; model?: string;
}) => call<{
  ok: boolean; voiceId?: string; model?: string;
  before: { audioBase64: string; mime: string } | null;
  after: { audioBase64: string; mime: string } | null;
  dictionary: { id: string; versionId: string } | null;
  reason?: string; methods?: string[];
  providerCode?: string | null; providerStatus?: number | null;
}>('pronunciation-preview', input);

export const approvePronunciation = (input: {
  id: string; enabled?: boolean; dictionaryId?: string | null; versionId?: string | null;
}) => call<{ ok: boolean; reason?: string }>('pronunciation-approve', input);

export const deletePronunciation = (id: string) =>
  call<{ ok: boolean; reason?: string }>('pronunciation-delete', { id });

// ── Personality ─────────────────────────────────────────────────────────────

export interface PersonalityProfile {
  id: string;
  name: string;
  brevity: number;
  warmth: number;
  formality: number;
  sales_intensity: number;
  proactivity: number;
  confirmation: number;
  interruption_sensitivity: number;
  speaking_rate: number;
  stability: number | null;
  similarity_boost: number | null;
  style: number | null;
  use_speaker_boost: boolean | null;
  extra_instructions: string | null;
}

export const getPersonality = () =>
  call<{
    ok: boolean; profile: PersonalityProfile | null; model: string;
    supports: Record<string, boolean>;
  }>('personality');

export const savePersonality = (patch: Record<string, unknown>) =>
  call<{ ok: boolean; reason?: string }>('personality-save', patch);

// ── Routes ──────────────────────────────────────────────────────────────────

export const listRoutes = () => call<{ ok: boolean; routes: ProviderRoute[] }>('routes');

export const saveRoute = (patch: {
  id: string; enabled?: boolean; priority?: number; killSwitch?: boolean;
  config?: Record<string, unknown>;
}) => call<{ ok: boolean; reason?: string }>('routes-save', patch);

// ── Usage ───────────────────────────────────────────────────────────────────

export interface UsageGroup {
  provider: string;
  role: string;
  model: string | null;
  calls: number;
  failures: number;
  characters: number | null;
  audioSeconds: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  costUsd: number | null;
  costBasis: string[] | null;
}

export const getVoiceUsage = (days: number) =>
  call<{ ok: boolean; days: number; groups: UsageGroup[]; note: string }>('usage', { days });

// ── Shared ──────────────────────────────────────────────────────────────────

/**
 * A playable URL for base64 audio the server rendered.
 *
 * A blob, not a data: URL — see previewVoice in services/communications.ts
 * for the failure that taught us the difference.
 */
export function audioUrlFromBase64(base64: string, mime: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

// ── The Georgian audition ───────────────────────────────────────────────────
//
// No test can tell whether Georgian sounds native. A transcript round-trip
// cannot: the provider's own transcriber reads an American saying Georgian
// words perfectly well, which is how a foreign accent passed every automated
// check and failed the first person who listened. So these call the provider
// for real, keep the audio, and put it in front of somebody who speaks the
// language.

export interface SharedVoice {
  voiceId: string;
  publicOwnerId: string;
  name: string;
  accent: string | null;
  language: string | null;
  /** What the PROVIDER says the speaker speaks, not what a model can render. */
  verifiedLanguages: Array<{ language: string; accent: string | null; locale: string | null }>;
  description: string | null;
  previewUrl: string | null;
  category: string | null;
  usageCount: number | null;
}

export const searchSharedVoices = (params: { language?: string; search?: string; limit?: number }) =>
  call<{ ok: boolean; voices?: SharedVoice[]; reason?: string; providerStatus?: number | null }>(
    'shared-voices', params,
  );

export const addSharedVoiceToAccount = (input: {
  publicOwnerId: string; voiceId: string; name: string;
}) => call<{ ok: boolean; voiceId?: string; reason?: string; detail?: string }>('add-shared-voice', input);

export interface AuditionCandidate {
  voiceId: string;
  name?: string;
  modelId: string;
  sendLanguage: boolean;
  settings?: Record<string, number | boolean> | null;
}

export const runAudition = (input: {
  language: string;
  sentences: Array<{ key: string; text: string }>;
  candidates: AuditionCandidate[];
}) => call<{ ok: boolean; batchId?: string; generated?: number; failed?: number; reason?: string }>(
  'audition', input,
);

export interface AuditionSample {
  id: string;
  batchId: string;
  voiceId: string;
  voiceName: string | null;
  modelId: string;
  language: string | null;
  sentLanguage: boolean;
  settings: Record<string, unknown>;
  sentenceKey: string;
  sentence: string;
  latencyMs: number | null;
  bytes: number | null;
  ok: boolean;
  errorCode: string | null;
  providerStatus: number | null;
  errorDetail: string | null;
  /** Signed and short-lived: the bucket is private and stays that way. */
  url: string | null;
}

export const getAuditionResults = (batchId?: string) =>
  call<{ ok: boolean; batches: string[]; samples: AuditionSample[] }>(
    'audition-results', { batchId, expiresIn: 21600 },
  );

export interface LanguageVoice {
  language: string;
  voice_id: string;
  voice_name: string | null;
  model_id: string | null;
  send_language: boolean;
  settings: Record<string, unknown>;
  notes: string | null;
  approved_at: string;
}

export const getLanguageVoices = () =>
  call<{
    ok: boolean;
    approved: LanguageVoice[];
    fallback: {
      voiceId: string; name: string;
      speakerLanguage: string | null; speakerAccent: string | null;
    } | null;
  }>('language-voices');

export const approveLanguageVoice = (input: {
  language: string; voiceId: string; modelId?: string | null;
  sendLanguage?: boolean; settings?: Record<string, unknown>;
  auditionSampleId?: string | null; notes?: string | null;
}) => call<{ ok: boolean; reason?: string }>('approve-language-voice', input);

export const revokeLanguageVoice = (language: string) =>
  call<{ ok: boolean; reason?: string }>('revoke-language-voice', { language });
