// SANITIZED fixture shaped like production Verify jobs eeefada9 (flat N4,
// floor 2, 79.50 m²) and dbf04e48 (parking space N17, 12 m²) of the
// Kristian Stiven St. 18 development in Digomi, Tbilisi (2026-10-11).
//
// The ledgers' own shapes: 186 comparables gathered CITYWIDE because the
// subject district was unknown when the search started; reconciledIdentity
// carrying a MyHome listing's Saburtalo address; the register's address in
// officialEvidence; the NAPR cadastral plan the TAS map traversal read, with
// its WGS 84 / UTM 38N grid. A representative subset of the comparables is
// kept, with synthetic URLs and no listing ids, owner, phone or personal
// data. Prices, areas, districts and street names are as recorded.

const listing = (n, over) => ({
  source: 'myhome.ge',
  url: `https://example.test/udzravi-qoneba/iyideba-3-otaxiani-bina-${n}/`,
  currency: 'USD',
  comparableType: 'WIDER_MARKET',
  listingStatus: 'ACTIVE',
  propertyType: 'RESIDENTIAL',
  similarity: 'same city, similar size and rooms',
  listingDate: '2026-10-11T10:00:00Z',
  retrievedAt: '2026-10-11T14:01:46Z',
  discoveryMethod: 'MARKETPLACE_WORKER_SEARCH',
  ...over,
});

/** The development's own asks (estatehub), same project. */
export const SAME_PROJECT = [
  { area: '79.3', pricePerSqm: '950', price: '75335' },
  { area: '75.6', pricePerSqm: '950', price: '71820' },
  { area: '45.4', pricePerSqm: '970', price: '44038' },
  { area: '46', pricePerSqm: '970', price: '44620' },
].map((x, i) => listing(`sp-${i}`, {
  ...x,
  source: 'estatehub.ge',
  url: `https://example.test/homes/kristian-stivenis-qucha-18-${i}`,
  address: 'კრისტიან სტივენის ქუჩა 18, თბილისი',
  project: 'Kristian Stiven Street, 18',
  comparableType: 'SAME_PROJECT',
  condition: 'white frame',
  similarity: 'same development, asking sale price',
}));

/** Saburtalo: the leaked "subject address" Gelovani Ave. 23 and its neighbours. */
export const SABURTALO = [
  listing('sab-1', { district: 'საბურთალო', address: 'მარშალ გელოვანის გამზ. 23, საბურთალო, თბილისი', area: '75', price: '175000', pricePerSqm: '2333' }),
  listing('sab-2', { district: 'საბურთალო', address: 'მარშალ გელოვანის გამზ. 23, საბურთალო, თბილისი', area: '125', price: '340000', pricePerSqm: '2720' }),
  listing('sab-3', { district: 'საბურთალო', address: 'გამრეკელი ი. ქ., საბურთალო, თბილისი', area: '85', price: '195000', pricePerSqm: '2294' }),
  // The same price per m² as the project's own asks: price similarity is not relevance.
  listing('sab-4', { district: 'საბურთალო', address: 'ნუცუბიძის ქ., საბურთალო, თბილისი', area: '78', price: '74100', pricePerSqm: '950' }),
];

/** Didi Dighomi, Dighomi 1-9 and the Dighomi massif: the subject's own side of the city. */
export const DIGHOMI_SIDE = [
  listing('dd-1', { district: 'დიდი დიღომი', address: 'მირიან მეფის ქ., დიდი დიღომი, თბილისი', area: '79', price: '136000', pricePerSqm: '1722' }),
  listing('dd-2', { district: 'დიდი დიღომი', address: 'ფარნავაზ მეფის გამზ., დიდი დიღომი, თბილისი', area: '80', price: '135000', pricePerSqm: '1688' }),
  listing('dd-3', { district: 'დიდი დიღომი', address: 'დემეტრე თავდადებულის ქუჩა, დიდი დიღომი, თბილისი', area: '84', price: '122000', pricePerSqm: '1452' }),
  listing('dd-4', { district: 'დიდი დიღომი', address: 'მირიან მეფის ქ., დიდი დიღომი, თბილისი', area: '82', price: '105000', pricePerSqm: '1280' }),
  listing('d19-1', { district: 'დიღომი 1-9', address: 'ბობ უოლშის ქუჩა, დიღომი 1-9, თბილისი', area: '66', price: '125400', pricePerSqm: '1900' }),
  listing('d19-2', { district: 'დიღომი 1-9', address: 'დიღომი 7, დიღომი 1-9, თბილისი', area: '62.6', price: '90770', pricePerSqm: '1450' }),
  listing('dm-1', { district: 'დიღმის მასივი', address: 'დიღმის მასივი - III კვარტ., დიღმის მასივი, თბილისი', area: '90', price: '110000', pricePerSqm: '1222' }),
];

/** Elsewhere in the city: never this home's market. */
export const ELSEWHERE = [
  listing('vk-1', { district: 'ვაკე', address: 'ჭავჭავაძე ი. გამზირი, ვაკე, თბილისი', area: '80', price: '240000', pricePerSqm: '3000' }),
  listing('gl-1', { district: 'გლდანი', address: 'ქერჩის ქ., გლდანი, თბილისი', area: '70', price: '63000', pricePerSqm: '900' }),
  listing('or-1', { district: 'ორთაჭალა', address: 'ლაისტი ა. ქ., ორთაჭალა, თბილისი', area: '81', price: '170100', pricePerSqm: '2100' }),
  listing('kr-1', { district: 'კრწანისი', address: 'გიორგი გურამიშვილის ქუჩა, კრწანისი, თბილისი', area: '77', price: '154000', pricePerSqm: '2000' }),
  listing('va-1', { district: 'ვარკეთილი', address: 'კუპრაძე ვ. ქ., ვარკეთილი, თბილისი', area: '75', price: '67500', pricePerSqm: '900' }),
];

