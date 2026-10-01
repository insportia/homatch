// META ADS — the engine behind meta-ads-api: preflight, publish, sync and
// settlement. index.ts routes and authorises; this file is what actually
// talks to Meta and to the ledger.
//
// THE THREE PROMISES THIS FILE KEEPS
//
//   1. PREFLIGHT IS REAL. Every check is deterministic or a live Graph read;
//      nothing is marked OK because a row exists. Results are READY /
//      WARNING / ACTION_REQUIRED, and a campaign can only be READY when no
//      check is ACTION_REQUIRED. The configuration that was checked is
//      fingerprinted, and launch refuses a campaign that changed since.
//
//   2. LAUNCH IS THE WHOLE TREE OR NOTHING. Media uploaded, campaign created
//      PAUSED, ad sets and ads created ACTIVE beneath it, and only then the
//      campaign switched on. A failure part-way deletes what was created and
//      returns the money. The customer sees SUBMITTED, then whatever Meta
//      says — never ACTIVE because our own write succeeded.
//
//   3. MONEY FOLLOWS META. The media reserve and fee are taken at launch
//      (REAL mode only — MOCK never touches a customer's balance), the real
//      spend is settled from Meta's insights when the campaign ends, and the
//      unspent reserve and its share of the fee come back.

import {
  buildPlan, validatePlanInput, computeTotals, classifySpecialAdCategories, strategyParams, STRATEGY_VERSION,
  type MetaGoal, type StrategyInput, type StrategyParams, type TypedCampaignPlan,
} from '../../../src/lib/metaAds/strategy.ts';
import { declaredSpecialAdCategories, normalizeIntent, validateTargeting } from '../../../src/lib/metaAds/targeting.ts';
import { creativeAdvice, creativeQuality, blocksLaunch, type AdviceItem } from '../../../src/lib/metaAds/creativeAdvice.ts';
import { effectiveFeePercent, fundingPlan, heldFeeFromLedger, settleServiceFee, plannedMediaCents, type FeePolicy } from '../../../src/lib/metaAds/billing.ts';
import { DEFAULT_ANALYSIS_PARAMS, type AnalysisParams } from '../../../src/lib/metaAds/analysis.ts';
import { guardPolicy, type GuardPolicy } from '../../../src/lib/metaAds/guard.ts';
import {
  GOAL_SPECS, adSetParams, adParams, campaignParams, creativeParams, missingRequirements, mapMetaStatus,
  settlement, checkMedia, recommendedPlacements, PLACEMENTS, isHttpsUrl,
  type LaunchContext, type LaunchCreative, type MessagingApp, type Placement,
  launchCharge, launchStartTime, parseBudgetBilling, type BudgetBilling,
} from '../../../src/lib/metaAds/payload.ts';
import { CLAIM_FLAG, claimText, claimFingerprint, approvedClaim, openClaimCase, type ModerationCaseRow } from '../../../src/lib/metaAds/moderation.ts';
import { classifyDomainScope, domainFingerprint, DOMAIN_CASE_REASON, type DomainVerdict } from '../../../src/lib/metaAds/domainScope.ts';
import {
  graph, graphAll, MetaApiError, metaMode, openToken, uploadImage, uploadVideo, mockExternalId,
  REQUIRED_SCOPES_BY_GOAL, type MetaMode,
} from '../_shared/metaAds.ts';

type Sb = any;

/* ── SETTINGS ───────────────────────────────────────────────────────── */

export interface MetaSettings {
  enabled: boolean;
  publishingEnabled: boolean;
  feePercent: number;
  minDurationDays: number;
  minDailyCents: number;
  maxDailyCents: number;
  goalsEnabled: string[];
  leadImportEnabled: boolean;
  leadSyncEnabled: boolean;
  audienceCreationEnabled: boolean;
  retargetingEnabled: boolean;
  aiAssistEnabled: boolean;
  whatsappEnabled: boolean;
  defaultCountries: string[];
  /** Who pays Meta for the ad budget (payload.ts BudgetBilling). */
  budgetBilling: BudgetBilling;
  /** Canonical, server-side strategy thresholds (strategy.ts). */
  strategyParams: StrategyParams;
  /** Evidence thresholds for recommendations and events (analysis.ts). */
  analysisParams: AnalysisParams;
  guardPolicy: GuardPolicy;
  guardEnabled: boolean;
  /** AI narrative for meaningful events and summaries; never in the cycle by default. */
  aiSummaryEnabled: boolean;
}

/** Bounded numeric overrides on top of the analysis defaults. */
function analysisParamsOf(raw: unknown): AnalysisParams {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out = { ...DEFAULT_ANALYSIS_PARAMS } as Record<string, number>;
  for (const [k, d] of Object.entries(DEFAULT_ANALYSIS_PARAMS)) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v > 0 && v <= (d as number) * 20) out[k] = v;
  }
  return out as unknown as AnalysisParams;
}

