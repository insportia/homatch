// HOMATCH — the evidence package handed to the Buyer Intelligence synthesis.
//
// WHY THIS EXISTS
// ---------------
// Verify collects a great deal about a property. The old synthesis path threw
// most of it away before the model ever saw it, in two places:
//
//   1. extractClaims() reads a handful of report fields and emits typed
//      claims. It never touches `publicResearch` at all — the block that
//      carries the developer, the legal company, the project, the financing
//      partner and the public construction chronology. On the real production
//      job for 01.18.06.019.055.03.01.601 that was ~3,900 characters of
//      already-researched context, including the sentence naming the bank as
//      the project's financing partner AND tying it to the parent-parcel
//      mortgage. Discarded.
//
//   2. buildRenderPrompt() then reduced every surviving fact to
//      `{ key, statement }`. Source, date, provenance, certainty and
//      corroboration were all dropped on the floor.
//
// The result was a model asked to write about a property while holding only a
// list of bare sentences — so it produced exactly what it had: "a mortgage
// exists", "sources are inconsistent". Not wrong. Just almost worthless next
// to what the research actually knew.
//
// This module is the fix. It reads the WHOLE report and produces structured,
// individually-citable evidence that keeps provenance and certainty attached,
// tiered so that registry evidence can never be crowded out by social noise.
//
// It is pure: same report in, same package out. No clock, no network, no
// database — so it is fully testable, and it is safe to run inside an Edge
// Function.

export type Tier = 1 | 2 | 3 | 4 | 5;

export type Provenance =
  | 'OFFICIAL_REGISTRY'
  | 'OFFICIAL_DOCUMENT'
  | 'DEVELOPER_STATEMENT'
  | 'PARTNER_PUBLICATION'
  | 'MARKET_LISTING'
  | 'MEDIA_REPORT'
  | 'SOCIAL_SIGNAL'
  | 'HUMAN_ASSISTED'
  | 'DERIVED';

/**
 * How strongly the evidence supports the claim. This is the vocabulary the
 * report is required to use instead of flattening everything to good/bad.
 */
export type Certainty =
  | 'CONFIRMED'      // an official source states it
  | 'CORROBORATED'   // two or more independent sources agree
  | 'REPORTED'       // a credible publication states it
  | 'CLAIMED'        // the developer or an interested party states it
  | 'OBSERVED'       // seen in market/listing data
  | 'UNCONFIRMED';   // present but nothing independent supports it

export type Category =
  | 'PROPERTY'
  | 'OWNERSHIP'
  | 'ENCUMBRANCE'
  | 'LEGAL_CHECK'
  | 'PROJECT'
  | 'DEVELOPER'
  | 'FINANCING'
  | 'MARKET'
  | 'DOCUMENT'
  | 'MEDIA'
  | 'SOCIAL';

export interface EvidenceItem {
  /** Stable citation handle. The model may cite only these. */
  id: string;
  tier: Tier;
  category: Category;
  /** The claim, already in customer language. */
  claim: string;
  provenance: Provenance;
  certainty: Certainty;
  source?: string;
  url?: string;
  date?: string;
  entity?: string;
  documentRef?: string;
  /** True when more than one independent source carries it. */
  corroborated?: boolean;
  /** True when it describes the past rather than the present. */
  historical?: boolean;
  /** Set when sources disagree; both sides are kept, never merged. */
  conflictsWith?: string;
}

export interface UnavailableCheck {
  /** What could not be established, in customer language. */
  label: string;
  /** Why, when the report says. Never invented. */
  note?: string;
  /** True when a human can finish it (the RS.ge questionnaire path). */
  humanAssistable: boolean;
}

export interface MarketContext {
  medianPricePerSqm?: string;
  rangePerSqm?: string;
  comparableCount: number;
  sameProjectCount: number;
  /** Verbatim reasoning the research produced about pricing. */
  reasoning: string[];
  /** Always true. Listings are asks, not completed sales. */
  askingNotTransaction: true;
}

