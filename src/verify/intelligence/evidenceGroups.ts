// HOMATCH — Evidence & Sources, grouped for a person rather than a graph.
//
// WHY THIS IS DETERMINISTIC
//
// The customer-visible evidence list used to be whatever the model had cited:
//
//     evidenceUsed: packageItems(pkg).filter((i) => cited.has(i.id))
//
// On the live Villion report the model cited nothing, so `evidenceUsed` was
// an empty array — while the same report displayed a company identification
// code, two shareholders with exact percentages, a registered pledge and an
// official extract reference. The evidence plainly existed; a model's failure
// to write `cites` had erased the customer's view of it.
//
// A citation is the model's opinion about which evidence it leaned on. It is
// not the record of what evidence Homatch holds. So the grouping below is
// computed from the evidence package itself, and the model's citations are
// used only to ORDER the result — never to decide whether it exists.
//
// WHAT IS DELIBERATELY EXCLUDED
//
// Nothing internal. No scores, no provider names, no item ids, no debug
// fields: those are engineering artefacts, and a customer reading "e17,
// DERIVED, tier 4" learns nothing except that we shipped our own notes. Each
// visible row carries what the source IS, what it SUPPORTS, and when — and a
// link only when there is a real destination behind it.

import type { EvidenceItem } from './evidencePackage.ts';

/**
 * The groups a buyer recognises. Ordered by how much weight they carry, so
 * the official record is always read before market chatter.
 */
export type EvidenceGroupKey =
  | 'OFFICIAL_REGISTRY'
  | 'PROPERTY'
  | 'COMPANY'
  | 'PROJECT'
  | 'MARKET'
  | 'LOCATION'
  | 'OTHER';

export const EVIDENCE_GROUP_ORDER: readonly EvidenceGroupKey[] = [
  'OFFICIAL_REGISTRY', 'PROPERTY', 'COMPANY', 'PROJECT', 'MARKET', 'LOCATION', 'OTHER',
] as const;

/** i18n keys for each group heading. */
export const EVIDENCE_GROUP_KEY: Record<EvidenceGroupKey, string> = {
  OFFICIAL_REGISTRY: 'ev_group_official',
  PROPERTY: 'ev_group_property',
  COMPANY: 'ev_group_company',
  PROJECT: 'ev_group_project',
  MARKET: 'ev_group_market',
  LOCATION: 'ev_group_location',
  OTHER: 'ev_group_other',
};

/** One row as the customer sees it. No ids, no tiers, no scores. */
export interface EvidenceRow {
  /** What this evidence says, in customer language. */
  claim: string;
  /** Where it came from, when the package names a source. */
  source?: string;
  /** Only ever a real destination. */
  url?: string;
  /** When the source stated it. */
  date?: string;
  /** True when an official register or document is behind it. */
  official: boolean;
  /** True when independent sources agree. */
  corroborated: boolean;
  /** Set only when sources genuinely disagree — never hidden. */
  conflict?: string;
}

export interface EvidenceGroup {
  key: EvidenceGroupKey;
  rows: EvidenceRow[];
}

const OFFICIAL_PROVENANCE = new Set(['OFFICIAL_REGISTRY', 'OFFICIAL_DOCUMENT']);

/**
 * Which group an item belongs to.
 *
 * Provenance wins over category: a company fact stated by an official
 * register belongs with the official record, because that is what a reader
 * is looking for when they open this section. Everything unrecognised falls
 * to OTHER rather than being guessed into a group it might not belong to.
 */
export function groupFor(item: EvidenceItem): EvidenceGroupKey {
  if (OFFICIAL_PROVENANCE.has(item.provenance)) return 'OFFICIAL_REGISTRY';
  switch (item.category) {
    case 'PROPERTY':
    case 'OWNERSHIP':
    case 'ENCUMBRANCE':
    case 'LEGAL_CHECK':
      return 'PROPERTY';
    case 'DEVELOPER':
    case 'FINANCING':
      return 'COMPANY';
    case 'PROJECT':
    case 'DOCUMENT':
      return 'PROJECT';
    case 'MARKET':
      return 'MARKET';
    default:
      return 'OTHER';
  }
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[«»„“”"'`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Builds the customer-visible evidence, grouped.
 *
 * `cited` is the set of ids the model actually referenced. It only promotes
 * those rows within their group; it can never remove a row, which is the
 * whole point — see this file's header.
 *
 * Groups with nothing in them are omitted rather than rendered empty.
 */
export function buildEvidenceGroups(
  items: EvidenceItem[],
  cited: ReadonlySet<string> = new Set(),
  opts: { perGroup?: number } = {}
): EvidenceGroup[] {
  const perGroup = opts.perGroup ?? 8;
  const buckets = new Map<EvidenceGroupKey, EvidenceItem[]>();

  for (const item of items) {
    const claim = typeof item?.claim === 'string' ? item.claim.trim() : '';
    if (!claim) continue;
    const key = groupFor(item);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  const out: EvidenceGroup[] = [];
  for (const key of EVIDENCE_GROUP_ORDER) {
    const list = buckets.get(key);
    if (!list?.length) continue;

    const ordered = [...list].sort((a, b) => {
      // What the model leaned on first, then the strongest evidence, then
      // the most specific — a stable order, never a random one.
      const ca = cited.has(a.id) ? 0 : 1;
      const cb = cited.has(b.id) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const oa = OFFICIAL_PROVENANCE.has(a.provenance) ? 0 : 1;
      const ob = OFFICIAL_PROVENANCE.has(b.provenance) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return (a.tier ?? 9) - (b.tier ?? 9);
    });

    const seen = new Set<string>();
    const rows: EvidenceRow[] = [];
    for (const item of ordered) {
      // The same observation arrives from two lanes routinely; one fact is
      // one row.
      const dedupeKey = norm(item.claim);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      rows.push({
        claim: item.claim.trim(),
        ...(item.source ? { source: item.source } : {}),
        ...(item.url && /^https?:\/\//i.test(item.url) ? { url: item.url } : {}),
        ...(item.date ? { date: item.date } : {}),
        official: OFFICIAL_PROVENANCE.has(item.provenance),
        corroborated: item.corroborated === true,
        ...(item.conflictsWith ? { conflict: item.conflictsWith } : {}),
      });
      if (rows.length >= perGroup) break;
    }
    if (rows.length) out.push({ key, rows });
  }
  return out;
}

/** Total rows actually shown — the number the header may state out loud. */
export function evidenceRowCount(groups: EvidenceGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0);
}