export async function loadSettings(sb: Sb): Promise<MetaSettings> {
  const { data } = await sb.from('admin_settings').select('key,value').like('key', 'meta_ads_%');
  const m = new Map<string, unknown>((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const b = (k: string, d: boolean) => (typeof m.get(k) === 'boolean' ? m.get(k) as boolean : d);
  const n = (k: string, d: number) => (typeof m.get(k) === 'number' && Number.isFinite(m.get(k)) ? m.get(k) as number : d);
  const goals = m.get('meta_ads_goals_enabled');
  const countries = m.get('meta_ads_default_countries');
  return {
    enabled: b('meta_ads_enabled', true),
    publishingEnabled: b('meta_ads_publishing_enabled', true),
    feePercent: n('meta_ads_fee_percent', 9),
    // The floor is two days whatever the setting says: a one-day campaign
    // spends most of its budget inside Meta's learning phase.
    minDurationDays: Math.max(2, n('meta_ads_min_duration_days', 2)),
    minDailyCents: n('meta_ads_daily_budget_min_cents', 200),
    maxDailyCents: n('meta_ads_daily_budget_max_cents', 100000000),
    goalsEnabled: Array.isArray(goals) ? goals.map(String) : ['LEADS_ON_META'],
    leadImportEnabled: b('meta_ads_lead_import_enabled', true),
    leadSyncEnabled: b('meta_ads_lead_sync_enabled', true),
    audienceCreationEnabled: b('meta_ads_audience_creation_enabled', true),
    retargetingEnabled: b('meta_ads_retargeting_enabled', true),
    aiAssistEnabled: b('meta_ads_ai_assist_enabled', true),
    whatsappEnabled: b('meta_ads_whatsapp_enabled', false),
    defaultCountries: Array.isArray(countries) && countries.length ? countries.map(String) : ['GE'],
    /* Default: Meta bills the customer's own ad account, HOMATCH holds only
       its fee. Reserving the budget too would charge the customer twice. */
    budgetBilling: parseBudgetBilling(m.get('meta_ads_budget_billing')),
    strategyParams: strategyParams(m.get('meta_ads_strategy_params')),
    analysisParams: analysisParamsOf(m.get('meta_ads_analysis_params')),
    guardPolicy: guardPolicy(m.get('meta_ads_guard_policy')),
    guardEnabled: b('meta_ads_guard_enabled', true),
    aiSummaryEnabled: b('meta_ads_ai_summary_enabled', true),
  };
}

/**
 * The service-fee percent for this customer — from the ONE canonical source,
 * the database (meta_effective_fee_percent: the admin policy over the standard
 * setting). Never guessed: if it cannot be read, the caller fails.
 * `settings.feePercent` is the same standard setting, kept for display.
 */
export async function customerFeePercent(sb: Sb, userId: string, _settings?: MetaSettings): Promise<number> {
  const { data, error } = await sb.rpc('meta_effective_fee_percent', { p_user: userId });
  if (error || data == null || !Number.isFinite(Number(data))) throw new Error('FEE_POLICY_UNAVAILABLE');
  return Number(data);
}

/** Reference implementation the database mirrors (tests compare them). */
export const feePercentFromPolicy = (policy: FeePolicy | null, standardPercent: number) => effectiveFeePercent(policy, standardPercent);

/* ── TOKENS + ASSETS ────────────────────────────────────────────────── */

export async function userToken(sb: Sb, userId: string): Promise<string | null> {
  const { data: conn } = await sb.from('meta_connections').select('id,status').eq('user_id', userId).maybeSingle();
  if (!conn || conn.status !== 'CONNECTED') return null;
  const { data: tok } = await sb.from('meta_tokens').select('access_token,expires_at').eq('connection_id', conn.id).maybeSingle();
  if (!tok) return null;
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
    await sb.from('meta_connections').update({ status: 'EXPIRED' }).eq('id', conn.id);
    return null;
  }
  return await openToken(tok.access_token);
}

export async function selectedAsset(sb: Sb, userId: string, kind: string) {
  const { data } = await sb.from('meta_assets').select('*')
    .eq('user_id', userId).eq('kind', kind).eq('selected', true).maybeSingle();
  return data ?? null;
}

/** A Page access token, fetched when needed and never stored. */
export async function pageToken(userTokenValue: string, pageId: string, audit?: { sb: Sb; userId: string }): Promise<string | null> {
  const res = await graph(`/${pageId}?fields=access_token`, { token: userTokenValue, audit, attempts: 2 });
  return typeof res.access_token === 'string' ? res.access_token : null;
}

/* ── STRATEGY INPUT ─────────────────────────────────────────────────── */

export async function strategyInputFor(sb: Sb, uid: string, c: any, settings: MetaSettings):
  Promise<{ strategy: StrategyInput } | { error: string }> {
  // '*': priority arrived with 20261003120000; absent reads as false.
  const { data: creatives } = await sb.from('meta_creatives')
    .select('*').eq('campaign_id', c.id).order('sort');
  let audienceExternalId: string | null = null;
  if (c.audience_id) {
    const { data: aud } = await sb.from('meta_audiences').select('external_audience_id,sync_status,user_id')
      .eq('id', c.audience_id).maybeSingle();
    if (!aud || aud.user_id !== uid) return { error: 'AUDIENCE_NOT_FOUND' };
    if (aud.sync_status !== 'READY') return { error: 'AUDIENCE_NOT_READY' };
    audienceExternalId = aud.external_audience_id;
  }
  const offerCats = classifySpecialAdCategories({
    isProperty: !!c.property_id || !!(c.offer && c.offer.isProperty !== false),
    dealKind: c.offer?.dealKind ?? (c.property_id ? 'SALE' : 'OTHER'),
  });
  const targeting = normalizeIntent(c.targeting, settings.defaultCountries);
  // Declared only where Meta requires it: a housing offer reaching the US,
  // Canada or the European list (targeting.housingRule).
  const acct = await selectedAsset(sb, uid, 'AD_ACCOUNT');
  const cats = declaredSpecialAdCategories(offerCats, targeting, acct?.capabilities?.business_country_code ?? null);
  return {
    strategy: {
      goal: c.goal,
      dailyBudgetCents: Number(c.daily_budget_cents ?? 0),
      durationDays: Number(c.duration_days ?? 0),
      currency: c.currency,
      specialAdCategories: cats,
      creatives: (creatives ?? []).map((cr: any) => ({
        id: cr.id, kind: cr.kind,
        ready: (cr.media ?? []).length > 0 && cr.safety_status !== 'BLOCKED',
        width: cr.media?.[0]?.width ?? null, height: cr.media?.[0]?.height ?? null,
        quality: creativeQuality({ id: cr.id, media: cr.media ?? [], headline: cr.headline, primaryText: cr.primary_text }),
        priority: cr.priority === true,
      })),
      destination: c.destination ?? { type: c.goal === 'LEADS_ON_META' ? 'META_FORM' : 'WEBSITE' },
      audienceExternalId,
      // Where / ages / gender the customer chose; the market default when unset.
      targeting,
      countryCode: settings.defaultCountries[0],
      placementsMode: c.placements?.mode === 'CUSTOM' ? 'CUSTOM' : 'RECOMMENDED',
      customPlacements: c.placements?.list ?? [],
    },
  };
}

export function limitsOf(settings: MetaSettings) {
  return { minDurationDays: settings.minDurationDays, minDailyCents: settings.minDailyCents, maxDailyCents: settings.maxDailyCents };
}

/** What preflight approved. Launch recomputes it and refuses on any difference. */
export async function configFingerprint(sb: Sb, c: any): Promise<string> {
  const { data: creatives } = await sb.from('meta_creatives')
    .select('*').eq('campaign_id', c.id).order('id');
  const material = JSON.stringify({
    goal: c.goal, daily: c.daily_budget_cents, days: c.duration_days, currency: c.currency,
    destination: c.destination, placements: c.placements, audience: c.audience_id,
    offer: c.offer, property: c.property_id, targeting: c.targeting ?? null,
    creatives: (creatives ?? []).map((cr: any) => [cr.id, cr.headline, cr.primary_text, cr.description ?? '', cr.cta, cr.media, cr.priority === true]),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The lead form a campaign may use: the one named in its destination only if
 * it is among THIS customer's discovered forms (the draft is browser-written),
 * otherwise their selected form.
 */
async function ownedFormId(sb: Sb, uid: string, requested: unknown, selected: { external_id?: string } | null): Promise<string | null> {
  if (typeof requested === 'string' && requested) {
    const { data } = await sb.from('meta_assets').select('external_id')
      .eq('user_id', uid).eq('kind', 'LEAD_FORM').eq('external_id', requested).maybeSingle();
    return data?.external_id ?? null;
  }
  return selected?.external_id ?? null;
}

/* ── PREFLIGHT ──────────────────────────────────────────────────────── */

export type CheckState = 'READY' | 'WARNING' | 'ACTION_REQUIRED';
export interface PreflightCheck { key: string; state: CheckState; ok: boolean; detail?: string }

const BANNED_CLAIMS = /(guaranteed (profit|roi|return|income)|risk[- ]free investment|შემოსავალი გარანტირებულია|გარანტირებული მოგება|100% гарант|гарантированн\w* (доход|прибыль)|garantili (kazanç|getiri)|ربح مضمون|רווח מובטח)/i;

export async function runPreflight(sb: Sb, uid: string, c: any, settings: MetaSettings, mode: MetaMode) {
  const checks: PreflightCheck[] = [];
  const add = (key: string, state: CheckState, detail?: string) => checks.push({ key, state, ok: state !== 'ACTION_REQUIRED', detail });

  const input = await strategyInputFor(sb, uid, c, settings);
  if ('error' in input) {
    add('audience', 'ACTION_REQUIRED', input.error);
    return finish(sb, uid, c, checks, null, settings);
  }
  const goal = c.goal as MetaGoal;
  const spec = GOAL_SPECS[goal];

  add('goal_enabled', settings.goalsEnabled.includes(goal) ? 'READY' : 'ACTION_REQUIRED', settings.goalsEnabled.includes(goal) ? undefined : 'GOAL_DISABLED');
  // Only a property this account manages can be promoted (checked again at launch).
  const owned = await propertyAuthorized(sb, uid, c.property_id);
  add('property_owned', owned ? 'READY' : 'ACTION_REQUIRED', owned ? undefined : 'PROPERTY_NOT_OWNED');

  const planIssues = validatePlanInput(input.strategy, limitsOf(settings));
  add('budget', planIssues.some((i) => i.field === 'dailyBudgetCents') ? 'ACTION_REQUIRED' : 'READY',
    planIssues.filter((i) => i.field === 'dailyBudgetCents').map((i) => i.code).join(',') || undefined);
  add('duration', planIssues.some((i) => i.field === 'durationDays') ? 'ACTION_REQUIRED' : 'READY',
    planIssues.some((i) => i.field === 'durationDays') ? `MIN_${settings.minDurationDays}_DAYS` : undefined);
  const targetingIssues = validateTargeting(input.strategy.targeting!);
  add('targeting', targetingIssues.length ? 'ACTION_REQUIRED' : 'READY', targetingIssues.map((i) => i.code).join(',') || undefined);

  // Connection + assets.
  const token = await userToken(sb, uid);
  const { data: conn } = await sb.from('meta_connections').select('status,granted_scopes').eq('user_id', uid).maybeSingle();
  add('connection', token ? 'READY' : 'ACTION_REQUIRED', token ? undefined : (conn?.status ?? 'DISCONNECTED'));
  const granted: string[] = conn?.granted_scopes ?? [];
  const missingScopes = (REQUIRED_SCOPES_BY_GOAL[goal] ?? []).filter((s) => !granted.includes(s));
  add('permissions', missingScopes.length ? 'ACTION_REQUIRED' : 'READY', missingScopes.join(',') || undefined);

  const [page, acct, ig, pixel, form, wa] = await Promise.all([
    selectedAsset(sb, uid, 'PAGE'), selectedAsset(sb, uid, 'AD_ACCOUNT'), selectedAsset(sb, uid, 'INSTAGRAM'),
    selectedAsset(sb, uid, 'PIXEL'), selectedAsset(sb, uid, 'LEAD_FORM'), selectedAsset(sb, uid, 'WHATSAPP'),
  ]);
  add('page_selected', page ? 'READY' : 'ACTION_REQUIRED');
  add('ad_account_selected', acct ? 'READY' : 'ACTION_REQUIRED');
  if (acct) {
    const { data: guard } = await sb.from('meta_guard_accounts').select('status')
      .eq('user_id', uid).eq('ad_account_external_id', acct.external_id).maybeSingle();
    if (guard?.status === 'SUSPENDED') add('managed_access', 'ACTION_REQUIRED', 'META_ADS_ACCESS_SUSPENDED');
  }

  // Live reads, REAL mode only: the token works, the account can spend, the
  // page is still ours, and the goal's own assets exist.
  if (mode === 'REAL' && token && acct) {
    try {
      const info = await graph(`/${acct.external_id}?fields=account_status,currency,disable_reason,funding_source`, {
        token, audit: { sb, userId: uid, campaignId: c.id }, attempts: 2,
      });
      const status = Number(info.account_status);
      add('ad_account_active', status === 1 ? 'READY' : 'ACTION_REQUIRED', status === 1 ? undefined : `ACCOUNT_STATUS_${status}`);
      add('ad_account_currency', String(info.currency) === c.currency ? 'READY' : 'ACTION_REQUIRED',
        String(info.currency) === c.currency ? undefined : `ACCOUNT_CURRENCY_${info.currency}`);
      add('ad_account_funding', info.funding_source ? 'READY' : 'WARNING', info.funding_source ? undefined : 'NO_PAYMENT_METHOD_VISIBLE');
    } catch (err) {
      const norm = err instanceof MetaApiError ? err.normalized : null;
      add('ad_account_active', 'ACTION_REQUIRED', norm?.customerKey ?? 'meta_err_generic');
    }
  } else if (mode === 'MOCK') {
    add('integration_mode', 'WARNING', 'MOCK_MODE_NOTHING_REACHES_META');
  }

  // Goal-specific requirements.
  const destinationUrl = c.destination?.url ?? null;
  const ctx: Partial<LaunchContext> = {
    pageId: page?.external_id ?? '', instagramUserId: ig?.external_id ?? null,
    pixelId: pixel?.external_id ?? null, leadFormId: await ownedFormId(sb, uid, c.destination?.formId, form),
    messagingApp: (c.destination?.messagingApp as MessagingApp) ?? null,
    whatsappNumber: wa?.external_id ?? null, websiteUrl: destinationUrl,
  };
  const missing = missingRequirements(goal, ctx).filter((m) => m !== 'PAGE_REQUIRED');
  if (spec.needsWebsiteUrl) {
    add('destination', isHttpsUrl(destinationUrl) ? 'READY' : 'ACTION_REQUIRED', isHttpsUrl(destinationUrl) ? undefined : 'DESTINATION_URL_INVALID');
    if (isHttpsUrl(destinationUrl)) {
      const reach = await probeUrl(destinationUrl!);
      if (reach !== 'OK') add('destination_reachable', 'WARNING', reach);
    }
  }
  if (spec.needsPixel) add('tracking', ctx.pixelId ? 'READY' : 'ACTION_REQUIRED', ctx.pixelId ? spec.pixelEvent ?? undefined : 'PIXEL_REQUIRED');
  if (spec.needsLeadForm) add('lead_form', ctx.leadFormId ? 'READY' : 'ACTION_REQUIRED', ctx.leadFormId ? undefined : 'LEAD_FORM_REQUIRED');
  if (spec.needsMessagingApp) {
    const m = missing.find((x) => ['MESSAGING_DESTINATION_REQUIRED', 'INSTAGRAM_REQUIRED', 'WHATSAPP_REQUIRED'].includes(x));
    const waBlocked = ctx.messagingApp === 'WHATSAPP' && !settings.whatsappEnabled;
    add('messaging_destination', m || waBlocked ? 'ACTION_REQUIRED' : 'READY', m ?? (waBlocked ? 'WHATSAPP_NOT_ENABLED' : undefined));
  }

  // Creatives: content rules and media compatibility, deterministic.
  const placements: Placement[] = input.strategy.placementsMode === 'CUSTOM'
    ? (input.strategy.customPlacements ?? []).filter((p): p is Placement => (PLACEMENTS as readonly string[]).includes(p))
    : recommendedPlacements({ hasInstagram: !!ig, hasVideo: false, goal });
  if (input.strategy.placementsMode === 'CUSTOM' && placements.length === 0) add('placements', 'ACTION_REQUIRED', 'NO_PLACEMENT_SELECTED');
  else if (placements.some((p) => p.startsWith('instagram')) && !ig && input.strategy.placementsMode === 'CUSTOM') {
    add('placements', 'ACTION_REQUIRED', 'INSTAGRAM_PLACEMENT_WITHOUT_ACCOUNT');
  } else add('placements', 'READY', input.strategy.placementsMode);

  const { data: creatives } = await sb.from('meta_creatives').select('*').eq('campaign_id', c.id).order('sort');
  // Admin moderation decisions on this campaign: an approved claim text is
  // not held again; a review already waiting is never opened twice.
  const { data: modCases } = await sb.from('meta_moderation_cases').select('id,creative_id,status,findings').eq('campaign_id', c.id);
  let manualReview = false;
  let creativeState: CheckState = (creatives ?? []).length ? 'READY' : 'ACTION_REQUIRED';
  const creativeDetail: string[] = (creatives ?? []).length ? [] : ['CREATIVE_REQUIRED'];
  for (const cr of creatives ?? []) {
    const flags: string[] = [];
    let claimFp: string | null = null;
    let approved: ModerationCaseRow | null = null;
    if (BANNED_CLAIMS.test(claimText(cr))) {
      claimFp = await claimFingerprint(cr);
      approved = approvedClaim(modCases ?? [], cr.id, claimFp);
      if (!approved) flags.push(CLAIM_FLAG);
    }
    if ((cr.media ?? []).length === 0) flags.push('NO_MEDIA');
    if (goal !== 'ENGAGEMENT' && !String(cr.primary_text ?? '').trim()) flags.push('PRIMARY_TEXT_REQUIRED');
    if (['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'PROMOTE'].includes(goal) && !String(cr.headline ?? '').trim()) flags.push('HEADLINE_REQUIRED');
    if (String(cr.headline ?? '').length > 255 || String(cr.primary_text ?? '').length > 2200) flags.push('TEXT_TOO_LONG');
    const m0 = cr.media?.[0];
    if (m0) {
      const mc = checkMedia({ mime: m0.mime, sizeBytes: Number(m0.size ?? 0), width: m0.width, height: m0.height, durationSeconds: m0.duration }, placements);
      if (mc.verdict === 'INCOMPATIBLE') flags.push('MEDIA_INCOMPATIBLE');
      else if (mc.verdict === 'WARNING' && creativeState === 'READY') creativeState = 'WARNING';
      if (input.strategy.placementsMode === 'CUSTOM' && Object.values(mc.placements).includes('INCOMPATIBLE')) flags.push('MEDIA_PLACEMENT_MISMATCH');
    }
    const status = flags.includes(CLAIM_FLAG) ? 'MANUAL_REVIEW' : flags.length ? 'NEEDS_CHANGES' : 'READY';
    if (status !== 'READY') { creativeState = 'ACTION_REQUIRED'; creativeDetail.push(...flags); }
    if (status === 'MANUAL_REVIEW') manualReview = true;
    await sb.from('meta_creatives').update({
      safety_status: status,
      safety: { flags, checked_at: new Date().toISOString(), ...(approved ? { approved_claim_case: approved.id } : {}) },
    }).eq('id', cr.id);
    if (status === 'MANUAL_REVIEW' && claimFp && !openClaimCase(modCases ?? [], cr.id, claimFp)) {
      await sb.from('meta_moderation_cases').insert({
        user_id: uid, campaign_id: c.id, creative_id: cr.id,
        reason: flags.join(','), severity: 'HIGH', findings: { flags, claim_fingerprint: claimFp }, status: 'OPEN',
      });
    }
  }
  /* Yellow vs red: RECOMMENDATION / WARNING never block; only a
     BLOCKING_ERROR does. The advice is stored for the builder to show. */
  const draftPlan = planIssues.length === 0 ? buildPlan(input.strategy, settings.strategyParams) : null;
  const advice: AdviceItem[] = creativeAdvice((creatives ?? []).map((cr: any) => ({
    id: cr.id, media: cr.media ?? [], headline: cr.headline, primaryText: cr.primary_text,
  })), { goal, placements, recommendedCreativeCount: draftPlan?.strategy.recommendedCreativeCount ?? null });
  if (blocksLaunch(advice) && creativeState !== 'ACTION_REQUIRED') {
    creativeState = 'ACTION_REQUIRED';
    creativeDetail.push(...advice.filter((a) => a.severity === 'BLOCKING_ERROR').map((a) => a.code));
  }
  add('creatives', creativeState, [...new Set(creativeDetail)].join(',') || undefined);

  /* REAL-ESTATE SCOPE — HOMATCH Ads are for property and the services
     around it. Decided here and again at launch (domainCheck). */
  const domain = await domainCheck(sb, uid, c, { owned, creatives: creatives ?? [] });
  if (domain.state === 'BLOCKED') add('domain_scope', 'ACTION_REQUIRED', `BLOCKED_OUT_OF_SCOPE:${domain.verdict.reason}`);
  else if (domain.state === 'IN_REVIEW') { add('domain_scope', 'WARNING', `IN_REVIEW:${domain.verdict.reason}`); manualReview = true; }
  else add('domain_scope', 'READY', domain.state === 'APPROVED' ? 'APPROVED_BY_REVIEW' : domain.verdict.reason);

  const cats = input.strategy.specialAdCategories;
  add('policy_classified', 'READY', cats.join(',') || 'NONE');

  // Money: shown now, enforced at launch.
  const feePercent = await customerFeePercent(sb, uid, settings);
  const totals = computeTotals(input.strategy.dailyBudgetCents, input.strategy.durationDays, feePercent);
  const { data: wallet } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', uid).maybeSingle();
  const available = Number(wallet?.available_cents ?? 0);
  /* Only what HOMATCH itself will hold must be in the balance: with the
     customer's own ad account that is the fee, and Meta bills the budget. */
  const required = launchCharge(totals, settings.budgetBilling).requiredCents;
  add('balance', available >= required ? 'READY' : 'WARNING', available >= required ? undefined : `SHORT_${required - available}`);

  return finish(sb, uid, c, checks, input.strategy, settings, manualReview, cats, {
    advice, feePercent, hasInstagram: !!ig,
    funding: fundingPlan({ dailyBudgetCents: input.strategy.dailyBudgetCents, durationDays: input.strategy.durationDays, feePercent, availableCents: available }),
  });
}

/**
 * The real-estate scope of a campaign, as a decision with evidence. A case is
 * written for every non-ALLOWED verdict (once per exact offer+copy): BLOCKED
 * as an automatic REJECTED record, NEEDS_REVIEW as an OPEN case an admin
 * decides. A person's APPROVED decision for the same text lets it through;
 * a person's REJECTED decision holds it.
 */
export async function domainCheck(sb: Sb, uid: string, c: any, pre?: { owned?: boolean; creatives?: any[] }): Promise<{
  state: 'ALLOWED' | 'APPROVED' | 'IN_REVIEW' | 'BLOCKED'; verdict: DomainVerdict; fingerprint: string;
}> {
  const creatives = pre?.creatives ?? (await sb.from('meta_creatives').select('*').eq('campaign_id', c.id)).data ?? [];
  const owned = pre?.owned ?? await propertyAuthorized(sb, uid, c.property_id);
  const input = {
    hasProperty: !!c.property_id && owned,
    offer: c.offer ?? null,
    texts: [...creatives.flatMap((cr: any) => [cr.headline, cr.primary_text, cr.description]), c.owner_brief],
  };
  const verdict = classifyDomainScope(input);
  const fingerprint = domainFingerprint(input);
  if (verdict.decision === 'ALLOWED') return { state: 'ALLOWED', verdict, fingerprint };
  const { data: cases } = await sb.from('meta_moderation_cases').select('id,status,findings,decided_by')
    .eq('campaign_id', c.id).eq('reason', DOMAIN_CASE_REASON);
  const same = (cases ?? []).filter((m: any) => m.findings?.domain_fingerprint === fingerprint);
  const findings = { domain: verdict.decision, domain_reason: verdict.reason, signals: verdict.signals, domain_fingerprint: fingerprint, source: 'DETERMINISTIC', checked_at: new Date().toISOString() };
  // A person's decision on this exact offer and copy stands — an admin may overturn an automatic block.
  if (same.some((m: any) => m.status === 'APPROVED' && m.decided_by)) return { state: 'APPROVED', verdict, fingerprint };
  if (verdict.decision === 'BLOCKED_OUT_OF_SCOPE') {
    if (!same.length) {
      await sb.from('meta_moderation_cases').insert({
        user_id: uid, campaign_id: c.id, creative_id: null, reason: DOMAIN_CASE_REASON, severity: 'HIGH', findings,
        status: 'REJECTED', decided_at: new Date().toISOString(), decision_note: 'AUTO: out of HOMATCH Ads scope',
      });
    }
    return { state: 'BLOCKED', verdict, fingerprint };
  }
  if (same.some((m: any) => m.status === 'REJECTED' && m.decided_by)) return { state: 'BLOCKED', verdict, fingerprint };
  if (!same.some((m: any) => m.status === 'OPEN')) {
    await sb.from('meta_moderation_cases').insert({
      user_id: uid, campaign_id: c.id, creative_id: null, reason: DOMAIN_CASE_REASON, severity: 'MEDIUM', findings, status: 'OPEN',
    });
  }
  return { state: 'IN_REVIEW', verdict, fingerprint };
}

/** Recommended placements lose Instagram when no Instagram account is selected. */
export function withoutInstagram(plan: TypedCampaignPlan): TypedCampaignPlan {
  return {
    ...plan,
    adSets: plan.adSets.map((s) => (s.placements ? { ...s, placements: s.placements.filter((p) => !p.startsWith('instagram')) } : s))
      .filter((s) => !s.placements || s.placements.length > 0),
  };
}

async function finish(
  sb: Sb, uid: string, c: any, checks: PreflightCheck[], strategy: StrategyInput | null, settings: MetaSettings,
  manualReview = false, cats: string[] = [],
  extra: { advice?: AdviceItem[]; feePercent?: number; hasInstagram?: boolean; funding?: ReturnType<typeof fundingPlan> } = {},
) {
  const blocked = checks.some((ch) => ch.state === 'ACTION_REQUIRED');
  const status = manualReview ? 'MANUAL_REVIEW' : blocked ? 'NEEDS_CHANGES' : 'READY';
  let plan: TypedCampaignPlan | null = !blocked && strategy ? buildPlan(strategy, settings.strategyParams) : null;
  if (plan && extra.hasInstagram === false) plan = withoutInstagram(plan);
  const fingerprint = await configFingerprint(sb, c);
  const warnings = checks.filter((ch) => ch.state === 'WARNING').length;
  const feePercent = extra.feePercent ?? settings.feePercent;
  await sb.from('meta_campaigns').update({
    special_ad_categories: cats,
    objective: strategy ? GOAL_SPECS[strategy.goal].objective : null,
    preflight: {
      status, checks, warnings, fingerprint, checked_at: new Date().toISOString(),
      advice: extra.advice ?? [], strategy: plan?.strategy ?? null, funding: extra.funding ?? null,
    },
    plan, plan_version: plan ? STRATEGY_VERSION : null,
    status,
  }).eq('id', c.id);
  await sb.from('meta_funnel_events').insert({ event: 'preflight_completed', user_id: uid });
  const totals = strategy ? computeTotals(strategy.dailyBudgetCents, strategy.durationDays, feePercent) : null;
  return { status, checks, warnings, totals, advice: extra.advice ?? [], strategy: plan?.strategy ?? null, funding: extra.funding ?? null, feePercent };
}

async function probeUrl(url: string): Promise<'OK' | 'UNREACHABLE' | 'HTTP_ERROR'> {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(5000) });
    return res.status < 400 ? 'OK' : 'HTTP_ERROR';
  } catch {
    return 'UNREACHABLE';
  }
}

/* ── PUBLISH ────────────────────────────────────────────────────────── */

export async function publishCampaign(sb: Sb, uid: string, c: any, plan: TypedCampaignPlan, mode: MetaMode, settings: MetaSettings) {
  if (mode === 'MOCK') {
    // Clearly-mock externals; nothing is ever reported as delivering.
    const campaignId = mockExternalId('camp');
    for (const set of plan.adSets) {
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'AD_SET', external_id: mockExternalId('adset'),
        name: `TEST ${set.key}`, status: 'MOCK', config: set,
      });
      for (const crId of set.creativeIds) {
        await sb.from('meta_ad_entities').insert({
          campaign_id: c.id, kind: 'AD', external_id: mockExternalId('ad'),
          name: `TEST ad ${crId.slice(0, 6)}`, status: 'MOCK', config: { creativeId: crId },
        });
      }
    }
    return { campaignId, status: 'MOCK' };
  }

  const token = await userToken(sb, uid);
  if (!token) throw new MetaApiError(400, { error: { message: 'NOT_CONNECTED', code: 190 } });
  const [acct, page, ig, pixel, form, wa] = await Promise.all([
    selectedAsset(sb, uid, 'AD_ACCOUNT'), selectedAsset(sb, uid, 'PAGE'), selectedAsset(sb, uid, 'INSTAGRAM'),
    selectedAsset(sb, uid, 'PIXEL'), selectedAsset(sb, uid, 'LEAD_FORM'), selectedAsset(sb, uid, 'WHATSAPP'),
  ]);
  if (!acct || !page) throw new MetaApiError(400, { error: { message: 'ASSETS_MISSING', code: 100 } });
  const goal = c.goal as MetaGoal;
  const start = launchStartTime(Date.now(), c.start_at ?? null);
  const ctx: LaunchContext = {
    pageId: page.external_id,
    instagramUserId: ig?.external_id ?? null,
    pixelId: pixel?.external_id ?? null,
    leadFormId: await ownedFormId(sb, uid, c.destination?.formId, form),
    messagingApp: (c.destination?.messagingApp as MessagingApp) ?? (goal === 'MESSAGES' ? 'MESSENGER' : null),
    whatsappNumber: wa?.external_id ?? null,
    countries: plan.countries?.length ? plan.countries : settings.defaultCountries,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + Number(c.duration_days) * 86_400_000).toISOString(),
    websiteUrl: c.destination?.url ?? null,
  };
  const missing = missingRequirements(goal, ctx);
  if (missing.length) throw new MetaApiError(400, { error: { message: missing.join(','), code: 100 } });

  const auditCtx = { sb, userId: uid, campaignId: c.id };
  const created: string[] = [];
  try {
    // Media first: nothing is created at Meta until every asset is there.
    const { data: crRows } = await sb.from('meta_creatives').select('*').eq('campaign_id', c.id).order('sort');
    const launchCreatives = new Map<string, LaunchCreative>();
    for (const cr of crRows ?? []) {
      const m0 = cr.media?.[0];
      if (!m0?.path) continue;
      const isVideo = String(m0.mime ?? '').startsWith('video');
      let imageHash: string | null = null;
      let videoId: string | null = null;
      let thumbnailUrl: string | null = null;
      if (isVideo) {
        const { data: signed } = await sb.storage.from('meta-ads-media').createSignedUrl(m0.path, 3600);
        if (!signed?.signedUrl) throw new MetaApiError(500, { error: { message: 'MEDIA_UNAVAILABLE', code: 100 } });
        const v = await uploadVideo(acct.external_id, signed.signedUrl, { token, audit: auditCtx });
        videoId = v.videoId;
        thumbnailUrl = v.thumbnailUrl;
        if (!v.ready || !thumbnailUrl) throw new MetaApiError(400, { error: { message: 'VIDEO_STILL_PROCESSING', code: 2 } });
      } else {
        const { data: blob } = await sb.storage.from('meta-ads-media').download(m0.path);
        if (!blob) throw new MetaApiError(500, { error: { message: 'MEDIA_UNAVAILABLE', code: 100 } });
        imageHash = await uploadImage(acct.external_id, new Uint8Array(await blob.arrayBuffer()), m0.path.split('/').pop() ?? 'image', { token, audit: auditCtx });
      }
      launchCreatives.set(cr.id, {
        id: cr.id, kind: isVideo ? 'VIDEO' : 'IMAGE', imageHash, videoId, thumbnailUrl,
        primaryText: cr.primary_text ?? '', headline: cr.headline ?? '', description: cr.description ?? '', cta: cr.cta ?? null,
      });
    }

    const camp = await graph(`/${acct.external_id}/campaigns`, {
      token, method: 'POST', audit: auditCtx,
      body: campaignParams(plan, c.name || `HOMATCH ${goal} ${c.id.slice(0, 8)}`, ctx.countries),
    });
    const campaignId = String(camp.id);
    created.push(campaignId);
    /* Persist at once, so a crash from here on can still find and clean it —
       and with it the exact Meta objects this campaign is bound to, which is
       what Guard, sync and lead attribution compare against. */
    await sb.from('meta_campaigns').update({
      external_campaign_id: campaignId, ad_account_external_id: acct.external_id, page_external_id: page.external_id,
      instagram_external_id: ig?.external_id ?? null, lead_form_external_id: ctx.leadFormId,
    }).eq('id', c.id);

    for (const set of plan.adSets) {
      const adset = await graph(`/${acct.external_id}/adsets`, {
        token, method: 'POST', audit: auditCtx, body: adSetParams(goal, plan, set, ctx, campaignId),
      });
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'AD_SET', external_id: String(adset.id), name: `HOMATCH ${set.key}`, status: 'ACTIVE', config: set,
        parent_external_id: campaignId,
      });
      for (const crId of set.creativeIds) {
        const lc = launchCreatives.get(crId);
        if (!lc) continue;
        const creative = await graph(`/${acct.external_id}/adcreatives`, {
          token, method: 'POST', audit: auditCtx, body: creativeParams(goal, lc, ctx),
        });
        const ad = await graph(`/${acct.external_id}/ads`, {
          token, method: 'POST', audit: auditCtx,
          body: adParams(lc.headline || `HOMATCH ad ${crId.slice(0, 6)}`, String(adset.id), String(creative.id)),
        });
        await sb.from('meta_ad_entities').insert([
          { campaign_id: c.id, kind: 'CREATIVE', external_id: String(creative.id), config: { creativeId: crId, imageHash: lc.imageHash, videoId: lc.videoId }, local_creative_id: crId },
          { campaign_id: c.id, kind: 'AD', external_id: String(ad.id), status: 'PENDING_REVIEW', config: { creativeId: crId },
            parent_external_id: String(adset.id), creative_external_id: String(creative.id), local_creative_id: crId },
        ]);
        await sb.from('meta_creatives').update({ external_creative_id: String(creative.id) }).eq('id', crId);
      }
    }
    // The one act that starts delivery.
    await graph(`/${campaignId}`, { token, method: 'POST', body: { status: 'ACTIVE' }, audit: auditCtx });
    return { campaignId, status: 'SUBMITTED', requestedStartAt: ctx.startTime };
  } catch (err) {
    // Tear down what was created, so a retry never leaves orphans at Meta.
    for (const id of created) {
      try { await graph(`/${id}`, { token, method: 'DELETE', attempts: 1 }); } catch { /* recorded below */ }
    }
    throw err;
  }
}

