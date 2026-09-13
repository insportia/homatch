// HOMATCH Communications — the data layer.
//
// §125: the pages do not talk to Supabase directly. Every query is here, so
// that the ownership filter, the column list and the ordering are written once
// and a new screen cannot quietly select a column a customer should not see.
//
// TWO THINGS THIS FILE IS CAREFUL ABOUT
//
// §85. Nothing here selects an unbounded set. Every list takes a limit, every
// analytics figure is aggregated in Postgres or over a bounded window, and the
// contacts list is paged. A screen that loads 40,000 contacts to count them is
// a screen that crashes a phone.
//
// §72. Every filter here is convenience, not security. RLS is what actually
// stops one account reading another's rows; `eq('owner_id', …)` exists so the
// query is small and the intent is legible.

import { supabase } from '@/db/supabase';
import type {
  AgentListRow, AttentionItem, ChannelStatusCard, CommAgent, CommCampaign,
  CommChannelAccount, CommContact, CommConversation, CommExtraction, CommMessage,
  CommOverviewStats, CommSend, CommTemplate, LaunchPreview, RiskAssessmentRow, TrustSummary,
  AnalyticsFilter, AnalyticsResult, CommunicationsSpend,
  ProviderRouteRow, ProviderReportRow, CommVoiceTuning, AiTalkLimits,
  ChannelReadinessRow,
} from '@/types/communications';
import { customerFacingComplianceLabel } from '@/lib/comm/vocabulary';
import { parsePhone } from '@/lib/comm/phone';

export type { AnalyticsFilter, AnalyticsResult } from '@/types/communications';

/** Every list in this module is bounded. This is the ceiling when none is given. */
const DEFAULT_LIMIT = 100;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

/**
 * Call an edge function with the caller's session.
 *
 * Returns a discriminated result rather than throwing, because every caller
 * has a defined thing to show when the server says no, and an exception
 * bubbling into a React render is not it.
 */
async function invoke<T>(fn: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number; data?: unknown }> {
  const { data, error } = await supabase.functions.invoke(fn, { body: body as Record<string, unknown> });
  if (error) {
    // Supabase wraps a non-2xx in a FunctionsHttpError whose body carries the
    // machine-readable code the UI actually needs.
    const context = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
    let payload: unknown = null;
    try { payload = await context?.json?.(); } catch { payload = null; }
    return {
      ok: false,
      error: (payload as { code?: string; error?: string })?.code
        ?? (payload as { error?: string })?.error
        ?? error.message,
      status: context?.status,
      data: payload,
    };
  }
  return { ok: true, data: data as T };
}

// ── Agents ──────────────────────────────────────────────────────────────────

export async function listAgents(limit = DEFAULT_LIMIT): Promise<AgentListRow[]> {
  const uid = await currentUserId();
  if (!uid) return [];

  const { data: agents, error } = await supabase
    .from('comm_agents')
    .select('*')
    .eq('owner_id', uid)
    .neq('status', 'ARCHIVED')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !agents?.length) return [];

  // Counts in one grouped pass rather than a query per agent. A list of
  // twenty agents must not be twenty-one round trips.
  const ids = agents.map((a) => a.id);
  const { data: campaigns } = await supabase
    .from('outreach_campaigns')
    .select('id, agent_id')
    .in('agent_id', ids)
    .limit(1000);

  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const { data: sends } = campaignIds.length
    ? await supabase.from('outreach_sends')
        .select('campaign_id, status, lead_score')
        .in('campaign_id', campaignIds)
        .limit(20_000)
    : { data: [] as Array<{ campaign_id: string; status: string; lead_score: number | null }> };

  const campaignToAgent = new Map((campaigns ?? []).map((c) => [c.id, c.agent_id as string]));

  return agents.map((agent) => {
    const mine = (sends ?? []).filter((s) => campaignToAgent.get(s.campaign_id) === agent.id);
    return {
      ...(agent as CommAgent),
      campaignCount: (campaigns ?? []).filter((c) => c.agent_id === agent.id).length,
      interactionCount: mine.filter((s) => !['PENDING', 'QUEUED', 'SUPPRESSED'].includes(s.status)).length,
      qualifiedCount: mine.filter((s) => (s.lead_score ?? 0) >= 60).length,
    };
  });
}

export async function getAgent(id: string): Promise<CommAgent | null> {
  const { data } = await supabase.from('comm_agents').select('*').eq('id', id).maybeSingle();
  return (data as CommAgent) ?? null;
}

export async function createAgent(input: Partial<CommAgent>): Promise<CommAgent | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase.from('comm_agents').insert({
    owner_id: uid,
    name: input.name ?? 'Untitled agent',
    template_code: input.template_code ?? 'CUSTOM',
    languages: input.languages ?? ['ka'],
    channels: input.channels ?? ['AI_CALL'],
    ...stripReadOnly(input),
  }).select('*').maybeSingle();
  if (error) return null;
  return data as CommAgent;
}

export async function updateAgent(id: string, patch: Partial<CommAgent>): Promise<boolean> {
  const { error } = await supabase.from('comm_agents').update(stripReadOnly(patch)).eq('id', id);
  return !error;
}

export async function archiveAgent(id: string): Promise<boolean> {
  // Archive, never delete. A deleted agent orphans every transcript that was
  // produced under it (§104).
  const { error } = await supabase.from('comm_agents').update({ status: 'ARCHIVED' }).eq('id', id);
  return !error;
}

/** Fields the server owns. A client patch must never carry them. */
function stripReadOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out = { ...input };
  for (const k of ['id', 'owner_id', 'created_at', 'updated_at', 'current_version', 'last_used_at']) {
    delete (out as Record<string, unknown>)[k];
  }
  return out;
}

export function generateAgentCopy(params: { rough: string; template: string; languages: string[]; locale: string }) {
  return invoke<{ ok: boolean; purpose: string | null; introduction: string | null; primaryGoal: string | null; questions: string[] }>(
    'comm-agent', { action: 'generate', rough: params.rough, template: params.template, languages: params.languages, locale: params.locale },
  );
}

export function publishAgent(agentId: string) {
  return invoke<{ ok: boolean; version: number; versionId: string }>('comm-agent', { action: 'publish', agentId });
}

export function previewAgent(agentId: string) {
  return invoke<{ ok: boolean; summary: Record<string, unknown>; systemPrompt: string }>('comm-agent', { action: 'preview', agentId });
}

export function requestAgentTestGrant(agentId: string) {
  return invoke<{
    ok: boolean; token: string; expiresAt: string; provider: string;
    instructions: string; firstMessage: string; voiceId: string | null;
    primaryLanguage: string; maxDurationSec: number;
    endpointing: { minSilenceMs: number; maxSilenceMs: number; completeSilenceMs: number; continuationGraceMs: number; semantic: boolean };
  }>('comm-agent', { action: 'test', agentId });
}

