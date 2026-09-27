// PROPERTIES FOR THE HARNESS, BECAUSE THE GATE WAS MEASURING AN EMPTY PAGE.
//
// The mobile harness answers every un-stubbed `/rest/v1/*` with `[]`. So /property
// rendered its "no properties yet" card at four widths in six locales and the matrix
// called that coverage of My Properties — a centred empty state cannot overflow, and a
// listing row is the only thing on that page that can.
//
// This is the same class of false coverage this file's neighbours have hit twice
// already: every `auth: true` route once measured a "could not load your profile" card,
// and an admin route once measured a 404.
//
// THREE PROPERTIES IS THE DEFAULT, deliberately. One row cannot show whether the
// density is right and cannot reveal a row that grows when its neighbour does; ten is
// slower to render and tells you nothing the third row did not. The desktop inspection
// script renders one, three and ten.
//
// THE CONTENT IS ADVERSARIAL, not decorative:
//   row 0  the real production listing — a long Georgian title, an imported source, a
//          paused campaign with 55 matches waiting. The combination that exists today.
//   row 1  no photo, no price, DRAFT, zero matches. Every empty branch at once.
//   row 2  the longest plausible title, an ACTIVE campaign, and a 7-figure price, so a
//          row that fits row 0 is not assumed to fit anything.

const OWNER = '77777777-7777-4777-8777-777777777777';

/** A stable uuid per index, so a re-run stubs the same ids. */
const idFor = (index) => `c5c1a6a4-6fed-4764-91c2-3cd7ad09${String(index).padStart(4, '0')}`;

const SHAPES = [
  {
    title: 'იყიდება 3 ოთახიანი ბინა კრწანისში',
    source_type: 'URL_IMPORT',
    matching_status: 'PAUSED',
    cover: 'https://static-statements.tnet.ge/uploads/202608/20260819/statements/XXB2rD26a8603155deb3.webp',
    facts: {
      city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD',
      price_per_sqm: 2200, area: 97.2, rooms: 3, bedrooms: 2, bathrooms: 2,
      source_domain: 'www.myhome.ge',
    },
    matches: { total: 55, fresh: 40, strong: 10 },
  },
  {
    /* Every empty branch at once: no photo, no price, a draft, nothing found. */
    title: 'ბინა საბურთალოზე',
    source_type: 'PRIVATE_LISTING',
    matching_status: 'DRAFT',
    cover: null,
    facts: {
      city: 'Tbilisi', district: 'Saburtalo', total_price: null, currency: null,
      price_per_sqm: null, area: null, rooms: null, bedrooms: null, bathrooms: null,
      source_domain: null,
    },
    matches: { total: 0, fresh: 0, strong: 0 },
  },
  {
    /* The long one. A title that wraps, an active campaign, a seven-figure price. */
    title: 'იყიდება ახალაშენებული ელიტური პენტჰაუსი აბულაძის ქუჩაზე, საელჩოების უბანში, თბილისი',
    source_type: 'PRIVATE_LISTING',
    matching_status: 'ACTIVE',
    cover: null,
    facts: {
      city: 'Tbilisi', district: 'Vake', total_price: 3964650, currency: 'USD',
      price_per_sqm: 3604, area: 1100, rooms: 7, bedrooms: 4, bathrooms: 3,
      source_domain: null,
    },
    matches: { total: 3, fresh: 0, strong: 1 },
  },
];

/** N properties in the joined shape listPortfolio actually selects. */
export function propertyRows(count = 3) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const shape = SHAPES[index % SHAPES.length];
    const id = idFor(index);
    rows.push({
      id,
      user_id: OWNER,
      source_type: shape.source_type,
      title: shape.title,
      transaction_type: 'SALE',
      property_type: 'APARTMENT',
      matching_status: shape.matching_status,
      matchability_score: null,
      cover_photo_url: shape.cover,
      is_deleted: false,
      archived_at: null,
      developer_id: null,
      canonical_group_id: null,
      created_at: '2026-09-20T10:00:00Z',
      updated_at: '2026-09-26T03:53:03Z',
      /* PostgREST returns an embedded one-to-one as an object or a single-element
         array depending on the relationship; the page handles both, and the array is
         the shape this join actually produces. */
      facts: [{ property_id: id, ...shape.facts }],
      photos: [],
    });
  }
  return rows;
}

/** The `matches` rows portfolioIntelligence counts, for the same N properties. */
export function matchRows(count = 3) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const shape = SHAPES[index % SHAPES.length];
    const id = idFor(index);
    for (let n = 0; n < shape.matches.total; n += 1) {
      rows.push({
        property_id: id,
        status: n < shape.matches.fresh ? 'NEW' : 'VIEWED',
        signal_strength: n < shape.matches.strong ? 'STRONG' : 'POTENTIAL',
      });
    }
  }
  return rows;
}