/* ── SYNC + SETTLEMENT ──────────────────────────────────────────────── */

export async function syncCampaign(sb: Sb, c: any, mode: MetaMode) {
  if (!c.external_campaign_id) return { ok: false, reason: 'NOT_LAUNCHED' };
  if (mode === 'MOCK' || String(c.external_campaign_id).startsWith('mock_')) {
    await sb.from('meta_campaigns').update({ last_synced_at: new Date().toISOString() }).eq('id', c.id);
    return { ok: true, mode: 'MOCK', results: null, status: c.status };
  }
  const token = await userToken(sb, c.user_id);
  if (!token) {
    await sb.from('meta_campaigns').update({ last_error: { key: 'meta_err_reconnect', code: 'TOKEN_UNAVAILABLE' } }).eq('id', c.id);
    return { ok: false, reason: 'NOT_CONNECTED' };
  }
  const auditCtx = { sb, userId: c.user_id, campaignId: c.id };
  const info = await graph(`/${c.external_campaign_id}?fields=status,effective_status,start_time,stop_time`, { token, audit: auditCtx });
  const ads = await graphAll(`/${c.external_campaign_id}/ads?fields=id,effective_status,ad_review_feedback`, { token, audit: auditCtx }, 3);
  const insights = await graph(`/${c.external_campaign_id}/insights?fields=spend,impressions,reach,clicks,actions&date_preset=maximum`, { token, audit: auditCtx });
  const row = (insights.data as any[])?.[0] ?? null;

  // From the start HOMATCH requested (older launches: launched_at), never from local time alone.
  const startedFrom = c.plan?.requestedStartAt ?? c.launched_at;
  const endTime = startedFrom ? Date.parse(startedFrom) + Number(c.duration_days) * 86_400_000 + 10 * 60_000 : NaN;
  const verdict = mapMetaStatus({
    campaign: String(info.effective_status ?? info.status ?? ''),
    ads: ads.map((a) => String(a.effective_status ?? '')),
    endTimePassed: Number.isFinite(endTime) && Date.now() > endTime,
  });
  for (const ad of ads) {
    await sb.from('meta_ad_entities').update({
      status: String(ad.effective_status ?? ''), metrics: ad.ad_review_feedback ? { review: ad.ad_review_feedback } : null,
      updated_at: new Date().toISOString(),
    }).eq('campaign_id', c.id).eq('kind', 'AD').eq('external_id', String(ad.id));
  }

  /* Meta's own start time is kept apart from HOMATCH's requested one
     (plan.requestedStartAt): what was asked for vs what Meta holds. */
  const results = {
    ...(row ? { spend: row.spend, impressions: row.impressions, reach: row.reach, clicks: row.clicks, actions: row.actions } : {}),
    meta_start_time: info.start_time ?? null,
    fetched_at: new Date().toISOString(),
    has_delivery: !!row,
  };
  const spendCents = row ? Math.round(parseFloat(row.spend ?? '0') * 100) : Number(c.spend_cents ?? 0);
  const review = ads.map((a) => a.ad_review_feedback).find(Boolean) ?? null;

  const patch: Record<string, unknown> = {
    external_status: String(info.effective_status ?? info.status ?? ''),
    results, spend_cents: spendCents, last_synced_at: new Date().toISOString(),
    status: verdict.status === 'SUBMITTED' ? c.status : verdict.status,
    last_error: verdict.status === 'REJECTED'
      ? { key: 'meta_err_rejected', code: 'DISAPPROVED', review }
      : verdict.issue ? { key: verdict.issue === 'WITH_ISSUES' ? 'meta_err_with_issues' : 'meta_err_partially_rejected', code: verdict.issue, review } : null,
  };
  /* A campaign that stopped delivering is ENDED now, but its money settles
     only after SETTLEMENT_GRACE_DAYS: Meta keeps attributing spend for a
     while, and a fee released on a spend figure that later grows cannot be
     taken back. The maintenance pass settles it from the final figure. */
  const stopped = ['COMPLETED', 'REJECTED', 'ARCHIVED'].includes(String(patch.status));
  if (stopped && !c.ended_at) patch.ended_at = new Date().toISOString();
  await sb.from('meta_campaigns').update(patch).eq('id', c.id);
  if (stopped && settlementDue({ ...c, ...patch })) await settleCampaign(sb, { ...c, ...patch }, spendCents);
  return { ok: true, results, status: patch.status, external_status: patch.external_status, issue: verdict.issue };
}