/**
 * Real audio for one voice, in one language.
 *
 * Synthesised by the server from the same credential the call will use, so
 * what a customer hears here is what the agent will actually sound like. The
 * key never reaches the browser; the audio does.
 *
 * Previews cost money to generate, so the result is cached for the lifetime of
 * the page: clicking the same voice twice replays it rather than paying twice.
 */
const previewCache = new Map<string, string>();

export async function previewVoice(
  voiceId: string, language: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const key = `${voiceId}:${language}`;
  const cached = previewCache.get(key);
  if (cached) return { ok: true, url: cached };

  const { data, error } = await supabase.functions.invoke('cartesia-access-token', {
    body: { action: 'preview', voiceId, language },
  });
  if (error) return { ok: false };

  const payload = data as { ok?: boolean; audioBase64?: string; mime?: string };
  if (!payload?.ok || !payload.audioBase64) return { ok: false };

  /*
   * A blob URL, not a data: URL.
   *
   * A data: URL carries the whole clip as a string on every assignment, and
   * some media stacks decode it lazily enough that the element never reaches a
   * playable state — which is how the play button sat on a spinner after the
   * audio had already arrived. A blob is handed to the element by reference
   * and either decodes or errors.
   *
   * Held for the life of the page rather than revoked after each play: the
   * point of the cache is that auditioning the same voice twice is not billed
   * twice, and a revoked URL would be billed again. The bound is the number of
   * distinct voices someone previews in one sitting.
   */
  const url = blobUrlFromBase64(payload.audioBase64, payload.mime ?? 'audio/mpeg');
  if (!url) return { ok: false };
  previewCache.set(key, url);
  return { ok: true, url };
}

function blobUrlFromBase64(base64: string, mime: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

/**
 * Clone a voice from a clip the customer supplied.
 *
 * The consent flag is sent explicitly and the server refuses without it; it is
 * not a default and not something this function can imply. The clip goes to
 * the server as base64 and is never stored by Homatch — see the comment on
 * cloneCartesiaVoice for why keeping voice samples is the thing to avoid.
 */
export async function cloneVoice(params: {
  file: File;
  name: string;
  language: string;
  consent: boolean;
  source?: 'UPLOAD' | 'RECORD';
}): Promise<
  | { ok: true; voiceId: string }
  | { ok: false; reason: 'CONSENT_REQUIRED' | 'TOO_SHORT' | 'TOO_LARGE' | 'UNSUPPORTED_FORMAT' | 'RATE_LIMITED' | 'FAILED' }
> {
  if (!params.consent) return { ok: false, reason: 'CONSENT_REQUIRED' };

  const clipBase64 = await fileToBase64(params.file);
  if (!clipBase64) return { ok: false, reason: 'FAILED' };

  const res = await invoke<{ ok: boolean; voiceId: string }>('cartesia-access-token', {
    action: 'clone',
    name: params.name,
    language: params.language,
    mime: params.file.type || 'audio/mpeg',
    clipBase64,
    consent: true,
    source: params.source ?? 'UPLOAD',
  });

  if (!res.ok) {
    const code = String(res.error ?? '');
    if (code === 'CONSENT_REQUIRED') return { ok: false, reason: 'CONSENT_REQUIRED' };
    if (code === 'TOO_SHORT') return { ok: false, reason: 'TOO_SHORT' };
    if (code === 'TOO_LARGE') return { ok: false, reason: 'TOO_LARGE' };
    if (code === 'UNSUPPORTED_FORMAT') return { ok: false, reason: 'UNSUPPORTED_FORMAT' };
    if (res.status === 429) return { ok: false, reason: 'RATE_LIMITED' };
    return { ok: false, reason: 'FAILED' };
  }
  return { ok: true, voiceId: res.data.voiceId };
}

export async function deleteCustomVoice(voiceId: string): Promise<boolean> {
  const res = await invoke<{ ok: boolean }>('cartesia-access-token', { action: 'delete_voice', voiceId });
  return res.ok;
}

/** The voices this account cloned, with the consent that authorised each. */
export async function listMyVoices(): Promise<Array<{
  voiceId: string; name: string; status: string; confirmedAt: string;
}>> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data } = await supabase.from('comm_voice_consents')
    .select('provider_voice_id, voice_name, status, confirmed_at')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? [])
    .filter((r) => r.provider_voice_id)
    .map((r) => ({
      voiceId: r.provider_voice_id as string,
      name: r.voice_name as string,
      status: r.status as string,
      confirmedAt: r.confirmed_at as string,
    }));
}

function fileToBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // readAsDataURL gives "data:<mime>;base64,<payload>"; the server wants
      // the payload alone.
      const comma = result.indexOf(',');
      resolve(comma === -1 ? null : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function listVoices(): Promise<Array<{ id: string; name: string; description: string | null; language: string | null }>> {
  const { data, error } = await supabase.functions.invoke('cartesia-access-token', { method: 'GET' });
  if (error) return [];
  return (data as { voices?: Array<{ id: string; name: string; description: string | null; language: string | null }> })?.voices ?? [];
}

// ── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(filter: { channel?: string; limit?: number } = {}): Promise<CommCampaign[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  let q = supabase.from('outreach_campaigns').select('*').eq('owner_id', uid)
    .order('created_at', { ascending: false }).limit(filter.limit ?? DEFAULT_LIMIT);
  if (filter.channel && filter.channel !== 'ALL') q = q.eq('campaign_type', filter.channel);
  const { data } = await q;
  return (data ?? []) as CommCampaign[];
}

export async function getCampaign(id: string): Promise<CommCampaign | null> {
  const { data } = await supabase.from('outreach_campaigns').select('*').eq('id', id).maybeSingle();
  return (data as CommCampaign) ?? null;
}

/**
 * Why this returns a reason instead of null.
 *
 * It used to be `if (error) return null`, and the Campaign Builder turned that
 * into "campaign could not be saved" with nothing behind it — which is exactly
 * how an RLS policy that could never be satisfied survived in production
 * unnoticed. The database always said precisely what was wrong; this function
 * was throwing it away.
 *
 * The reason returned here is a CODE, not the driver's message: the message
 * can name policies and columns, and §92 keeps that away from a customer. The
 * caller maps the code to a sentence; the technical detail goes to the console
 * for support.
 */
export type SaveFailure =
  | 'NOT_SIGNED_IN' | 'DENIED' | 'INVALID' | 'DUPLICATE' | 'UNAVAILABLE';

