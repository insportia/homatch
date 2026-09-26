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