/**
 * The light, frequent check, GROUPED BY AD ACCOUNT: two Graph reads per
 * account (its campaigns' status, its ads' review/delivery state, filtered to
 * the live campaign ids) however many live campaigns it holds. Each campaign
 * is then mapped exactly as the full sync maps it, and written only when it
 * differs — plus its own last_synced_at, which is what "last checked" means.
 */
export async function reconcileAccountStatuses(sb: Sb, token: string, account: string, rows: any[]): Promise<Array<{ id: string; before: string; status: string; changed: boolean }>> {
  const act = String(account).startsWith('act_') ? String(account) : `act_${account}`;
  const ids = rows.map((c) => String(c.external_campaign_id));
  const auditCtx = { sb, userId: rows[0]?.user_id ?? null, campaignId: null };
  const filter = (field: string) => encodeURIComponent(JSON.stringify([{ field, operator: 'IN', value: ids }]));
  const camps = await graphAll(`/${act}/campaigns?fields=id,status,effective_status&filtering=${filter('id')}&limit=500`, { token, audit: auditCtx, attempts: 2 }, 3);
  const ads = await graphAll(`/${act}/ads?fields=id,campaign_id,effective_status&filtering=${filter('campaign.id')}&limit=500`, { token, audit: auditCtx, attempts: 2 }, 5);
  const byId = new Map(camps.map((x) => [String(x.id), x]));
  const out: Array<{ id: string; before: string; status: string; changed: boolean }> = [];
  for (const c of rows) {
    const info = byId.get(String(c.external_campaign_id));
    if (!info) continue; // not returned (deleted / no access): the 15-minute sync decides
    const mine = ads.filter((a) => String(a.campaign_id) === String(c.external_campaign_id));
    out.push({ id: c.id, before: c.status, ...(await applyStatus(sb, c, info, mine)) });
  }
  return out;
}