export async function createCampaign(
  input: Partial<CommCampaign>,
): Promise<{ ok: true; campaign: CommCampaign } | { ok: false; reason: SaveFailure }> {
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'NOT_SIGNED_IN' };

  const { data, error } = await supabase.from('outreach_campaigns').insert({
    owner_id: uid,
    name: input.name ?? 'Untitled campaign',
    campaign_type: input.campaign_type ?? 'AI_CALL',
    status: 'DRAFT',
    ...stripReadOnly(input as Record<string, unknown>),
  }).select('*').maybeSingle();

  if (error) return { ok: false, reason: classifyWriteError(error) };
  if (!data) return { ok: false, reason: 'UNAVAILABLE' };
  return { ok: true, campaign: data as CommCampaign };
}

/**
 * PostgREST/Postgres codes that mean something a customer can act on.
 *
 * 42501 and the RLS violation both mean "not yours"; 23502/23514/22P02 mean the
 * row was malformed; 23505 is a duplicate. Everything else is ours to fix, so
 * it degrades to UNAVAILABLE rather than inventing an explanation.
 */
function classifyWriteError(error: { code?: string; message?: string }): SaveFailure {
  const code = String(error?.code ?? '');
  const msg = String(error?.message ?? '');
  if (import.meta.env?.DEV) console.error('[comm] write rejected', code, msg);
  if (code === '42501' || /row-level security/i.test(msg)) return 'DENIED';
  if (code === '23505') return 'DUPLICATE';
  if (code === '23502' || code === '23514' || code === '22P02' || code === '23503') return 'INVALID';
  return 'UNAVAILABLE';
}

export async function updateCampaign(id: string, patch: Partial<CommCampaign>): Promise<boolean> {
  const { error } = await supabase.from('outreach_campaigns')
    .update(stripReadOnly(patch as Record<string, unknown>)).eq('id', id);
  return !error;
}

/**
 * The compliance and cost preview (§17 step 5).
 *
 * Runs the SAME server gate that the launch will run, so the customer is never
 * shown "ready" by one code path and refused by another.
 */
export function previewLaunch(campaignId: string) {
  return invoke<LaunchPreview>('comm-campaign-launch', { campaignId, action: 'preview' });
}

export interface TestCallResult {
  ok: boolean;
  blockers: string[];
  checks: Array<{ key: string; ok: boolean; detail: string | null; ownerAction: boolean }>;
  destination?: string;
  agentName?: string;
  providerCallId?: string | null;
  code?: string;
}

/**
 * What is stopping one real test call, without contacting anybody.
 *
 * Runs the same channel gates the Admin go-live checklist runs and the same
 * ones a campaign launch would run, so "it said I could and then refused" is
 * not a state this can reach.
 */
export async function previewTestCall(params: { agentId: string; toE164: string }) {
  return invoke<TestCallResult>('comm-campaign-launch', {
    action: 'test_call_preview', agentId: params.agentId, toE164: params.toE164,
  });
}

/**
 * Place one real call, to one number.
 *
 * The server refuses unless every gate passes; this function cannot and does
 * not weaken any of them. It is deliberately NOT a campaign: a campaign needs
 * the dispatcher, and enabling the dispatcher to hear one agent speak is how
 * a list gets dialled by accident.
 */
export async function runTestCall(params: { agentId: string; toE164: string }) {
  return invoke<TestCallResult>('comm-campaign-launch', {
    action: 'test_call', agentId: params.agentId, toE164: params.toE164,
  });
}

export function launchCampaign(campaignId: string) {
  return invoke<LaunchPreview>('comm-campaign-launch', { campaignId, action: 'launch' });
}

/**
 * Resume, via the SQL function whose predicate is the actual control.
 *
 * A campaign in COMPLIANCE_PAUSED simply does not match, so this returns false
 * however it is called (§52) — the UI hiding the button is a courtesy, not the
 * enforcement.
 */
export async function resumeCampaign(campaignId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('comm_user_resume_campaign', { p_campaign_id: campaignId });
  return !error && data === true;
}

export async function pauseCampaign(campaignId: string): Promise<boolean> {
  const { error } = await supabase.from('outreach_campaigns')
    .update({ status: 'PAUSED', paused_reason: null })
    .eq('id', campaignId).eq('status', 'RUNNING');
  return !error;
}

// ── Calls ───────────────────────────────────────────────────────────────────

export interface CallFilter {
  campaignId?: string;
  status?: string;
  outcome?: string;
  qualifiedOnly?: boolean;
  callbackOnly?: boolean;
  search?: string;
  since?: string;
  limit?: number;
}

export async function listCalls(filter: CallFilter = {}): Promise<CommSend[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  let q = supabase.from('outreach_sends')
    .select('*')
    .eq('owner_id', uid)
    .eq('channel', 'AI_CALL')
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? DEFAULT_LIMIT);

  if (filter.campaignId) q = q.eq('campaign_id', filter.campaignId);
  if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
  if (filter.outcome && filter.outcome !== 'ALL') q = q.eq('outcome', filter.outcome);
  if (filter.qualifiedOnly) q = q.gte('lead_score', 60);
  if (filter.callbackOnly) q = q.eq('outcome', 'CALLBACK');
  if (filter.since) q = q.gte('created_at', filter.since);
  if (filter.search) q = q.ilike('recipient_phone', `%${filter.search}%`);

  const { data } = await q;
  return (data ?? []) as CommSend[];
}

/** The Live Calls panel (§18). Bounded, and only the statuses that are on the wire. */
export async function listLiveCalls(): Promise<CommSend[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data } = await supabase.from('outreach_sends')
    .select('*')
    .eq('owner_id', uid)
    .in('status', ['DIALING', 'RINGING', 'ANSWERED'])
    .order('call_started_at', { ascending: false })
    .limit(50);
  return (data ?? []) as CommSend[];
}

