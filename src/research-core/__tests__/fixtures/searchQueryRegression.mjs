// FIND PROPERTY — the deterministic query engine's regression set.
//
// Representative sentences people type into Find Property, across the six product
// languages: mixed filters, rent versus sale, GEL / USD / EUR, districts and
// neighbourhoods, typos, free word order. Each case states only the fields it is
// about; a field set to null must be ABSENT from the brief.
//
// Keys: tx, type, city, districts, price [min,max], priceStatus, area [min,max],
// rooms [min,max], bedrooms [min,max], floor [min,max], must, nice, excl, furnished,
// parking, buildings, renovations, clar (clarification ids, in any order).
//
// Prices are USD after conversion with the fixed test rates USD_GEL 2.70 and
// EUR_GEL 2.95. A ceiling alone becomes [max - 15000, max] (brief.ts primaryPriceRange).

export const TEST_RATES = { USD_GEL: 2.7, EUR_GEL: 2.95 };

export const CASES = [
  // ── Georgian ──────────────────────────────────────────────────────────────
  ['ka', 'ვაკეში მინდა საყიდლად 2 საძინებლიანი, 3 ოთახიანი ბინა, 80 დან 110 მ² მდე, ახალაშენებულ ან მშენებარე კორპუსში. ბიუჯეტი $120,000 დან $160,000 მდე.',
    { tx: 'BUY', type: 'APARTMENT', city: 'Tbilisi', districts: ['Vake'], price: [120000, 160000], priceStatus: 'STATED', area: [80, 110], rooms: [3, 3], bedrooms: [2, 2], buildings: ['NEW_BUILD', 'UNDER_CONSTRUCTION'], clar: [] }],
  ['ka', 'ვაკეში მინდა კარგი 2 საძინებლიანი ბინა', { tx: null, type: 'APARTMENT', city: 'Tbilisi', districts: ['Vake'], bedrooms: [2, 2], price: null }],
  ['ka', 'მინდა ვარკეთილში, სუხიშვილის ქუჩისკენ, ან მიკროებში მაღლა მხარეს 2 საძინებლიანი ბინა, ახალ აშენებულ კორპუსში ან მიმდინარეში, მაქსიმუმ 90000$, მინიმუმ 70 კვადრატიდან',
    { tx: 'BUY', type: 'APARTMENT', city: 'Tbilisi', districts: ['Varketili'], price: [75000, 90000], area: [70, null], bedrooms: [2, 2], buildings: ['NEW_BUILD', 'UNDER_CONSTRUCTION'] }],
  ['ka', 'მოკლედ ყლეო, ვეძებ ვარკეთილში და ვაზისუბანშიც ორივე ლოკაცია მაინტერესებს, ბინას მაქსიმუმ ბიუჯეტი 70-დან 90 ათას დოლარამდეა, 2 საძინებლიანი აუცილებლად, უნდ ქონდეს აივანი, განვიხიალვ მწვანე კარკასსაც და რაც მტავარია გარემონტებული უნდა იყოს და უკეთესია ახალაშენებულში, სართულები კიდე 2-დან 8-მდე, და კვ.მ კიდე 70 კვ.მ.-დან! მხოლოდ ამ უბნების ცენტრში',
    { tx: 'BUY', type: 'APARTMENT', city: 'Tbilisi', districts: ['Varketili', 'Vazisubani'], price: [70000, 90000], area: [70, null], bedrooms: [2, 2], floor: [2, 8], must: ['BALCONY'], renovations: ['RENOVATED', 'GREEN_FRAME'] }],
  ['ka', 'ვქირაობ ბინას ვაკეში თვეში 1000 დოლარამდე, ავეჯით, ლიფტით', { tx: 'MONTHLY_RENT', type: 'APARTMENT', districts: ['Vake'], price: [0, 1000], furnished: true, must: ['ELEVATOR'] }],
  ['ka', 'დღიურად ბინა ბათუმში ზღვასთან 50 ლარამდე', { tx: 'DAILY_RENT', type: 'APARTMENT', city: 'Batumi', price: [0, 19], priceStatus: 'STATED' }],
  ['ka', 'კერძო სახლი დიღომში ეზოთი 250 ათას დოლარამდე', { tx: 'BUY', type: 'HOUSE', city: 'Tbilisi', districts: ['Digomi'], price: [235000, 250000], must: ['GARDEN'] }],
  ['ka', 'ვყიდულობ სამოთახიან ბინას საბურთალოზე, მეორე სართულიდან, გარემონტებული, 100-130 ათასი დოლარი', { tx: 'BUY', rooms: [3, 3], districts: ['Saburtalo'], price: [100000, 130000], floor: [2, null], renovations: ['RENOVATED'] }],
  ['ka', 'ბინა ვაკეში ან საბურთალოზე, ქირით ან ყიდვით', { tx: null, districts: ['Vake', 'Saburtalo'], clar: ['transaction'] }],
  ['ka', 'ოფისი ვერაზე ქირით 2000$', { tx: 'MONTHLY_RENT', type: 'OFFICE', districts: ['Vera'], price: [0, 2000] }],
  ['ka', 'მიწის ნაკვეთი წყნეთში 50000$', { tx: 'BUY', type: 'LAND', city: 'Tbilisi', districts: ['Tskneti'], price: [35000, 50000] }],
  ['ka', 'ბინა საბურთლოზე', { districts: ['Saburtalo'], city: 'Tbilisi' }],
  ['ka', 'ბინა ვაკშეი 120000$', { districts: ['Vake'], price: [105000, 120000], tx: 'BUY' }],
  ['ka', '150 000 ლარამდე ბინა გლდანში', { tx: 'BUY', districts: ['Gldani'], price: [40556, 55556], priceStatus: 'STATED' }],
  ['ka', 'ბინა ისანში 80000-მდე', { districts: ['Isani'], price: [65000, 80000], priceStatus: 'PROPOSED', clar: ['currency'] }],
  ['ka', 'სამგორში ორსაძინებლიანი ბინა იყიდება 70 ათას დოლარამდე', { tx: 'BUY', districts: ['Samgori'], bedrooms: [2, 2], price: [55000, 70000] }],
  ['ka', 'ბათუმში ახალ ბულვართან ბინა ზღვის ხედით 90 ათასი დოლარი', { city: 'Batumi', districts: ['New Boulevard'], must: ['VIEW'], price: [75000, 90000] }],
  ['ka', 'ქუთაისში სახლი 60 ათას დოლარამდე', { tx: 'BUY', type: 'HOUSE', city: 'Kutaisi', price: [45000, 60000] }],
  ['ka', 'რუსთავში 2 ოთახიანი ბინა 40000$', { city: 'Rustavi', rooms: [2, 2], price: [25000, 40000] }],
  ['ka', 'ბინა რუსთაველზე ქირით', { tx: 'MONTHLY_RENT', city: 'Tbilisi', districts: ['Rustaveli'] }],
  ['ka', 'დიდ დიღომში 3 ოთახიანი ბინა 90 კვ.მ', { districts: ['Didi Digomi'], rooms: [3, 3], area: [81, 99] }],
  ['ka', 'ბინა ვაკეში, პარკინგით და აივნით, 2-3 საძინებელი', { districts: ['Vake'], bedrooms: [2, 3], must: ['PARKING', 'BALCONY'], parking: true }],
  ['ka', 'ქირით ბინა საბურთალოზე, ავეჯის გარეშე, 700 დოლარი თვეში', { tx: 'MONTHLY_RENT', furnished: false, price: [0, 700] }],
  ['ka', 'ვეძებ კომერციულ ფართს ჩუღურეთში ქირით', { tx: 'MONTHLY_RENT', type: 'COMMERCIAL', districts: ['Chughureti'] }],
  ['ka', 'სტუდიო ბათუმში დღიურად 30 დოლარი', { tx: 'DAILY_RENT', type: 'STUDIO', city: 'Batumi', price: [0, 30] }],
  ['ka', 'პენტჰაუსი ვაკეში 500 ათასიდან 700 ათას დოლარამდე', { type: 'PENTHOUSE', price: [500000, 700000], tx: 'BUY' }],
  ['ka', 'ბინა მთაწმინდაზე ძველ კორპუსში 120 ათასი დოლარი', { districts: ['Mtatsminda'], buildings: ['OLD_BUILD'], price: [105000, 120000] }],
  ['ka', 'ბინა ნაძალადევში 60-80 კვ.მ 70000$', { districts: ['Nadzaladevi'], area: [60, 80], price: [55000, 70000] }],
  ['ka', 'ბინა თბილისში ან ბათუმში', { city: null, clar: ['city'] }],
  ['ka', 'ბინა ბაგებში 200 000 ევრო', { districts: ['Bagebi'], price: [203519, 218519] }],
  ['ka', 'ქირავდება ბინა დიდუბეში 500$', { tx: 'MONTHLY_RENT', districts: ['Didube'], price: [0, 500] }],
  ['ka', 'ბინა ორთაჭალაში დაახლოებით 100 ათასი დოლარი', { districts: ['Ortachala'], price: [90000, 110000], priceStatus: 'PROPOSED' }],
  ['ka', 'ბინა ლისზე არა პირველ სართულზე 2 საძინებლით', { districts: ['Lisi'], bedrooms: [2, 2] }],
  ['ka', 'მინდა ბინა ძველ თბილისში', { districts: ['Old Tbilisi'], city: 'Tbilisi' }],
  ['ka', 'ავლაბარში 1 საძინებლიანი ქირით 400$-მდე', { tx: 'MONTHLY_RENT', districts: ['Avlabari'], bedrooms: [1, 1], price: [0, 400] }],
  // ── English ───────────────────────────────────────────────────────────────
  ['en', 'Looking to rent a 2 bedroom flat in Saburtalo up to 800$ per month, furnished, with parking', { tx: 'MONTHLY_RENT', type: 'APARTMENT', districts: ['Saburtalo'], bedrooms: [2, 2], price: [0, 800], furnished: true, parking: true }],
  ['en', '2 bedroom apartment in Vake for sale between 150k and 200k USD, new building, high floor', { tx: 'BUY', bedrooms: [2, 2], price: [150000, 200000], buildings: ['NEW_BUILD'] }],
  ['en', 'studio for daily rent in old tbilisi 40$ per night', { tx: 'DAILY_RENT', type: 'STUDIO', districts: ['Old Tbilisi'], price: [0, 40] }],
  ['en', 'I want to buy a penthouse in Batumi, sea view, pool, up to $1.2m', { tx: 'BUY', type: 'PENTHOUSE', city: 'Batumi', price: [1185000, 1200000], must: ['POOL', 'VIEW'] }],
  ['en', 'apartment Vake not Saburtalo 2000 EUR per month', { tx: 'MONTHLY_RENT', districts: ['Vake'], price: [0, 2185] }],
  ['en', 'apartment in Saburtlo 300 000 GEL', { districts: ['Saburtalo'], price: [96111, 111111], priceStatus: 'STATED' }],
  ['en', 'Buy 3 room flat Tbilisi Didube 90-120 sqm budget $180,000', { tx: 'BUY', rooms: [3, 3], area: [90, 120], price: [165000, 180000], districts: ['Didube'] }],
  ['en', 'house with garden in Tskneti, at least 200 m2, up to 450k usd', { type: 'HOUSE', area: [200, null], price: [435000, 450000], must: ['GARDEN'] }],
  ['en', 'office space for rent in Vera 120 sqm', { tx: 'MONTHLY_RENT', type: 'OFFICE', districts: ['Vera'] }],
  ['en', 'cheap apartment in Gldani around 50k', { districts: ['Gldani'], price: [45000, 55000], priceStatus: 'PROPOSED' }],
  ['en', 'need a flat in Isani or Samgori, renovated, 2 bedrooms, 70000 dollars', { districts: ['Isani', 'Samgori'], renovations: ['RENOVATED'], bedrooms: [2, 2], price: [55000, 70000] }],
  ['en', 'Land plot in Kojori for investment, $30,000', { tx: 'BUY', type: 'LAND', districts: ['Kojori'], price: [15000, 30000] }],
  ['en', 'apartment for rent in batumi, monthly, 2 bedrooms, pets allowed, up to 600 usd', { tx: 'MONTHLY_RENT', city: 'Batumi', bedrooms: [2, 2], must: ['PET_FRIENDLY'], price: [0, 600] }],
  ['en', 'townhouse in Digomi for sale 300k$', { type: 'TOWNHOUSE', districts: ['Digomi'], price: [285000, 300000] }],
  ['en', 'flat in Vake, preferably with a balcony, max 140000 usd', { districts: ['Vake'], nice: ['BALCONY'], price: [125000, 140000] }],
  ['en', 'apartment in Mtatsminda without elevator is fine, 3 bedrooms, 250,000 USD', { districts: ['Mtatsminda'], bedrooms: [3, 3], price: [235000, 250000] }],
  ['en', 'Krtsanisi apartment, under construction, $95k', { districts: ['Krtsanisi'], buildings: ['UNDER_CONSTRUCTION'], price: [80000, 95000] }],
  ['en', 'apartmnet in Vake to purchsae 150000 usd', { type: 'APARTMENT', districts: ['Vake'], price: [135000, 150000], tx: 'BUY' }],
  ['en', '1 bedroom in Gonio daily rent 35 usd', { tx: 'DAILY_RENT', city: 'Batumi', districts: ['Gonio'], bedrooms: [1, 1], price: [0, 35] }],
  ['en', 'shop for rent in Saburtalo 1500 gel per month', { tx: 'MONTHLY_RENT', type: 'COMMERCIAL', price: [0, 556] }],
  ['en', 'apartment or house in Vake to buy', { clar: ['propertyType'], type: null, tx: 'BUY' }],
  ['en', 'rent or buy apartment Saburtalo', { clar: ['transaction'], tx: null }],
  // ── Russian ───────────────────────────────────────────────────────────────
  ['ru', 'Сдается 2-комнатная квартира в Сабуртало, 600 долларов в месяц, без мебели', { tx: 'MONTHLY_RENT', rooms: [2, 2], districts: ['Saburtalo'], price: [0, 600], furnished: false }],
  ['ru', 'Ищу дом в Дигоми с участком до 300 000$', { tx: 'BUY', type: 'HOUSE', districts: ['Digomi'], price: [285000, 300000] }],
  ['ru', 'Квартира в Глдани около 70 тыс $', { districts: ['Gldani'], price: [63000, 77000], priceStatus: 'PROPOSED' }],
  ['ru', 'Купить трёхкомнатную квартиру в Ваке 150-200 тыс долларов', { tx: 'BUY', rooms: [3, 3], districts: ['Vake'], price: [150000, 200000], priceStatus: 'STATED' }],
  ['ru', 'Сниму квартиру посуточно в Батуми, Старый Батуми, до 60$', { tx: 'DAILY_RENT', city: 'Batumi', districts: ['Old Batumi'], price: [0, 60] }],
  ['ru', 'куплю квартиру в новостройке в Сабуртало, 2 спальни, от 70 до 90 м2, до 120 тысяч долларов', { tx: 'BUY', buildings: ['NEW_BUILD'], bedrooms: [2, 2], area: [70, 90], price: [105000, 120000] }],
  ['ru', 'аренда офиса в Ваке 100 кв.м', { tx: 'MONTHLY_RENT', type: 'OFFICE', districts: ['Vake'] }],
  ['ru', 'двушка в Исани с ремонтом до 55 000 долларов', { rooms: [2, 2], districts: ['Isani'], renovations: ['RENOVATED'], price: [40000, 55000] }],
  ['ru', 'квартира в Тбилиси с балконом и парковкой, бюджет 100000 лари', { city: 'Tbilisi', must: ['BALCONY', 'PARKING'], price: [22037, 37037] }],
  ['ru', 'пентхаус в Батуми с видом на море', { type: 'PENTHOUSE', city: 'Batumi', must: ['VIEW'] }],
  ['ru', 'квартира в Сабуртало не первый этаж, 3 комнаты, 85000$', { rooms: [3, 3], price: [70000, 85000] }],
  ['ru', 'снять квартиру в Ваке на длительный срок 1200 евро', { tx: 'MONTHLY_RENT', price: [0, 1311] }],
  ['ru', 'земельный участок в Цхнети 40 тыс долларов', { type: 'LAND', districts: ['Tskneti'], price: [25000, 40000] }],
  ['ru', 'квартира в Сабуртала 2 спальни', { districts: ['Saburtalo'], bedrooms: [2, 2] }],
  ['ru', 'дом или квартира в Батуми купить', { clar: ['propertyType'], tx: 'BUY', city: 'Batumi' }],
  // ── Turkish ───────────────────────────────────────────────────────────────
  ['tr', "Tiflis'te satılık 2+1 daire, 100 bin dolara kadar", { tx: 'BUY', type: 'APARTMENT', city: 'Tbilisi', bedrooms: [2, 2], rooms: [3, 3], price: [85000, 100000] }],
  ['tr', "Batum'da kiralık daire aylık 500 dolar", { tx: 'MONTHLY_RENT', city: 'Batumi', price: [0, 500] }],
  ['tr', "Tiflis Vake'de 3+1 satılık daire 250.000 USD", { tx: 'BUY', districts: ['Vake'], bedrooms: [3, 3], price: [235000, 250000] }],
  ['tr', 'Batumda günlük kiralık stüdyo 40 dolar', { tx: 'DAILY_RENT', type: 'STUDIO', city: 'Batumi', price: [0, 40] }],
  ['tr', 'Tiflis Saburtalo eşyalı kiralık daire 700 USD', { tx: 'MONTHLY_RENT', furnished: true, districts: ['Saburtalo'], price: [0, 700] }],
  ['tr', 'Batum yeni bina satılık daire deniz manzaralı 80 bin dolar', { tx: 'BUY', city: 'Batumi', buildings: ['NEW_BUILD'], must: ['VIEW'], price: [65000, 80000] }],
  ['tr', 'Tiflis satılık müstakil ev bahçeli 300.000 $', { tx: 'BUY', type: 'HOUSE', must: ['GARDEN'], price: [285000, 300000] }],
  ['tr', 'Tiflis kiralık ofis 150 metrekare', { tx: 'MONTHLY_RENT', type: 'OFFICE', city: 'Tbilisi' }],
  ['tr', 'Batum satılık arsa 50 bin euro', { tx: 'BUY', type: 'LAND', city: 'Batumi', price: [39630, 54630] }],
  // ── Arabic ────────────────────────────────────────────────────────────────
  ['ar', 'شقة للبيع في تبليسي فاكي 3 غرف نوم حتى 200 ألف دولار', { tx: 'BUY', type: 'APARTMENT', city: 'Tbilisi', districts: ['Vake'], bedrooms: [3, 3], price: [185000, 200000] }],
  ['ar', 'للإيجار شقة في باتومي غرفتين نوم 600 دولار شهريا', { tx: 'MONTHLY_RENT', city: 'Batumi', bedrooms: [2, 2], price: [0, 600] }],
  ['ar', 'أريد شراء فيلا في تبليسي مع مسبح', { tx: 'BUY', type: 'VILLA', city: 'Tbilisi', must: ['POOL'] }],
  ['ar', 'شقة مفروشة للإيجار اليومي في باتومي 50 دولار', { tx: 'DAILY_RENT', city: 'Batumi', furnished: true, price: [0, 50] }],
  ['ar', 'أرض للبيع في باتومي 100 ألف دولار', { tx: 'BUY', type: 'LAND', city: 'Batumi', price: [85000, 100000] }],
  ['ar', 'شقة في سابورتالو مع موقف سيارات بحد أقصى 150000 دولار', { districts: ['Saburtalo'], must: ['PARKING'], price: [135000, 150000] }],
  ['ar', 'مكتب للإيجار في تبليسي', { tx: 'MONTHLY_RENT', type: 'OFFICE', city: 'Tbilisi' }],
  // ── Hebrew ────────────────────────────────────────────────────────────────
  ['he', 'דירה להשכרה בבטומי 2 חדרי שינה עד 700 דולר לחודש', { tx: 'MONTHLY_RENT', type: 'APARTMENT', city: 'Batumi', bedrooms: [2, 2], price: [0, 700] }],
  ['he', 'בית למכירה בטביליסי עד 400 אלף דולר', { tx: 'BUY', type: 'HOUSE', city: 'Tbilisi', price: [385000, 400000] }],
  ['he', 'מחפש דירה בבטומי לטווח קצר', { tx: 'DAILY_RENT', city: 'Batumi' }],
  ['he', 'דירת 3 חדרים בסבורטלו לקנות 120 אלף דולר', { tx: 'BUY', rooms: [3, 3], districts: ['Saburtalo'], price: [105000, 120000] }],
  ['he', 'דירה מרוהטת עם מרפסת ומעלית בטביליסי להשכרה', { tx: 'MONTHLY_RENT', furnished: true, must: ['BALCONY', 'ELEVATOR'] }],
  ['he', 'פנטהאוז בבטומי עם נוף לים', { type: 'PENTHOUSE', city: 'Batumi', must: ['VIEW'] }],
  ['he', 'משרד להשכרה בטביליסי 100 מ"ר', { tx: 'MONTHLY_RENT', type: 'OFFICE' }],
];