/** One campaign's Meta answer (campaign + its ads) → its HOMATCH status. */
export async function applyStatus(sb: Sb, c: any, info: Record<string, unknown>, ads: Record<string, unknown>[]): Promise<{ changed: boolean; status: string }> {
  const startedFrom = c.plan?.requestedStartAt ?? c.launched_at;
  const endTime = startedFrom ? Date.parse(startedFrom) + Number(c.duration_days) * 86_400_000 + 10 * 60_000 : NaN;
  const verdict = mapMetaStatus({
    campaign: String(info.effective_status ?? info.status ?? ''),
    ads: ads.map((a) => String(a.effective_status ?? '')),
    endTimePassed: Number.isFinite(endTime) && Date.now() > endTime,
  });
  const status = verdict.status === 'SUBMITTED' ? c.status : verdict.status;
  for (const ad of ads) {
    await sb.from('meta_ad_entities').update({ status: String(ad.effective_status ?? ''), updated_at: new Date().toISOString() })
      .eq('campaign_id', c.id).eq('kind', 'AD').eq('external_id', String(ad.id));
  }
  const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString(), external_status: String(info.effective_status ?? info.status ?? '') };
  if (status !== c.status) {
    patch.status = status;
    if (['COMPLETED', 'REJECTED', 'ARCHIVED'].includes(status) && !c.ended_at) patch.ended_at = new Date().toISOString();
  }
  await sb.from('meta_campaigns').update(patch).eq('id', c.id);
  return { changed: status !== c.status, status };
}