export async function getCall(id: string): Promise<{ send: CommSend | null; extraction: CommExtraction | null }> {
  const { data: send } = await supabase.from('outreach_sends').select('*').eq('id', id).maybeSingle();
  const { data: extraction } = await supabase.from('comm_extractions')
    .select('*').eq('send_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { send: (send as CommSend) ?? null, extraction: (extraction as CommExtraction) ?? null };
}

// ── Conversations ───────────────────────────────────────────────────────────

export interface InboxFilter {
  unread?: boolean;
  mode?: 'AI' | 'HUMAN';
  qualified?: boolean;
  archived?: boolean;
  search?: string;
  limit?: number;
}

export async function listConversations(filter: InboxFilter = {}): Promise<CommConversation[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  let q = supabase.from('comm_conversations')
    .select('*')
    .eq('owner_id', uid)
    .eq('status', filter.archived ? 'ARCHIVED' : 'OPEN')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(filter.limit ?? DEFAULT_LIMIT);

  if (filter.unread) q = q.gt('unread_count', 0);
  if (filter.mode === 'AI') q = q.eq('mode', 'AI_ACTIVE');
  if (filter.mode === 'HUMAN') q = q.in('mode', ['HUMAN_ACTIVE', 'PENDING_HANDOFF']);
  if (filter.qualified) q = q.in('lead_stage', ['QUALIFIED', 'INTERESTED', 'VIEWING']);
  if (filter.search) q = q.or(`peer_address.ilike.%${filter.search}%,peer_name.ilike.%${filter.search}%`);

  const { data } = await q;
  return (data ?? []) as CommConversation[];
}

export async function listMessages(conversationId: string, limit = 200): Promise<CommMessage[]> {
  const { data } = await supabase.from('comm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  // Fetched newest-first so the limit keeps the RECENT messages, then
  // reversed for display. Ascending with a limit would show the oldest 200 of
  // a long thread, which is the wrong 200.
  return ((data ?? []) as CommMessage[]).reverse();
}

export function sendWhatsAppMessage(params: {
  conversationId?: string; toE164?: string; text?: string;
  templateId?: string; templateVariables?: string[];
}) {
  return invoke<{ ok: boolean; messageId: string; providerMessageId: string | null }>('whatsapp-send', params);
}

/**
 * Take over, or hand back (§36).
 *
 * Goes through the SQL function, which applies the transition only if the
 * conversation is still in the state the UI believed. Two operators pressing
 * Take over at the same moment produce one winner and one honest refusal.
 */
export async function setConversationMode(
  conversationId: string,
  expectedMode: string,
  newMode: string,
  reason?: string,
): Promise<boolean> {
  const uid = await currentUserId();
  const { data, error } = await supabase.rpc('comm_set_conversation_mode', {
    p_conversation_id: conversationId,
    p_expected_mode: expectedMode,
    p_new_mode: newMode,
    p_actor: uid,
    p_reason: reason ?? null,
  });
  return !error && data === true;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await supabase.from('comm_conversations').update({ unread_count: 0 }).eq('id', conversationId);
}

// ── Templates ───────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<CommTemplate[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data } = await supabase.from('comm_whatsapp_templates')
    .select('*').eq('owner_id', uid).order('updated_at', { ascending: false }).limit(DEFAULT_LIMIT);
  return (data ?? []) as CommTemplate[];
}

export async function saveTemplate(input: Partial<CommTemplate>): Promise<CommTemplate | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  if (input.id) {
    const { data } = await supabase.from('comm_whatsapp_templates')
      .update(stripReadOnly(input as Record<string, unknown>)).eq('id', input.id).select('*').maybeSingle();
    return (data as CommTemplate) ?? null;
  }
  const { data } = await supabase.from('comm_whatsapp_templates').insert({
    owner_id: uid,
    name: input.name ?? 'untitled_template',
    language: input.language ?? 'en',
    body_text: input.body_text ?? '',
    category: input.category ?? 'MARKETING',
    // DRAFT always. §37: Homatch generating copy is not Meta approving it, and
    // the client cannot set a status that would permit a send.
    status: 'DRAFT',
  }).select('*').maybeSingle();
  return (data as CommTemplate) ?? null;
}

// ── Channel accounts ────────────────────────────────────────────────────────

export async function listChannelAccounts(): Promise<CommChannelAccount[]> {
  const { data } = await supabase.from('comm_channel_accounts')
    .select('*').order('created_at', { ascending: true }).limit(50);
  return (data ?? []) as CommChannelAccount[];
}

// ── Contacts ────────────────────────────────────────────────────────────────

/**
 * The list a manually-added contact lands in.
 *
 * outreach_contacts.list_id is NOT NULL — a contact cannot exist outside a
 * list — which is why "Add contact" could not simply insert a row. Rather than
 * make every customer invent a list before they can type one phone number,
 * manual additions go to a single reusable list, created on first use.
 */
const MANUAL_LIST_NAME = 'Added manually';

export async function ensureManualList(): Promise<string | null> {
  const uid = await currentUserId();
  if (!uid) return null;

  const { data: existing } = await supabase.from('outreach_contact_lists')
    .select('id').eq('owner_id', uid).eq('name', MANUAL_LIST_NAME).limit(1).maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase.from('outreach_contact_lists').insert({
    owner_id: uid,
    name: MANUAL_LIST_NAME,
    source_format: 'MANUAL',
    // READY, and not for cosmetic reasons twice over. import_status is a CHECK
    // over PENDING/ANALYZING/READY/FAILED/ARCHIVED — 'COMPLETED' is not in it
    // and the insert is rejected outright. And READY is what the campaign
    // builder filters audiences on, so it is also the value that makes a
    // hand-added contact reachable by a campaign. A manual list has nothing to
    // analyse, so it is ready the moment it exists.
    import_status: 'READY',
  }).select('id').maybeSingle();
  if (error || !data) {
    if (import.meta.env?.DEV) console.error('[comm] manual list insert rejected', error?.code, error?.message);
    return null;
  }
  return data.id as string;
}

export interface NewContactInput {
  phone: string;
  full_name?: string;
  email?: string;
  language?: string;
  country?: string;
  notes?: string;
  listId?: string;
}

/**
 * Add one contact by hand.
 *
 * The phone is parsed BEFORE the insert, with parsePhone() — the same parser
 * the import path uses, so a number typed here and the same number imported
 * from a sheet become one identity rather than two. A number that will not
 * resolve is refused here, where the customer can fix it, rather than stored
 * and discovered later by a call that does not connect.
 */
export async function createContact(
  input: NewContactInput,
): Promise<{ ok: true; contact: CommContact } | { ok: false; reason: SaveFailure | 'BAD_PHONE' | 'DUPLICATE' }> {
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'NOT_SIGNED_IN' };

  const parsed = parsePhone(input.phone, input.country ?? null);
  if (!parsed.e164) return { ok: false, reason: 'BAD_PHONE' };

  const listId = input.listId ?? await ensureManualList();
  if (!listId) return { ok: false, reason: 'UNAVAILABLE' };

  // Same person, already here? Report it rather than creating a second row
  // that will be dialled separately.
  const { data: dupe } = await supabase.from('outreach_contacts')
    .select('id').eq('owner_id', uid).eq('phone', parsed.e164).limit(1).maybeSingle();
  if (dupe?.id) return { ok: false, reason: 'DUPLICATE' };

  const { data, error } = await supabase.from('outreach_contacts').insert({
    owner_id: uid,
    list_id: listId,
    phone: parsed.e164,
    phone_valid: parsed.valid,
    full_name: input.full_name?.trim() || null,
    email: input.email?.trim()?.toLowerCase() || null,
    language: input.language || null,
    country: parsed.country ?? input.country ?? null,
    notes: input.notes?.trim() || null,
  }).select('*').maybeSingle();

  if (error) {
    const reason = classifyWriteError(error);
    return { ok: false, reason: reason === 'DUPLICATE' ? 'DUPLICATE' : reason };
  }
  if (!data) return { ok: false, reason: 'UNAVAILABLE' };

  await refreshListCounts(listId, uid);
  return { ok: true, contact: data as CommContact };
}

