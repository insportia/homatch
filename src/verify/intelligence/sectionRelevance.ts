// HOMATCH — which parts of a report a given property actually has.
//
// A plot of land has no building quality. A warehouse has no school run. A
// private resale from one family to another has no developer. Reports that
// carried those sections anyway did not merely waste space: a heading with
// nothing real under it gets filled with something, and what it gets filled
// with is either generic filler or an inventory of what the research could
// not retrieve. Both are worse than the heading being absent.
//
// So relevance is decided HERE, deterministically, from the asset class the
// evidence supports — not left to the model to notice, and not decided in the
// browser after a paragraph has already been written and paid for.
//
// The default is generous on purpose. An unclear asset class gets the full
// report, because narrowing on a guess removes something a buyer needed;
// omitting a section is only correct when the property genuinely cannot have
// one.

import { SECTION_KEYS, type SectionKey } from './prompt.ts';

/**
 * Sections that never apply to a given class.
 *
 * Written as an exclusion list rather than an inclusion list so that adding a
 * section to SECTION_KEYS makes it appear everywhere by default. The failure
 * mode of the opposite arrangement is silent: a new section that nobody
 * remembered to allow simply never renders, for anyone.
 */
const NEVER_RELEVANT: Record<string, readonly SectionKey[]> = {
  /* Bare land. There is no building, so nothing about building quality is a
   * fact about this property — and a "Project" heading over a plot invites
   * the surrounding development's marketing to be written as if it were. */
  LAND: ['PROJECT'],

  /* A house sold by its owner. It has a building, but no development project
   * and no developer, and forcing developer research onto a private sale was
   * exactly how unrelated companies ended up in people's reports. */
  PRIVATE_HOUSE: ['PROJECT'],
  PRIVATE_RESALE: ['PROJECT'],
  RENTAL: ['PROJECT'],

  /* Commercial space. Everything applies — an office block's build quality,
   * street and surroundings all matter — but what "surroundings" means is
   * different, which is a matter for the prompt rather than for omission. */
  COMMERCIAL: [],
};

/**
 * The sections this property may have, in the order a buyer reads them.
 *
 * SECTION_KEYS is already in reading order, so filtering preserves it and
 * there is no second ordering to keep in sync.
 */
export function sectionsForAssetClass(assetClass: string | null | undefined): SectionKey[] {
  const excluded = NEVER_RELEVANT[String(assetClass ?? '')] ?? [];
  return SECTION_KEYS.filter((k) => !excluded.includes(k));
}

/** Whether one section belongs in a report about this kind of property. */
export function sectionApplies(assetClass: string | null | undefined, key: SectionKey): boolean {
  return sectionsForAssetClass(assetClass).includes(key);
}

/**
 * What to tell the model about this particular property's shape.
 *
 * Kept beside the exclusions deliberately: an instruction that drifts from the
 * rule that enforces it is worse than no instruction, because the model writes
 * a section that is then silently dropped and the buyer is left with a report
 * that reads as though something is missing.
 *
 * Empty for a class with nothing special to say, so the prompt gains no line.
 */
export function assetClassSectionNote(assetClass: string | null | undefined): string {
  switch (String(assetClass ?? '')) {
    case 'LAND':
      return [
        'THIS IS LAND. There is no building. Do NOT write a PROJECT section, and do not describe a',
        'neighbouring development as though it were this plot. What matters instead: what the plot',
        'is, its size and shape, what its status permits to be built, access and utilities, and what',
        'comparable land trades at. Write those inside SNAPSHOT, LOCATION, INFRASTRUCTURE and MARKET.',
      ].join('\n');
    case 'PRIVATE_HOUSE':
      return [
        'THIS IS A PRIVATE HOUSE, not a unit in a development. Do NOT write a PROJECT section and do',
        'NOT research or speculate about a developer. The building itself — its condition, size,',
        'plot and what has been done to it — belongs in SNAPSHOT. PEOPLE is about the seller and the',
        'registered owner, in whatever role the evidence actually supports.',
      ].join('\n');
    case 'PRIVATE_RESALE':
    case 'RENTAL':
      return [
        'THIS IS A PRIVATE RESALE between individuals, not a developer sale.',
        'Do NOT write a PROJECT section and do NOT force developer research onto it. If the building',
        'happens to be part of a known development, one sentence of context inside SNAPSHOT is',
        'enough. PEOPLE is the registered owner and the seller, nothing more.',
      ].join('\n');
    case 'COMMERCIAL':
      return [
        'THIS IS COMMERCIAL SPACE. Do NOT write family-living filler — no schools, no playgrounds,',
        'no "comfortable for a family" — unless the evidence genuinely makes it relevant. What',
        'matters here is footfall and visibility, access and parking for customers or goods,',
        'neighbouring businesses, floor area and layout, and what comparable commercial space rents',
        'or sells for. Frame INFRASTRUCTURE and LOCATION in those terms.',
      ].join('\n');
    default:
      return '';
  }
}