export const SETTLEMENT_GRACE_DAYS = 3;

/**
 * The grace period is over: read Meta's FINAL lifetime spend (status is not
 * touched — an ended campaign stays ended) and settle from it. Without a
 * usable token the settlement waits; it is never done on a guessed figure.
 */
export async function finalizeSettlement(sb: Sb, c: any, mode: MetaMode) {
  if (!settlementDue(c)) return { settled: false, reason: 'NOT_DUE' };
  let spendCents = Number(c.spend_cents ?? 0);
  if (mode === 'REAL' && c.external_campaign_id && !String(c.external_campaign_id).startsWith('mock_')) {
    const token = await userToken(sb, c.user_id);
    if (!token) return { settled: false, reason: 'NOT_CONNECTED' };
    const insights = await graph(`/${c.external_campaign_id}/insights?fields=spend&date_preset=maximum`, { token, audit: { sb, userId: c.user_id, campaignId: c.id } });
    const row = (insights.data as any[])?.[0] ?? null;
    if (row) spendCents = Math.round(parseFloat(row.spend ?? '0') * 100);
    await sb.from('meta_campaigns').update({ spend_cents: spendCents }).eq('id', c.id);
  }
  const r = await settleCampaign(sb, { ...c, spend_cents: spendCents }, spendCents);
  return { settled: true, spendCents, result: r };
}

