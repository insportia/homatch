/*
 * FIND PROPERTY — Deep Search: a paid campaign's own results, judged and kept.
 *
 *   persistCampaignResults   at the end of a campaign (and once, lazily, for a campaign that
 *                            ended before this existed): every offer the campaign stored is
 *                            judged against the customer's exact request (campaignMatch.ts);
 *                            verdicts + a snapshot of each post are written to
 *                            find_property_campaign_results and the counts to
 *                            discovery_runs.campaign_outcome. Re-entrant: it replaces the
 *                            campaign's rows, never another campaign's.
 *   readCampaignResults      one page of them, for the campaign's own results page.
 *
 * Never touches money: wallet, reservations and actor-run costs are only READ here.
 */
import {
  CAMPAIGN_MATCH_VERSION, criteriaFromSearchRequest, districtsNamed, judgeCampaign, offerPriceUsd,
  type CampaignCriteria, type CampaignFunnel, type CampaignOffer, type MatchCategory,
} from '../../../../src/research-core/findProperty/campaignMatch.ts';
import { draftFromStoredPlan } from '../../../../src/research-core/discovery/discovery-plan.ts';
import { normalisePlan } from '../../../../src/research-core/discovery/search-plan.ts';
import { PAID_DISCOVERY_POLICY_ID } from '../../../../src/research-core/billing/paidDiscoveryPolicy.ts';

const OFFER_COLUMNS = 'id,canonical_url,transaction,property_type,city,district,sale_amount,sale_currency,rent_amount,rent_currency,area_sqm,rooms,bedrooms,floor,total_floors,title,description,published_at,content_fingerprint,image_urls,field_origins';

/** The request a campaign answers: its marketplace search's confirmed brief, else its stored plan. */
export async function campaignCriteria(db: any, run: { subscription_id: string | null; user_id: string; offer_plan: any }): Promise<{ criteria: CampaignCriteria; originalText: string | null; searchId: string | null }> {
  const searchId = typeof run.offer_plan?.marketplaceSearchId === 'string' ? run.offer_plan.marketplaceSearchId : null;
  let request: Record<string, any> | null = null;
  let originalText: string | null = null;
  if (searchId) {
    const { data } = await db.from('discovery_marketplace_searches').select('request,brief').eq('id', searchId).eq('user_id', run.user_id).maybeSingle();
    request = data?.request ?? null;
    originalText = typeof data?.brief?.originalText === 'string' ? data.brief.originalText : null;
  }
  let fallback: Parameters<typeof criteriaFromSearchRequest>[1];
  if (!request && run.subscription_id) {
    const { data: sub } = await db.from('active_search_subscriptions').select('search_criteria').eq('id', run.subscription_id).eq('user_id', run.user_id).maybeSingle();
    const { plan } = normalisePlan(draftFromStoredPlan(sub?.search_criteria ?? {}));
    if (plan?.city) fallback = { transaction: plan.deal === 'RENT' ? 'RENT' : 'SALE', city: plan.city.value, districts: plan.districts?.value ?? [], propertyType: plan.propertyTypes?.value?.[0] ?? null };
  }
  return { criteria: criteriaFromSearchRequest(request, fallback), originalText, searchId };
}

/** What a post said, kept with its verdict so the results page never changes after the fact. */
function snapshotOf(o: CampaignOffer, c: CampaignCriteria, duplicates: CampaignOffer[]): Record<string, unknown> {
  const text = String(o.description ?? '');
  const origins = (o.field_origins ?? {}) as Record<string, unknown>;
  return {
    url: o.canonical_url, network: origins.network ?? null,
    title: o.title ?? null, excerpt: text.slice(0, 700),
    priceUsd: offerPriceUsd(o, c.transaction),
    price: c.transaction === 'RENT' ? (o.rent_amount != null ? { amount: o.rent_amount, currency: o.rent_currency } : null)
      : (o.sale_amount != null ? { amount: o.sale_amount, currency: o.sale_currency } : null),
    areaSqm: o.area_sqm, rooms: o.rooms, bedrooms: o.bedrooms, floor: o.floor ?? null, totalFloors: o.total_floors ?? null,
    propertyType: o.property_type, city: o.city, district: o.district ?? districtsNamed(text)[0] ?? null,
    publishedAt: o.published_at, images: (o.image_urls ?? []).slice(0, 4),
    duplicateUrls: duplicates.map((d) => d.canonical_url).filter(Boolean).slice(0, 10),
  };
}

