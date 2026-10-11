/*
 * THE REGISTER, APPLIED TO A REPORT — NEW OR ALREADY PERSISTED.
 *
 * A persisted report is served as a READ (verify-synthesis returns
 * synthesis_json without rebuilding it), so a report written before the
 * extracts were decoded — c80f7237 among them — would keep naming the wrong
 * owner forever unless the read path corrects it. Regenerating would mean a
 * model call and a charge per historical case. This costs nothing: the raw
 * Service 176 documents are already in result_json, the register is pure
 * arithmetic over them, and the corrections are deterministic.
 *
 * What it does, and only this:
 *   - attaches the parsed register (`propertyRegister`) for the UI;
 *   - removes prose the register proves wrong (reconcileReport);
 *   - sets the snapshot's owner from the extract;
 *   - rebuilds the closing checklist with the register in hand;
 *   - drops the developer taxpayer self-check when the developer is not the
 *     registered owner.
 * Nothing is written back; the stored row is never modified.
 */

import { buildPropertyRegister, reconcileReport, sentences, unitLegalPosition } from './propertyRegister.ts';
import { propertyKindOverlay } from './propertyKind.ts';
import { buildUnitIdentity } from './unitIdentity.ts';
import type { PropertyRegister } from './propertyRegister.ts';
import { buildBuyerChecklist } from './buyerChecklist.ts';
import { buildCompanyIntelligence } from './companyIntelligence.ts';
import { ownerFromRegister } from './bundle.ts';
import { acceptableValue, buildTasIntelligence, officialHistoryView, type TasIntelligence } from './tasIntelligence.ts';
import { marketContextFrom, companyFinanceFrom, adsViewFromCostRecord, projectTeamFrom } from './reportGaps.ts';
import { buildOfficialDossier } from './officialDossier.ts';
import { BANK } from './tasProfessionals.ts';
import type { AdsCostRecord } from './reportGaps.ts';

export interface EnrichmentContext {
  /** When the job completed — dates a legacy reused market snapshot. */
  completedAt?: string | null;
  /** The job's DEVELOPER_ADS_VERIFY cost record, when its result was lost. */
  adsCost?: AdsCostRecord | null;
  /** Admin verify_developer_ads setting (country, term limit). */
  adsPolicy?: unknown;
  /** Internal memo: the job's TAS picture, built at most once per enrichment. */
  _tas?: TasIntelligence | null;
}

/*
 * Persisted official histories still hold the malformed purpose "change"
 * (ფართობი → არასასოფლო სამეურნეო) the TAS reader used to produce. The
 * reader refuses those values now; this removes them from stored reports.
 */
function cleanOfficialHistory(history: unknown): unknown {
  const h = obj(history);
  if (!Array.isArray(h.evolution)) return history;
  const evolution = h.evolution.filter((e: any) => acceptableValue(String(e?.key ?? ''), String(e?.from ?? '')) && acceptableValue(String(e?.key ?? ''), String(e?.to ?? '')));
  return evolution.length === h.evolution.length ? history : { ...h, evolution };
}

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

const privateOwner = (reg: PropertyRegister | null) => {
  const owners = reg?.latest?.owners ?? [];
  return owners.length > 0 && owners.every((o) => o.kind === 'PERSON');
};

/*
 * The sections the research had and the report lost (see reportGaps.ts):
 * market context from a reused snapshot, the developer's financial
 * position from what was actually checked, and a zero-result ad search that
 * ran and was then dropped. Each is added only when the payload lacks it.
 */
function withRecoveredSections<T extends Record<string, any>>(payload: T, resultJson: unknown, ctx: EnrichmentContext): T {
  const out: Record<string, any> = { ...payload };
  if (!out.market && out.marketContext === undefined) {
    const mc = marketContextFrom(resultJson, ctx.completedAt ?? null);
    if (mc) out.marketContext = mc;
  }
  if (out.projectTeam === undefined) {
    const team = projectTeamFrom(resultJson, out.officialHistory?.team ?? null);
    if (team.length) (out as any).projectTeam = team;
  } else if (Array.isArray(out.projectTeam)) {
    // A bank advertising mortgages was stored as a team member (job 220ed087). A bank is never one.
    const kept = out.projectTeam.filter((m: any) => !BANK.test(String(m?.name ?? '')) && !BANK.test(String(m?.roleText ?? '')));
    if (kept.length !== out.projectTeam.length) out.projectTeam = kept;
  }
  // Reports written before the dossier existed get it on read, deterministically and free.
  if (out.projectTeamV2 === undefined || out.technicalSpecs === undefined || out.officialDocuments === undefined) {
    try {
      const tas = tasOf(resultJson, ctx);
      const d = buildOfficialDossier(resultJson, tas, ctx.completedAt ?? null);
      if (out.projectTeamV2 === undefined) out.projectTeamV2 = d.projectTeamV2;
      if (out.technicalSpecs === undefined) out.technicalSpecs = d.technicalSpecs;
      if (out.officialDocuments === undefined) out.officialDocuments = d.officialDocuments;
    } catch {
      /* no section rather than a wrong one */
    }
  }
  if (out.companyFinance === undefined) {
    try {
      const cf = companyFinanceFrom(resultJson, buildCompanyIntelligence(resultJson));
      if (cf) out.companyFinance = cf;
    } catch {
      /* no section rather than a wrong one */
    }
  }
  if (!out.developerAds && !obj(resultJson)._developerAds && ctx.adsCost) {
    try {
      const ads = adsViewFromCostRecord(resultJson, ctx.adsCost, ctx.adsPolicy);
      if (ads) out.developerAds = ads;
    } catch {
      /* nothing rebuilt */
    }
  }
  return out as T;
}

