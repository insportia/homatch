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
  buildPlan, validatePlanInput, computeTotals, classifySpecialAdCategories, STRATEGY_VERSION,
  type MetaGoal, type StrategyInput, type TypedCampaignPlan,
} from '../../../src/lib/metaAds/strategy.ts';
import {
  GOAL_SPECS, adSetParams, adParams, campaignParams, creativeParams, missingRequirements, mapMetaStatus,
  settlement, checkMedia, recommendedPlacements, PLACEMENTS, isHttpsUrl,
  type LaunchContext, type LaunchCreative, type MessagingApp, type Placement,
  feeOnlySettlement, launchCharge, parseBudgetBilling, type BudgetBilling,
} from '../../../src/lib/metaAds/payload.ts';
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
  };
}

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
  const { data: creatives } = await sb.from('meta_creatives')
    .select('id,kind,safety_status,media').eq('campaign_id', c.id).order('sort');
  let audienceExternalId: string | null = null;
  if (c.audience_id) {
    const { data: aud } = await sb.from('meta_audiences').select('external_audience_id,sync_status,user_id')
      .eq('id', c.audience_id).maybeSingle();
    if (!aud || aud.user_id !== uid) return { error: 'AUDIENCE_NOT_FOUND' };
    if (aud.sync_status !== 'READY') return { error: 'AUDIENCE_NOT_READY' };
    audienceExternalId = aud.external_audience_id;
  }
  const cats = classifySpecialAdCategories({
    isProperty: !!c.property_id || !!(c.offer && c.offer.isProperty !== false),
    dealKind: c.offer?.dealKind ?? (c.property_id ? 'SALE' : 'OTHER'),
  });
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
      })),
      destination: c.destination ?? { type: c.goal === 'LEADS_ON_META' ? 'META_FORM' : 'WEBSITE' },
      audienceExternalId,
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
    .select('id,updated_at,headline,primary_text,description,cta,media').eq('campaign_id', c.id).order('id');
  const material = JSON.stringify({
    goal: c.goal, daily: c.daily_budget_cents, days: c.duration_days, currency: c.currency,
    destination: c.destination, placements: c.placements, audience: c.audience_id,
    offer: c.offer, property: c.property_id,
    creatives: (creatives ?? []).map((cr: any) => [cr.id, cr.headline, cr.primary_text, cr.description ?? '', cr.cta, cr.media]),
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

  const planIssues = validatePlanInput(input.strategy, limitsOf(settings));
  add('budget', planIssues.some((i) => i.field === 'dailyBudgetCents') ? 'ACTION_REQUIRED' : 'READY',
    planIssues.filter((i) => i.field === 'dailyBudgetCents').map((i) => i.code).join(',') || undefined);
  add('duration', planIssues.some((i) => i.field === 'durationDays') ? 'ACTION_REQUIRED' : 'READY',
    planIssues.some((i) => i.field === 'durationDays') ? `MIN_${settings.minDurationDays}_DAYS` : undefined);

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
  let manualReview = false;
  let creativeState: CheckState = (creatives ?? []).length ? 'READY' : 'ACTION_REQUIRED';
  const creativeDetail: string[] = (creatives ?? []).length ? [] : ['CREATIVE_REQUIRED'];
  for (const cr of creatives ?? []) {
    const text = `${cr.headline}\n${cr.primary_text}\n${cr.description ?? ''}`;
    const flags: string[] = [];
    if (BANNED_CLAIMS.test(text)) flags.push('CLAIM_GUARANTEE');
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
    const status = flags.includes('CLAIM_GUARANTEE') ? 'MANUAL_REVIEW' : flags.length ? 'NEEDS_CHANGES' : 'READY';
    if (status !== 'READY') { creativeState = 'ACTION_REQUIRED'; creativeDetail.push(...flags); }
    if (status === 'MANUAL_REVIEW') manualReview = true;
    await sb.from('meta_creatives').update({
      safety_status: status, safety: { flags, checked_at: new Date().toISOString() },
    }).eq('id', cr.id);
    if (status === 'MANUAL_REVIEW') {
      await sb.from('meta_moderation_cases').insert({
        user_id: uid, campaign_id: c.id, creative_id: cr.id,
        reason: flags.join(','), severity: 'HIGH', findings: { flags }, status: 'OPEN',
      });
    }
  }
  add('creatives', creativeState, [...new Set(creativeDetail)].join(',') || undefined);

  const cats = input.strategy.specialAdCategories;
  add('policy_classified', 'READY', cats.join(',') || 'NONE');

  // Money: shown now, enforced at launch.
  const totals = computeTotals(input.strategy.dailyBudgetCents, input.strategy.durationDays, settings.feePercent);
  const { data: wallet } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', uid).maybeSingle();
  const available = Number(wallet?.available_cents ?? 0);
  /* Only what HOMATCH itself will hold must be in the balance: with the
     customer's own ad account that is the fee, and Meta bills the budget. */
  const required = launchCharge(totals, settings.budgetBilling).requiredCents;
  add('balance', available >= required ? 'READY' : 'WARNING', available >= required ? undefined : `SHORT_${required - available}`);

  return finish(sb, uid, c, checks, input.strategy, settings, manualReview, cats);
}

async function finish(
  sb: Sb, uid: string, c: any, checks: PreflightCheck[], strategy: StrategyInput | null, settings: MetaSettings,
  manualReview = false, cats: string[] = [],
) {
  const blocked = checks.some((ch) => ch.state === 'ACTION_REQUIRED');
  const status = manualReview ? 'MANUAL_REVIEW' : blocked ? 'NEEDS_CHANGES' : 'READY';
  const plan: TypedCampaignPlan | null = !blocked && strategy ? buildPlan(strategy) : null;
  const fingerprint = await configFingerprint(sb, c);
  const warnings = checks.filter((ch) => ch.state === 'WARNING').length;
  await sb.from('meta_campaigns').update({
    special_ad_categories: cats,
    objective: strategy ? GOAL_SPECS[strategy.goal].objective : null,
    preflight: { status, checks, warnings, fingerprint, checked_at: new Date().toISOString() },
    plan, plan_version: plan ? STRATEGY_VERSION : null,
    status,
  }).eq('id', c.id);
  await sb.from('meta_funnel_events').insert({ event: 'preflight_completed', user_id: uid });
  const totals = strategy ? computeTotals(strategy.dailyBudgetCents, strategy.durationDays, settings.feePercent) : null;
  return { status, checks, warnings, totals };
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
  const start = new Date(Date.now() + 5 * 60_000);
  const ctx: LaunchContext = {
    pageId: page.external_id,
    instagramUserId: ig?.external_id ?? null,
    pixelId: pixel?.external_id ?? null,
    leadFormId: await ownedFormId(sb, uid, c.destination?.formId, form),
    messagingApp: (c.destination?.messagingApp as MessagingApp) ?? (goal === 'MESSAGES' ? 'MESSENGER' : null),
    whatsappNumber: wa?.external_id ?? null,
    countries: settings.defaultCountries,
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
      body: campaignParams(plan, c.name || `HOMATCH ${goal} ${c.id.slice(0, 8)}`, settings.defaultCountries),
    });
    const campaignId = String(camp.id);
    created.push(campaignId);
    // Persist at once, so a crash from here on can still find and clean it.
    await sb.from('meta_campaigns').update({ external_campaign_id: campaignId }).eq('id', c.id);

    for (const set of plan.adSets) {
      const adset = await graph(`/${acct.external_id}/adsets`, {
        token, method: 'POST', audit: auditCtx, body: adSetParams(goal, plan, set, ctx, campaignId),
      });
      await sb.from('meta_ad_entities').insert({
        campaign_id: c.id, kind: 'AD_SET', external_id: String(adset.id), name: `HOMATCH ${set.key}`, status: 'ACTIVE', config: set,
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
          { campaign_id: c.id, kind: 'CREATIVE', external_id: String(creative.id), config: { creativeId: crId, imageHash: lc.imageHash, videoId: lc.videoId } },
          { campaign_id: c.id, kind: 'AD', external_id: String(ad.id), status: 'PENDING_REVIEW', config: { creativeId: crId } },
        ]);
        await sb.from('meta_creatives').update({ external_creative_id: String(creative.id) }).eq('id', crId);
      }
    }
    // The one act that starts delivery.
    await graph(`/${campaignId}`, { token, method: 'POST', body: { status: 'ACTIVE' }, audit: auditCtx });
    return { campaignId, status: 'SUBMITTED' };
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
  const info = await graph(`/${c.external_campaign_id}?fields=status,effective_status,stop_time`, { token, audit: auditCtx });
  const ads = await graphAll(`/${c.external_campaign_id}/ads?fields=id,effective_status,ad_review_feedback`, { token, audit: auditCtx }, 3);
  const insights = await graph(`/${c.external_campaign_id}/insights?fields=spend,impressions,reach,clicks,actions&date_preset=maximum`, { token, audit: auditCtx });
  const row = (insights.data as any[])?.[0] ?? null;

  const endTime = c.launched_at ? Date.parse(c.launched_at) + Number(c.duration_days) * 86_400_000 + 10 * 60_000 : NaN;
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

  const results = row ? {
    spend: row.spend, impressions: row.impressions, reach: row.reach,
    clicks: row.clicks, actions: row.actions, fetched_at: new Date().toISOString(),
  } : null;
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
  await sb.from('meta_campaigns').update(patch).eq('id', c.id);

  if (verdict.status === 'COMPLETED' || verdict.status === 'REJECTED' || verdict.status === 'ARCHIVED') {
    await settleCampaign(sb, c, spendCents);
  }
  return { ok: true, results, status: patch.status, external_status: patch.external_status, issue: verdict.issue };
}

