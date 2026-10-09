/*
 * THREE THINGS THE RESEARCH HAD AND THE REPORT LOST (job c80f7237).
 *
 * 1. MARKET CONTEXT FROM A REUSED SNAPSHOT.
 *    The planner reused a stored project snapshot (3 listings, median
 *    2,200 USD/m², 45 h old) and gave the market stage a search budget of
 *    zero — correctly, it did not need to pay again. But the snapshot reached
 *    the model only as a prose brief; result_json.market.comparables stayed
 *    empty, buildMarketIntelligence() returned null, and the market section
 *    and price bar vanished from a report whose research HAD the answer.
 *    marketContextFrom() turns the reused snapshot into a structured, dated
 *    view. New jobs carry the snapshot as structure; older ones are read from
 *    the brief the planner wrote, which states the same numbers.
 *
 * 2. THE DEVELOPER'S FINANCIAL POSITION, FROM WHAT WAS ACTUALLY CHECKED.
 *    RS.ge returned nothing (the worker stalled), so there is no tax status —
 *    and that must never read as an adverse finding. But the run did check
 *    the debtor registry, read the registered pledge and the liquidation
 *    flag, and found who finances the project. companyFinanceFrom() collects
 *    exactly those, each with its date and basis, and marks the tax status
 *    as "not checked in this research" rather than inventing one.
 *
 * 3. A ZERO-RESULT AD SEARCH THAT WAS RUN, PAID FOR, AND DROPPED.
 *    The Ad Library stage ran (cost_events: items=0) and finish() then
 *    discarded its result — the bug PR #138 fixed for new jobs. For a job
 *    that lost it, adsViewFromCostRecord() rebuilds the one thing that can
 *    be rebuilt faithfully: a completed search that returned no ads, with
 *    the search terms recomputed from the same deterministic identity
 *    resolver. A lost NON-zero result is not rebuilt — its ads are gone, and
 *    a count without them would be a claim we cannot show.
 *
 * All three are pure: no network, no writes, nothing paid.
 */

import { resolveDeveloperIdentity, summarizeAds, parseDeveloperAdsPolicy } from '../developerAds.ts';
import type { DeveloperAdsView } from '../developerAds.ts';
import type { CompanyIntelligence } from './companyIntelligence.ts';

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/* ───────────────────────── 1. market context ───────────────────────── */

export interface MarketContextView {
  basis: 'HOMATCH_SNAPSHOT';
  /** PROJECT | STREET | DISTRICT | CITY — what the figures describe. */
  scope: string;
  currency: string;
  medianPerSqm: number;
  lowerPerSqm: number | null;
  upperPerSqm: number | null;
  listings: number;
  confidence: string | null;
  /** ISO day the snapshot's listings were last refreshed. */
  asOf: string | null;
  /** These are asking prices, never sale prices. */
  askingPrices: true;
}

const BRIEF = /median\s+([\d.,]+)\s+([A-Z]{3})\s+per\s+sqm,\s+observed\s+range\s+([\d.,]+)\s*-\s*([\d.,]+)\s+based\s+on\s+(\d+)\s+comparable\s+listings?,\s+confidence\s+([A-Z]+)/i;
const SUMMARY = /reusing\s+([A-Z]+)\s+snapshot\s+\([A-Z]+,\s*\d+\s+comparables?,\s*(\d+)h\s+old\)/i;

/**
 * The reused snapshot as a structured view, or null when the run gathered
 * its own comparables (the full market block is better) or reused nothing.
 * `referenceTime` is when the plan was made (the job's creation, or its
 * completion as the nearest stored moment) — used only to date a legacy plan.
 */
export function marketContextFrom(resultJson: unknown, referenceTime?: string | null): MarketContextView | null {
  const r = obj(resultJson);
  const own = Array.isArray(obj(r.market).comparables) ? obj(r.market).comparables.length : 0;
  if (own > 0) return null;
  const plan = obj(obj(r._reusePlan).marketPlan);
  if (!Object.keys(plan).length || plan.refresh === true) return null;

  // New jobs: the snapshot itself, as the store returned it.
  const s = obj(plan.snapshot);
  const median = num(s.median_price_per_sqm ?? s.medianPerSqm);
  if (median && median > 0) {
    return {
      basis: 'HOMATCH_SNAPSHOT',
      scope: String(s.scope_type ?? plan.scope ?? 'PROJECT'),
      currency: String(s.currency ?? 'USD'),
      medianPerSqm: median,
      lowerPerSqm: num(s.lower_price_per_sqm ?? s.lowerPerSqm),
      upperPerSqm: num(s.upper_price_per_sqm ?? s.upperPerSqm),
      listings: num(s.usable_comparable_count ?? s.listings) ?? 0,
      confidence: typeof s.confidence === 'string' ? s.confidence : (plan.confidence ?? null),
      asOf: typeof s.last_refreshed_at === 'string' ? s.last_refreshed_at.slice(0, 10) : null,
      askingPrices: true,
    };
  }

  // Older jobs: the brief the planner wrote states the same figures.
  const m = String(plan.brief ?? '').match(BRIEF);
  if (!m) return null;
  const age = String(plan.summary ?? '').match(SUMMARY);
  const ref = Date.parse(String(referenceTime ?? ''));
  const asOf = age && Number.isFinite(ref) ? new Date(ref - Number(age[2]) * 3_600_000).toISOString().slice(0, 10) : null;
  return {
    basis: 'HOMATCH_SNAPSHOT',
    scope: String(plan.scope ?? age?.[1] ?? 'PROJECT').toUpperCase(),
    currency: m[2].toUpperCase(),
    medianPerSqm: num(m[1])!,
    lowerPerSqm: num(m[3]),
    upperPerSqm: num(m[4]),
    listings: Number(m[5]),
    confidence: m[6].toUpperCase(),
    asOf,
    askingPrices: true,
  };
}