export interface EvidencePackage {
  subject: {
    cadastralCode?: string;
    parentCadastralCode?: string;
    address?: string;
    area?: string;
    unitNumber?: string;
    floor?: string;
    project?: string;
    developer?: string;
    legalCompany?: string;
    companyId?: string;
  };
  items: EvidenceItem[];
  unavailable: UnavailableCheck[];
  market: MarketContext | null;
  /** Counts by tier, so the prompt can tell the model how rich this case is. */
  tierCounts: Record<Tier, number>;
  /** True when items were dropped to fit the budget. */
  truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Strips markdown noise the research layer sometimes emits. */
const clean = (v: unknown): string =>
  str(v).replace(/\*\*/g, '').replace(/#{1,6}\s*/g, '').replace(/\s+/g, ' ').trim();

const nonEmpty = (v: unknown): string | undefined => {
  const s = clean(v);
  return s ? s : undefined;
};

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Rejects text that cannot be shown to a customer.
 *
 * The historical registry documents in this pipeline sometimes carry
 * mis-decoded Georgian — long runs of replacement characters or control
 * bytes. The old UI printed it raw. A report must not: unreadable bytes teach
 * the customer nothing and make everything around them look untrustworthy.
 * The underlying source data is untouched; only presentation refuses it.
 */
export function isPresentable(text: unknown): boolean {
  const s = str(text);
  if (!s.trim()) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) return false;
  const bad = (s.match(/[�]/g) ?? []).length;
  if (bad > 0 && bad / s.length > 0.02) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * The builder                                                         *
 * ------------------------------------------------------------------ */

/** Per-tier caps. Registry evidence is never squeezed out by social posts. */
const TIER_CAP: Record<Tier, number> = { 1: 60, 2: 40, 3: 25, 4: 12, 5: 20 };

export function buildEvidencePackage(report: unknown): EvidencePackage {
  const r = obj(report);
  const items: EvidenceItem[] = [];
  let n = 0;
  const add = (i: Omit<EvidenceItem, 'id'>): void => {
    if (!isPresentable(i.claim)) return;
    items.push({ ...i, id: `e${++n}` });
  };

  const pr = obj(r.publicResearch);
  const unit = obj(r.exactUnit);
  const parent = obj(r.identifiedParent);
  const company = obj(r.companyProfile);
  const project = obj(r.projectProfile);

  const subject = {
    cadastralCode: nonEmpty(unit.cadastralCode ?? unit.code),
    parentCadastralCode: nonEmpty(parent.code ?? parent.cadastralCode),
    address: nonEmpty(unit.address ?? parent.address ?? r.address),
    area: nonEmpty(unit.area ?? unit.areaSqm),
    unitNumber: nonEmpty(unit.unitNumber ?? unit.apartmentNumber),
    floor: nonEmpty(unit.floor),
    project: nonEmpty(pr.project ?? project.name),
    developer: nonEmpty(pr.developer ?? project.developer),
    legalCompany: nonEmpty(pr.legalCompany ?? company.name),
    companyId: nonEmpty(pr.companyId ?? company.idCode),
  };

  /* ---- TIER 1: official property, ownership, encumbrance, checks ---- */

  for (const f of arr<unknown>(pr.facts)) {
    // publicResearch.facts are the research layer's own synthesised
    // statements about the subject. They are the single richest block in the
    // report and were previously read by nothing at all.
    add({
      tier: 1, category: 'PROPERTY', claim: clean(f),
      provenance: 'DERIVED', certainty: 'CORROBORATED', corroborated: true,
    });
  }

  const ls = obj(r.legalStatus);
  for (const [key, raw] of Object.entries(ls)) {
    const c = obj(raw);
    const label = nonEmpty(c.label) ?? key;
    const status = str(c.status).toUpperCase();
    const note = nonEmpty(c.note);
    if (status === 'HUMAN_VERIFICATION_REQUIRED' || status === 'NOT_CONFIRMED') continue; // handled as unavailable
    add({
      tier: 1,
      category: 'LEGAL_CHECK',
      claim: note ? `${label}: ${note}` : label,
      provenance: 'OFFICIAL_REGISTRY',
      certainty: 'CONFIRMED',
      source: label,
      // CONFIRMED_ATTENTION is a real finding that needs explaining, not a
      // verdict. The report decides what it means in context.
      conflictsWith: status === 'CONFIRMED_ATTENTION' ? 'ATTENTION' : undefined,
    });
  }

  const rr = obj(r.rightsAndRestrictions);
  for (const [, raw] of Object.entries(rr)) {
    for (const entry of arr<unknown>(raw)) {
      // The object key here ("items", "mortgages", ...) is a shape detail, not
      // a source. Passing it through put the literal word `items` on a
      // customer's screen as though it were where the fact came from.
      add({
        tier: 1, category: 'ENCUMBRANCE', claim: clean(entry),
        provenance: 'OFFICIAL_REGISTRY', certainty: 'CONFIRMED',
      });
    }
  }

  for (const f of arr<Record<string, unknown>>(r.technicalFacts)) {
    const value = nonEmpty(f?.value);
    if (!value) continue;
    add({
      tier: 1, category: 'DOCUMENT',
      claim: `${nonEmpty(f?.key) ? `${nonEmpty(f?.key)}: ` : ''}${value}`,
      provenance: 'OFFICIAL_DOCUMENT', certainty: 'CONFIRMED',
      documentRef: nonEmpty(f?.documentTitle), date: nonEmpty(f?.documentDate),
    });
  }

  for (const e of arr<Record<string, unknown>>(r.officialEvidence)) {
    const claim = nonEmpty(e?.statement ?? e?.text ?? e?.claim);
    if (!claim) continue;
    add({
      tier: 1, category: 'DOCUMENT', claim,
      provenance: 'OFFICIAL_DOCUMENT', certainty: 'CONFIRMED',
      date: nonEmpty(e?.date), documentRef: nonEmpty(e?.documentTitle ?? e?.title),
    });
  }

  /* ---- TIER 2: project, developer, company, FINANCING ---- */

  // Financing partners are the reason this whole rewrite exists: a mortgage
  // read without them looks like a defect, and read with them looks like
  // ordinary project finance that still needs a release mechanism.
  for (const p of arr<unknown>(pr.partners)) {
    add({
      tier: 2, category: 'FINANCING', claim: clean(p),
      provenance: 'DEVELOPER_STATEMENT', certainty: 'CLAIMED', entity: subject.developer,
    });
  }
  if (nonEmpty(pr.financingBank)) {
    add({
      tier: 2, category: 'FINANCING',
      claim: `პროექტის დაფინანსების პარტნიორად საჯაროდ მითითებულია ${clean(pr.financingBank)}.`,
      provenance: 'DEVELOPER_STATEMENT', certainty: 'CLAIMED',
      entity: clean(pr.financingBank),
    });
  }

  const DEVELOPER_CLAIMS: [string, Category][] = [
    ['developerReputation', 'DEVELOPER'], ['companyHistory', 'DEVELOPER'],
    ['currentPhysicalStatus', 'PROJECT'], ['progressHistory', 'PROJECT'],
    ['chronology', 'PROJECT'], ['structuralSystem', 'PROJECT'],
    ['seismicDesign', 'PROJECT'], ['energyEfficiency', 'PROJECT'],
    ['constructionMaterials', 'PROJECT'], ['windows', 'PROJECT'],
    ['elevators', 'PROJECT'], ['parking', 'PROJECT'], ['landscaping', 'PROJECT'],
    ['MEP', 'PROJECT'], ['insulation', 'PROJECT'], ['facade', 'PROJECT'],
  ];
  for (const [key, category] of DEVELOPER_CLAIMS) {
    const v = nonEmpty(pr[key]);
    if (v) {
      add({
        tier: 2, category, claim: v,
        provenance: 'DEVELOPER_STATEMENT', certainty: 'CLAIMED', entity: subject.developer,
      });
    }
  }
  for (const a of arr<unknown>(pr.amenities)) {
    add({ tier: 2, category: 'PROJECT', claim: clean(a), provenance: 'DEVELOPER_STATEMENT', certainty: 'CLAIMED' });
  }
  for (const s of arr<unknown>(pr.suppliers)) {
    add({ tier: 2, category: 'PROJECT', claim: clean(s), provenance: 'PARTNER_PUBLICATION', certainty: 'REPORTED' });
  }
  for (const q of arr<unknown>(pr.qualitySignals)) {
    add({ tier: 2, category: 'PROJECT', claim: clean(q), provenance: 'PARTNER_PUBLICATION', certainty: 'REPORTED' });
  }
  for (const key of ['directorsRepresentatives', 'foundersOwnersParticipants', 'previousProjects']) {
    for (const v of arr<unknown>(pr[key])) {
      add({ tier: 2, category: 'DEVELOPER', claim: clean(v), provenance: 'DERIVED', certainty: 'REPORTED' });
    }
  }
  for (const [k, label] of [['name', 'კომპანია'], ['status', 'სტატუსი'], ['registrationDate', 'რეგისტრაცია'], ['address', 'მისამართი']] as const) {
    const v = nonEmpty(company[k]);
    if (v) {
      add({
        tier: 2, category: 'DEVELOPER', claim: `${label}: ${v}`,
        provenance: str(company.sourceBasis).toUpperCase() === 'REGISTRY_CONFIRMED' ? 'OFFICIAL_REGISTRY' : 'DERIVED',
        certainty: str(company.sourceBasis).toUpperCase() === 'REGISTRY_CONFIRMED' ? 'CONFIRMED' : 'REPORTED',
        entity: subject.legalCompany,
      });
    }
  }

  /* ---- TIER 3: market ---- */

  const m = obj(r.market);
  const comparables = arr<Record<string, unknown>>(m.comparables);
  for (const c of comparables) {
    const price = nonEmpty(c?.price);
    const per = nonEmpty(c?.pricePerSqm);
    const area = nonEmpty(c?.area);
    if (!price && !per) continue;
    const bits = [
      nonEmpty(c?.project) ? `${clean(c.project)}` : null,
      area ? `${area} კვ.მ` : null,
      price ? `${price} ${nonEmpty(c?.currency) ?? ''}`.trim() : null,
      per ? `${per}/კვ.მ` : null,
    ].filter(Boolean);
    add({
      tier: 3, category: 'MARKET',
      claim: `${bits.join(' · ')}${nonEmpty(c?.similarity) ? ` — ${clean(c.similarity)}` : ''}`,
      provenance: 'MARKET_LISTING',
      certainty: 'OBSERVED',
      source: nonEmpty(c?.source),
      url: nonEmpty(c?.url),
      date: nonEmpty(c?.retrievedAt ?? c?.listingDate),
    });
  }

  /* ---- TIER 4: media and social ---- */

  for (const v of arr<unknown>(pr.mediaCoverage)) {
    add({ tier: 4, category: 'MEDIA', claim: clean(v), provenance: 'MEDIA_REPORT', certainty: 'REPORTED' });
  }
  for (const key of ['socialPublicFootprint', 'legalPublicFootprint']) {
    for (const v of arr<unknown>(pr[key])) {
      add({ tier: 4, category: 'SOCIAL', claim: clean(v), provenance: 'SOCIAL_SIGNAL', certainty: 'UNCONFIRMED' });
    }
  }
  for (const key of ['disputes', 'complaints']) {
    for (const v of arr<unknown>(pr[key])) {
      add({ tier: 4, category: 'MEDIA', claim: clean(v), provenance: 'MEDIA_REPORT', certainty: 'UNCONFIRMED' });
    }
  }
  for (const e of arr<Record<string, unknown>>(r.publicEvidence)) {
    const claim = nonEmpty(e?.statement ?? e?.text ?? e?.claim);
    if (!claim) continue;
    add({
      tier: 4, category: 'MEDIA', claim,
      provenance: 'MEDIA_REPORT', certainty: 'REPORTED',
      url: nonEmpty(e?.url), date: nonEmpty(e?.date),
    });
  }

  /* ---- TIER 5: historical supporting detail ---- */

  for (const d of arr<Record<string, unknown>>(r.officialDocumentsRetrieved)) {
    const title = nonEmpty(d?.title ?? d?.documentTitle);
    if (!title) continue;
    add({
      tier: 5, category: 'DOCUMENT', claim: title,
      provenance: 'OFFICIAL_DOCUMENT', certainty: 'CONFIRMED',
      date: nonEmpty(d?.date ?? d?.documentDate), historical: true,
    });
  }
  for (const t of arr<Record<string, unknown>>(r.revisionTimeline)) {
    const label = nonEmpty(t?.title ?? t?.label ?? t?.event);
    if (!label) continue;
    add({
      tier: 5, category: 'DOCUMENT', claim: label,
      provenance: 'OFFICIAL_DOCUMENT', certainty: 'CONFIRMED',
      date: nonEmpty(t?.date), historical: true,
    });
  }

  /* ---- what could NOT be established ---- */

  const unavailable: UnavailableCheck[] = [];
  const seenUnavailable = new Set<string>();
  const pushUnavailable = (label: string, note?: string, humanAssistable = false): void => {
    const key = label.toLowerCase();
    if (!label || seenUnavailable.has(key) || !isPresentable(label)) return;
    seenUnavailable.add(key);
    unavailable.push({ label, note, humanAssistable });
  };

  for (const [, raw] of Object.entries(ls)) {
    const c = obj(raw);
    const status = str(c.status).toUpperCase();
    if (status !== 'HUMAN_VERIFICATION_REQUIRED' && status !== 'NOT_CONFIRMED') continue;
    pushUnavailable(
      nonEmpty(c.label) ?? 'შემოწმება',
      nonEmpty(c.note),
      status === 'HUMAN_VERIFICATION_REQUIRED'
    );
  }
  for (const u of arr<unknown>(r.unverified)) pushUnavailable(clean(u));
  for (const o of arr<Record<string, unknown>>(r.officialSourcesNotVerified)) {
    pushUnavailable(nonEmpty(o?.sourceName ?? o?.source) ?? '', nonEmpty(o?.reason));
  }

  /* ---- market context ---- */

  const drivers = obj(m.priceDrivers);
  const reasoning = arr<unknown>(drivers.reasoning).map(clean).filter(isPresentable);
  const market: MarketContext | null =
    comparables.length || reasoning.length || nonEmpty(m.activeMedianPricePerSqm)
      ? {
          medianPricePerSqm: nonEmpty(m.activeMedianPricePerSqm),
          rangePerSqm:
            nonEmpty(m.activeMinPricePerSqm) && nonEmpty(m.activeMaxPricePerSqm)
              ? `${nonEmpty(m.activeMinPricePerSqm)} – ${nonEmpty(m.activeMaxPricePerSqm)}`
              : undefined,
          comparableCount: comparables.length,
          sameProjectCount: comparables.filter(
            (c) => str(c?.comparableType).toUpperCase() === 'SAME_PROJECT'
          ).length,
          reasoning,
          askingNotTransaction: true,
        }
      : null;

  /* ---- budget ---- */

  const kept: EvidenceItem[] = [];
  const used: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let truncated = false;
  // Ordered by tier so a cap never drops registry evidence in favour of a
  // social post that happened to be extracted earlier.
  for (const tier of [1, 2, 3, 4, 5] as Tier[]) {
    for (const item of items.filter((i) => i.tier === tier)) {
      if (used[tier] >= TIER_CAP[tier]) { truncated = true; continue; }
      used[tier]++;
      kept.push(item);
    }
  }

  return {
    subject,
    items: kept,
    unavailable,
    market,
    tierCounts: { 1: used[1], 2: used[2], 3: used[3], 4: used[4], 5: used[5] } as Record<Tier, number>,
    truncated,
  };
}

/** Total evidence weight, used to decide how substantial a report may be. */
export function evidenceRichness(pkg: EvidencePackage): 'RICH' | 'MODERATE' | 'SPARSE' {
  const weighted =
    pkg.tierCounts[1] * 3 + pkg.tierCounts[2] * 2 + pkg.tierCounts[3] + pkg.tierCounts[4] * 0.5;
  if (weighted >= 40) return 'RICH';
  if (weighted >= 12) return 'MODERATE';
  return 'SPARSE';
}