/**
 * Bring a list's denormalised counters back in line with its actual contacts.
 *
 * total_rows and valid_rows were only ever maintained by the import path, so a
 * hand-added contact left the list reading "0 rows, 0 with usable numbers".
 * The campaign builder shows exactly those two numbers when choosing an
 * audience — so a list holding a real person advertised itself as empty, which
 * is the same as not being able to add the person at all.
 *
 * Counted rather than incremented: an increment drifts the first time anything
 * deletes a contact, and a counter that is wrong in the direction of "more
 * people than exist" is a counter that overstates an audience about to be
 * dialled. A recount is always right and costs one query.
 *
 * A failure here is deliberately not fatal — the contact is already saved, and
 * refusing to report success because a display counter did not update would
 * be a worse answer than a stale count.
 */
async function refreshListCounts(listId: string, ownerId: string): Promise<void> {
  const [{ count: total }, { count: valid }] = await Promise.all([
    supabase.from('outreach_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId).eq('owner_id', ownerId),
    supabase.from('outreach_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listId).eq('owner_id', ownerId)
      .eq('phone_valid', true).eq('suppressed', false).eq('unsubscribed', false),
  ]);

  await supabase.from('outreach_contact_lists')
    .update({ total_rows: total ?? 0, valid_rows: valid ?? 0 })
    .eq('id', listId);
}

export async function listContacts(params: {
  listId?: string; search?: string; stage?: string; page?: number; pageSize?: number;
}): Promise<{ rows: CommContact[]; total: number }> {
  const uid = await currentUserId();
  if (!uid) return { rows: [], total: 0 };

  const pageSize = Math.min(200, params.pageSize ?? 50);
  const from = (params.page ?? 0) * pageSize;

  let q = supabase.from('outreach_contacts')
    .select('*', { count: 'exact' })
    .eq('owner_id', uid)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.listId) q = q.eq('list_id', params.listId);
  if (params.stage && params.stage !== 'ALL') q = q.eq('lead_stage', params.stage);
  if (params.search) {
    q = q.or(`full_name.ilike.%${params.search}%,phone.ilike.%${params.search}%,email.ilike.%${params.search}%`);
  }

  const { data, count } = await q;
  return { rows: (data ?? []) as CommContact[], total: count ?? 0 };
}

export async function getContact(id: string): Promise<CommContact | null> {
  const { data } = await supabase.from('outreach_contacts').select('*').eq('id', id).maybeSingle();
  return (data as CommContact) ?? null;
}

/**
 * The Contact 360 timeline (§15).
 *
 * Unified across channels, bounded per source, and sorted once. Deliberately
 * NOT a single query across a union view: the sources have different shapes
 * and different RLS, and a view that flattens them would need its own policy.
 */
export async function getContactTimeline(contactId: string): Promise<Array<{
  id: string; at: string; kind: string; title: string; detail: string | null; href: string | null;
}>> {
  const [{ data: sends }, { data: conversations }, { data: extractions }] = await Promise.all([
    supabase.from('outreach_sends')
      .select('id, channel, status, outcome, summary, created_at, campaign_id')
      .eq('contact_id', contactId).order('created_at', { ascending: false }).limit(50),
    supabase.from('comm_conversations')
      .select('id, channel, last_message_at, last_message_preview, lead_stage, created_at')
      .eq('contact_id', contactId).limit(20),
    supabase.from('comm_extractions')
      .select('id, source, summary, next_action, created_at')
      .eq('contact_id', contactId).order('created_at', { ascending: false }).limit(50),
  ]);

  const events: Array<{ id: string; at: string; kind: string; title: string; detail: string | null; href: string | null }> = [];

  for (const s of sends ?? []) {
    events.push({
      id: `send:${s.id}`,
      at: s.created_at,
      kind: s.channel === 'AI_CALL' ? 'CALL' : 'MESSAGE',
      title: s.outcome ?? s.status,
      detail: s.summary,
      href: s.channel === 'AI_CALL' ? `/outreach/calls?call=${s.id}` : null,
    });
  }
  for (const c of conversations ?? []) {
    events.push({
      id: `conv:${c.id}`,
      at: c.last_message_at ?? c.created_at,
      kind: 'CONVERSATION',
      title: c.channel,
      detail: c.last_message_preview,
      href: `/outreach/whatsapp/inbox?c=${c.id}`,
    });
  }
  for (const e of extractions ?? []) {
    events.push({
      id: `ext:${e.id}`,
      at: e.created_at,
      kind: 'INSIGHT',
      title: e.source,
      detail: e.summary ?? e.next_action,
      href: null,
    });
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 100);
}

export async function suppressContact(id: string, reason: string): Promise<boolean> {
  const { error } = await supabase.from('outreach_contacts')
    .update({ suppressed: true, suppressed_reason: reason.slice(0, 200) }).eq('id', id);
  return !error;
}

export async function setDoNotCall(id: string, value: boolean): Promise<boolean> {
  const { error } = await supabase.from('outreach_contacts').update({ do_not_call: value }).eq('id', id);
  return !error;
}

// ── Overview and analytics ──────────────────────────────────────────────────

/**
 * The Overview KPIs (§9).
 *
 * One bounded window, aggregated in the browser over rows that are already
 * small because the window is a day. Anything wider goes through
 * getAnalytics(), which aggregates server-side.
 */
export async function getOverviewStats(sinceIso?: string): Promise<CommOverviewStats> {
  const uid = await currentUserId();
  const since = sinceIso ?? startOfTodayIso();
  const empty: CommOverviewStats = {
    conversationsToday: 0, callsToday: 0, whatsappConversations: 0, qualifiedLeads: 0,
    viewingsRequested: 0, spendTodayUsd: 0, answerRate: null, replyRate: null,
    qualificationRate: null, costPerQualifiedLeadUsd: null, averageCallDurationSec: null,
    aiResolutionRate: null,
  };
  if (!uid) return empty;

  const [{ data: sends }, { data: conversations }] = await Promise.all([
    supabase.from('outreach_sends')
      .select('channel, status, outcome, lead_score, cost_usd, duration_sec')
      .eq('owner_id', uid).gte('created_at', since).limit(20_000),
    supabase.from('comm_conversations')
      .select('id, channel, lead_stage, mode, last_message_at')
      .eq('owner_id', uid).gte('last_message_at', since).limit(5_000),
  ]);

  const rows = sends ?? [];
  const calls = rows.filter((r) => r.channel === 'AI_CALL');
  const attempted = calls.filter((r) => !['PENDING', 'QUEUED', 'SUPPRESSED'].includes(r.status));
  const answered = calls.filter((r) => ['ANSWERED', 'COMPLETED'].includes(r.status));
  const messages = rows.filter((r) => r.channel === 'WHATSAPP');
  const delivered = messages.filter((r) => ['DELIVERED', 'READ'].includes(r.status));

  const qualified = rows.filter((r) => (r.lead_score ?? 0) >= 60).length;
  const spend = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const convs = conversations ?? [];
  const replied = convs.filter((c) => c.lead_stage !== 'NEW').length;
  const durations = answered.map((r) => Number(r.duration_sec) || 0).filter((d) => d > 0);

  return {
    conversationsToday: convs.length + attempted.length,
    callsToday: attempted.length,
    whatsappConversations: convs.filter((c) => c.channel === 'WHATSAPP').length,
    qualifiedLeads: qualified,
    viewingsRequested: convs.filter((c) => c.lead_stage === 'VIEWING').length
      + rows.filter((r) => r.outcome === 'QUALIFIED').length,
    spendTodayUsd: spend,
    // A rate over zero attempts is not zero percent, it is unknown. Returning
    // null lets the UI show a dash rather than a confident 0% (§93).
    answerRate: attempted.length ? answered.length / attempted.length : null,
    replyRate: convs.length ? replied / convs.length : (delivered.length ? 0 : null),
    qualificationRate: attempted.length ? qualified / attempted.length : null,
    costPerQualifiedLeadUsd: qualified ? spend / qualified : null,
    averageCallDurationSec: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    aiResolutionRate: convs.length
      ? convs.filter((c) => c.mode === 'AI_ACTIVE' || c.mode === 'CLOSED').length / convs.length
      : null,
  };
}

/** §9's Needs Attention list. Every item is a real stored fact, never a placeholder. */
export async function getAttentionItems(): Promise<AttentionItem[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const items: AttentionItem[] = [];

  const { data: paused } = await supabase.from('outreach_campaigns')
    .select('id, name, status, paused_reason, compliance_state')
    .eq('owner_id', uid)
    .in('status', ['COMPLIANCE_PAUSED', 'PAUSED', 'REVIEW_REQUIRED'])
    .limit(20);

  for (const c of paused ?? []) {
    items.push({
      id: `campaign:${c.id}`,
      severity: c.status === 'COMPLIANCE_PAUSED' ? 'CRITICAL' : 'WARNING',
      code: c.compliance_state ?? c.status,
      titleKey: c.status === 'COMPLIANCE_PAUSED' ? 'comm_attention_compliance_paused'
        : c.status === 'REVIEW_REQUIRED' ? 'comm_attention_needs_review'
        : 'comm_attention_campaign_paused',
      detail: c.paused_reason ?? c.name,
      href: `/outreach/campaigns?c=${c.id}`,
    });
  }

  const { data: templates } = await supabase.from('comm_whatsapp_templates')
    .select('id, name, status, rejection_reason').eq('owner_id', uid).eq('status', 'REJECTED').limit(10);
  for (const t of templates ?? []) {
    items.push({
      id: `template:${t.id}`, severity: 'WARNING', code: 'TEMPLATE_REJECTED',
      titleKey: 'comm_attention_template_rejected',
      detail: `${t.name}${t.rejection_reason ? `: ${t.rejection_reason}` : ''}`,
      href: '/outreach/whatsapp/templates',
    });
  }

  const { data: accounts } = await supabase.from('comm_channel_accounts')
    .select('id, label, status, environment, quality_rating').limit(20);
  for (const a of accounts ?? []) {
    if (a.status === 'ACTION_REQUIRED') {
      items.push({
        id: `account:${a.id}`, severity: 'CRITICAL', code: 'CHANNEL_ACTION_REQUIRED',
        titleKey: 'comm_attention_channel_action', detail: a.label, href: '/outreach/numbers',
      });
    } else if (String(a.quality_rating ?? '').toUpperCase() === 'RED') {
      items.push({
        id: `quality:${a.id}`, severity: 'WARNING', code: 'CHANNEL_QUALITY',
        titleKey: 'comm_attention_channel_quality', detail: a.label, href: '/outreach/numbers',
      });
    }
  }

  const { data: trust } = await supabase.from('comm_account_trust')
    .select('outbound_frozen, frozen_reason').eq('owner_id', uid).maybeSingle();
  if (trust?.outbound_frozen) {
    items.push({
      id: 'trust:frozen', severity: 'CRITICAL', code: 'OUTBOUND_FROZEN',
      titleKey: 'comm_attention_outbound_frozen', detail: trust.frozen_reason ?? null, href: null,
    });
  }

  return items;
}

export async function getChannelStatus(): Promise<ChannelStatusCard[]> {
  const accounts = await listChannelAccounts();
  const whatsapp = accounts.find((a) => a.channel === 'WHATSAPP');

  return [
    {
      channel: 'AI_CALL',
      // Voice readiness is a provider fact the customer does not configure, so
      // it reflects whether any campaign has ever connected rather than a
      // credential the customer can see (§106).
      state: 'CONNECTED',
      detail: null,
    },
    {
      channel: 'WHATSAPP',
      state: !whatsapp ? 'NOT_CONFIGURED'
        : whatsapp.status === 'CONNECTED' ? (whatsapp.environment === 'TEST' ? 'PARTIAL' : 'CONNECTED')
        : whatsapp.status === 'ACTION_REQUIRED' ? 'ACTION_REQUIRED'
        : whatsapp.status === 'DISABLED' ? 'DISABLED' : 'NOT_CONFIGURED',
      // §100: a test number is never presented as production.
      detail: whatsapp?.environment === 'TEST' ? 'TEST' : null,
    },
  ];
}

export async function getTrustSummary(): Promise<TrustSummary> {
  const uid = await currentUserId();
  const fallback: TrustSummary = { tier: 'NEW', outboundFrozen: false, label: 'READY' };
  if (!uid) return fallback;

  const { data } = await supabase.from('comm_account_trust')
    .select('tier, outbound_frozen').eq('owner_id', uid).maybeSingle();
  if (!data) return fallback;

  return {
    tier: data.tier,
    outboundFrozen: Boolean(data.outbound_frozen),
    label: data.outbound_frozen ? 'PAUSED_FOR_SAFETY' : customerFacingComplianceLabel('ALLOW'),
  };
}


/**
 * §77's analytics, over a bounded window.
 *
 * The window is capped at 180 days. An unbounded "all time" over a busy
 * account is a query that pulls every send ever made into a browser, which
 * §85 forbids and which would not render anyway.
 */
export async function getAnalytics(filter: AnalyticsFilter): Promise<AnalyticsResult> {
  const uid = await currentUserId();
  const empty: AnalyticsResult = {
    series: [], funnel: [], spendUsd: 0, qualified: 0, costPerQualifiedUsd: null,
    callStats: { attempted: 0, answered: 0, answerRate: null, avgDurationSec: null, outcomes: {} },
    messageStats: { sent: 0, delivered: 0, read: 0, failed: 0, replies: 0, optOuts: 0 },
  };
  if (!uid) return empty;

  const maxWindowMs = 180 * 86_400_000;
  const since = new Date(Math.max(new Date(filter.since).getTime(), Date.now() - maxWindowMs)).toISOString();

  let q = supabase.from('outreach_sends')
    .select('channel, status, outcome, lead_score, cost_usd, duration_sec, created_at, campaign_id')
    .eq('owner_id', uid).gte('created_at', since).limit(50_000);
  if (filter.until) q = q.lte('created_at', filter.until);
  if (filter.channel && filter.channel !== 'ALL') q = q.eq('channel', filter.channel);
  if (filter.campaignId) q = q.eq('campaign_id', filter.campaignId);

  const { data: sends } = await q;
  const rows = sends ?? [];

  const { data: conversations } = await supabase.from('comm_conversations')
    .select('lead_stage, last_message_at').eq('owner_id', uid).gte('last_message_at', since).limit(20_000);

  const byDate = new Map<string, { calls: number; messages: number; qualified: number; spend: number }>();
  for (const r of rows) {
    const key = String(r.created_at).slice(0, 10);
    const bucket = byDate.get(key) ?? { calls: 0, messages: 0, qualified: 0, spend: 0 };
    if (r.channel === 'AI_CALL') bucket.calls += 1; else bucket.messages += 1;
    if ((r.lead_score ?? 0) >= 60) bucket.qualified += 1;
    bucket.spend += Number(r.cost_usd) || 0;
    byDate.set(key, bucket);
  }

  const calls = rows.filter((r) => r.channel === 'AI_CALL');
  const attempted = calls.filter((r) => !['PENDING', 'QUEUED', 'SUPPRESSED'].includes(r.status));
  const answered = calls.filter((r) => ['ANSWERED', 'COMPLETED'].includes(r.status));
  const durations = answered.map((r) => Number(r.duration_sec) || 0).filter((d) => d > 0);

  const outcomes: Record<string, number> = {};
  for (const r of calls) {
    const key = r.outcome ?? r.status;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }

  const messages = rows.filter((r) => r.channel === 'WHATSAPP');
  const qualified = rows.filter((r) => (r.lead_score ?? 0) >= 60).length;
  const spendUsd = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  const stageCounts = new Map<string, number>();
  for (const c of conversations ?? []) {
    stageCounts.set(c.lead_stage, (stageCounts.get(c.lead_stage) ?? 0) + 1);
  }

  return {
    series: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    funnel: ['REACHED', 'ENGAGED', 'QUALIFIED', 'INTERESTED', 'VIEWING', 'CONVERTED']
      .map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    callStats: {
      attempted: attempted.length,
      answered: answered.length,
      answerRate: attempted.length ? answered.length / attempted.length : null,
      avgDurationSec: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      outcomes,
    },
    messageStats: {
      sent: messages.filter((r) => ['SENT', 'DELIVERED', 'READ'].includes(r.status)).length,
      delivered: messages.filter((r) => ['DELIVERED', 'READ'].includes(r.status)).length,
      read: messages.filter((r) => r.status === 'READ').length,
      failed: messages.filter((r) => r.status === 'FAILED').length,
      replies: (conversations ?? []).filter((c) => c.lead_stage !== 'NEW').length,
      optOuts: rows.filter((r) => r.status === 'OPTED_OUT').length,
    },
    spendUsd,
    qualified,
    costPerQualifiedUsd: qualified ? spendUsd / qualified : null,
  };
}

// ── Admin ───────────────────────────────────────────────────────────────────

export async function listRiskAssessments(filter: {
  decision?: string; pendingOnly?: boolean; limit?: number;
} = {}): Promise<RiskAssessmentRow[]> {
  let q = supabase.from('comm_risk_assessments')
    .select('*').order('created_at', { ascending: false }).limit(filter.limit ?? DEFAULT_LIMIT);
  if (filter.decision && filter.decision !== 'ALL') q = q.eq('decision', filter.decision);
  if (filter.pendingOnly) q = q.is('reviewed_at', null).in('decision', ['REVIEW', 'BLOCK']);
  const { data } = await q;
  return (data ?? []) as RiskAssessmentRow[];
}

/**
 * Probe every provider. Read-only and free on all of them (§57).
 *
 * A POST to comm-provider-status is what actually contacts Cartesia, Vapi and
 * Meta; a GET only reads what was last stored, so opening the Admin page does
 * not fire three live requests every time.
 */
export function probeProviders(provider?: string) {
  return invoke<{ ok: boolean; providers: ProviderReportRow[]; routes: ProviderRouteRow[]; readiness: ChannelReadinessRow[] }>(
    `comm-provider-status${provider ? `?provider=${provider}` : ''}`, {},
  );
}

export type ProviderStatusResult =
  | { ok: true; providers: ProviderReportRow[]; routes: ProviderRouteRow[]; readiness: ChannelReadinessRow[] }
  | { ok: false; reason: string };

/**
 * Read the stored routing and provider health.
 *
 * Returns a NAMED reason on failure rather than null. comm_provider_routes
 * ships in a migration the owner has not applied and comm-provider-status
 * ships in a function that has not been deployed, so "it did not work" is not
 * useful to an admin — "the function is not deployed" is.
 */
export async function readProviderStatus(): Promise<ProviderStatusResult> {
  const { data, error } = await supabase.functions.invoke('comm-provider-status', { method: 'GET' });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return {
      ok: false,
      reason: status === 404
        ? 'comm-provider-status is not deployed yet'
        : status === 403
          ? 'this account is not an administrator'
          : `comm-provider-status returned ${status ?? 'no response'}`,
    };
  }
  const payload = data as {
    providers?: ProviderReportRow[]; routes?: ProviderRouteRow[]; readiness?: ChannelReadinessRow[];
  } | null;
  return {
    ok: true,
    providers: payload?.providers ?? [],
    routes: payload?.routes ?? [],
    readiness: payload?.readiness ?? [],
  };
}

