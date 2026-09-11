// HOMATCH — refreshing a market, instead of re-discovering one.
//
// MARKET is the most expensive stage in a verification and stayed that way
// while every other stage got cheaper. Measured across seven production runs of
// one property it ran between 56,017 and 86,252 tokens and 4 to 8 web searches,
// against an identity stage that fell to 9,152 and one search. It was also the
// only stage that never received anything useful from the graph.
//
// WHY IT COSTS WHAT IT COSTS. The stage is told to work outward through five
// bands — same project, same street, micro-district, wider district, peer
// developments — and to find at least three genuinely comparable listings in
// each. That is a discovery sweep, and it is the right instruction: a report
// that compares five flats in one building to each other answers the wrong
// question. The cost is not waste, it is the shape of the work.
//
// WHAT IS WASTE is doing the whole sweep again for listings already found. The
// graph holds them: eleven LISTING entities for the property above, nine facts
// each, with the URL as the natural key.
//
// WHAT CHANGES AND WHAT DOES NOT.
//
//   area, rooms, floor, condition, address, project, source   do not change
//   price, listingStatus                                       change daily
//
// So the stable half is handed over and the volatile half is asked for, by URL.
// Re-reading a known page for its current price is a targeted fetch; finding
// that page in the first place was the sweep. The bands still have to be
// filled, and a band that is thin still has to be researched — this narrows
// what is searched for, never what is reported.
//
// WHAT THIS IS NOT. It is not a cached market. A comparable's price and status
// are never asserted from the graph: their freshness policy is 24 hours and
// this module refuses to quote them at all, precisely so that a stale asking
// price can never reach a buyer as a current one. NOT FOUND is not ABSENT and
// LAST WEEK'S PRICE is not TODAY'S.

/** A comparable as the graph holds it. Values are whatever was stored. */
export interface HeldComparableFacts {
  url: string;
  facts: Record<string, string | number | null>;
}

/**
 * Facts about a listing that do not move, and may therefore be given.
 *
 * Everything absent from this list is either volatile or derived. In
 * particular `listing.price` and `listing.status` are deliberately excluded:
 * they are the two fields the market stage exists to establish freshly.
 */
const STABLE_FIELDS: Array<[key: string, label: string]> = [
  ['listing.area', 'area'],
  ['listing.rooms', 'rooms'],
  ['listing.floor', 'floor'],
  ['listing.condition', 'condition'],
  ['listing.address', 'address'],
  ['listing.source', 'source'],
];

/** Never handed over, whatever the graph holds. */
export const VOLATILE_FIELDS = ['listing.price', 'listing.pricePerSqm', 'listing.status'];

const shortish = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 80) : null;
};

export interface MarketBrief {
  text: string;
  /** URLs offered for refresh. Recorded internally, never shown. */
  urls: string[];
}

/**
 * The block handed to the market stage.
 *
 * Bounded at a size that is worth sending: a property with two hundred stored
 * comparables must not put two hundred rows into a prompt, and beyond a couple
 * of dozen the sweep is cheaper than the list.
 */
export function buildMarketBrief(
  comparables: readonly HeldComparableFacts[] | null | undefined,
  limit = 24
): MarketBrief {
  const rows: string[] = [];
  const urls: string[] = [];

  for (const c of comparables ?? []) {
    if (!c?.url || !/^https?:\/\//i.test(c.url)) continue;
    const attrs = STABLE_FIELDS
      .map(([key, label]) => {
        const v = shortish(c.facts?.[key]);
        return v ? `${label} ${v}` : null;
      })
      .filter(Boolean);
    rows.push(`  ${c.url}${attrs.length ? ` — ${attrs.join(', ')}` : ''}`);
    urls.push(c.url);
    if (rows.length >= limit) break;
  }

  if (!rows.length) return { text: '', urls: [] };

  return {
    urls,
    text: [
      '',
      'COMPARABLES HOMATCH HAS ALREADY FOUND FOR THIS PROPERTY.',
      'These pages were located by earlier research. Their area, rooms, floor,',
      'condition and address do not change, so they are given here and you do',
      'NOT need to search to find these listings again:',
      ...rows,
      '',
      'WHAT YOU STILL HAVE TO DO WITH THEM. Their PRICE and LISTING STATUS are',
      'not given, because those change daily and a stale asking price presented',
      'as a current one is exactly the error this report cannot make. For each',
      'listing above that is still relevant, read its page and return its',
      'CURRENT price and listingStatus — and if the page is gone or the listing',
      'is no longer available, say so with listingStatus EXPIRED / REMOVED /',
      'SOLD rather than dropping it silently.',
      '',
      'Spend the searching you save on the bands that are still THIN. The',
      'five-band requirement is unchanged: a band with fewer than three',
      'comparable listings still needs researching, and a band you have not',
      'searched must not be described. If one of the listings above is not',
      'actually comparable to the subject, leave it out and say nothing about',
      'it — this is what we found before, not what must be true now.',
    ].join('\n'),
  };
}