export const COMPARABLES = [...SAME_PROJECT, ...SABURTALO, ...DIGHOMI_SIDE, ...ELSEWHERE];

/** The cadastral plan the TAS map traversal read (NAPR, 2025-07-02), as stored. */
export const CADASTRAL_PLAN_TEXT =
  ' *882025728844*\nსაკადასტრო გეგმა\nსაჯარო რეესტრის ეროვნული სააგენტო\nსაკადასტრო კოდი: 01.72.14.040.030\n' +
  'განცხადების ნომერი:882025728844\nმომზადების თარიღი:02/07/2025\nნაკვეთის დანიშნულება:არასასოფლო სამეურნეო\n' +
  'ფართობი:1400 კვ.მ (WGS 84 / UTM zone 38N)\nვალდებულების ფართობი:183 კვ.მ (WGS 84 / UTM zone 38N)\n' +
  '478640\n478640\n478660\n478660\n478680\n478680\n4625950\n4625950\n4625970\n4625970\n4625990\n4625990\n01/7\n' +
  'კოორდინატთა სისტემა: WGS 84 / UTM zone 38N\nNNNN\nმასშტაბი 1:400\n10\nმშენებარე ნაგებობა';

/** browserOfficial as the worker stored it: the map never left its start view. */
export const browserOfficial = (planText = CADASTRAL_PLAN_TEXT, query = '01.72.14.040.030.01.01.004') => ({
  results: [{
    source: 'TAS_MAP',
    status: 'SEARCH_CONFIRMED',
    queryEntered: query,
    startUrl: 'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526',
    finalUrl: 'http://abstract.reestri.gov.ge/abstract/cad_amo.php?cad_code=01.72.14.040.030',
    frameUrls: null,
    documents: [
      { title: 'საკადასტრო გეგმა: 882025728844', documentType: 'PDF_DOCUMENT', documentDate: '2025-07-02', rawText: planText },
    ],
  }],
});

const base = {
  identifiedParent: {
    code: '01.72.14.040.030',
    projectIdentity: 'Kristian Stiven Street, 18',
    developmentAddress: '18 Kristian Stiven Street, Digomi, Tbilisi',
  },
  projectProfile: { name: 'Kristian Stiven Street, 18', address: '18 Kristian Stiven Street, Digomi, Tbilisi' },
  // Production: the reconciler took a MyHome listing's address as the subject's.
  reconciledIdentity: {
    address: 'მარშალ გელოვანის გამზ. 23, საბურთალო, თბილისი',
    project: 'Kristian Stiven Street, 18',
    provenance: { address: [{ url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-4-otaxiani-bina-saburtaloze-0/', source: 'myhome.ge' }] },
  },
  publicResearch: { project: 'Kristian Stiven Street, 18', amenities: ['ლიფტი', 'მიწისზედა პარკინგი'] },
};

/** Job eeefada9: the flat. */
export const FLAT_REPORT = {
  ...base,
  assetClass: 'MIXED_OR_UNKNOWN',
  entityType: 'უძრავი ქონების საკადასტრო ერთეული',
  exactUnit: { code: '01.72.14.040.030.01.01.004', note: 'x', verified: true },
  officialEvidence: [
    'საკადასტრო ერთეული 01.72.14.040.030.01.01.004 რეგისტრირებულია მისამართზე: ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18, სართული 2, ბინა N4.',
    '2026 წლის 22 ივნისის საჯარო რეესტრის ამონაწერში ერთეული აღწერილია როგორც მშენებარე; ფართობია 79.50 კვ.მ.',
  ],
  browserOfficial: browserOfficial(),
  market: { comparables: COMPARABLES },
};

/** Parking spaces offered for sale nearby (synthetic, same shape). */
export const PARKING_NEARBY = [
  listing('pk-1', { district: 'დიდი დიღომი', address: 'მირიან მეფის ქ., დიდი დიღომი, თბილისი', area: '13', price: '13000', pricePerSqm: '1000', propertyType: 'PARKING', url: 'https://example.test/udzravi-qoneba/iyideba-avtosadgomi-pk-1/' }),
];

/** Job dbf04e48: the parking space, priced in production from 144 apartments. */
export const PARKING_REPORT = {
  ...base,
  assetClass: 'MIXED_OR_UNKNOWN',
  entityType: 'ავტოსადგომი',
  exactUnit: { code: '01.72.14.040.030.01.02.017', note: 'x', verified: true },
  officialEvidence: [
    'საკადასტრო კოდი 01.72.14.040.030.01.02.017 რეგისტრირებულია მისამართზე: ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18, სართული 1, ავტოსადგომი N17 (მშენებარე). ფართობი შეადგენს 12.00 კვ.მ-ს.',
  ],
  browserOfficial: browserOfficial(CADASTRAL_PLAN_TEXT, '01.72.14.040.030.01.02.017'),
  market: { comparables: COMPARABLES },
};