/* ───────────────────────── 2. company finance ───────────────────────── */

export type TaxStatusState = 'CHECKED' | 'NOT_CHECKED';

export interface CompanyFinanceView {
  companyName: string | null;
  companyId: string | null;
  /** Official debtor registry (NAPR) for the company. */
  debtorRegistry: { state: 'NO_ENTRY' | 'LISTED'; checkedOn: string | null } | null;
  /** Revenue Service taxpayer status. NOT_CHECKED is never adverse. */
  taxStatus: { state: TaxStatusState; checkedOn: string | null };
  /** Charges registered against the COMPANY (not the apartment). */
  pledges: Array<{ creditor: string | null; reference: string | null; registeredOn: string | null }>;
  liquidationRegistered: boolean | null;
  /** Date of the company register extract these facts come from. */
  registryExtractDate: string | null;
  /** Who publicly finances the project — a public statement, not a register fact. */
  financingPartner: string | null;
}

const isoOfDmy = (v: unknown): string | null => {
  const m = typeof v === 'string' ? v.match(/(\d{2})[./](\d{2})[./](\d{4})/) : null;
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};

/** The source's own result for the company, matched by identification code only. */
function resultFor(r: Record<string, any>, source: string, companyId: string | null): Record<string, any> | null {
  if (!companyId) return null;
  const results = Array.isArray(obj(r.browserOfficial).results) ? r.browserOfficial.results : [];
  return results.find((x: any) => x?.source === source && String(x?.forEntity?.idCode ?? x?.queryEntered ?? '').trim() === companyId) ?? null;
}

const short = (v: unknown, n = 120): string | null => {
  const s = typeof v === 'string' ? v.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\S+/g, '').replace(/\s+/g, ' ').trim() : '';
  return s && s.length <= n ? s : null;
};

export function companyFinanceFrom(resultJson: unknown, company: CompanyIntelligence | null): CompanyFinanceView | null {
  const r = obj(resultJson);
  const companyId = company?.idCode ?? (typeof obj(r.companyProfile).idCode === 'string' ? r.companyProfile.idCode : null);
  if (!company && !companyId) return null;

  const debtor = resultFor(r, 'debtor', companyId);
  const debtorRegistry = debtor && (debtor.debtorRecordFound === true || debtor.debtorRecordFound === false)
    ? { state: debtor.debtorRecordFound ? ('LISTED' as const) : ('NO_ENTRY' as const), checkedOn: isoOfDmy(debtor.retrievedAt) }
    : null;

  const tax = resultFor(r, 'rstax', companyId);
  const taxRead = !!tax && !tax.unavailable && Array.isArray(tax.documents) && tax.documents.length > 0 &&
    ['VERIFIED', 'SEARCH_CONFIRMED', 'COMPLETED', 'SUCCESS'].includes(String(tax.status));
  const taxStatus = { state: taxRead ? ('CHECKED' as const) : ('NOT_CHECKED' as const), checkedOn: taxRead ? isoOfDmy(tax.retrievedAt) : null };

  const pledges = (company?.encumbrances ?? []).map((e) => ({
    creditor: e.creditor ? e.creditor.replace(/\s*\(საქართველო\)/, '').trim() : null,
    reference: e.reference,
    registeredOn: isoOfDmy(e.registeredAt),
  }));

  const pub = obj(r.publicResearch);
  const financing = Array.isArray(pub.financingBank) ? pub.financingBank[0] : pub.financingBank;

  const view: CompanyFinanceView = {
    companyName: company?.legalName ?? null,
    companyId,
    debtorRegistry,
    taxStatus,
    pledges,
    liquidationRegistered: company?.liquidationRegistered ?? null,
    registryExtractDate: isoOfDmy(company?.extractPreparedAt),
    financingPartner: short(financing),
  };
  // Nothing to say at all → no section.
  const any = view.debtorRegistry || view.pledges.length || view.liquidationRegistered !== null || view.financingPartner;
  return any || companyId ? view : null;
}

/* ───────────────────────── 3. a lost zero-result ad search ───────────────────────── */

/** A cost_events row for DEVELOPER_ADS_VERIFY, as stored. */
export interface AdsCostRecord {
  success?: boolean | null;
  source?: string | null;
  timestamp?: string | null;
}

/**
 * The completed, ZERO-result search a job paid for and then lost — rebuilt
 * from its cost record. Null for anything else (no record, a failure, or a
 * non-zero result whose ads were not kept).
 */
export function adsViewFromCostRecord(resultJson: unknown, record: AdsCostRecord | null | undefined, adminPolicy?: unknown): DeveloperAdsView | null {
  if (!record || record.success !== true) return null;
  const items = String(record.source ?? '').match(/(?:^|;)items=(\d+)(?:;|$)/);
  if (!items || Number(items[1]) !== 0) return null;
  const policy = parseDeveloperAdsPolicy(adminPolicy);
  const identity = resolveDeveloperIdentity(resultJson, policy.maxTerms);
  if (!identity.searchTerms.length) return null;
  return summarizeAds({
    outcome: 'COMPLETE',
    verifiedAt: record.timestamp ?? null,
    policy,
    identity,
    normalized: { ads: [], duplicates: 0 },
    result: resultJson,
  });
}