export function settlementDue(c: { ended_at?: string | null; settled_at?: string | null }, now = Date.now()): boolean {
  if (c.settled_at || !c.ended_at) return false;
  return now - Date.parse(c.ended_at) >= SETTLEMENT_GRACE_DAYS * 86_400_000;
}

/** Idempotent: the settlement keys are per campaign, so it posts exactly once. */
export async function settleCampaign(sb: Sb, c: any, actualSpendCents: number) {
  const { data: rows } = await sb.from('meta_ads_ledger').select('entry_type,amount_cents,idempotency_key').eq('campaign_id', c.id);
  /* What is still HELD for this campaign: every attempt's reserve and fee,
     minus what failed attempts already gave back under their own keys
     (`<attempt>:release` / `<attempt>:feerefund`). Settlement rows use the
     campaign-level `<campaign>:settle:*` keys and are never counted here. */
  const key = (r: any) => String(r.idempotency_key ?? '');
  const isSettle = (r: any) => key(r).startsWith(`${c.id}:settle:`);
  const sum = (pred: (r: any) => boolean) => (rows ?? []).filter(pred).reduce((n: number, r: any) => n + Number(r.amount_cents), 0);
  const reserve = -sum((r) => r.entry_type === 'RESERVE')
    - sum((r) => r.entry_type === 'RELEASE' && !isSettle(r) && key(r).endsWith(':release'));
  const fee = -sum((r) => r.entry_type === 'HOMATCH_FEE')
    - sum((r) => r.entry_type === 'REFUND' && !isSettle(r) && key(r).endsWith(':feerefund'))
    - sum((r) => r.entry_type === 'FEE_RELEASE' && !isSettle(r));
  const released = (rows ?? []).some((r: any) => key(r) === `${c.id}:settle:release`);
  const base = { user_id: c.user_id, currency: c.currency, campaign_id: c.id };

  /* CUSTOMER_AD_ACCOUNT: Meta billed the customer's ad account, nothing was
     reserved here. Only the service fee is reconciled: every fee this
     campaign holds (launch + budget increases, less releases already made)
     against the fee on what Meta actually spent. The rest is RELEASED to the
     available HOMATCH balance — reusable, never a cash refund. */
  if (reserve <= 0) {
    const feeSettled = (rows ?? []).some((r: any) => key(r) === `${c.id}:settle:fee_release` || key(r) === `${c.id}:settle:feerefund`);
    const held = heldFeeFromLedger(rows ?? []);
    if (held <= 0 || feeSettled || c.settled_at) {
      if (!c.settled_at && held <= 0) await sb.from('meta_campaigns').update({ settled_at: new Date().toISOString() }).eq('id', c.id);
      return null;
    }
    const planned = plannedMediaCents(Number(c.daily_budget_cents ?? 0), Number(c.duration_days ?? 0));
    const pct = c.fee_percent != null && Number.isFinite(Number(c.fee_percent)) ? Number(c.fee_percent)
      : planned > 0 ? Math.round((held / planned) * 10000) / 100 : null;
    // No percent and no plan to derive it from: never settle on a guess.
    if (pct == null) return null;
    const f = settleServiceFee({ heldFeeCents: held, plannedMediaCents: planned, spentMediaCents: actualSpendCents, feePercent: pct });
    if (f.releaseCents > 0) {
      const { error } = await sb.from('meta_ads_ledger').insert({
        ...base, entry_type: 'FEE_RELEASE', amount_cents: f.releaseCents,
        idempotency_key: `${c.id}:settle:fee_release`, note: 'released to HOMATCH balance: budget Meta did not spend',
      });
      if (error && !String(error.message).includes('duplicate')) throw error;
    }
    await sb.from('meta_campaigns').update({ settled_at: new Date().toISOString() }).eq('id', c.id);
    return f;
  }

  if (released) return null;
  const s = settlement(reserve, fee, actualSpendCents);
  const inserts = [
    { ...base, entry_type: 'RELEASE', amount_cents: s.releaseCents, idempotency_key: `${c.id}:settle:release`, note: 'campaign closed' },
    ...(s.spendCents > 0 ? [{ ...base, entry_type: 'META_SPEND', amount_cents: -s.spendCents, idempotency_key: `${c.id}:settle:spend`, note: 'Meta-reported spend' }] : []),
    ...(s.feeRefundCents > 0 ? [{ ...base, entry_type: 'REFUND', amount_cents: s.feeRefundCents, idempotency_key: `${c.id}:settle:feerefund`, note: 'fee on unspent budget' }] : []),
  ];
  for (const row of inserts) {
    const { error } = await sb.from('meta_ads_ledger').insert(row);
    if (error && !String(error.message).includes('duplicate')) throw error;
  }
  await sb.from('meta_campaigns').update({ settled_at: new Date().toISOString() }).eq('id', c.id);
  return s;
}

/* ── PROPERTY AUTHORITY ──────────────────────────────────────────────────
   A campaign may promote a property only its owner manages. property_id is
   whatever the builder stored (the permanent six-digit id or the uuid); a
   campaign with no property is a general promotion and needs no check. */
export async function propertyAuthorized(sb: Sb, uid: string, propertyId: unknown): Promise<boolean> {
  const pid = String(propertyId ?? '').trim();
  if (!pid) return true;
  const isUuid = /^[0-9a-f-]{36}$/i.test(pid);
  const q = sb.from('properties').select('id').eq('user_id', uid).eq('is_deleted', false).limit(1);
  const { data } = isUuid ? await q.eq('id', pid) : await q.eq('homatch_id', pid);
  return (data ?? []).length > 0;
}

export { computeTotals, metaMode };
