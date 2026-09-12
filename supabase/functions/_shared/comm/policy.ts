// HOMATCH Communications — the one place a campaign is allowed to start.
//
// §48: "Create a centralized server-side policy decision pipeline… Never
// depend solely on frontend checks." This file is that pipeline. Every path
// that can cause an outbound communication — the launch endpoint, the dispatch
// worker, the manual single send, a scheduled start — calls decideLaunch() and
// obeys it. There is deliberately no second implementation and no way to skip
// it: a campaign row without a matching comm_risk_assessments row has not been
// authorised and the dispatcher refuses it.
//
// THE ORDER IS THE DESIGN
//
//   ownership -> contact eligibility -> domain -> compliance -> risk ->
//   trust -> provider health -> spend/balance -> approval
//
// Cheap and absolute first, expensive and contingent last. Ownership is a
// single indexed lookup and rules out the whole request; the domain gate is
// free for most campaigns and only escalates to a model for genuinely
// ambiguous ones; the wallet is touched last because holding a customer's
// credits and then refusing them on a compliance rule is both rude and a
// reservation leak.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { classifyDomain, applyLlmVerdict, type DomainResult } from './generated/domainClassifier.ts';
import { assessRisk, TIER_LIMITS, type RiskResult, type RiskInput } from './generated/risk.ts';
import type { TrustTier } from './generated/vocabulary.ts';

export interface LaunchContext {
  sb: SupabaseClient;
  userId: string;
  campaignId: string;
  /** Called only when the deterministic cascade could not decide (§51 stage 4). */
  classifyWithLlm?: (text: string) => Promise<{ verdict: 'ALLOW' | 'REVIEW' | 'BLOCK'; reason?: string; confidence?: number }>;
}

export interface LaunchDecision {
  ok: boolean;
  /** Machine-readable, always. The UI maps these to copy; it never parses prose. */
  code:
    | 'APPROVED'
    | 'CAMPAIGN_NOT_FOUND' | 'NOT_OWNER' | 'BAD_STATE'
    | 'NO_ELIGIBLE_CONTACTS' | 'DOMAIN_BLOCKED' | 'NEEDS_REVIEW'
    | 'ACCOUNT_FROZEN' | 'TRUST_LIMIT' | 'PROVIDER_UNAVAILABLE'
    | 'INSUFFICIENT_BALANCE' | 'SPEND_CAP' | 'CHANNEL_NOT_CONFIGURED'
    | 'TEMPLATE_NOT_APPROVED' | 'AGENT_NOT_READY' | 'ERROR';
  message: string;
  domain?: DomainResult;
  risk?: RiskResult;
  /** Persisted assessment id, so the campaign row can point at the decision. */
  assessmentId?: string;
  audience?: {
    total: number;
    eligible: number;
    suppressed: number;
    invalid: number;
    allowed: number;
  };
  estimate?: { minCents: number; maxCents: number; isRange: boolean; basis: string };
  throughputPerHour?: number;
}

function deny(code: LaunchDecision['code'], message: string, extra: Partial<LaunchDecision> = {}): LaunchDecision {
  return { ok: false, code, message, ...extra };
}

/**
 * Decide whether this campaign may start, and record why.
 *
 * Returns a decision AND writes it to comm_risk_assessments, always — a
 * refusal is as much a fact worth keeping as an approval, and §53's admin
 * screen is built from these rows. Writing only the approvals would make the
 * Risk & Compliance centre a list of things that went fine.
 */
