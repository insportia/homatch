/**
 * UTILITIES AND SITE READINESS — evidence, not a row of ticks.
 *
 * For a flat, "is there electricity" is nearly rhetorical. For LAND it is the
 * question: a parcel with a live electricity subscription and a water main at
 * the boundary is a different asset from one with neither, and the difference
 * is most of the development cost. The report used to reduce all of it to
 * three states and a grey note, which threw away the part a buyer needed.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 *
 * It is a READING of evidence the existing research already produces, put on
 * a readiness ladder and carrying its provenance. It is not a second research
 * engine, it starts nothing, and it fetches nothing. When Research Core later
 * emits richer utility evidence, `normalizeUtilities` already accepts it and
 * the report gains detail without a UI change.
 *
 * THE LADDER
 *
 * Ordered by how much has actually happened on the ground. The rule for
 * placing a finding on it is the same rule as everywhere else in this
 * product: use the closest state the EVIDENCE supports, and never a higher
 * one. "The provider lists an active subscription" is not "connected and
 * working"; "a main runs past the plot" is not "available to connect".
 *
 *   UNKNOWN                            nothing was established
 *   NOT_CONNECTED                      a source positively says there is none
 *   NEARBY                             infrastructure exists near the site
 *   AVAILABLE_FOR_CONNECTION           a connection can be applied for
 *   APPLICATION_OR_CONNECTION_IN_PROGRESS
 *   CONNECTED                          physically connected
 *   ACTIVE_OR_SUBSCRIBED               a live account or metered supply
 *
 * NOT_CONNECTED sits low but is NOT the same as UNKNOWN, and putting it on
 * the ladder is deliberate: "we looked and there is none" is a finding a
 * buyer can act on, and collapsing it into "we don't know" would lose it.
 * Equally it is not NEARBY — proximity is a separate claim needing separate
 * evidence, and inferring it would be inventing precision.
 *
 * WHAT IS NEVER INFERRED
 *
 * One utility says nothing about another, and no utility says anything about
 * whether a building is finished. A live electricity account on a plot does
 * not mean water, gas, or a road, and nothing here aggregates upward into
 * "site ready". Each finding stands on its own evidence.
 */

export type UtilityKind =
  | 'ELECTRICITY'
  | 'WATER'
  | 'SEWERAGE'
  | 'GAS'
  | 'INTERNET'
  /** Practical site access. Meaningful for land; usually not for a flat. */
  | 'ACCESS_ROAD';

export type UtilityReadiness =
  | 'UNKNOWN'
  | 'NOT_CONNECTED'
  | 'NEARBY'
  | 'AVAILABLE_FOR_CONNECTION'
  | 'APPLICATION_OR_CONNECTION_IN_PROGRESS'
  | 'CONNECTED'
  | 'ACTIVE_OR_SUBSCRIBED';

/** Low to high. Used for ordering and for "is this stronger than that". */
export const READINESS_ORDER: UtilityReadiness[] = [
  'UNKNOWN',
  'NOT_CONNECTED',
  'NEARBY',
  'AVAILABLE_FOR_CONNECTION',
  'APPLICATION_OR_CONNECTION_IN_PROGRESS',
  'CONNECTED',
  'ACTIVE_OR_SUBSCRIBED',
];

export interface UtilityEvidence {
  url?: string | null;
  label?: string | null;
  /** When the source last said so. Freshness is part of the claim. */
  asOf?: string | null;
}

export interface UtilityFinding {
  kind: UtilityKind;
  readiness: UtilityReadiness;
  /** The utility company or authority, when a source named one. */
  provider?: string | null;
  /** What the source actually confirms, in its own terms. Never a summary. */
  confirms?: string | null;
  /** The address, cadastral code or account the evidence is tied to. */
  linkage?: string | null;
  evidence: UtilityEvidence[];
  asOf?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  /** True only when an authoritative source was read, not inferred. */
  verified: boolean;
}

/** The order a reader expects, not the order the data arrived in. */
const KIND_ORDER: UtilityKind[] = [
  'ELECTRICITY', 'WATER', 'SEWERAGE', 'GAS', 'INTERNET', 'ACCESS_ROAD',
];

