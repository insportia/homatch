/*
 * WEIGHT, NOT HEADCOUNT.
 *
 * The live Villion report opened as NEEDS_ATTENTION. Underneath it were two
 * verified positives, a registry-confirmed company with named directors and a
 * clean 50/50 shareholding, a matched cadastral unit, a matched address — and
 * two open items, neither of which is a blocker:
 *
 *   · a mortgage on the PARENT PARCEL, which the extract explicitly neither
 *     extends to nor excludes from this unit
 *   · a commissioning status no authority had confirmed
 *
 * Two unresolved questions outvoted everything established, because the label
 * was effectively a count of things that were not finished. That is how a
 * sound property acquires an alarming headline.
 *
 * The opposite failure is worse and this module must not cause it: ONE
 * genuinely material risk — a charge registered against the unit itself, a
 * company in liquidation, an owner who is not the seller — outweighs any
 * number of cosmetic positives, and must still produce NEEDS_ATTENTION.
 *
 * ── WHY THIS READS STRUCTURED EVIDENCE, NOT PROSE ────────────────────
 *
 * Classifying the model's sentences would make the verdict depend on wording,
 * and wording changes every run. Every rule below is driven by fields the
 * research core persists, so the same property produces the same weight twice.
 *
 * ── AND WHY COVERAGE GAPS SCORE NOTHING ──────────────────────────────
 *
 * A thin crawl is not a property defect. If our search reached fewer sources,
 * internal confidence falls — the verdict does not. Letting coverage move the
 * label is exactly how "we found little" becomes "this looks risky".
 */

export type Severity = 'MATERIAL_RISK' | 'MODERATE_CONCERN' | 'MINOR_ROUTINE' | 'POSITIVE';

export type OverallLabel = 'POSITIVE' | 'BALANCED' | 'NEEDS_ATTENTION';

