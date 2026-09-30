// META ADS — the managed-campaign actions: location search, the Smart
// Strategy preview, write-through edits (budget, duration, end, pause,
// resume), recommendations (apply / dismiss / remind), the campaign drill-down
// and the global dashboard, premium lead forms, and the admin controls for
// Guard, service-fee policy and notification/AI economics.
//
// Every customer action is scoped to the caller's own rows (IDOR: the row is
// always read with `.eq('user_id', uid)`); every admin action checks is_admin
// and writes an audit row with a reason. Nothing here reports a Meta change
// done before Meta confirmed it — that is lifecycle.ts.

import { buildPlan, validatePlanInput, type MetaGoal } from '../../../src/lib/metaAds/strategy.ts';
import { applyTargeting, targetingConstraints, validateTargeting, MAX_LOCATIONS } from '../../../src/lib/metaAds/targeting.ts';
import { creativeAdvice } from '../../../src/lib/metaAds/creativeAdvice.ts';
import { fundingPlan, heldFeeFromLedger, LEDGER_LABEL_KEY } from '../../../src/lib/metaAds/billing.ts';
import { kpis, sumTotals, totalsByCurrency, emptyTotals, type MetricTotals } from '../../../src/lib/metaAds/kpi.ts';
import { recommendedPlacements, type Placement } from '../../../src/lib/metaAds/payload.ts';
import { validateLeadFormSpec, leadFormPayload, leadFormPreview, META_LOCALE, type LeadFormSpec } from '../../../src/lib/metaAds/leadForms.ts';
import { graph, MetaApiError, mockExternalId, hasScopes, INSTANT_FORM_SCOPES, type MetaMode } from '../_shared/metaAds.ts';
import {
  userToken, selectedAsset, pageToken, strategyInputFor, limitsOf, customerFeePercent, withoutInstagram, type MetaSettings,
} from './engine.ts';
import {
  LifecycleError, setCampaignStatus, endCampaign, changePlan, setAdStatus, readManagedState, setApproved, recordOp, finishOp, timeline,
} from './lifecycle.ts';
import { refreshAccount } from './guardSync.ts';
import { analyzeCampaign, QUALIFIED, VIEWED } from './intelligence.ts';
import { lifecycleEvent } from './monitor.ts';

type Sb = any;
type Json = (b: unknown, s?: number) => Response;

export interface ActionCtx {
  sb: Sb; uid: string; me: { id: string; is_admin?: boolean; email?: string | null };
  body: Record<string, any>; action: string; settings: MetaSettings; mode: MetaMode; json: Json;
  audit: (sb: Sb, actorId: string | null, action: string, target: string, meta: unknown) => Promise<void>;
}

const UUID = /^[0-9a-f-]{36}$/i;
const ownCampaign = async (sb: Sb, uid: string, id: unknown) => {
  if (!UUID.test(String(id ?? ''))) return null;
  const { data } = await sb.from('meta_campaigns').select('*').eq('id', String(id)).eq('user_id', uid).maybeSingle();
  return data ?? null;
};
const keyOf = (body: Record<string, any>) => (UUID.test(String(body.idempotencyKey ?? '')) ? String(body.idempotencyKey) : null);

/** Customer-safe campaign fields: no approved-state internals, no raw Meta errors. */
function publicCampaign(c: any) {
  return {
    id: c.id, name: c.name, goal: c.goal, status: c.status, currency: c.currency, property_id: c.property_id,
    daily_budget_cents: c.daily_budget_cents, duration_days: c.duration_days, launched_at: c.launched_at, ended_at: c.ended_at,
    settled_at: c.settled_at, spend_cents: c.spend_cents, targeting: c.targeting, placements: c.placements, destination: c.destination,
    fee_percent: c.fee_percent, guard_state: c.guard_state, health: c.health, summary: c.summary, summary_at: c.summary_at,
    last_synced_at: c.last_synced_at, insights_synced_at: c.insights_synced_at, external_status: c.external_status,
    last_error_key: c.last_error?.key ?? null, strategy: c.plan?.strategy ?? null, plan_version: c.plan_version,
    ad_set_count: Array.isArray(c.plan?.adSets) ? c.plan.adSets.length : 0,
  };
}

function lifecycleResponse(json: Json, err: unknown): Response | null {
  if (err instanceof LifecycleError) return json({ error: err.code, code: err.code, ...err.extra }, err.status);
  return null;
}

/* ── COUNTRIES: the full ISO list, named in the customer's language ──── */
const ISO2 = 'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IS IT JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SE SG SI SK SL SM SN SO SR SS ST SV SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VC VE VG VN VU WS XK YE ZA ZM ZW'.split(' ');

function countryMatches(q: string, locale: string) {
  let names: Intl.DisplayNames | null = null;
  let en: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: 'region' }); en = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* fallback below */ }
  const needle = q.trim().toLowerCase();
  return ISO2.map((code) => ({ code, name: names?.of(code) ?? code, en: en?.of(code) ?? code }))
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.en.toLowerCase().includes(needle) || c.code.toLowerCase() === needle)
    .slice(0, 20)
    .map((c) => ({ type: 'country', key: c.code, name: c.name, countryCode: c.code }));
}