/*
 * MATCHES AS THE MATCHES PAGE ACTUALLY READS THEM, which is a different query from the
 * one above.
 *
 * matchRows() answers portfolioIntelligence: three columns, enough to count. getMatches()
 * selects twenty-six, and a card built from the three-column shape renders a headline with
 * no city, no budget, no excerpt and no reasons — which is not a card anybody can judge by
 * looking at it. Visual QA against that fixture would have been QA of a fixture.
 *
 * FOUR STATES, DELIBERATELY, because each one is a different card:
 *
 *   NEW and INCLUDED       carries an allowance id, so no price, no blur, and a View
 *                          button. This is the state the old card charged for twice.
 *   PREVIEWED and FOR SALE the only state where a price and a blur are honest.
 *   UNLOCKED               opened, so the chat and viewing actions exist.
 *   POTENTIAL with a gap   a mismatch_reasons entry, which was stored since matching was
 *                          built and rendered nowhere at all until the rebuild.
 *
 * The reason strings are the matcher's own literals, copied from run-matching-v2's
 * score(). A fixture that invents friendlier ones would hide exactly the fault this
 * rebuild exists to fix.
 */
const MATCH_STATES = [
  {
    signal_strength: 'EXCEPTIONAL',
    status: 'NEW',
    match_score: 92,
    included: true,
    reasons: ['Transaction intent matches', 'Country matches', 'City matches', 'Property type matches', 'Budget compatible'],
    mismatches: [],
    preview_city: 'Tbilisi',
    preview_budget_min: 220000,
    preview_budget_max: 280000,
    preview_bedrooms: 3,
    preview_recency: '2d ago',
    preview_platform: 'GOOGLE',
    preview_language: 'ka',
    evidence_freshness: 'FRESH',
    preview_excerpt: 'ვეძებ სამ საძინებლიან ბინას ვაკეში ან საბურთალოზე, ბიუჯეტი 250 ათასამდე, აუცილებლად პარკინგით.',
  },
  {
    signal_strength: 'GOOD',
    status: 'PREVIEWED',
    match_score: 71,
    included: false,
    reasons: ['Transaction intent matches', 'City matches', 'Budget near range'],
    mismatches: ['Property type differs'],
    preview_city: 'Tbilisi',
    preview_budget_min: 180000,
    preview_budget_max: null,
    preview_bedrooms: 2,
    preview_recency: '8d ago',
    preview_platform: 'FACEBOOK',
    preview_language: 'ru',
    evidence_freshness: 'NEEDS_REVALIDATION',
    preview_excerpt: 'Ищу квартиру в Тбилиси, район не принципиален, бюджет от 180 тысяч, желательно с ремонтом.',
  },
  {
    signal_strength: 'VERY_STRONG',
    status: 'UNLOCKED',
    match_score: 84,
    included: false,
    reasons: ['Transaction intent matches', 'Country matches', 'City matches', 'District/neighborhood matches', 'Area compatible', 'Description/needs overlap'],
    mismatches: [],
    preview_city: 'Tbilisi',
    preview_budget_min: 240000,
    preview_budget_max: 300000,
    preview_bedrooms: 4,
    preview_recency: '3h ago',
    preview_platform: 'TELEGRAM',
    preview_language: 'en',
    evidence_freshness: 'FRESH',
    preview_excerpt: 'Relocating to Tbilisi in the autumn, looking to buy a four-bedroom in Vake, up to 300k, parking essential.',
  },
  {
    signal_strength: 'POTENTIAL',
    status: 'NEW',
    match_score: 44,
    included: false,
    reasons: ['Transaction intent partially known', 'Country matches'],
    mismatches: ['City differs', 'Budget differs'],
    preview_city: 'Batumi',
    preview_budget_min: null,
    preview_budget_max: 90000,
    preview_bedrooms: null,
    preview_recency: '34d ago',
    preview_platform: 'WEBSITE',
    preview_language: 'tr',
    evidence_freshness: 'UNVERIFIABLE',
    preview_excerpt: 'Batum\'da deniz manzaralı, bütçem 90 bin dolara kadar, acele etmiyorum.',
  },
];

/** N matches in the shape getMatches() selects, cycling the four states. */
export function matchDetailRows(count = 3, propertyId = idFor(0)) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const state = MATCH_STATES[index % MATCH_STATES.length];
    rows.push({
      id: `aaaaaaaa-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      property_id: propertyId,
      campaign_id: 'bbbbbbbb-0000-4000-8000-000000000001',
      signal_id: `cccccccc-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      intent_profile_id: `dddddddd-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      match_score: state.match_score,
      intent_confidence: 0.8,
      signal_strength: state.signal_strength,
      match_reasons: state.reasons,
      mismatch_reasons: state.mismatches,
      unlock_price_credits: state.included ? 0 : 4.5,
      unlock_included_reservation_id: null,
      /* An ALLOWANCE rather than a reservation: the first search of every month on the
         FREE plan is covered this way, and reading only the reservation id is what made
         those results render as something to buy. */
      unlock_included_allowance_id: state.included
        ? 'eeeeeeee-0000-4000-8000-000000000001'
        : null,
      evidence_freshness: state.evidence_freshness,
      status: state.status,
      preview_platform: state.preview_platform,
      preview_language: state.preview_language,
      preview_city: state.preview_city,
      preview_budget_min: state.preview_budget_min,
      preview_budget_max: state.preview_budget_max,
      preview_currency: 'USD',
      preview_bedrooms: state.preview_bedrooms,
      preview_excerpt: state.preview_excerpt,
      preview_recency: state.preview_recency,
      created_at: '2026-09-24T10:00:00Z',
      updated_at: '2026-09-26T10:00:00Z',
    });
  }
  return rows;
}