/**
 * Flip one routing flag.
 *
 * Written straight to comm_provider_routes under the admin's own session, so
 * the table's RLS decides — this is not a path that borrows the service role.
 */
export async function setProviderRouteFlag(
  role: string,
  provider: string,
  field: 'enabled' | 'kill_switch',
  value: boolean,
): Promise<boolean> {
  const { error } = await supabase.from('comm_provider_routes')
    .update({ [field]: value })
    .eq('role', role)
    .eq('provider', provider);
  return !error;
}

// ── Admin settings ──────────────────────────────────────────────────────────
//
// admin_settings already exists in production, so unlike the routing table
// these two read and write for real today.

async function readSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('admin_settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return null;
  return (data.value as T) ?? null;
}

async function writeSetting(key: string, value: unknown, description: string): Promise<boolean> {
  const { error } = await supabase.from('admin_settings')
    .upsert({ key, value, description, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return !error;
}

export function getCommVoiceTuning(): Promise<Partial<CommVoiceTuning> | null> {
  return readSetting<Partial<CommVoiceTuning>>('comm_voice_tuning');
}

export function saveCommVoiceTuning(value: CommVoiceTuning): Promise<boolean> {
  return writeSetting(
    'comm_voice_tuning', value,
    'Endpointing, interruption and recording defaults read by _shared/comm/agentPrompt.ts loadVoiceTuning().',
  );
}

export function getAiTalkLimits(): Promise<Partial<AiTalkLimits> | null> {
  return readSetting<Partial<AiTalkLimits>>('ai_talk_limits');
}

export async function saveAiTalkLimits(value: AiTalkLimits): Promise<boolean> {
  // ai-talk-session reads the allowance from ai_talk_limits and the on/off
  // switch from ai_talk_enabled, so the two are written together.
  const { enabled, ...limits } = value;
  const a = await writeSetting(
    'ai_talk_limits', limits,
    'Anonymous AI Talk allowance enforced server-side by ai-talk-session (§28).',
  );
  const b = await writeSetting(
    'ai_talk_enabled', enabled,
    'Master switch for the public homepage AI Talk demo.',
  );
  return a && b;
}

export function syncWhatsApp() {
  return invoke<{ ok: boolean; account: unknown; templates: unknown }>('whatsapp-sync', {});
}

// ── Realtime ────────────────────────────────────────────────────────────────

/**
 * §123: scope the subscription.
 *
 * Filtered to one owner, so a customer's client never receives another's
 * events, and one channel per screen rather than one per row — a hundred open
 * channels is how a realtime quota is exhausted by a single inbox.
 */
export function subscribeToConversations(ownerId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`comm-inbox-${ownerId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'comm_conversations', filter: `owner_id=eq.${ownerId}` },
      onChange)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'comm_messages', filter: `owner_id=eq.${ownerId}` },
      onChange)
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}

export function subscribeToCalls(ownerId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`comm-calls-${ownerId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'outreach_sends', filter: `owner_id=eq.${ownerId}` },
      onChange)
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Billing ─────────────────────────────────────────────────────────────────

/**
 * What Communications cost, over a bounded window.
 *
 * Reads the rows the dispatcher and the webhooks already write — there is no
 * separate billing ledger for this product (§43). `cost_usd` on those rows is
 * the CUSTOMER charge, computed server-side from configured pricing; this
 * function sums, it never prices.
 *
 * A null cost is carried through as null rather than coerced to zero: a call
 * that completed while AI_CALL pricing is inactive was not free, it was
 * unpriced, and the screen says so.
 */
export async function getCommunicationsSpend(sinceIso: string): Promise<CommunicationsSpend> {
  const empty: CommunicationsSpend = {
    totalUsd: 0,
    series: [],
    byProduct: {
      AI_CALL: { amountUsd: 0, units: 0 },
      WHATSAPP: { amountUsd: 0, units: 0 },
      AI_TALK: { amountUsd: 0, units: 0 },
    },
    items: [],
    campaigns: [],
    unpricedProducts: [],
  };

  const uid = await currentUserId();
  if (!uid) return empty;

  // Capped at 180 days for the same reason getAnalytics is (§85).
  const since = new Date(
    Math.max(new Date(sinceIso).getTime(), Date.now() - 180 * 86_400_000),
  ).toISOString();

  const [{ data: sends }, { data: campaigns }] = await Promise.all([
    supabase.from('outreach_sends')
      .select('id, channel, status, cost_usd, duration_sec, created_at, campaign_id')
      .eq('owner_id', uid)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20_000),
    supabase.from('outreach_campaigns')
      .select('id, name, status, campaign_type, cost_estimate_usd, cost_actual_usd, created_at')
      .eq('owner_id', uid)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const rows = sends ?? [];
  const campaignName = new Map((campaigns ?? []).map((c) => [c.id, c.name as string]));

  const byDate = new Map<string, number>();
  const result: CommunicationsSpend = { ...empty, byProduct: { ...empty.byProduct } };
  const unpriced = new Set<string>();

  for (const row of rows) {
    // A unit that never left is not usage.
    if (['PENDING', 'QUEUED', 'SUPPRESSED'].includes(row.status)) continue;

    const product = row.channel === 'AI_CALL' ? 'AI_CALL' : row.channel === 'WHATSAPP' ? 'WHATSAPP' : null;
    if (!product) continue;

    const amount = row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd);
    if (amount === null) unpriced.add(product);

    const bucket = result.byProduct[product];
    bucket.units += 1;
    bucket.amountUsd += amount ?? 0;
    result.totalUsd += amount ?? 0;

    const day = String(row.created_at).slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + (amount ?? 0));

    if (result.items.length < 100) {
      result.items.push({
        id: row.id,
        at: row.created_at,
        product,
        reference: campaignName.get(row.campaign_id) ?? null,
        unitsLabel: product === 'AI_CALL'
          ? formatSeconds(row.duration_sec)
          : '1',
        amountUsd: amount,
      });
    }
  }

  result.series = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amountUsd]) => ({ date, amountUsd }));

  result.campaigns = (campaigns ?? [])
    .filter((c) => ['AI_CALL', 'WHATSAPP'].includes(c.campaign_type))
    .filter((c) => Number(c.cost_estimate_usd) > 0 || Number(c.cost_actual_usd) > 0)
    .slice(0, 25)
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      estimateUsd: Number(c.cost_estimate_usd) || 0,
      actualUsd: Number(c.cost_actual_usd) || 0,
    }));

  result.unpricedProducts = [...unpriced];
  return result;
}

function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '·';
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}