/** The job's TAS picture, built once per enrichment and dated by the job, never the wall clock. */
function tasOf(resultJson: unknown, ctx: EnrichmentContext & { _tas?: TasIntelligence | null }): TasIntelligence | null {
  if (ctx._tas !== undefined) return ctx._tas;
  try {
    const at = ctx.completedAt && Number.isFinite(Date.parse(ctx.completedAt)) ? new Date(Date.parse(ctx.completedAt)).toISOString() : new Date().toISOString();
    const t = buildTasIntelligence(resultJson, at);
    ctx._tas = t.available ? t : null;
  } catch {
    ctx._tas = null;
  }
  return ctx._tas;
}

/*
 * "ACCEPTED INTO OPERATION" THAT NO RECORD SAYS.
 *
 * Reports built before the operative-only rule (PR #150) say the building
 * was accepted into operation from a cited resolution (job 220ed087: "2026
 * წლის 11 მარტის … ექსპლუატაციაში მიღებულად არის მონიშნული"). On read, when
 * the records re-checked today do not CONFIRM commissioning, those sentences
 * and status rows are removed and the stored official status is replaced by
 * the re-derived one. A negated sentence ("not yet accepted") is kept.
 */
const COMMISSIONED_CLAIM = /ექსპლუატაციაში\s+(?:მიღებულ|შესულ|შეყვანილ|მიღების\s+(?:აქტ|გადაწყვეტილებ))|ექსპლუატაციაში\s+მიღება|accepted\s+into\s+operation|\bcommissioned\b|принят\S*\s+в\s+эксплуатацию/iu;
const NEGATED = /(?:^|[\s,(])(?:არ|ვერ|არც|ჯერ\s+არ|not|never|no|не)(?=[\s,.)]|$)|დაუდასტურებ|ვერ\s+დასტურდ|not\s+(?:yet\s+)?(?:confirmed|verified)/iu;

export function stripUnsupportedCommissioning<T extends Record<string, any>>(report: T): T {
  if (!report || typeof report !== 'object') return report;
  const fixText = (t: unknown): unknown => {
    if (typeof t !== 'string' || !COMMISSIONED_CLAIM.test(t)) return t;
    return sentences(t).filter((x) => !COMMISSIONED_CLAIM.test(x) || NEGATED.test(x)).join(' ').trim();
  };
  const out: Record<string, any> = { ...report };
  if (out.summary && typeof out.summary === 'object') {
    out.summary = { ...out.summary, statement: fixText(out.summary.statement) };
    if (Array.isArray(out.summary.highlights))
      out.summary.highlights = out.summary.highlights.map((h: any) => ({ ...h, detail: fixText(h?.detail) })).filter((h: any) => typeof h.detail !== 'string' || h.detail.trim());
  }
  if (Array.isArray(out.keyFindings))
    out.keyFindings = out.keyFindings.map((k: any) => ({ ...k, finding: fixText(k?.finding), whyItMatters: fixText(k?.whyItMatters) })).filter((k: any) => typeof k.finding !== 'string' || k.finding.trim());
  if (Array.isArray(out.sections)) out.sections = out.sections.map((x: any) => ({ ...x, body: fixText(x?.body) }));
  if (out.propertyStory && Array.isArray(out.propertyStory.chapters))
    out.propertyStory = { ...out.propertyStory, chapters: out.propertyStory.chapters.map((c: any) => ({ ...c, body: fixText(c?.body) })).filter((c: any) => typeof c.body !== 'string' || c.body.trim()) };
  if (out.currentStatus && typeof out.currentStatus === 'object') {
    out.currentStatus = {
      ...out.currentStatus,
      statement: fixText(out.currentStatus.statement),
      items: Array.isArray(out.currentStatus.items)
        ? out.currentStatus.items.filter((i: any) => !(COMMISSIONED_CLAIM.test(String(i?.label ?? '')) || (COMMISSIONED_CLAIM.test(String(i?.value ?? '')) && !NEGATED.test(String(i?.value ?? '')))))
        : out.currentStatus.items,
    };
  }
  if (typeof out.finalView === 'string') out.finalView = fixText(out.finalView);
  return out as T;
}

