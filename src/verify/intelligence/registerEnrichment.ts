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

import { buildPropertyRegister, reconcileReport } from './propertyRegister.ts';
import type { PropertyRegister } from './propertyRegister.ts';
import { buildBuyerChecklist } from './buyerChecklist.ts';
import { buildCompanyIntelligence } from './companyIntelligence.ts';
import { ownerFromRegister } from './bundle.ts';
import { acceptableValue } from './tasIntelligence.ts';
import { marketContextFrom, companyFinanceFrom, adsViewFromCostRecord } from './reportGaps.ts';
import type { AdsCostRecord } from './reportGaps.ts';

export interface EnrichmentContext {
  /** When the job completed — dates a legacy reused market snapshot. */
  completedAt?: string | null;
  /** The job's DEVELOPER_ADS_VERIFY cost record, when its result was lost. */
  adsCost?: AdsCostRecord | null;
  /** Admin verify_developer_ads setting (country, term limit). */
  adsPolicy?: unknown;
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

export function withPropertyRegister<T extends Record<string, any>>(payload: T, resultJson: unknown, ctx: EnrichmentContext = {}): T {
  if (!payload || typeof payload !== 'object') return payload;
  payload = withRecoveredSections(payload, resultJson, ctx);
  let reg: PropertyRegister | null = null;
  try {
    reg = buildPropertyRegister(obj(resultJson).browserOfficial);
  } catch {
    reg = null;
  }
  // Reconciliation also removes the malformed purpose change, which needs no register.
  const report = payload.report ? reconcileReport(payload.report, reg) : payload.report;
  const officialHistory = payload.officialHistory ? cleanOfficialHistory(payload.officialHistory) : payload.officialHistory;
  if (!reg?.latest) return { ...payload, report, officialHistory };

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

  return { ...payload, report, officialHistory, snapshot, checklist, selfChecks, propertyRegister: reg };
}