export async function persistCampaignResults(db: any, runId: string): Promise<CampaignFunnel | null> {
  const { data: run } = await db.from('discovery_runs').select('id,user_id,subscription_id,offer_plan,pricing_policy,started_at,completed_at').eq('id', runId).maybeSingle();
  if (!run || run.pricing_policy !== PAID_DISCOVERY_POLICY_ID) return null;
  const { criteria } = await campaignCriteria(db, run);
  const { data: actorRuns } = await db.from('find_property_actor_runs').select('id,items_fetched,results_billed').eq('discovery_run_id', runId);
  const ars = (actorRuns ?? []) as Array<{ id: string; items_fetched: number | null; results_billed: number | null }>;
  const fetched = ars.reduce((n, a) => n + Math.max(Number(a.items_fetched ?? 0), Number(a.results_billed ?? 0)), 0);
  const offers: CampaignOffer[] = [];
  if (ars.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('supply_observations').select(OFFER_COLUMNS)
        .in('field_origins->>memo23ActorRunId', ars.map((a) => a.id)).order('id').range(from, from + 999);
      if (error) throw error;
      offers.push(...((data ?? []) as CampaignOffer[]));
      if (!data || data.length < 1000) break;
    }
  }
  /* Judged AS OF the campaign's end (its start while it runs): a backfill months later gives the
     same verdicts — "posted in the last 30 days" is about the campaign, not about today. */
  const asOf = Date.parse(String(run.completed_at ?? run.started_at ?? '')) || Date.now();
  const { verdicts, funnel } = judgeCampaign(offers, criteria, fetched, asOf);
  const byId = new Map(offers.map((o) => [o.id, o]));
  const rows = verdicts.map((v, i) => ({
    run_id: runId, observation_id: v.offerId, category: v.category, rank: i + 1, score: v.score,
    checks: v.checks, reject_reasons: v.rejectReasons, duplicate_ids: v.duplicateIds,
    snapshot: snapshotOf(byId.get(v.offerId)!, criteria, v.duplicateIds.map((d) => byId.get(d)!).filter(Boolean)),
    match_version: CAMPAIGN_MATCH_VERSION,
  }));
  /* Idempotent: an upsert of the same deterministic rows, then only rows this campaign no longer
     has are removed (never another campaign's). Two first reads racing write the same rows. */
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('find_property_campaign_results').upsert(rows.slice(i, i + 500), { onConflict: 'run_id,observation_id' });
    if (error) throw error;
  }
  const keep = new Set(rows.map((r) => r.observation_id));
  const { data: existing } = await db.from('find_property_campaign_results').select('observation_id').eq('run_id', runId);
  const stale = ((existing ?? []) as Array<{ observation_id: string }>).map((r) => r.observation_id).filter((id) => !keep.has(id));
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await db.from('find_property_campaign_results').delete().eq('run_id', runId).in('observation_id', stale.slice(i, i + 200));
    if (error) throw error;
  }
  /* The only other write: the campaign's own counts. Wallet, reservations, ledger and provider runs are never touched here. */
  const { error: upError } = await db.from('discovery_runs').update({ campaign_outcome: { ...funnel, criteria, judgedAsOf: new Date(asOf).toISOString() } }).eq('id', runId);
  if (upError) throw upError;
  return funnel;
}