export async function decideLaunch(ctx: LaunchContext): Promise<LaunchDecision> {
  const { sb, userId, campaignId } = ctx;

  // ── 1. Ownership ─────────────────────────────────────────────────────────
  const { data: campaign, error: campaignErr } = await sb
    .from('outreach_campaigns')
    .select('id, owner_id, name, campaign_type, status, contact_list_id, property_id, ai_instructions, call_script, agent_id, agent_version_id, channel_account_id, template_id, max_spend_usd, audience_count')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignErr) return deny('ERROR', 'the campaign could not be read');
  if (!campaign) return deny('CAMPAIGN_NOT_FOUND', 'no such campaign');
  // Checked here even though RLS also enforces it: this function runs under
  // the service role in the worker, where RLS does not apply.
  if (campaign.owner_id !== userId) return deny('NOT_OWNER', 'this campaign belongs to another account');

  const launchable = ['DRAFT', 'READY', 'APPROVED', 'SCHEDULED', 'PAUSED'];
  if (!launchable.includes(campaign.status)) {
    return deny('BAD_STATE', `a campaign in ${campaign.status} cannot be launched`);
  }
  // §52's line, enforced rather than merely displayed: a compliance pause is
  // not something the customer's own API call can lift.
  if (campaign.status === 'COMPLIANCE_PAUSED') {
    return deny('ACCOUNT_FROZEN', 'this campaign is paused pending review and cannot be resumed from here');
  }

  const channel = String(campaign.campaign_type);

  // ── 2. Audience ──────────────────────────────────────────────────────────
  const audience = await summariseAudience(sb, userId, campaign.contact_list_id, channel);
  if (audience.eligible === 0) {
    return deny('NO_ELIGIBLE_CONTACTS',
      'every contact on this list is suppressed, opted out, or has no usable number',
      { audience: { ...audience, allowed: 0 } });
  }

  // ── 3. The real-estate boundary ──────────────────────────────────────────
  const agent = campaign.agent_id ? await loadAgent(sb, campaign.agent_id) : null;
  const domainText = [
    campaign.name,
    campaign.ai_instructions,
    campaign.call_script,
    agent?.purpose,
    agent?.primary_goal,
    agent?.introduction,
    agent?.business_context,
  ].filter(Boolean).join('\n');

  let domain = classifyDomain({
    text: domainText,
    agentTemplate: agent?.template_code ?? null,
    hasPropertyContext: Boolean(campaign.property_id || agent?.property_id),
    campaignType: channel,
  });

  // Stage 4, and only stage 4. A campaign the cascade already settled never
  // reaches a model, which is §7 and §64 applied to the gate itself.
  if (domain.needsLlm && ctx.classifyWithLlm) {
    try {
      const llm = await ctx.classifyWithLlm(domainText);
      domain = applyLlmVerdict(domain, llm);
    } catch {
      // A model that is down must not open the gate. An unresolved REVIEW
      // stays a REVIEW and a human decides.
      domain = { ...domain, signals: [...domain.signals, { code: 'LLM_UNAVAILABLE', weight: 0 }], needsLlm: false };
    }
  }

  // ── 4. Trust, history and risk ───────────────────────────────────────────
  const trust = await loadTrust(sb, userId);
  const history = await loadHistory(sb, userId);
  const spend = await loadSpendToday(sb, userId, trust);

  const estimate = await estimateFor(sb, channel, audience.eligible, history.answerRate);

  const riskInput: RiskInput = {
    trustTier: trust.tier,
    accountAgeHours: history.accountAgeHours,
    audienceSize: audience.eligible,
    consentedCount: audience.consented,
    validPhoneCount: audience.validPhones,
    channel,
    countries: audience.countries,
    recentVolume24h: history.volume24h,
    priorVolume24h: history.priorVolume24h,
    optOutRate: history.optOutRate,
    complaintCount: trust.complaintCount,
    failureRate: history.failureRate,
    domainVerdict: domain.verdict,
    outboundFrozen: trust.outboundFrozen,
    estimatedSpendUsd: estimate.maxCents / 100,
    dailySpendCapUsd: spend.capUsd,
    spentTodayUsd: spend.spentUsd,
  };
  const risk = assessRisk(riskInput);

  // ── 5. Record the decision, whatever it is ───────────────────────────────
  const assessmentId = await recordAssessment(sb, {
    userId,
    campaignId,
    agentId: campaign.agent_id ?? null,
    decision: risk.decision,
    riskLevel: risk.level,
    domain,
    risk,
  });

  const base: Partial<LaunchDecision> = {
    domain, risk, assessmentId,
    audience: { ...audience, allowed: risk.allowedRecipients },
    estimate: { minCents: estimate.minCents, maxCents: estimate.maxCents, isRange: estimate.isRange, basis: estimate.basis },
    throughputPerHour: risk.throughputPerHour,
  };

  if (domain.verdict === 'BLOCK') {
    return deny('DOMAIN_BLOCKED',
      'Homatch Communications is for real estate and property services. This campaign does not appear to be.',
      base);
  }
  if (trust.outboundFrozen) {
    return deny('ACCOUNT_FROZEN', 'outbound sending is paused on this account pending review', base);
  }
  if (risk.decision === 'BLOCK') {
    return deny('TRUST_LIMIT', 'this campaign cannot start in its current form', base);
  }
  if (risk.decision === 'REVIEW' || domain.verdict === 'REVIEW') {
    return deny('NEEDS_REVIEW', 'this campaign needs a review before it can start', base);
  }

  // ── 6. Channel readiness ─────────────────────────────────────────────────
  const readiness = await checkChannelReadiness(sb, campaign, channel);
  if (!readiness.ok) return deny(readiness.code, readiness.message, base);

  // ── 7. Money, last ───────────────────────────────────────────────────────
  if (estimate.maxCents / 100 > spend.capUsd - spend.spentUsd) {
    return deny('SPEND_CAP',
      'this campaign would exceed the spending limit on this account for today',
      base);
  }

  return { ok: true, code: 'APPROVED', message: 'approved', ...base } as LaunchDecision;
}