/** The legacy matrix's keys, and the kinds they mean. */
const LEGACY_KEYS: Record<string, UtilityKind> = {
  electricity: 'ELECTRICITY',
  water: 'WATER',
  sewage: 'SEWERAGE',
  sewerage: 'SEWERAGE',
  gas: 'GAS',
  internet: 'INTERNET',
  accessRoad: 'ACCESS_ROAD',
  access_road: 'ACCESS_ROAD',
};

/**
 * Phrases that raise a CONFIRMED_CONNECTED to ACTIVE_OR_SUBSCRIBED.
 *
 * Only a statement about a LIVE ACCOUNT counts. "Connected" is the physical
 * fact; "subscribed", "active account", "metered", "billed" are statements
 * that somebody is being supplied today, which is the stronger claim and the
 * one a buyer of land actually wants. Matched on the source's own words, in
 * the languages those words arrive in.
 */
const ACTIVE_PHRASES = [
  /\bactive\s+(subscription|account|supply|contract)\b/i,
  /\bsubscrib(ed|er)\b/i,
  /\bmetered\b/i,
  /\bbilling\s+account\b/i,
  // Georgian: "აქტიური" (active), "აბონენტი" (subscriber).
  /აქტიური/,
  /აბონენტ/,
  /* Russian: "активный абонент", "лицевой счёт".
   *
   * `\w` is ASCII-only in JavaScript, so `активн\w*` can never match
   * "активный" — the suffix is Cyrillic. Written with an explicit Cyrillic
   * class instead, which is the same trap that once made every Georgian rent
   * query return UNKNOWN. */
  /активн[а-яё]*\s+абонент/i,
  /лицевой\s+сч[её]т/i,
];

const looksActive = (text: string | null | undefined): boolean =>
  !!text && ACTIVE_PHRASES.some((re) => re.test(text));

/**
 * Map one legacy status plus whatever the note says onto the ladder.
 *
 * The legacy vocabulary carries three values. Nothing here upgrades beyond
 * what they mean, with one exception that is itself evidence-driven: a
 * CONFIRMED_CONNECTED whose note states a live account is ACTIVE_OR_SUBSCRIBED,
 * because that is what the source said, not what we decided.
 */
export function readinessFromLegacy(
  status: string | null | undefined,
  note?: string | null,
): UtilityReadiness {
  switch (String(status ?? '').toUpperCase()) {
    case 'CONFIRMED_CONNECTED':
      return looksActive(note) ? 'ACTIVE_OR_SUBSCRIBED' : 'CONNECTED';
    case 'CONFIRMED_NOT_CONNECTED':
      return 'NOT_CONNECTED';
    // NOT_MENTIONED / NOT_CONFIRMED / anything unrecognised. A source that
    // did not speak about a utility has told us nothing about it.
    default:
      return 'UNKNOWN';
  }
}

/** A value already on the ladder, or UNKNOWN. Never a guess. */
function readinessOf(v: unknown): UtilityReadiness | null {
  const s = String(v ?? '').toUpperCase();
  return (READINESS_ORDER as string[]).includes(s) ? (s as UtilityReadiness) : null;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

function evidenceOf(v: unknown): UtilityEvidence[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { url: str(o.url), label: str(o.label) ?? str(o.title), asOf: str(o.asOf) ?? str(o.date) };
    })
    .filter((e) => e.url || e.label);
}

/**
 * Every utility finding this report supports, strongest evidence first.
 *
 * Accepts two shapes and prefers the richer one:
 *
 *   report.utilities        an array of findings already on the ladder, with
 *                           provider, provenance and dates — what Research
 *                           Core emits once it carries them;
 *   report.utilitiesMatrix  the legacy five-key object of status + note.
 *
 * A kind present in both is taken from the richer source. A kind present in
 * neither is simply absent — an empty list means nothing was established,
 * which the card renders as UNKNOWN rather than as an absent section.
 */