const ENDED = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED']);
const SHOWN: Record<string, MatchCategory[]> = {
  MATCHES: ['EXACT', 'POTENTIAL'], EXACT: ['EXACT'], POTENTIAL: ['POTENTIAL'], ALTERNATIVE: ['ALTERNATIVE'],
};

/**
 * One page of a campaign's results for its own page. The caller has already checked that
 * the viewer owns the campaign (or is an admin). Alternatives only when asked for.
 */
export async function readCampaignResults(db: any, runId: string, opts: { view?: string; sort?: string; page?: number; pageSize?: number }) {
  const { data: run } = await db.from('discovery_runs')
    .select('id,user_id,subscription_id,status,stage,created_at,started_at,completed_at,deadline_at,offer_plan,pricing_policy,credits_charged,credits_per_usd,billing_grant,campaign_outcome,offers_found')
    .eq('id', runId).maybeSingle();
  if (!run || run.pricing_policy !== PAID_DISCOVERY_POLICY_ID) return null;
  let outcome = run.campaign_outcome as (CampaignFunnel & { criteria?: CampaignCriteria }) | null;
  if (!outcome && ENDED.has(String(run.status))) outcome = await persistCampaignResults(db, runId).then(async () =>
    (await db.from('discovery_runs').select('campaign_outcome').eq('id', runId).maybeSingle()).data?.campaign_outcome ?? null);
  const { criteria, originalText, searchId } = await campaignCriteria(db, run);

  const view = SHOWN[String(opts.view ?? 'MATCHES').toUpperCase()] ? String(opts.view ?? 'MATCHES').toUpperCase() : 'MATCHES';
  const pageSize = Math.min(50, Math.max(5, Math.round(Number(opts.pageSize) || 20)));
  const page = Math.max(1, Math.round(Number(opts.page) || 1));
  let q = db.from('find_property_campaign_results').select('observation_id,category,rank,score,checks,reject_reasons,duplicate_ids,snapshot', { count: 'exact' })
    .eq('run_id', runId).in('category', SHOWN[view]);
  const sort = String(opts.sort ?? 'BEST').toUpperCase();
  q = sort === 'PRICE_ASC' ? q.order('snapshot->priceUsd', { ascending: true, nullsFirst: false })
    : sort === 'PRICE_DESC' ? q.order('snapshot->priceUsd', { ascending: false, nullsFirst: false })
      : sort === 'NEWEST' ? q.order('snapshot->publishedAt', { ascending: false, nullsFirst: false })
        : q.order('rank', { ascending: true });
  const { data: items, count, error } = await q.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;

  /* Money the customer may see: what was held, charged and released — never provider costs or margins. */
  const reservationId = run.billing_grant?.reservationId ?? null;
  let settlement: Record<string, unknown> = { status: ENDED.has(String(run.status)) ? 'SETTLING' : 'HELD', reservedCredits: Number(run.billing_grant?.authorizedMaxCredits ?? run.billing_grant?.reservedCredits ?? 0) || null, chargedCredits: null, releasedCredits: null };
  if (reservationId) {
    const { data: r } = await db.from('usage_reservations').select('status,reserved_credits,settled_credits,released_credits,settled_at').eq('id', reservationId).maybeSingle();
    if (r) settlement = {
      status: r.status === 'SETTLED' ? 'SETTLED' : r.status === 'RELEASED' ? 'RELEASED' : r.status === 'RESERVED' || r.status === 'ACTIVE' ? 'HELD' : String(r.status),
      reservedCredits: r.reserved_credits != null ? Number(r.reserved_credits) : null,
      chargedCredits: r.settled_credits != null ? Number(r.settled_credits) : r.status === 'RELEASED' ? 0 : null,
      releasedCredits: r.released_credits != null ? Number(r.released_credits) : null,
      settledAt: r.settled_at ?? null,
    };
  }
  return {
    run: { id: run.id, status: run.status, createdAt: run.created_at, completedAt: run.completed_at, searchId, originalText, criteria },
    outcome,
    settlement,
    view, sort, page, pageSize, total: Number(count ?? 0),
    items: (items ?? []).map((i: any) => ({
      id: i.observation_id, category: i.category, rank: i.rank, checks: i.checks, rejectReasons: i.reject_reasons,
      duplicates: (i.duplicate_ids ?? []).length, ...i.snapshot,
    })),
  };
}

