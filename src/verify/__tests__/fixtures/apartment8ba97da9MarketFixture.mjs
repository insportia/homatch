// Production job 8ba97da9-2f0d-487f-96f2-043a2abe8202 (flat N601, 01.18.06.019.055.03.01.601,
// Krtsanisi St. 6), read-only from research_jobs on 2026-10-22: a sample of its
// result_json.market.comparables (all three MICRO_LOCATION, 44 SAME_DISTRICT from the
// MyHome/SS.ge district search incl. its one GEL advert, 4 citywide WIDER_MARKET), trimmed to
// the fields the market gate reads. Public adverts only; no personal data.
//
// SYNTHETIC rows (marked) exercise rules production did not happen to hit in this sample:
// a rental, a mispriced in-band outlier and a EUR price.

export const REGISTER_LATEST = {
  issuedAt: '2026-08-24T08:35:20', recordId: '35356992', unitFloor: '6', unitNumber: '601', landAreaSqm: 2145, unitAreaSqm: 94.1,
  unitItemText: 'ფართი (მშენებარე) სართული 6, ბინა N601, ბლოკი "ც"', unitRowFound: true,
  buildingsText: 'N1 (მშენებარე), N2 (მშენებარე) და N3(მშენებარე)-საერთო ფართობი 6946.6 კვ.მ.',
  parcelAddress: 'ქალაქი თბილისი , ქუჩა კრწანისი , N 6', unitDescription: 'ფართი (მშენებარე)',
};

export const RESULT = {
  identity: { assetClass: 'APARTMENT_IN_PROJECT', entity: { type: 'საცხოვრებელი ბინის ერთეული' } },
  exactUnit: { code: '01.18.06.019.055.03.01.601', note: null, verified: false },
  reconciledIdentity: { address: 'თბილისი, კრწანისის ქ. 6', project: 'Villion Krtsanisi Homes' },
};

/** The profile production sent: district known, area NOT (94.1 m² was in the register). */
export const PRODUCTION_PROFILE = { city: 'თბილისი', rooms: null, areaSqm: null, district: 'კრწანისი', priceUsd: null, propertyType: 'APARTMENT', transactionType: 'BUY' };

const ss = (id, area, rooms, price, ppsm, address, currency = 'USD', extra = {}) => ({
  source: 'ss.ge', url: `https://home.ss.ge/ka/udzravi-qoneba/iyideba-${rooms}-otaxiani-bina-ortatchalashi-${id}`, area: String(area), rooms: String(rooms),
  price: String(price), currency, pricePerSqm: String(ppsm), comparableType: 'SAME_DISTRICT', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL',
  district: 'ორთაჭალა', address: `${address}, ორთაჭალა, თბილისი`, project: null, discoveryMethod: 'MARKETPLACE_WORKER_SEARCH',
  sourcePropertyType: 'APARTMENT', transactionType: 'BUY', ...extra,
});