function withLegalTruth<T extends Record<string, any>>(payload: T, resultJson: unknown, ctx: EnrichmentContext): T {
  const tas = tasOf(resultJson, ctx);
  if (!tas) return payload;
  const out: Record<string, any> = { ...payload };
  const fresh = officialHistoryView(tas);
  const stored = obj(out.officialHistory);
  if (fresh && Object.keys(stored).length) {
    const next: Record<string, any> = { ...stored };
    if (next.pendingApplications === undefined) next.pendingApplications = fresh.pendingApplications;
    if (next.currentPosition === undefined) next.currentPosition = fresh.currentPosition;
    if (next.futureDatedReferences === undefined) next.futureDatedReferences = fresh.futureDatedReferences;
    /*
     * Deterministic projections are re-derived on read: the filing-order case
     * chronology, the two newest cases, the pending stages, and the legal
     * claims (whose basis once carried an applicant's home address as a
     * "block" — job 8ba97da9). A stored permit status without its term gets
     * the term the act states.
     */
    next.caseChronology = fresh.caseChronology;
    next.latestCases = fresh.latestCases;
    next.pendingApplications = fresh.pendingApplications;
    next.currentPosition = fresh.currentPosition;
    next.legal = fresh.legal;
    if (obj(next.status).state === fresh.status.state && !obj(next.status).validUntil && fresh.status.validUntil)
      next.status = { ...obj(next.status), validUntil: fresh.status.validUntil };
    if (obj(stored.status).state === 'COMMISSIONED' && fresh.status.state !== 'COMMISSIONED') {
      next.status = fresh.status;
      next.legal = fresh.legal;
      next.milestones = fresh.milestones;
      next.milestoneGroups = fresh.milestoneGroups;
    }
    out.officialHistory = next;
  }
  const approved = tas.legalClaims.find((c) => c.key === 'COMMISSIONING_APPROVED');
  if (approved?.status !== 'CONFIRMED' && out.report) out.report = stripUnsupportedCommissioning(out.report);
  return out as T;
}

export function withPropertyRegister<T extends Record<string, any>>(payload: T, resultJson: unknown, ctx: EnrichmentContext = {}): T {
  if (!payload || typeof payload !== 'object') return payload;
  ctx = { ...ctx };
  payload = withRecoveredSections(payload, resultJson, ctx);
  payload = withLegalTruth(payload, resultJson, ctx);
  let reg: PropertyRegister | null = null;
  try {
    reg = buildPropertyRegister(obj(resultJson).browserOfficial);
  } catch {
    reg = null;
  }
  // The register reused from the buyer's own earlier check (registerReuse.ts) was persisted with the report.
  if (!reg?.latest && payload.registerSource && obj(payload.propertyRegister).latest) reg = payload.propertyRegister as PropertyRegister;
  // Reconciliation also removes the malformed purpose change, which needs no register.
  const report = payload.report ? reconcileReport(payload.report, reg) : payload.report;
  const officialHistory = payload.officialHistory ? cleanOfficialHistory(payload.officialHistory) : payload.officialHistory;
  /*
   * WHICH PROPERTY, DECIDED FROM OFFICIAL RECORDS (unitIdentity.ts): the exact
   * unit (verified by the NAPR extract when one was read), its parent parcel,
   * building/block, the research project/developer, and ownership with dates.
   * Re-derived on every read, so persisted reports carry it without a rebuild.
   */
  let unitIdentity: ReturnType<typeof buildUnitIdentity> = null;
  try {
    unitIdentity = buildUnitIdentity(resultJson);
  } catch {
    unitIdentity = null;
  }
  // v7: what kind of property the register says this is (propertyKind.ts); propertyType corrected from UNKNOWN.
  let kindFields: ReturnType<typeof propertyKindOverlay> = {};
  try {
    kindFields = propertyKindOverlay(resultJson, reg?.latest ?? null, payload.propertyType);
  } catch {
    kindFields = {};
  }
  if (!reg?.latest) return { ...payload, report, officialHistory, ...(unitIdentity ? { unitIdentity } : {}), ...kindFields };

  const snapshot = { ...obj(payload.snapshot) };
  const owner = ownerFromRegister(reg);
  if (owner) snapshot.owner = owner;

  let checklist = payload.checklist;
  try {
    const market = obj(payload.market);
    checklist = buildBuyerChecklist({
      cadastralCode: snapshot.cadastralCode ?? reg.cadastralCode,
      company: buildCompanyIntelligence(resultJson),
      market: payload.market ?? null,
      parkingMentioned: !!snapshot.parking,
      subjectPriceKnown: typeof market.subjectPricePerSqm === 'number',
      register: reg,
    }) as unknown as T['checklist'];
  } catch {
    /* keep the stored checklist */
  }

  const selfChecks = Array.isArray(payload.selfChecks) && privateOwner(reg)
    ? payload.selfChecks.filter((c: any) => c?.kind !== 'TAXPAYER_REGISTRY')
    : payload.selfChecks;

  // Ownership, mortgages step by step (application ≠ cancellation) and restrictions, scoped and dated.
  const legalPosition = unitLegalPosition(reg);
  return { ...payload, report, officialHistory, snapshot, checklist, selfChecks, propertyRegister: reg, ...(unitIdentity ? { unitIdentity } : {}), ...(legalPosition ? { unitLegalPosition: legalPosition } : {}), ...kindFields };
}