// ── The pieces ──────────────────────────────────────────────────────────────

export interface AudienceSummary {
  total: number;
  eligible: number;
  suppressed: number;
  invalid: number;
  consented: number;
  validPhones: number;
  countries: string[];
}

/**
 * Count the audience without loading it.
 *
 * §101 and §85: one action must not pull every contact into memory. These are
 * aggregate counts done in Postgres; the dispatcher pages through the actual
 * rows later, in batches, claiming each one.
 */
export async function summariseAudience(
  sb: SupabaseClient,
  ownerId: string,
  listId: string | null,
  channel: string,
): Promise<AudienceSummary> {
  const empty: AudienceSummary = { total: 0, eligible: 0, suppressed: 0, invalid: 0, consented: 0, validPhones: 0, countries: [] };
  if (!listId) return empty;

  const { data, error } = await sb.rpc('comm_audience_summary', {
    p_list_id: listId, p_owner_id: ownerId, p_channel: channel,
  });

  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    return {
      total: Number(row?.total ?? 0),
      eligible: Number(row?.eligible ?? 0),
      suppressed: Number(row?.suppressed ?? 0),
      invalid: Number(row?.invalid ?? 0),
      consented: Number(row?.consented ?? 0),
      validPhones: Number(row?.valid_phones ?? 0),
      countries: Array.isArray(row?.countries) ? row.countries.filter(Boolean) : [],
    };
  }

  // The RPC ships with the communications migration. Until that is applied,
  // fall back to counting in the client rather than failing the whole gate —
  // but count with HEAD queries, never by selecting the rows.
  return await summariseAudienceFallback(sb, ownerId, listId, channel);
}

async function summariseAudienceFallback(
  sb: SupabaseClient, ownerId: string, listId: string, channel: string,
): Promise<AudienceSummary> {
  const base = () => sb.from('outreach_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', listId)
    .eq('owner_id', ownerId);

  const isCall = channel === 'AI_CALL';
  const isWhatsApp = channel === 'WHATSAPP';

  const [total, suppressed, valid, consented] = await Promise.all([
    base(),
    base().or('suppressed.eq.true,do_not_contact.eq.true,unsubscribed.eq.true'),
    base().eq('phone_valid', true),
    base().eq('consent_status', 'CONSENTED'),
  ]);

  let eligibleQ = base().eq('phone_valid', true)
    .eq('suppressed', false).eq('do_not_contact', false);
  if (isCall) eligibleQ = eligibleQ.eq('do_not_call', false);
  if (isWhatsApp) eligibleQ = eligibleQ.eq('whatsapp_opted_out', false);
  const eligible = await eligibleQ;

  const totalN = total.count ?? 0;
  const validN = valid.count ?? 0;
  return {
    total: totalN,
    eligible: eligible.count ?? 0,
    suppressed: suppressed.count ?? 0,
    invalid: Math.max(0, totalN - validN),
    consented: consented.count ?? 0,
    validPhones: validN,
    countries: [],
  };
}