/**
 * What the retired model (OpenAI call 1) returned for production sentences, from the
 * repository's own fixtures (marketplaceFixtures.mjs, findPropertyStabilization.test.mjs,
 * marketplaceSearch.test.mjs). The engine is compared field by field on the brief both
 * readings produce through the same gate.
 */
export const MODEL_BASELINE = [
  {
    text: 'ვაკეში მინდა საყიდლად 2 საძინებლიანი, 3 ოთახიანი ბინა, 80 დან 110 მ² მდე, ახალაშენებულ ან მშენებარე კორპუსში. ბიუჯეტი $120,000 დან $160,000 მდე.',
    model: {
      transactionType: 'BUY', propertyType: 'APARTMENT', country: 'GE', city: null, districts: ['ვაკე'], locationPreferences: [],
      priceMinUsd: 120000, priceMaxUsd: 160000, priceCurrencyStated: 'USD', areaMinSqm: 80, areaMaxSqm: 110,
      roomsMin: 3, roomsMax: 3, bedroomsMin: 2, bedroomsMax: 2, bathroomsMin: null,
      buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'], renovationPreferences: [], furnished: null, parking: null,
      floorPreferences: [], mustHave: [], niceToHave: [], exclusions: [], userLanguage: 'ka', relevantSearchLanguages: ['ka', 'en', 'ru'], proposals: [],
    },
  },
  {
    text: 'ვაკეში მინდა კარგი 2 საძინებლიანი ბინა',
    model: {
      transactionType: null, propertyType: 'APARTMENT', country: 'GE', city: null, districts: ['ვაკე'], locationPreferences: [],
      priceMinUsd: null, priceMaxUsd: null, priceCurrencyStated: null, areaMinSqm: null, areaMaxSqm: null,
      roomsMin: null, roomsMax: null, bedroomsMin: 2, bedroomsMax: 2, bathroomsMin: null,
      buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
      floorPreferences: [], mustHave: [], niceToHave: [], exclusions: [], userLanguage: 'ka', relevantSearchLanguages: ['ka', 'en', 'ru'], proposals: [],
    },
  },
  {
    text: 'მოკლედ ყლეო, ვეძებ ვარკეთილში და ვაზისუბანშიც ორივე ლოკაცია მაინტერესებს, ბინას მაქსიმუმ ბიუჯეტი 70-დან 90 ათას დოლარამდეა, 2 საძინებლიანი აუცილებლად, უნდ ქონდეს აივანი, განვიხიალვ მწვანე კარკასსაც და რაც მტავარია გარემონტებული უნდა იყოს და უკეთესია ახალაშენებულში, სართულები კიდე 2-დან 8-მდე, და კვ.მ კიდე 70 კვ.მ.-დან! მხოლოდ ამ უბნების ცენტრში',
    model: {
      transactionType: 'BUY', propertyType: 'APARTMENT', country: 'GE', city: 'Tbilisi', districts: ['ვარკეთილი', 'ვაზისუბანი'],
      locationPreferences: ['უბნის ცენტრი'], priceMinUsd: 70000, priceMaxUsd: 90000, priceCurrencyStated: 'USD',
      areaMinSqm: 70, areaMaxSqm: 100, roomsMin: 2, roomsMax: null, bedroomsMin: 2, bedroomsMax: null, bathroomsMin: null,
      buildingStatuses: ['NEW_BUILD', 'OLD_BUILD'], renovationPreferences: ['RENOVATED', 'GREEN_FRAME'], furnished: null, parking: null,
      floorPreferences: ['LOW', 'MIDDLE', 'HIGH'], mustHave: ['BALCONY'], niceToHave: [], exclusions: [],
      userLanguage: 'ka', relevantSearchLanguages: ['ka'], proposals: [],
    },
  },
  {
    text: 'მინდა ვარკეთილში, სუხიშვილის ქუჩისკენ, ან მიკროებში მაღლა მხარეს 2 საძინებლიანი ბინა, ახალ აშენებულ კორპუსში ან მიმდინარეში, მაქსიმუმ 90000$, მინიმუმ 70 კვადრატიდან',
    model: {
      transactionType: 'BUY', propertyType: 'APARTMENT', country: 'GE', city: 'ვარკეთილი', districts: ['სუხიშვილის ქუჩა', 'მიკროები'], locationPreferences: ['მაღლა მხარეს'],
      priceMinUsd: null, priceMaxUsd: 90000, areaMinSqm: 70, areaMaxSqm: null, bedroomsMin: 2, bedroomsMax: 2,
      buildingStatuses: ['NEW_BUILD', 'UNDER_CONSTRUCTION'], userLanguage: 'ka',
    },
  },
];

/** The brief fields compared against the model baseline (what a search actually executes on). */
export const BASELINE_FIELDS = ['transactionType', 'propertyType', 'city', 'districts', 'price', 'area', 'rooms', 'bedrooms', 'buildingStatuses', 'renovationPreferences', 'floorRange', 'mustHave'];