export const COMPARABLES = [
  // MICRO_LOCATION (research lane)
  { source: 'საჯარო განცხადება', url: 'https://home.ss.ge/default/real-estate/iyideba-3-otaxiani-bina-ortatchalashi-33664293', area: '149.5', rooms: '3', price: '291000', currency: 'USD', pricePerSqm: '1947', comparableType: 'MICRO_LOCATION', listingStatus: 'UNKNOWN', propertyType: 'RESIDENTIAL', district: null, address: 'კრწანისის მეორე შესახვევი 4, ორთაჭალა, თბილისი', project: null, discoveryMethod: null },
  { source: 'საჯარო განცხადება', url: 'https://home.ss.ge/default/real-estate/iyideba-4-otaxiani-bina-ortatchalashi-36039754', area: '130', rooms: '4', price: '260000', currency: 'USD', pricePerSqm: '2000', comparableType: 'MICRO_LOCATION', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: null, address: 'კრწანისის ქ., ორთაჭალა, თბილისი', project: null, discoveryMethod: null },
  { source: 'საჯარო განცხადება', url: 'https://home.ss.ge/ka/real-estate/iyideba-3-otaxiani-bina-ortatchalashi-35448687', area: '127', rooms: '3', price: '440000', currency: 'USD', pricePerSqm: '3465', comparableType: 'MICRO_LOCATION', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: null, address: 'კრწანისის ქ., ორთაჭალა, თბილისი', project: null, discoveryMethod: null },
  // SAME_DISTRICT (worker district search) — the one GEL advert first
  ss('36981370', 78, 3, 296000, 3794.87, 'გორგასლის ქ. 17', 'GEL'),
  ss('36912538', 59, 1, 139000, 2355.93, 'გ. ვოლსკის ქ. 7'),
  ss('36983184', 30, 1, 52000, 1733.33, 'გულიას ქ. 1'),
  ss('32932205', 87, 2, 280000, 3218.39, 'გ. ვოლსკის ქ. 7'),
  ss('33109106', 55.5, 2, 75000, 1351.35, 'ორთაჭალის ქ.'),
  ss('34950017', 57, 2, 108000, 1894.74, 'კრწანისის მეორე შესახვევი 35'),
  ss('36225199', 52, 2, 95000, 1826.92, 'გორგასლის ქ.'),
  ss('36547459', 66, 2, 120000, 1818.18, 'არტურ ლაისტის ქ. 55'),
  ss('36638555', 56, 2, 180000, 3214.29, 'გ. ვოლსკის ქ. 7'),
  ss('36645101', 53, 2, 93500, 1764.15, 'გორგასლის ქ. 40'),
  ss('36664210', 68, 2, 140000, 2058.82, 'ნადიკვარის ქ.'),
  ss('36681723', 157, 2, 392000, 2496.82, 'კალანდაძის ქ.'),
  ss('36694986', 66, 2, 120000, 1818.18, 'ნადიკვარის ქ.'),
  ss('36694996', 68, 2, 120000, 1764.71, 'ნადიკვარის ქ.'),
  ss('36781567', 106, 2, 313000, 2952.83, 'კრწანისის ქ. 62'),
  ss('36781708', 101, 2, 300000, 2970.3, 'კრწანისის ქ. 62'),
  ss('36782913', 66, 2, 147000, 2227.27, 'ნადიკვარის ქ. 3'),
  ss('36800403', 60, 2, 138000, 2300, 'კრწანისის ქ.'),
  ss('36817061', 62, 2, 110000, 1774.19, 'გორგასლის ქ. 0'),
  ss('36817816', 67, 2, 155000, 2313.43, 'კრწანისის ქ. 14'),
  ss('36845687', 48, 2, 88000, 1833.33, 'არტურ ლაისტის ქ.'),
  ss('36938339', 63, 2, 149000, 2365.08, 'გორგასლის ქ. 105'),
  ss('36938790', 54, 2, 100000, 1851.85, 'გორგასლის ქ.'),
  ss('36944124', 58, 2, 125000, 2155.17, 'გორგასლის ქ. 63'),
  ss('36962243', 55, 2, 99000, 1800, 'გორგასლის ქ. 105'),
  ss('36966237', 68, 2, 143000, 2102.94, 'ნადიკვარის ქ. 3'),
  ss('36979530', 51, 2, 97000, 1901.96, 'ნადიკვარის ქ. 3'),
  ss('36980090', 50, 2, 160000, 3200, 'კრწანისის I გასასვლელი 1'),
  ss('36980190', 65, 2, 92000, 1415.38, 'ნადიკვარის ქ. 1'),
  ss('36980218', 62, 2, 135000, 2177.42, 'კრწანისის ქ. 1'),
  ss('36980357', 72, 2, 140000, 1944.44, 'კრწანისის I გასასვლელი 1'),
  ss('36980676', 63, 2, 132000, 2095.24, 'ნადიკვარის ქ. 5'),
  ss('36981961', 56.4, 2, 265000, 4698.58, 'გ. ვოლსკის ქ.'),
  ss('36982558', 56.4, 2, 225000, 3989.36, 'გ. ვოლსკის ქ.'),
  ss('36983650', 46, 2, 92000, 2000, 'არტურ ლაისტის ქ. 64'),
  ss('36984748', 62.9, 2, 117000, 1860.1, 'ნადიკვარის ქ. 34'),
  ss('36986408', 95.2, 2, 125000, 1313.03, 'გ. ნიკოლაძის ქ.'),
  ss('36986538', 52, 2, 140000, 2692.31, 'გორგასლის ქ. 61'),
  ss('36986962', 64.5, 2, 90000, 1395.35, 'ნადიკვარის ქ.'),
  ss('30210290', 77.2, 3, 140000, 1813.47, 'გ. გურამიშვილის ქ. 5'),
  ss('31777015', 193, 3, 600000, 3108.81, 'გ. ვოლსკის ქ. 7'),
  // WIDER_MARKET (city-wide portal lane)
  { source: 'ss.ge', url: 'https://home.ss.ge/ka/real-estate/iyideba-1-otaxiani-bina-didubeshi-34369279', area: '40', rooms: null, price: '81000', currency: 'USD', pricePerSqm: '2020', comparableType: 'WIDER_MARKET', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: 'დიდუბე', address: 'ა.წერეთლის გამზ. დიდუბე თბილისი 45, თბილისი', project: null, discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH' },
  { source: 'ss.ge', url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36610778', area: '56', rooms: null, price: '84000', currency: 'USD', pricePerSqm: '1500', comparableType: 'WIDER_MARKET', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: 'დიდი დიღომი', address: 'არჩილ მეფის ქ. დიდი დიღომი თბილისი 7, თბილისი', project: null, discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH' },
  { source: 'ss.ge', url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36910148', area: '48', rooms: null, price: '75000', currency: 'USD', pricePerSqm: '1560', comparableType: 'WIDER_MARKET', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: 'დიდი დიღომი', address: 'მირიან მეფის ქ. დიდი დიღომი თბილისი 77, თბილისი', project: null, discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH' },
  { source: 'ss.ge', url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36950362', area: '52', rooms: null, price: '61400', currency: 'USD', pricePerSqm: '1180', comparableType: 'WIDER_MARKET', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: 'დიდი დიღომი', address: 'ბაგრატ III ქ. დიდი დიღომი თბილისი 29, თბილისი', project: null, discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH' },
  // SYNTHETIC
  ss('90000001', 92, 3, 2500, 27.17, 'კრწანისის ქ. 20', 'USD', { transactionType: 'MONTHLY_RENT', synthetic: 'rental in band' }),
  ss('90000002', 95, 3, 950000, 10000, 'კრწანისის ქ. 8', 'USD', { synthetic: 'in-band outlier' }),
  ss('90000003', 90, 3, 200000, 2222.22, 'კრწანისის ქ. 9', 'EUR', { synthetic: 'EUR price' }),
  { source: 'ss.ge', url: 'https://home.ss.ge/ka/real-estate/iyideba-3-otaxiani-bina-did-dighomshi-90000004', area: '92', rooms: '3', price: '130000', currency: 'USD', pricePerSqm: '1413.04', comparableType: 'WIDER_MARKET', listingStatus: 'ACTIVE', propertyType: 'RESIDENTIAL', district: 'დიდი დიღომი', address: 'დიდი დიღომი, თბილისი', project: null, discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH', synthetic: 'in-band citywide listing' },
];