async function loadAgent(sb: SupabaseClient, agentId: string) {
  const { data } = await sb.from('comm_agents')
    .select('id, status, template_code, purpose, primary_goal, introduction, business_context, property_id, current_version')
    .eq('id', agentId).maybeSingle();
  return data;
}

export interface TrustSnapshot {
  tier: TrustTier;
  outboundFrozen: boolean;
  complaintCount: number;
  optOutCount: number;
  overrides: {
    maxRecipients: number | null;
    dailySpendUsd: number | null;
  };
}

export async function loadTrust(sb: SupabaseClient, userId: string): Promise<TrustSnapshot> {
  const { data } = await sb.from('comm_account_trust')
    .select('tier, outbound_frozen, complaint_count, optout_count, max_campaign_recipients, max_daily_spend_usd')
    .eq('owner_id', userId).maybeSingle();

  // No row means a new account that has never been assessed. NEW is the safe
  // default and is what the tier table's smallest limits are for.
  return {
    tier: (data?.tier as TrustTier) ?? 'NEW',
    outboundFrozen: Boolean(data?.outbound_frozen),
    complaintCount: Number(data?.complaint_count ?? 0),
    optOutCount: Number(data?.optout_count ?? 0),
    overrides: {
      maxRecipients: data?.max_campaign_recipients ?? null,
      dailySpendUsd: data?.max_daily_spend_usd ?? null,
    },
  };
}

export interface HistorySnapshot {
  accountAgeHours: number;
  volume24h: number;
  priorVolume24h: number;
  optOutRate: number;
  failureRate: number;
  answerRate: number;
}

export async function loadHistory(sb: SupabaseClient, userId: string): Promise<HistorySnapshot> {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // public.users.id is NOT auth.uid(); auth_id is. Getting this wrong returns
  // no row, which silently reports every account as brand new and pushes every
  // campaign's risk score up by the ACCOUNT_UNDER_ONE_DAY weight.
  const { data: user } = await sb.from('users').select('created_at').eq('auth_id', userId).maybeSingle();
  const accountAgeHours = user?.created_at
    ? Math.max(0, (now - new Date(user.created_at).getTime()) / 3_600_000)
    : 0;

  const { data: sends } = await sb.from('outreach_sends')
    .select('status, created_at')
    .eq('owner_id', userId)
    .gte('created_at', new Date(now - 2 * day).toISOString())
    .limit(5000);

  const rows = sends ?? [];
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= now - day);
  const prior = rows.filter((r) => new Date(r.created_at).getTime() < now - day);

  const optOuts = recent.filter((r) => r.status === 'OPTED_OUT').length;
  const failed = recent.filter((r) => ['FAILED', 'BOUNCED'].includes(r.status)).length;
  const answered = recent.filter((r) => ['ANSWERED', 'COMPLETED'].includes(r.status)).length;

  return {
    accountAgeHours,
    volume24h: recent.length,
    priorVolume24h: prior.length,
    optOutRate: recent.length ? optOuts / recent.length : 0,
    failureRate: recent.length ? failed / recent.length : 0,
    // With no history there is no observed answer rate, and inventing an
    // optimistic one would understate the estimate. 0.25 is stated as an
    // assumption in the estimate's own `basis` string rather than hidden.
    answerRate: recent.length >= 20 ? answered / recent.length : 0.25,
  };
}

async function loadSpendToday(sb: SupabaseClient, userId: string, trust: TrustSnapshot) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data } = await sb.from('outreach_sends')
    .select('cost_usd')
    .eq('owner_id', userId)
    .gte('created_at', since.toISOString())
    .limit(10_000);

  const spentUsd = (data ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  // An admin override wins over the tier default; the tier default exists so a
  // missing override is never "unlimited".
  const capUsd = trust.overrides.dailySpendUsd ?? TIER_LIMITS[trust.tier].dailySpendUsd;
  return { spentUsd, capUsd };
}