/** Idempotent: the settlement keys are per campaign, so it posts exactly once. */
export async function settleCampaign(sb: Sb, c: any, actualSpendCents: number) {
  const { data: rows } = await sb.from('meta_ads_ledger').select('entry_type,amount_cents,idempotency_key').eq('campaign_id', c.id);
  const reserve = -(rows ?? []).filter((r: any) => r.entry_type === 'RESERVE').reduce((s: number, r: any) => s + Number(r.amount_cents), 0);
  const fee = -(rows ?? []).filter((r: any) => r.entry_type === 'HOMATCH_FEE').reduce((s: number, r: any) => s + Number(r.amount_cents), 0);
  const released = (rows ?? []).some((r: any) => String(r.idempotency_key ?? '').endsWith(':release'));
  const base = { user_id: c.user_id, currency: c.currency, campaign_id: c.id };

  /* CUSTOMER_AD_ACCOUNT: Meta billed the customer's ad account, nothing was
     reserved here. Only the fee is reconciled, against the PLANNED budget. */
  if (reserve <= 0) {
    const feeSettled = (rows ?? []).some((r: any) => String(r.idempotency_key ?? '').endsWith(':settle:feerefund'));
    if (fee <= 0 || feeSettled || c.settled_at) return null;
    const daily = Array.isArray(c.plan?.adSets)
      ? c.plan.adSets.reduce((n: number, a: { dailyBudgetCents: number }) => n + Number(a.dailyBudgetCents), 0) : 0;
    const planned = computeTotals(daily, Number(c.duration_days), 0).mediaCents;
    const f = feeOnlySettlement(planned, fee, actualSpendCents);
    if (f.feeRefundCents > 0) {
      const { error } = await sb.from('meta_ads_ledger').insert({
        ...base, entry_type: 'REFUND', amount_cents: f.feeRefundCents,
        idempotency_key: `${c.id}:settle:feerefund`, note: 'fee on budget Meta did not spend',
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

export { computeTotals, metaMode };