export interface SeveritySignal {
  /** Stable identifier, so a test can name what it expected. */
  key: string;
  severity: Severity;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface SeverityInput {
  /** result_json.rightsAndRestrictions */
  rights?: { status?: unknown; items?: unknown } | null;
  /** result_json.companyProfile */
  company?: {
    sourceBasis?: unknown;
    liquidationRegistered?: unknown;
    shareholdingConsistent?: unknown;
    encumbrances?: unknown;
    directors?: unknown;
    idCode?: unknown;
    registrationDate?: unknown;
  } | null;
  /** synthesis.snapshot */
  snapshot?: { constructionStatus?: unknown; owner?: unknown; cadastralCode?: unknown } | null;
  /** The model's own highlights, used only for POSITIVE credit. */
  highlights?: { sentiment?: unknown; headline?: unknown }[];
}

/**
 * Everything that carries weight, with the weight it carries.
 *
 * Deliberately explicit rather than scored: a reader of this function should
 * be able to say why a property was marked, and disagree with a specific line.
 */
export function severitySignals(input: SeverityInput): SeveritySignal[] {
  const out: SeveritySignal[] = [];
  const rightsItems = arr(input.rights?.items).map(str).filter(Boolean);
  const rightsStatus = str(input.rights?.status).toUpperCase();

  /* ---- MATERIAL: something adverse established against THIS unit ---- */

  /*
   * A restriction the registry actually identified. RESTRICTION_IDENTIFIED is
   * the research core's own vocabulary for "we read the record and it says
   * there is one" — as distinct from NOT_CONFIRMED, which means the record
   * did not settle the question.
   */
  if (rightsStatus === 'RESTRICTION_IDENTIFIED') {
    out.push({ key: 'sev_unit_restriction', severity: 'MATERIAL_RISK' });
  }
  if (input.company?.liquidationRegistered === true) {
    out.push({ key: 'sev_company_liquidation', severity: 'MATERIAL_RISK' });
  }
  if (input.company?.shareholdingConsistent === false) {
    out.push({ key: 'sev_shareholding_inconsistent', severity: 'MATERIAL_RISK' });
  }

  /* ---- MODERATE: real, open, and resolvable before signing ---- */

  /*
   * A charge on the PARENT PARCEL. Real and worth acting on, and explicitly
   * not established against this unit — the extract says so itself. Treating
   * it as material would condemn most new-build flats in the country, which
   * are sold out of exactly this arrangement.
   *
   * ONE REAL-WORLD FACT, ONE SIGNAL.
   *
   * `rights.status` is NOT_CONFIRMED precisely BECAUSE the parent-parcel item
   * is unresolved — the two sentences in `items` describe a single open
   * question. Counting both made the Villion report carry three moderate
   * concerns where the evidence holds two, which was enough to outvote five
   * verified positives and produce the alarming headline this module exists
   * to prevent. The specific signal wins; the generic one only fires when
   * nothing more precise explains it.
   */
  const parentParcel = rightsItems.some(
    (i) => /მშობელ ნაკვეთ|parent (?:parcel|plot)|материнск/i.test(i)
  );
  if (parentParcel) {
    out.push({ key: 'sev_parent_parcel_charge', severity: 'MODERATE_CONCERN' });
  } else if (rightsStatus === 'NOT_CONFIRMED') {
    out.push({ key: 'sev_rights_open', severity: 'MODERATE_CONCERN' });
  }

  /*
   * A pledge registered against the COMPANY is not a charge on the flat — the
   * company card says exactly that to the customer, and the severity model
   * must agree with the page. It is worth confirming, which makes it routine
   * advice rather than a concern about this property.
   */
  if (arr(input.company?.encumbrances).length) {
    out.push({ key: 'sev_company_obligation', severity: 'MINOR_ROUTINE' });
  }

  /* ---- MINOR: ordinary confirmations a careful buyer performs anyway ---- */

  const construction = str(input.snapshot?.constructionStatus);
  if (construction && /არ წარმოადგენს|not .*proof|не является/i.test(construction)) {
    out.push({ key: 'sev_commissioning_check', severity: 'MINOR_ROUTINE' });
  }
  if (arr(input.company?.directors).length > 1) {
    out.push({ key: 'sev_joint_signature', severity: 'MINOR_ROUTINE' });
  }

  /* ---- POSITIVE: what the run actually established ---- */

  if (str(input.company?.sourceBasis) === 'REGISTRY_CONFIRMED') {
    out.push({ key: 'sev_company_registry_confirmed', severity: 'POSITIVE' });
  }
  if (str(input.company?.idCode)) {
    out.push({ key: 'sev_company_identified', severity: 'POSITIVE' });
  }
  if (str(input.snapshot?.cadastralCode)) {
    out.push({ key: 'sev_unit_identified', severity: 'POSITIVE' });
  }
  for (const h of input.highlights ?? []) {
    if (str(h?.sentiment).toUpperCase() === 'POSITIVE' && str(h?.headline)) {
      out.push({ key: `sev_highlight:${str(h.headline)}`, severity: 'POSITIVE' });
    }
  }

  return out;
}

export interface Weighed {
  label: OverallLabel;
  material: number;
  moderate: number;
  minor: number;
  positive: number;
}

/**
 * The verdict, from weight.
 *
 * MATERIAL dominates absolutely: one is enough, however good everything else
 * looks. Below that, moderate concerns have to actually outweigh what was
 * established rather than merely exist — which is the single change that stops
 * a sound property opening with an alarm.
 *
 * MINOR_ROUTINE never moves the label on its own. "Check both directors sign"
 * is advice, and a report whose headline darkens because it offered good
 * advice has taught the reader to ignore its headline.
 */
export function weighVerdict(signals: SeveritySignal[]): Weighed {
  const count = (s: Severity) => signals.filter((x) => x.severity === s).length;
  const material = count('MATERIAL_RISK');
  const moderate = count('MODERATE_CONCERN');
  const minor = count('MINOR_ROUTINE');
  const positive = count('POSITIVE');

  const label: OverallLabel =
    material > 0
      ? 'NEEDS_ATTENTION'
      : // Moderate concerns lead only when they are not outweighed by what the
        // run established. Three verified positives against two open questions
        // is a balanced picture, not an alarming one.
        moderate > 0 && moderate * 2 > positive
        ? 'NEEDS_ATTENTION'
        : moderate > 0
          ? 'BALANCED'
          : positive > 0
            ? 'POSITIVE'
            : 'BALANCED';

  return { label, material, moderate, minor, positive };
}