async function estimateFor(sb: SupabaseClient, channel: string, reachable: number, answerRate: number) {
  const { data: product } = await sb.from('billable_products')
    .select('code, standard_retail_cents, pricing_active, enabled')
    .eq('code', channel === 'WHATSAPP' ? 'WHATSAPP' : 'AI_CALL')
    .maybeSingle();

  const { data: taxSetting } = await sb.from('admin_settings')
    .select('value').eq('key', 'tax_rate_bps').maybeSingle();
  const taxBps = Number(taxSetting?.value ?? 1800);

  // No active pricing means no honest estimate. Zero is reported with a basis
  // that SAYS pricing is not configured, rather than a confident $0.00 that
  // reads as free.
  const unitNetCents = product?.pricing_active ? Number(product.standard_retail_cents ?? 0) : 0;
  const priced = Boolean(product?.pricing_active);

  if (channel === 'AI_CALL') {
    const answered = reachable * answerRate;
    const min = answered * (45 / 60) * unitNetCents * (1 + taxBps / 10_000);
    const max = answered * (180 / 60) * unitNetCents * (1 + taxBps / 10_000);
    return {
      minCents: min, maxCents: max, isRange: true,
      basis: priced
        ? `${reachable} reachable × ${Math.round(answerRate * 100)}% expected answer × 45-180s`
        : 'pricing is not configured for AI calls yet',
    };
  }

  const flat = reachable * unitNetCents * (1 + taxBps / 10_000);
  return {
    minCents: flat, maxCents: flat, isRange: false,
    basis: priced ? `${reachable} recipients` : 'pricing is not configured for WhatsApp yet',
  };
}

async function checkChannelReadiness(
  sb: SupabaseClient,
  campaign: Record<string, unknown>,
  channel: string,
): Promise<{ ok: true } | { ok: false; code: LaunchDecision['code']; message: string }> {
  if (channel === 'AI_CALL') {
    if (!campaign.agent_id) {
      return { ok: false, code: 'AGENT_NOT_READY', message: 'this campaign has no agent' };
    }
    const { data: agent } = await sb.from('comm_agents')
      .select('status, current_version').eq('id', campaign.agent_id as string).maybeSingle();
    if (!agent || agent.status !== 'READY' || !agent.current_version) {
      return { ok: false, code: 'AGENT_NOT_READY', message: 'the agent is not published and ready' };
    }
    return { ok: true };
  }

  if (channel === 'WHATSAPP') {
    const { data: account } = await sb.from('comm_channel_accounts')
      .select('status, environment, provider')
      .eq('id', (campaign.channel_account_id as string) ?? '')
      .maybeSingle();
    if (!account || account.status !== 'CONNECTED') {
      return { ok: false, code: 'CHANNEL_NOT_CONFIGURED', message: 'no connected WhatsApp number is attached to this campaign' };
    }
    if (campaign.template_id) {
      const { data: template } = await sb.from('comm_whatsapp_templates')
        .select('status').eq('id', campaign.template_id as string).maybeSingle();
      // §37: Homatch generating the copy is not Meta approving it, and only
      // Meta's own APPROVED permits a business-initiated send.
      if (!template || template.status !== 'APPROVED') {
        return { ok: false, code: 'TEMPLATE_NOT_APPROVED', message: 'the template has not been approved by Meta' };
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

async function recordAssessment(sb: SupabaseClient, params: {
  userId: string;
  campaignId: string;
  agentId: string | null;
  decision: string;
  riskLevel: string;
  domain: DomainResult;
  risk: RiskResult;
}): Promise<string | undefined> {
  const reasons = [
    ...params.domain.signals.map((s) => ({ code: s.code, weight: s.weight, detail: s.detail ?? null, source: 'DOMAIN' })),
    ...params.risk.signals.map((s) => ({ code: s.code, weight: s.weight, detail: s.detail ?? null, source: 'RISK' })),
  ];

  const { data, error } = await sb.from('comm_risk_assessments').insert({
    owner_id: params.userId,
    campaign_id: params.campaignId,
    agent_id: params.agentId,
    decision: params.decision,
    risk_level: params.riskLevel,
    domain_verdict: params.domain.verdict,
    domain_stage: params.domain.stage,
    reasons,
    score: params.risk.score,
  }).select('id').maybeSingle();

  // A failure to RECORD the decision must not silently become a failure to
  // MAKE it; the caller still gets its answer and the gap is logged.
  if (error) console.error('[policy] could not record assessment', error.message);
  return data?.id;
}