export function normalizeUtilities(report: unknown): UtilityFinding[] {
  const r = (report ?? {}) as Record<string, unknown>;
  const byKind = new Map<UtilityKind, UtilityFinding>();

  // Legacy first, so the richer shape overwrites it rather than the reverse.
  const matrix = (r.utilitiesMatrix ?? {}) as Record<string, unknown>;
  for (const [key, kind] of Object.entries(LEGACY_KEYS)) {
    const raw = matrix[key] as Record<string, unknown> | undefined;
    if (!raw) continue;
    const note = str(raw.note);
    byKind.set(kind, {
      kind,
      readiness: readinessFromLegacy(raw.status as string, note),
      provider: str(raw.provider),
      confirms: note,
      linkage: str(raw.linkage) ?? str(raw.address),
      evidence: evidenceOf(raw.evidence),
      asOf: str(raw.asOf),
      // The legacy matrix carries no verification flag of its own. A
      // confirmed status came from an authoritative read; anything else did
      // not, and claiming otherwise would be the invention this guards.
      confidence: null,
      verified: String(raw.status ?? '').toUpperCase().startsWith('CONFIRMED'),
    });
  }

  const rich = Array.isArray(r.utilities) ? (r.utilities as Record<string, unknown>[]) : [];
  for (const raw of rich) {
    const kindKey = String(raw.kind ?? raw.type ?? '').toUpperCase();
    const kind = (KIND_ORDER as string[]).includes(kindKey)
      ? (kindKey as UtilityKind)
      : LEGACY_KEYS[String(raw.kind ?? raw.type ?? '')];
    if (!kind) continue;
    const readiness = readinessOf(raw.readiness ?? raw.status)
      ?? readinessFromLegacy(raw.status as string, str(raw.confirms) ?? str(raw.note));
    const conf = String(raw.confidence ?? '').toUpperCase();
    byKind.set(kind, {
      kind,
      readiness,
      provider: str(raw.provider) ?? str(raw.authority),
      confirms: str(raw.confirms) ?? str(raw.note),
      linkage: str(raw.linkage) ?? str(raw.address) ?? str(raw.cadastralCode),
      evidence: evidenceOf(raw.evidence),
      asOf: str(raw.asOf) ?? str(raw.date),
      confidence: conf === 'HIGH' || conf === 'MEDIUM' || conf === 'LOW' ? conf : null,
      verified: raw.verified === true,
    });
  }

  return [...byKind.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
}

/**
 * Whether this report is about land, and so whether site readiness is a
 * headline rather than a footnote.
 *
 * Read from what the research already established — a land profile, or a
 * property type that says so. Never guessed from the absence of a flat.
 */
export function isLandReport(report: unknown): boolean {
  const r = (report ?? {}) as Record<string, unknown>;
  const lp = (r.landProfile ?? null) as Record<string, unknown> | null;
  if (lp && (str(lp.landCategory) || str(lp.permittedUse) || str(lp.buildabilityNote))) return true;
  const t = `${String(r.propertyType ?? '')} ${String(r.entityType ?? '')} ${String(r.queryType ?? '')}`.toUpperCase();
  return /\bLAND\b|\bPLOT\b|\bPARCEL\b|AGRICULT/.test(t);
}

/**
 * The strongest finding, for a headline.
 *
 * Deliberately returns the finding and not a verdict. There is no such thing
 * as an overall "site readiness score" here: one live electricity account
 * says nothing about water, and a single number would imply it did.
 */
export function strongestFinding(findings: UtilityFinding[]): UtilityFinding | null {
  let best: UtilityFinding | null = null;
  for (const f of findings) {
    if (!best || READINESS_ORDER.indexOf(f.readiness) > READINESS_ORDER.indexOf(best.readiness)) {
      best = f;
    }
  }
  return best && best.readiness !== 'UNKNOWN' ? best : null;
}

/** How many kinds were actually established, for an honest count. */
export function establishedCount(findings: UtilityFinding[]): number {
  return findings.filter((f) => f.readiness !== 'UNKNOWN').length;
}