export async function handleAction(x: ActionCtx): Promise<Response | null> {
  const { sb, uid, me, body, action, settings, mode, json } = x;
  try {
    switch (action) {
      /* ── LOCATIONS: Meta's own targeting catalogue ──────────────────── */
      case 'geo_search': {
        const q = String(body.q ?? '').trim().slice(0, 80);
        const type = ['country', 'region', 'city'].includes(body.type) ? String(body.type) : 'city';
        const locale = String(body.locale ?? 'en').slice(0, 5);
        if (type === 'country') return json({ results: countryMatches(q, locale) });
        if (q.length < 2) return json({ results: [] });
        if (mode === 'MOCK') return json({ results: [], mode, reason: 'MOCK_MODE_NO_META_CATALOGUE' });
        const token = await userToken(sb, uid);
        if (!token) return json({ error: 'NOT_CONNECTED', code: 'NOT_CONNECTED' }, 400);
        const country = /^[A-Z]{2}$/.test(String(body.country ?? '')) ? String(body.country) : null;
        const params = new URLSearchParams({ type: 'adgeolocation', q, location_types: JSON.stringify([type]), limit: '20', locale: `${locale}_${locale.toUpperCase()}` });
        if (country) params.set('country_code', country);
        const res = await graph(`/search?${params.toString()}`, { token, attempts: 2 });
        const rows = ((res.data as any[]) ?? []).filter((r) => r.supports_region !== false || type !== 'region');
        return json({
          results: rows.map((r) => ({
            type, key: String(r.key), name: String(r.name ?? ''), countryCode: String(r.country_code ?? ''),
            region: r.region ?? null, countryName: r.country_name ?? null,
          })),
        });
      }

      /* ── SMART STRATEGY PREVIEW ─────────────────────────────────────── */
      case 'strategy_preview': {
        const c = await ownCampaign(sb, uid, body.campaignId);
        if (!c) return json({ error: 'not found' }, 404);
        const input = await strategyInputFor(sb, uid, c, settings);
        if ('error' in input) return json(input, 400);
        const issues = [...validatePlanInput(input.strategy, limitsOf(settings)), ...validateTargeting(input.strategy.targeting!).map((i) => ({ code: i.code, field: i.field }))];
        const ig = await selectedAsset(sb, uid, 'INSTAGRAM');
        let plan = issues.length === 0 ? buildPlan(input.strategy, settings.strategyParams) : null;
        if (plan && !ig) plan = withoutInstagram(plan);
        const { data: crs } = await sb.from('meta_creatives').select('id,media,headline,primary_text').eq('campaign_id', c.id).order('sort');
        const goal = c.goal as MetaGoal;
        const placements: Placement[] = input.strategy.placementsMode === 'CUSTOM'
          ? (input.strategy.customPlacements ?? []) as Placement[]
          : recommendedPlacements({ hasInstagram: !!ig, hasVideo: (crs ?? []).some((cr: any) => String(cr.media?.[0]?.mime ?? '').startsWith('video')), goal });
        const advice = creativeAdvice((crs ?? []).map((cr: any) => ({ id: cr.id, media: cr.media ?? [], headline: cr.headline, primaryText: cr.primary_text })),
          { goal, placements, recommendedCreativeCount: plan?.strategy.recommendedCreativeCount ?? null });
        const feePercent = await customerFeePercent(sb, uid, settings);
        const { data: wallet } = await sb.from('meta_wallet_balances').select('available_cents').eq('user_id', uid).maybeSingle();
        const funding = fundingPlan({ dailyBudgetCents: input.strategy.dailyBudgetCents, durationDays: input.strategy.durationDays, feePercent, availableCents: Number(wallet?.available_cents ?? 0) });
        const applied = applyTargeting(input.strategy.targeting!, input.strategy.specialAdCategories);
        return json({
          issues, strategy: plan?.strategy ?? null, funding, advice,
          adSets: plan?.adSets.map((s) => ({ key: s.key, dailyBudgetCents: s.dailyBudgetCents, creativeCount: s.creativeIds.length, segment: s.segment ?? null, placements: s.placements ?? null })) ?? [],
          targeting: { effective: applied.effective, adjustments: applied.adjustments, constraints: targetingConstraints(input.strategy.specialAdCategories), maxLocations: MAX_LOCATIONS },
        });
      }

      /* ── WRITE-THROUGH LIFECYCLE ────────────────────────────────────── */
      case 'pause': case 'resume': {
        const c = await ownCampaign(sb, uid, body.campaignId);
        if (!c) return json({ error: 'not found' }, 404);
        const r = await setCampaignStatus(sb, c, action === 'pause' ? 'PAUSED' : 'ACTIVE', { actor: 'CUSTOMER', actorUserId: uid, key: keyOf(body) });
        await x.audit(sb, uid, `META_CAMPAIGN_${action.toUpperCase()}`, c.id, {});
        return json({ ok: true, ...r });
      }

      case 'end': {
        const c = await ownCampaign(sb, uid, body.campaignId);
        if (!c) return json({ error: 'not found' }, 404);
        const r = await endCampaign(sb, c, { actor: 'CUSTOMER', actorUserId: uid, key: keyOf(body) });
        await x.audit(sb, uid, 'META_CAMPAIGN_END', c.id, {});
        if (!(r as any).replay) await lifecycleEvent(sb, c, 'CAMPAIGN_STOPPED', 'ENDED', `end:${c.id}`, settings);
        return json({ ok: true, ...r });
      }

      case 'edit_budget': case 'edit_duration': {
        const c = await ownCampaign(sb, uid, body.campaignId);
        if (!c) return json({ error: 'not found' }, 404);
        const change = action === 'edit_budget' ? { dailyBudgetCents: Number(body.dailyBudgetCents) } : { durationDays: Number(body.durationDays) };
        const commit = body.commit === true;
        if (commit && !keyOf(body)) return json({ error: 'idempotencyKey required' }, 400);
        const r = await changePlan(sb, c, settings, change, { actor: 'CUSTOMER', actorUserId: uid, key: keyOf(body), commit, op: action === 'edit_budget' ? 'EDIT_BUDGET' : 'EDIT_DURATION' });
        if (commit) await x.audit(sb, uid, action === 'edit_budget' ? 'META_CAMPAIGN_EDIT_BUDGET' : 'META_CAMPAIGN_EDIT_DURATION', c.id, { preview: (r as any).preview });
        return json({ ok: true, ...r });
      }

      /* ── RECOMMENDATIONS: RECOMMEND ONLY by default ─────────────────── */
      case 'recommendation_act': {
        const act = String(body.act ?? '');
        if (!['APPLY', 'DISMISS', 'REMIND'].includes(act)) return json({ error: 'bad act' }, 400);
        if (!UUID.test(String(body.id ?? ''))) return json({ error: 'not found' }, 404);
        const { data: rec } = await sb.from('meta_recommendations').select('*').eq('id', String(body.id)).eq('user_id', uid).maybeSingle();
        if (!rec) return json({ error: 'not found' }, 404);
        if (!['OPEN', 'SNOOZED'].includes(rec.status)) return json({ error: 'NOT_OPEN', code: 'NOT_OPEN', status: rec.status }, 409);
        const now = new Date().toISOString();
        if (act === 'DISMISS') {
          await sb.from('meta_recommendations').update({ status: 'DISMISSED', acted_at: now }).eq('id', rec.id);
          return json({ ok: true, status: 'DISMISSED' });
        }
        if (act === 'REMIND') {
          const days = Math.min(14, Math.max(1, Math.round(Number(body.days) || 3)));
          await sb.from('meta_recommendations').update({ status: 'SNOOZED', snooze_until: new Date(Date.now() + days * 86_400_000).toISOString(), acted_at: now }).eq('id', rec.id);
          return json({ ok: true, status: 'SNOOZED', days });
        }
        // APPLY: only evidence-backed, actionable, and only through the write-through path.
        if (!rec.actionable || !['MEANINGFUL_SIGNAL', 'HIGH_CONFIDENCE'].includes(rec.confidence)) return json({ error: 'NOT_APPLICABLE', code: 'NOT_APPLICABLE' }, 409);
        const c = await ownCampaign(sb, uid, rec.campaign_id);
        if (!c) return json({ error: 'not found' }, 404);
        const key = keyOf(body);
        if (!key) return json({ error: 'idempotencyKey required' }, 400);
        const before = { costPerResultMinor: rec.baseline != null ? Number(rec.baseline) : null };
        let result: unknown;
        if (['INCREASE', 'REDUCE'].includes(rec.type) && rec.proposed?.dailyBudgetCents) {
          result = await changePlan(sb, c, settings, { dailyBudgetCents: Number(rec.proposed.dailyBudgetCents) }, { actor: 'CUSTOMER', actorUserId: uid, key, commit: true, op: 'APPLY_RECOMMENDATION' });
        } else if (['PAUSE', 'REFRESH_CREATIVE', 'REALLOCATE'].includes(rec.type) && String(rec.affected).startsWith('ad:')) {
          result = await setAdStatus(sb, c, String(rec.affected).slice(3), 'PAUSED', { actor: 'CUSTOMER', actorUserId: uid, key });
        } else {
          return json({ error: 'NOT_APPLICABLE', code: 'NOT_APPLICABLE' }, 409);
        }
        await sb.from('meta_recommendations').update({ status: 'APPLIED', acted_at: now, before_metrics: before }).eq('id', rec.id);
        await timeline(sb, c, 'RECOMMENDATION_APPLIED', 'tl_recommendation_applied', { type: rec.type });
        await sb.from('meta_funnel_events').insert({ event: 'recommendation_applied', user_id: uid });
        return json({ ok: true, status: 'APPLIED', result });
      }

      /* ── CAMPAIGN DRILL-DOWN ────────────────────────────────────────── */
      case 'campaign_detail': {
        const c = await ownCampaign(sb, uid, body.campaignId);
        if (!c) return json({ error: 'not found' }, 404);
        const launched = !!c.launched_at;
        const [a, recs, tl, ents, leads, ledger, guardAcct, incidents, events] = await Promise.all([
          launched ? analyzeCampaign(sb, c, settings.analysisParams) : Promise.resolve(null),
          sb.from('meta_recommendations').select('id,type,affected,metric,baseline,candidate,confidence,reason_codes,actionable,proposed,status,snooze_until,outcome,created_at,acted_at,window_current')
            .eq('campaign_id', c.id).eq('user_id', uid).in('status', ['OPEN', 'SNOOZED', 'APPLIED']).order('created_at', { ascending: false }).limit(50),
          sb.from('meta_campaign_events').select('kind,customer_key,params,at').eq('campaign_id', c.id).eq('user_id', uid).order('at', { ascending: false }).limit(100),
          sb.from('meta_ad_entities').select('kind,external_id,parent_external_id,local_creative_id,status,name').eq('campaign_id', c.id),
          sb.from('meta_leads').select('status').eq('campaign_id', c.id).eq('user_id', uid).limit(10000),
          sb.from('meta_ads_ledger').select('entry_type,amount_cents,created_at').eq('campaign_id', c.id).eq('user_id', uid).order('created_at'),
          c.ad_account_external_id ? sb.from('meta_guard_accounts').select('status,active_strikes,active_warnings,suspended_at').eq('user_id', uid).eq('ad_account_external_id', c.ad_account_external_id).maybeSingle() : Promise.resolve({ data: null }),
          sb.from('meta_guard_incidents').select('id,action,level,status,customer_key,protective_action,protective_status,created_at').eq('campaign_id', c.id).eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
          sb.from('meta_events').select('id,type,category,severity,state,action_required,first_seen_at,last_seen_at,deep_link,facts').eq('campaign_id', c.id).eq('user_id', uid).eq('state', 'OPEN').limit(50),
        ]);
        const { data: crs } = await sb.from('meta_creatives').select('id,headline,media').eq('campaign_id', c.id);
        const leadCounts: Record<string, number> = {};
        for (const l of leads.data ?? []) leadCounts[l.status] = (leadCounts[l.status] ?? 0) + 1;
        const held = heldFeeFromLedger(ledger.data ?? []);
        const k = a?.lifetime ? kpis(c.goal, a.lifetime, a.outcomes.lifetime) : null;
        return json({
          campaign: publicCampaign(c),
          kpis: k, evidence: a?.evidence ?? 'INSUFFICIENT_DATA',
          analysis: a ? {
            windows: a.windows, lifetime: a.lifetime, current: a.current, previous: a.previous, daily: a.daily, outcomes: a.outcomes,
            ads: a.ads.map((ad: any) => ({ key: ad.key, totals: ad.totals, outcomes: ad.outcomes, kpis: kpis(c.goal, ad.totals, ad.outcomes) })),
            creativeClasses: a.creativeClasses, segments: a.segments, leaders: a.leaders, leadHours: a.leadHours, health: a.health, facts: a.facts,
          } : null,
          // SNOOZED rows carry snooze_until; the drill-down shows them again once it has passed.
          recommendations: recs.data ?? [],
          timeline: tl.data ?? [],
          entities: (ents.data ?? []).filter((e: any) => e.kind !== 'CREATIVE'),
          creatives: (crs ?? []).map((cr: any) => ({ id: cr.id, headline: cr.headline, thumb: cr.media?.[0]?.path ?? null, kind: String(cr.media?.[0]?.mime ?? '').startsWith('video') ? 'VIDEO' : 'IMAGE' })),
          leads: { total: (leads.data ?? []).length, byStatus: leadCounts,
            qualified: (leads.data ?? []).filter((l: any) => QUALIFIED.includes(l.status)).length,
            viewings: (leads.data ?? []).filter((l: any) => VIEWED.includes(l.status)).length },
          funding: {
            heldServiceFeeCents: held, feePercent: c.fee_percent,
            ledger: (ledger.data ?? []).map((r: any) => ({ entry_type: r.entry_type, amount_cents: r.amount_cents, created_at: r.created_at, labelKey: LEDGER_LABEL_KEY[r.entry_type] ?? null })),
          },
          guard: { account: guardAcct.data ?? null, incidents: incidents.data ?? [], campaignState: c.guard_state, maxStrikes: settings.guardPolicy.maxStrikes },
          events: events.data ?? [],
          provenance: { lastSyncedAt: c.last_synced_at, insightsSyncedAt: c.insights_synced_at, summaryAt: c.summary_at, source: 'META_MARKETING_API' },
        });
      }

      /* ── GLOBAL DASHBOARD ───────────────────────────────────────────── */
      case 'dashboard': {
        let q = sb.from('meta_campaigns').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(200);
        if (typeof body.status === 'string' && /^[A-Z_]{2,30}$/.test(body.status)) q = q.eq('status', body.status);
        if (typeof body.goal === 'string' && /^[A-Z_]{2,30}$/.test(body.goal)) q = q.eq('goal', body.goal);
        if (typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency)) q = q.eq('currency', body.currency);
        const { data: camps } = await q;
        const ids = (camps ?? []).map((c: any) => c.id);
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from ?? '')) ? String(body.from) : null;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to ?? '')) ? String(body.to) : null;
        let iq = ids.length ? sb.from('meta_insights').select('campaign_id,day,currency,spend_minor,impressions,reach,clicks,link_clicks,landing_page_views,leads,messages,registrations,post_engagements')
          .in('campaign_id', ids).eq('level', 'campaign').eq('breakdown', 'none').not('day', 'is', null).limit(20000) : null;
        if (iq && from) iq = iq.gte('day', from);
        if (iq && to) iq = iq.lte('day', to);
        const [{ data: ins }, { data: leads }, { data: recs }, { data: svc }] = await Promise.all([
          iq ?? Promise.resolve({ data: [] }),
          ids.length ? sb.from('meta_leads').select('campaign_id,status,received_at').in('campaign_id', ids).limit(20000) : Promise.resolve({ data: [] }),
          ids.length ? sb.from('meta_recommendations').select('campaign_id').in('campaign_id', ids).eq('status', 'OPEN').eq('actionable', true) : Promise.resolve({ data: [] }),
          sb.from('meta_service_balances').select('*').eq('user_id', uid),
        ]);
        const toTotals = (r: any): MetricTotals => ({
          currency: r.currency, spendMinor: Number(r.spend_minor), impressions: Number(r.impressions), reach: null, clicks: Number(r.clicks),
          linkClicks: Number(r.link_clicks), landingPageViews: Number(r.landing_page_views), leads: Number(r.leads), messages: Number(r.messages),
          registrations: Number(r.registrations), postEngagements: Number(r.post_engagements),
        });
        const inRange = (d: string) => (!from || d >= from) && (!to || d <= to + 'T99');
        const rows = (camps ?? []).map((c: any) => {
          const t = sumTotals((ins ?? []).filter((r: any) => r.campaign_id === c.id).map(toTotals)) ?? emptyTotals(c.currency);
          const ls = (leads ?? []).filter((l: any) => l.campaign_id === c.id && inRange(String(l.received_at)));
          const outcomes = { qualifiedLeads: ls.filter((l: any) => QUALIFIED.includes(l.status)).length, viewings: ls.filter((l: any) => VIEWED.includes(l.status)).length, won: ls.filter((l: any) => l.status === 'WON').length };
          return {
            ...publicCampaign(c), totals: t, kpis: kpis(c.goal, t, outcomes), leads: ls.length, outcomes,
            openRecommendations: (recs ?? []).filter((r: any) => r.campaign_id === c.id).length,
            attention: Object.values(c.health ?? {}).some((h: any) => h?.state === 'ACTION_RECOMMENDED') || c.guard_state !== 'OK',
          };
        });
        // Money is never summed across currencies.
        const byCurrency = totalsByCurrency(rows.map((r: any) => r.totals));
        const summary = Object.entries(byCurrency).map(([currency, t]) => {
          const inCur = rows.filter((r: any) => r.currency === currency);
          const o = { qualifiedLeads: inCur.reduce((n: number, r: any) => n + r.outcomes.qualifiedLeads, 0), viewings: inCur.reduce((n: number, r: any) => n + r.outcomes.viewings, 0), won: inCur.reduce((n: number, r: any) => n + r.outcomes.won, 0) };
          return { currency, totals: t, kpis: kpis('LEADS_ON_META', t, o), leads: inCur.reduce((n: number, r: any) => n + r.leads, 0), campaigns: inCur.length };
        });
        return json({
          campaigns: rows, summary,
          counts: { total: rows.length, live: rows.filter((r: any) => ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'].includes(r.status)).length, attention: rows.filter((r: any) => r.attention).length },
          serviceBalance: svc ?? [],
          filters: { status: body.status ?? null, goal: body.goal ?? null, currency: body.currency ?? null, from, to },
        });
      }

      /* ── PREMIUM LEAD FORMS ─────────────────────────────────────────── */
      case 'lead_forms_list': {
        const { data } = await sb.from('meta_lead_forms').select('id,name,spec,status,meta_form_id,page_external_id,property_id,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
        return json({ forms: data ?? [] });
      }

      case 'lead_form_preview': {
        const spec = body.spec as LeadFormSpec;
        return json({ issues: validateLeadFormSpec(spec), preview: leadFormPreview(spec) });
      }

      case 'lead_form_create_v2': {
        const spec = body.spec as LeadFormSpec;
        const issues = validateLeadFormSpec(spec);
        if (issues.length) return json({ error: 'INVALID_FORM', code: 'INVALID_FORM', issues }, 400);
        const page = await selectedAsset(sb, uid, 'PAGE');
        if (!page) return json({ error: 'NO_PAGE', code: 'NO_PAGE' }, 400);
        const { data: conn } = await sb.from('meta_connections').select('granted_scopes').eq('user_id', uid).maybeSingle();
        if (mode === 'REAL' && !hasScopes(conn?.granted_scopes, INSTANT_FORM_SCOPES)) {
          return json({ error: 'INSTANT_FORMS_PERMISSION_REQUIRED', code: 'INSTANT_FORMS_PERMISSION_REQUIRED', needed: INSTANT_FORM_SCOPES }, 403);
        }
        const { data: row } = await sb.from('meta_lead_forms').insert({
          user_id: uid, page_external_id: page.external_id, name: String(spec.name).trim().slice(0, 100), spec,
          property_id: body.propertyId ? String(body.propertyId).slice(0, 40) : null,
        }).select('id').single();
        let externalId: string;
        try {
          if (mode === 'MOCK') externalId = mockExternalId('form');
          else {
            const token = await userToken(sb, uid);
            if (!token) throw new LifecycleError('NOT_CONNECTED', 400);
            const pt = await pageToken(token, page.external_id, { sb, userId: uid });
            if (!pt) throw new LifecycleError('PAGE_TOKEN_UNAVAILABLE', 400);
            const created = await graph(`/${page.external_id}/leadgen_forms`, { token: pt, method: 'POST', audit: { sb, userId: uid }, body: leadFormPayload(spec) });
            externalId = String(created.id);
          }
        } catch (err) {
          await sb.from('meta_lead_forms').update({ status: 'FAILED', error: { code: err instanceof MetaApiError ? err.normalized.customerKey : (err as Error).message } }).eq('id', row.id);
          throw err;
        }
        await sb.from('meta_lead_forms').update({ status: 'CREATED', meta_form_id: externalId, updated_at: new Date().toISOString() }).eq('id', row.id);
        await sb.from('meta_assets').update({ selected: false }).eq('user_id', uid).eq('kind', 'LEAD_FORM');
        const { data: asset } = await sb.from('meta_assets').upsert({
          user_id: uid, kind: 'LEAD_FORM', external_id: externalId, name: String(spec.name).trim().slice(0, 100), parent_external_id: page.external_id,
          selected: true, status: 'ACTIVE', capabilities: { created_by_homatch: true, questions: spec.questions, locale: META_LOCALE[spec.locale] ?? 'en_US', mock: mode === 'MOCK' },
        }, { onConflict: 'user_id,kind,external_id' }).select('id,external_id,name').single();
        await sb.from('meta_funnel_events').insert({ event: 'lead_form_created', user_id: uid });
        await x.audit(sb, uid, 'META_LEAD_FORM_CREATE', externalId, { questions: spec.questions });
        return json({ ok: true, form: asset, formId: row.id, mode });
      }

      /* ── GUARD: the customer's own view (no evidence internals) ─────── */
      case 'guard_status': {
        const [{ data: accounts }, { data: incidents }] = await Promise.all([
          sb.from('meta_guard_accounts').select('ad_account_external_id,status,active_strikes,active_warnings,suspended_at,reinstated_at').eq('user_id', uid),
          sb.from('meta_guard_incidents').select('id,campaign_id,action,level,status,customer_key,protective_action,protective_status,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
        ]);
        return json({ accounts: accounts ?? [], incidents: incidents ?? [], maxStrikes: settings.guardPolicy.maxStrikes, enabled: settings.guardEnabled });
      }

      /* ── ADMIN: GUARD CONTROLS ──────────────────────────────────────── */
      case 'admin_guard_overview': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const [{ data: accounts }, { data: incidents }, { data: actions }] = await Promise.all([
          sb.from('meta_guard_accounts').select('*').order('updated_at', { ascending: false }).limit(200),
          sb.from('meta_guard_incidents').select('*, meta_guard_evidence(evidence)').order('created_at', { ascending: false }).limit(200),
          sb.from('meta_guard_admin_actions').select('*').order('created_at', { ascending: false }).limit(100),
        ]);
        return json({ accounts: accounts ?? [], incidents: incidents ?? [], actions: actions ?? [], policy: settings.guardPolicy, enabled: settings.guardEnabled });
      }

      case 'admin_guard_act': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const act = String(body.act ?? '');
        const reason = String(body.reason ?? '').trim().slice(0, 500);
        if (reason.length < 3) return json({ error: 'REASON_REQUIRED', code: 'REASON_REQUIRED' }, 400);
        const ACTS = ['CLEAR_INCIDENT', 'DISMISS_INCIDENT', 'MARK_REVIEWED', 'REINSTATE_ACCOUNT', 'SUSPEND_ACCOUNT', 'UNLOCK_CAMPAIGN', 'ACCEPT_EXTERNAL', 'RESTORE_CONFIG'];
        if (!ACTS.includes(act)) return json({ error: 'bad act' }, 400);
        const log = async (targetUser: string, extra: Record<string, unknown>) => {
          await sb.from('meta_guard_admin_actions').insert({ admin_user_id: uid, target_user_id: targetUser, action: act, reason, ...extra });
          await x.audit(sb, uid, `META_GUARD_${act}`, String(extra.incident_id ?? extra.campaign_id ?? extra.ad_account_external_id ?? targetUser), { reason });
        };
        if (['CLEAR_INCIDENT', 'DISMISS_INCIDENT', 'MARK_REVIEWED'].includes(act)) {
          const { data: inc } = await sb.from('meta_guard_incidents').select('*').eq('id', String(body.incidentId ?? '')).maybeSingle();
          if (!inc) return json({ error: 'not found' }, 404);
          const status = act === 'CLEAR_INCIDENT' ? 'CLEARED' : act === 'DISMISS_INCIDENT' ? 'DISMISSED' : 'REVIEWED';
          await sb.from('meta_guard_incidents').update({ status, resolved_at: new Date().toISOString(), resolved_by: uid }).eq('id', inc.id);
          const acc = await refreshAccount(sb, inc.user_id, inc.ad_account_external_id, settings.guardPolicy);
          await log(inc.user_id, { incident_id: inc.id, ad_account_external_id: inc.ad_account_external_id, campaign_id: inc.campaign_id, previous_state: { status: inc.status }, new_state: { status, account: acc } });
          return json({ ok: true, status, account: acc });
        }
        if (act === 'REINSTATE_ACCOUNT' || act === 'SUSPEND_ACCOUNT') {
          const target = String(body.targetUserId ?? ''); const account = String(body.adAccountId ?? '');
          if (!UUID.test(target) || !account) return json({ error: 'targetUserId and adAccountId required' }, 400);
          const { data: prev } = await sb.from('meta_guard_accounts').select('*').eq('user_id', target).eq('ad_account_external_id', account).maybeSingle();
          const now = new Date().toISOString();
          if (act === 'REINSTATE_ACCOUNT') {
            // Reinstating clears the strikes that caused the suspension, with the reason on record.
            await sb.from('meta_guard_incidents').update({ status: 'CLEARED', resolved_at: now, resolved_by: uid })
              .eq('user_id', target).eq('ad_account_external_id', account).eq('level', 'STRIKE').eq('status', 'ACTIVE');
            await sb.from('meta_guard_accounts').upsert({ user_id: target, ad_account_external_id: account, status: 'ACTIVE', active_strikes: 0, reinstated_at: now, updated_at: now }, { onConflict: 'user_id,ad_account_external_id' });
          } else {
            await sb.from('meta_guard_accounts').upsert({ user_id: target, ad_account_external_id: account, status: 'SUSPENDED', suspended_at: now, updated_at: now }, { onConflict: 'user_id,ad_account_external_id' });
          }
          await log(target, { ad_account_external_id: account, previous_state: prev ?? null, new_state: { status: act === 'REINSTATE_ACCOUNT' ? 'ACTIVE' : 'SUSPENDED' } });
          return json({ ok: true });
        }
        // Campaign-level: UNLOCK / ACCEPT_EXTERNAL / RESTORE_CONFIG.
        const { data: c } = await sb.from('meta_campaigns').select('*').eq('id', String(body.campaignId ?? '')).maybeSingle();
        if (!c) return json({ error: 'not found' }, 404);
        if (act === 'UNLOCK_CAMPAIGN') {
          await sb.from('meta_campaigns').update({ guard_state: 'OK' }).eq('id', c.id);
          await log(c.user_id, { campaign_id: c.id, previous_state: { guard_state: c.guard_state }, new_state: { guard_state: 'OK' } });
          return json({ ok: true });
        }
        if (mode !== 'REAL' || !c.external_campaign_id || String(c.external_campaign_id).startsWith('mock_')) return json({ error: 'NOT_LIVE_AT_META' }, 409);
        const token = await userToken(sb, c.user_id);
        if (!token) return json({ error: 'META_CONNECTION_NEEDS_ATTENTION', code: 'META_CONNECTION_NEEDS_ATTENTION' }, 409);
        const current = await readManagedState(token, c, { sb, userId: c.user_id, campaignId: c.id });
        if (act === 'ACCEPT_EXTERNAL') {
          const op = await recordOp(sb, { userId: c.user_id, campaignId: c.id, op: 'ACCEPT_EXTERNAL', actor: 'ADMIN', actorUserId: uid, object: c.external_campaign_id });
          await setApproved(sb, c, current);
          await sb.from('meta_campaigns').update({ guard_state: 'OK' }).eq('id', c.id);
          await finishOp(sb, op.id, 'CONFIRMED');
          await timeline(sb, c, 'GUARD_REVIEWED', 'tl_guard_reviewed', {});
          await log(c.user_id, { campaign_id: c.id, previous_state: c.approved_state, new_state: current });
          return json({ ok: true });
        }
        // RESTORE_CONFIG: put the approved budgets/end times back at Meta, each read back.
        const approved = c.approved_state;
        if (!approved) return json({ error: 'NO_APPROVED_STATE' }, 409);
        const op = await recordOp(sb, { userId: c.user_id, campaignId: c.id, op: 'RESTORE_CONFIG', actor: 'ADMIN', actorUserId: uid, object: c.external_campaign_id,
          changes: (approved.adSets ?? []).map((s: any) => ({ object: s.id, field: 'daily_budget', expected: s.dailyBudget })) });
        try {
          for (const s of approved.adSets ?? []) {
            const now = current.adSets.find((x) => x.id === s.id);
            if (!now) continue;
            const patch: Record<string, unknown> = {};
            if (s.dailyBudget != null && now.dailyBudget !== s.dailyBudget) patch.daily_budget = s.dailyBudget;
            if (Object.keys(patch).length) {
              await graph(`/${s.id}`, { token, method: 'POST', body: patch, audit: { sb, userId: c.user_id, campaignId: c.id }, attempts: 1 });
              const back = await graph(`/${s.id}?fields=daily_budget`, { token, attempts: 2 });
              if (Math.round(Number(back.daily_budget)) !== Number(s.dailyBudget)) throw new LifecycleError('META_DID_NOT_CONFIRM', 502);
            }
          }
        } catch (err) { await finishOp(sb, op.id, 'FAILED', err); throw err; }
        await finishOp(sb, op.id, 'CONFIRMED');
        await timeline(sb, c, 'CONFIG_RESTORED', 'tl_config_restored', {});
        await log(c.user_id, { campaign_id: c.id, previous_state: current, new_state: approved });
        return json({ ok: true });
      }

      /* ── ADMIN: SERVICE-FEE POLICY ──────────────────────────────────── */
      case 'admin_fee_policy_get': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const target = String(body.targetUserId ?? '');
        if (!UUID.test(target)) return json({ error: 'targetUserId required' }, 400);
        const [{ data: policy }, { data: audit }] = await Promise.all([
          sb.from('meta_fee_policies').select('*').eq('user_id', target).maybeSingle(),
          sb.from('meta_fee_policy_audit').select('*').eq('user_id', target).order('created_at', { ascending: false }).limit(50),
        ]);
        return json({ policy: policy ?? { kind: 'STANDARD_PERCENT', percent: null }, standardPercent: settings.feePercent, audit: audit ?? [] });
      }

      case 'admin_fee_policy_set': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const target = String(body.targetUserId ?? '');
        const kind = String(body.kind ?? '');
        const reason = String(body.reason ?? '').trim().slice(0, 500);
        if (!UUID.test(target)) return json({ error: 'targetUserId required' }, 400);
        if (!['STANDARD_PERCENT', 'FEE_EXEMPT', 'CUSTOM_PERCENT'].includes(kind)) return json({ error: 'bad kind' }, 400);
        if (reason.length < 3) return json({ error: 'REASON_REQUIRED', code: 'REASON_REQUIRED' }, 400);
        const percent = kind === 'CUSTOM_PERCENT' ? Number(body.percent) : null;
        if (kind === 'CUSTOM_PERCENT' && !(Number.isFinite(percent) && percent! >= 0 && percent! <= 100)) return json({ error: 'PERCENT_INVALID', code: 'PERCENT_INVALID' }, 400);
        const { data: prev } = await sb.from('meta_fee_policies').select('kind,percent').eq('user_id', target).maybeSingle();
        const next = { kind, percent };
        const { error } = await sb.from('meta_fee_policies').upsert({ user_id: target, kind, percent, reason, set_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if (error) throw error;
        await sb.from('meta_fee_policy_audit').insert({ user_id: target, admin_user_id: uid, previous: prev ?? null, next, reason });
        await x.audit(sb, uid, 'META_FEE_POLICY_SET', target, { previous: prev ?? null, next, reason });
        // Applies to launches and plan changes from now on; live campaigns keep the percent they launched with.
        return json({ ok: true, policy: next });
      }

      /* ── ADMIN: NOTIFICATION + AI ECONOMICS ─────────────────────────── */
      case 'admin_meta_economics': {
        if (!me.is_admin) return json({ error: 'forbidden' }, 403);
        const since = new Date(Date.now() - Math.min(90, Math.max(1, Number(body.days) || 30)) * 86_400_000).toISOString();
        const [{ data: ai }, { data: deliveries }, { data: notes }, { data: events }] = await Promise.all([
          sb.from('meta_ai_summaries').select('purpose,trigger_reason,model,input_tokens,output_tokens,raw_cost_usd,landed_cost_usd,created_at,campaign_id,user_id').gte('created_at', since).limit(5000),
          sb.from('notification_deliveries').select('channel,status,reason,provider').eq('source', 'meta_ads').gte('created_at', since).limit(20000),
          sb.from('meta_event_notifications').select('transition,severity,channels').gte('created_at', since).limit(20000),
          sb.from('meta_events').select('type,severity,state').gte('last_seen_at', since).limit(20000),
        ]);
        const count = <T,>(rows: T[], key: (r: T) => string) => rows.reduce((m: Record<string, number>, r) => { const k = key(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
        const aiRows = ai ?? [];
        return json({
          since,
          ai: {
            calls: aiRows.length,
            inputTokens: aiRows.reduce((n: number, r: any) => n + Number(r.input_tokens ?? 0), 0),
            outputTokens: aiRows.reduce((n: number, r: any) => n + Number(r.output_tokens ?? 0), 0),
            rawCostUsd: aiRows.reduce((n: number, r: any) => n + Number(r.raw_cost_usd ?? 0), 0),
            landedCostUsd: aiRows.reduce((n: number, r: any) => n + Number(r.landed_cost_usd ?? 0), 0),
            unpriced: aiRows.filter((r: any) => r.raw_cost_usd == null).length,
            byPurpose: count(aiRows, (r: any) => r.purpose), byTrigger: count(aiRows, (r: any) => String(r.trigger_reason).split(':')[0]),
            byModel: count(aiRows, (r: any) => String(r.model ?? 'unknown')),
          },
          notifications: { total: (notes ?? []).length, byTransition: count(notes ?? [], (r: any) => r.transition), bySeverity: count(notes ?? [], (r: any) => r.severity),
            byChannel: count((notes ?? []).flatMap((r: any) => r.channels ?? []), (ch: any) => String(ch)) },
          deliveries: { byChannelStatus: count(deliveries ?? [], (r: any) => `${r.channel}:${r.status}`), skippedReasons: count((deliveries ?? []).filter((r: any) => r.status === 'SKIPPED'), (r: any) => String(r.reason)) },
          events: { byType: count(events ?? [], (r: any) => r.type), open: (events ?? []).filter((e: any) => e.state === 'OPEN').length },
        });
      }

      default:
        return null;
    }
  } catch (err) {
    const r = lifecycleResponse(json, err);
    if (r) return r;
    throw err;
  }
}