/** Admin: one campaign's economics, from the recorded costs only (VAT and fees stay explicit unknowns). */
export async function campaignEconomics(db: any, limit = 20) {
  const { data: runs } = await db.from('discovery_runs')
    .select('id,user_id,status,created_at,completed_at,credits_charged,credits_per_usd,customer_value_micros,provider_budget_micros,provider_cost_usd,billing_grant,campaign_outcome,offers_found')
    .eq('pricing_policy', PAID_DISCOVERY_POLICY_ID).order('created_at', { ascending: false }).limit(Math.min(100, Math.max(1, limit)));
  const ids = ((runs ?? []) as any[]).map((r) => r.id);
  const { data: actorRuns } = ids.length ? await db.from('find_property_actor_runs')
    .select('discovery_run_id,actor_key,stage,network,status,requested_limit,reserved_micros,actual_micros,cost_basis,provider_run_id,results_billed,items_fetched,offers_found,error,created_at')
    .in('discovery_run_id', ids) : { data: [] };
  return ((runs ?? []) as any[]).map((r) => {
    const rate = Number(r.credits_per_usd) || 10;
    const mine = ((actorRuns ?? []) as any[]).filter((a) => a.discovery_run_id === r.id);
    const known = mine.every((a) => a.actual_micros != null || a.status === 'RELEASED');
    const providerMicros = mine.reduce((n, a) => n + Number(a.actual_micros ?? 0), 0);
    const reservedMicros = mine.reduce((n, a) => n + Number(a.reserved_micros ?? 0), 0);
    const revenueCredits = r.credits_charged != null ? Number(r.credits_charged) : null;
    const revenueUsd = revenueCredits != null ? Math.round((revenueCredits / rate) * 10000) / 10000 : null;
    const providerUsd = providerMicros / 1e6;
    const available = Number(r.campaign_outcome?.available ?? NaN);
    return {
      id: r.id, status: r.status, createdAt: r.created_at, completedAt: r.completed_at,
      revenueCredits, revenueUsd,
      reservedCredits: Number(r.billing_grant?.authorizedMaxCredits ?? 0) || null,
      providerBudgetUsd: r.provider_budget_micros != null ? Number(r.provider_budget_micros) / 1e6 : null,
      providerCostUsd: known ? providerUsd : null, providerReservedUsd: reservedMicros / 1e6,
      providerCostComplete: known,
      budgetUtilization: r.provider_budget_micros ? Math.round((providerMicros / Number(r.provider_budget_micros)) * 1000) / 1000 : null,
      /* Gross spread = revenue − provider cost. NOT net profit: VAT and payment fees are not modelled. */
      grossSpreadUsd: known && revenueUsd != null ? Math.round((revenueUsd - providerUsd) * 10000) / 10000 : null,
      vatUsd: null, paymentFeesUsd: null, netMarginUsd: null,
      outcome: r.campaign_outcome ?? null,
      costPerAvailableUsd: known && Number.isFinite(available) && available > 0 ? Math.round((providerUsd / available) * 10000) / 10000 : null,
      actorRuns: mine.map((a) => ({
        actorKey: a.actor_key, stage: a.stage, network: a.network, status: a.status, requestedLimit: a.requested_limit,
        reservedUsd: Number(a.reserved_micros ?? 0) / 1e6, actualUsd: a.actual_micros != null ? Number(a.actual_micros) / 1e6 : null,
        costBasis: a.cost_basis, providerRunId: a.provider_run_id, billed: a.results_billed, fetched: a.items_fetched, offers: a.offers_found,
        error: a.error ? String(a.error).slice(0, 200) : null,
      })),
    };
  });
}
