// Deliberately adversarial fixture for the mobile-overflow test.
//
// It is NOT a copy of one production report. A regression test built from a
// single real payload only proves that ONE property fits; the failures that
// actually reach customers come from the extremes — a 26-character cadastral
// code, an unbroken Georgian compound noun, a long URL rendered inside the
// evidence drawer, a wide utilities matrix, a comparables table.
//
// So every field here is loaded with the worst realistic case, and the test
// asserts the layout survives it at 320px.

/** 26 characters, no natural break opportunity. */
export const LONG_CADASTRAL = '01.18.06.019.055.03.01.601';

/** A real-shaped Georgian string with no spaces for ~40 characters. */
const LONG_GEORGIAN = 'არასაცხოვრებელისაკუთრებისუფლებრივიმდგომარეობა';
const LONG_RUSSIAN = 'НежилоеПомещениеПравовоеСостояниеСобственности';
const LONG_URL = 'https://www.example-portal.ge/listings/residential/tbilisi/krtsanisi/villion-krtsanisi-homes/apartment-601-94-1m2?ref=homatch&utm_source=verification';

export const SYNTHESIS = {
  mode: 'MODEL',
  empty: false,
  persisted: true,
  propertyType: 'APARTMENT',
  report: {
    summary: {
      label: 'BALANCED',
      statement: 'საერთო სურათი დაბალანსებულია — პროექტი ხარისხიანია, თუმცა ხელშეკრულებამდე რამდენიმე დეტალი უნდა დაზუსტდეს.',
      highlights: [
        { dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE', headline: 'დაბალი სიმჭიდროვე', detail: 'ორი 8-სართულიანი შენობა დაახლოებით 42 ოჯახზეა გათვლილი.', cites: ['e1'] },
        { dimension: 'MARKET_POSITION', sentiment: 'BALANCED', headline: 'ბაზრის დონეზე', detail: 'იმავე პროექტის აქტიური შეთავაზებების დონეზეა.', cites: ['e2'] },
        { dimension: 'LEGAL_CONTEXT', sentiment: 'ATTENTION', headline: LONG_GEORGIAN, detail: `${LONG_GEORGIAN} — ${LONG_RUSSIAN}`, cites: ['e3'] },
        { dimension: 'DEVELOPER', sentiment: 'BALANCED', headline: 'ახალი დეველოპერი', detail: 'პროექტი პირველია ამ კომპანიისთვის.', cites: ['e4'] },
        { dimension: 'LOCATION', sentiment: 'POSITIVE', headline: 'კრწანისი', detail: 'ძველ თბილისთან და მტკვრის სანაპიროსთან სიახლოვე.', cites: ['e5'] },
        { dimension: 'TRANSACTION_READINESS', sentiment: 'ATTENTION', headline: 'ერთობლივი ხელმოწერა', detail: 'კომპანიას დირექტორები ერთობლივად წარმოადგენენ.', cites: ['e6'] },
      ],
    },
    keyFindings: [
      { finding: `საკადასტრო ერთეული ${LONG_CADASTRAL} იდენტიფიცირებულია.`, whyItMatters: 'ეს არის ზუსტად ის ერთეული, რომელსაც ყიდულობთ.', sentiment: 'BALANCED', cites: ['e1'] },
      { finding: LONG_GEORGIAN, whyItMatters: LONG_RUSSIAN, sentiment: 'ATTENTION', cites: ['e3'] },
      { finding: 'მშობელ ნაკვეთზე რეგისტრირებულია იპოთეკა.', whyItMatters: 'გავლენას ახდენს რეგისტრაციის თანმიმდევრობაზე.', sentiment: 'ATTENTION', cites: ['e2'] },
      { finding: 'კომპანია მოვალეთა რეესტრში არ ფიქსირდება.', whyItMatters: 'ეს დადებითი სიგნალია გარიგებისთვის.', sentiment: 'POSITIVE', cites: ['e4'] },
    ],
    sections: [
      { key: 'MARKET', title: 'ფასი და ბაზარი', body: 'იმავე პროექტში აქტიური შეთავაზებების მედიანა 5,734 ლარია კვადრატულ მეტრზე. ეს დონე უბნის შედარებით ძვირიან ალტერნატივებზე დაბალია.', metrics: [{ label: 'მედიანა', value: '5,734 ₾/მ²' }, { label: 'დიაპაზონი', value: '5,734–7,776 ₾/მ²' }, { label: 'შედარება', value: '3 განცხადება' }, { label: LONG_GEORGIAN, value: LONG_CADASTRAL }], cites: ['e2'] },
      { key: 'PROJECT', title: 'პროექტი და დეველოპერი', body: `${LONG_GEORGIAN} — პროექტი დაბალი სიმჭიდროვით გამოირჩევა.`, metrics: [], cites: ['e1'] },
      { key: 'LOCATION', title: 'კრწანისის მიკროლოკაცია', body: 'კრწანისი ძველ თბილისთან ახლოსაა.', metrics: [{ label: 'შედარებადი მედიანა', value: '1,730 USD/მ²' }, { label: 'შედარებადი საშუალო', value: '1,787 USD/მ²' }, { label: 'კრწანისის ახლო შედარებადი', value: '2,114 USD/მ²' }, { label: 'შედარებადი ჯგუფი', value: '43 განცხადება' }], cites: ['e5'] },
      /*
       * THE REAL METRICS FROM THE LIVE VILLION REPORT
       * (job 347f9933-e9e9-475d-a2aa-59c55c67c9ee).
       *
       * Four chips per section with long Georgian labels is the exact shape
       * that collapsed into one-character columns: several chips competing
       * for ONE row is what made the old flex layout shrink them all toward
       * zero. At phone widths only one chip fits per line, so nothing
       * competes and the defect never appeared — which is why this fixture
       * now carries the real labels AND the suite runs at 768 and desktop.
       */
      { key: 'PEOPLE', title: 'კომპანია და ხელმოწერის პრაქტიკული საკითხი', body: 'კომპანიას დირექტორები ერთობლივად წარმოადგენენ.', metrics: [{ label: 'რეგისტრაცია', value: '28.03.2023' }, { label: 'პარტნიორთა წილები', value: '50% / 50%' }, { label: 'წარმომადგენლობა', value: 'ერთობლივი' }, { label: 'კომპანიის ვალდებულება', value: 'საქართველოს ბანკი · 19.12.2023' }], cites: ['e6'] },
      { key: 'LEGAL', title: 'სამართლებრივი და ფინანსური კონტექსტი', body: `${LONG_RUSSIAN} ${LONG_GEORGIAN}`, metrics: [], cites: ['e3'] },
    ],
    attentionPoints: [
      { point: LONG_GEORGIAN, why: LONG_RUSSIAN, cites: ['e3'] },
    ],
    finalView: 'საერთო ჯამში პროექტი ხარისხიანია და ფასი ბაზრის დონეზეა.',
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება და შევამოწმებ მნიშვნელოვან პირობებს.' },
  },
  snapshot: {
    cadastralCode: LONG_CADASTRAL,
    propertyType: 'ბინა',
    project: 'VILLION Krtsanisi Homes',
    address: 'თბილისი, კრწანისის ქუჩა 6',
    district: 'კრწანისი',
    area: '94.10',
    floor: '6',
    rooms: '3',
    unitNumber: '601',
    condition: 'მწვანე კარკასი',
    owner: 'შპს „მილენიო გრუპი“',
    developer: 'Millennio Group',
    constructionStatus: 'ჩაბარებული',
    parking: 'მიწისქვეშა პარკინგი',
    amenities: [LONG_GEORGIAN, 'კონსიერჟი', 'დაცვა', 'გამწვანებული ეზო'],
  },
  market: {
    currency: 'GEL', median: 5734, mean: 6414, min: 5734, max: 7776, count: 3,
    basis: 'SAME_PROJECT', basisCount: 1,
    tiers: [
      { tier: 'SAME_PROJECT', median: 5734, min: 5734, max: 5734, count: 1 },
      { tier: 'SAME_DISTRICT', median: 5734, min: 5734, max: 5734, count: 1 },
      { tier: 'WIDER_MARKET', median: 7776, min: 7776, max: 7776, count: 1 },
    ],
    qualityFactors: [
      { factor: 'დაბალი სიმჭიდროვე', direction: 'SUPPORTS_PREMIUM' },
      { factor: LONG_GEORGIAN, direction: 'SUPPORTS_DISCOUNT' },
    ],
  },
  people: {
    people: [
      { name: 'კობა კვანტალიანი', role: 'DIRECTOR', roles: ['DIRECTOR', 'SHAREHOLDER'], entity: 'შპს „მილენიო გრუპი“', representation: 'JOINT', certainty: 'REGISTERED', historical: false, ownershipPct: 60 },
      { name: 'ლევან ჩაჩუა', role: 'DIRECTOR', roles: ['DIRECTOR', 'SHAREHOLDER'], entity: 'შპს „მილენიო გრუპი“', representation: 'JOINT', certainty: 'REGISTERED', historical: false, ownershipPct: 40 },
      { name: 'ნინო აბაშიძე-ჯაფარიძე-მელაძე', role: 'REPRESENTATIVE', roles: ['REPRESENTATIVE'], entity: 'შპს „მილენიო გრუპი“', representation: 'UNKNOWN', certainty: 'PUBLICLY_REPORTED', historical: true, asOf: '2024-03-11' },
    ],
    representationNote: 'რეესტრის ჩანაწერით კომპანიას დირექტორები ერთობლივად წარმოადგენენ.',
  },
  selfChecks: [
    { kind: 'PROPERTY_EXTRACT', url: 'https://www.my.gov.ge/ka-ge/services/5/service/176', copyValue: LONG_CADASTRAL, copyLabel: 'საკადასტრო კოდი' },
    { kind: 'TAXPAYER_REGISTRY', url: 'https://www.rs.ge/TaxPayersRegistry', copyValue: '404670272', copyLabel: 'საიდენტიფიკაციო კოდი', contextValue: 'შპს „მილენიო გრუპი“' },
  ],
  /*
   * VERIFY V3 (2026-10): the discipline-grouped team, the official document
   * explorer, today's legal position, the documented specifications and the
   * register card — loaded with the long Georgian role wordings, unbroken
   * file names and case numbers that break narrow layouts.
   */
  projectTeamV2: [
    { name: 'შპს მილენიო გრუპი', kind: 'ORGANIZATION', group: 'DEVELOPER', organization: null, official: true, firstSeen: '2023-04-01', lastSeen: '2025-06-01', roles: [
      { code: 'CLIENT', roleText: 'დამკვეთი', scope: null, caseRef: '01/2025/123456-01', date: '2025-06-01', documentTitle: 'მშენებლობის ნებართვის მოდიფიცირების განაცხადი', sourceUrl: LONG_URL },
    ] },
    { name: 'დარეჯან შათაშვილი', kind: 'PERSON', group: 'ARCHITECTURE', organization: 'შპს არტიტექსი', official: true, firstSeen: '2023-04-01', lastSeen: '2025-06-01', roles: [
      { code: 'ARCHITECT', roleText: 'მთავარი არქიტექტორი', scope: `არქიტექტურული პროექტი — ${LONG_GEORGIAN}`, caseRef: '01/2025/123456-01', date: '2025-06-01', documentTitle: 'არქიტექტურული პროექტი', sourceUrl: LONG_URL },
      { code: 'ARCHITECT', roleText: 'პროექტის ავტორი', scope: null, caseRef: '01/2023/654321-02', date: '2023-04-01', documentTitle: 'ესკიზური პროექტი', sourceUrl: null },
    ] },
    { name: 'გიორგი რეხვიაშვილი', kind: 'PERSON', group: 'STRUCTURAL', organization: null, official: true, roles: [
      { code: 'EXPERT_REVIEW', roleText: 'საძირკვლისა და ძირითადი კონსტრუქციული ელემენტების საექსპერტო შეფასება', scope: null, caseRef: '01/2025/123456-01', date: '2025-05-20', documentTitle: LONG_GEORGIAN, sourceUrl: LONG_URL },
    ] },
    { name: 'ია მშვიდობაძე', kind: 'PERSON', group: 'GEOTECHNICAL', organization: null, official: true, roles: [
      { code: 'GEOTECHNICAL_SPECIALIST', roleText: 'საინჟინრო-გეოლოგიური საექსპერტო შეფასება', scope: null, caseRef: null, date: '2023-03-10', documentTitle: null, sourceUrl: null },
    ] },
  ],
  officialDocuments: [
    { caseRef: '01/2025/123456-01', documentId: 'doc-a', caseDate: '2025-06-01', title: `მშენებლობის ნებართვის მოდიფიცირება — ${LONG_GEORGIAN}`, status: 'UNDER_REVIEW', priority: 1, publicUrl: LONG_URL, files: [
      { fileName: 'არქიტექტურული_პროექტი_ბლოკი_A_საბოლოო_ვერსია_განახლებული_2025_06_01.pdf', format: 'pdf', kind: 'PDF', outcome: 'READ_TEXT', pages: 118, sourceUrl: LONG_URL, date: '2025-06-01' },
      { fileName: 'renders.rar', format: 'rar', kind: 'ARCHIVE', outcome: 'UNSUPPORTED_FORMAT', pages: null, sourceUrl: null, date: null },
      { fileName: 'konstruqcia.dwg', format: 'dwg', kind: 'DRAWING', outcome: 'DEFERRED', pages: null, sourceUrl: null, date: null },
    ] },
    { caseRef: '01/2023/654321-02', documentId: 'doc-b', caseDate: '2023-04-01', title: 'მშენებლობის ნებართვა', status: 'APPROVED', priority: 2, publicUrl: LONG_URL, files: [] },
    { caseRef: '01/2022/111111-03', documentId: 'doc-c', caseDate: '2022-01-15', title: 'განაშენიანების რეგულირების გეგმა', status: 'APPROVED', priority: null, publicUrl: null, files: [] },
  ],
  technicalSpecs: [
    { key: 'landArea', label: 'მიწის ნაკვეთის ფართობი', value: '2 450', numeric: 2450, unit: 'მ²', status: 'APPROVED', caseRef: '01/2023/654321-02', date: '2023-04-01', source: 'TAS' },
    { key: 'K2', label: 'განაშენიანების ინტენსივობის კოეფიციენტი (კ-2)', value: '3.4', numeric: 3.4, unit: null, status: 'APPROVED', caseRef: null, date: null, source: 'TAS' },
    { key: 'floors', label: 'სართულიანობა', value: '8', numeric: 8, unit: null, status: 'APPROVED', caseRef: null, date: null, source: 'TAS' },
    { key: 'floors', label: 'სართულიანობა', value: '10', numeric: 10, unit: null, status: 'PROPOSED', caseRef: '01/2025/123456-01', date: '2025-06-01', source: 'TAS' },
    { key: 'foundationType', label: 'საძირკველი', value: LONG_GEORGIAN, numeric: null, unit: null, status: 'UNKNOWN', caseRef: null, date: null, source: 'TAS' },
  ],
  officialHistory: {
    status: { state: 'PERMITTED', since: '2023-04-01', caseRef: '01/2023/654321-02', decisionNumber: '01-2023-777', validUntil: null, conclusive: true, caveats: [], pendingCount: 1 },
    milestones: [], evolution: [],
    currentPosition: {
      effective: { kind: 'PERMIT', date: '2023-04-01', decisionNumber: '01-2023-777', caseRef: '01/2023/654321-02' },
      pending: [], conflicts: [],
    },
    pendingApplications: [{ caseRef: '01/2025/123456-01', date: '2025-06-01', deadline: '2025-08-15', subject: `სართულების დამატება — ${LONG_GEORGIAN}`, status: 'UNDER_REVIEW' }],
  },
  propertyRegister: {
    cadastralCode: LONG_CADASTRAL,
    latest: { recordId: 'r1', applicationNumber: null, issuedAt: '2025-09-01T10:00:00', owners: [{ kind: 'COMPANY', name: 'შპს „მილენიო გრუპი“' }], ownershipRegisteredOn: '2023-01-10', ownershipBasis: 'OTHER', landFunction: null, landAreaSqm: null, buildingsUnderConstruction: true, unitUnderConstruction: true, unitAreaSqm: 94.1, mortgages: [], taxLien: 'NONE', seizure: 'NONE', debtorRegistry: 'UNKNOWN' },
    currentMortgages: [{ applicationNumber: '882211', registeredOn: '2023-12-19', creditor: 'სააქციო საზოგადოება "საქართველოს ბანკი"', creditorId: null, agreementNumber: LONG_CADASTRAL, agreementDate: '2023-12-19', level: 'PARCEL' }],
    removedMortgages: [],
    proceedings: [],
    coverage: { found: 0, read: 0, documents: 0, notOpened: 0 },
  },
  registerSource: { jobId: 'earlier-job', asOf: '2025-09-01T10:00:00Z', reused: true },
  evidence: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i + 1}`,
    claim: i % 3 === 0 ? `${LONG_GEORGIAN} ${LONG_RUSSIAN}` : 'რეესტრის ჩანაწერით ერთეული იდენტიფიცირებულია.',
    provenance: 'OFFICIAL_REGISTRY',
    certainty: 'CONFIRMED',
    url: LONG_URL,
    date: '2026-09-09',
  })),
};

/**
 * The research result the evidence drawer renders. These are the legacy
 * cards that were reported to overflow, so the fixture stresses every one:
 * wide matrices, long unbroken strings, long URLs, comparables tables.
 */
export const RESULT_JSON = {
  queryType: 'cadastral',
  entityName: 'VILLION Krtsanisi Homes',
  entityType: 'APARTMENT',
  summary: `${LONG_GEORGIAN} ${LONG_RUSSIAN}`,
  coverageNote: LONG_GEORGIAN,
  exactUnit: { code: LONG_CADASTRAL, verified: true, note: LONG_GEORGIAN },
  identifiedParent: { code: '01.18.06.019.055', name: 'VILLION Krtsanisi Homes', address: 'თბილისი, კრწანისის ქუჩა 6', developer: 'Millennio Group' },
  reconciledIdentity: { address: 'თბილისი, კრწანისის ქუჩა 6', project: 'VILLION Krtsanisi Homes', note: LONG_GEORGIAN },
  projectProfile: {
    name: 'VILLION Krtsanisi Homes', developer: 'Millennio Group', address: 'თბილისი, კრწანისის ქუჩა 6',
    website: LONG_URL, buildings: '2', floors: '8', unitCounts: '42',
    constructionStatus: 'ჩაბარებული', architect: LONG_GEORGIAN,
    amenities: [LONG_GEORGIAN, 'კონსიერჟი', 'დაცვა'], facts: [LONG_GEORGIAN, LONG_RUSSIAN],
  },
  /*
   * The registry-backed shape, so COMPANY & OWNERSHIP is actually measured.
   * Values are the real Millenio extract (job 3aa36828's fixture); the
   * creditor string is long on purpose — a bank's full legal name with its
   * own id code is exactly what overflows a narrow encumbrance card.
   */
  companyProfile: {
    name: 'შპს „მილენიო გრუპი“', idCode: '404670272', legalForm: 'შეზღუდული პასუხისმგებლობის საზოგადოება',
    registrationDate: '28/03/2023', status: 'აქტიური',
    registeredAddress: 'საქართველო, თბილისი, კრწანისის რაიონი, კრწანისის ქუჩა, N6',
    directors: [
      { name: 'კობა კვანტალიანი', representation: 'ერთობლივი' },
      { name: 'ლევან ჩაჩუა', representation: 'ერთობლივი' },
    ],
    shareholders: [
      { name: 'ლევან ჩაჩუა', percentage: 50, units: 50 },
      { name: 'კობა კვანტალიანი', percentage: 50, units: 50 },
    ],
    encumbrances: [
      { kind: 'PLEDGE_LEASE', reference: 'R23757008', creditor: 'სს საქართველოს ბანკი (საქართველო) 204378869', registeredAt: '19/12/2023' },
    ],
    liquidationRegistered: false,
    shareholdingConsistent: true,
    extractNumber: 'B24099518',
    extractPreparedAt: '15/08/2024',
    registryFields: ['name', 'idCode', 'legalForm', 'registrationDate', 'registeredAddress', 'directors', 'shareholders', 'encumbrances'],
    sourceBasis: 'REGISTRY_CONFIRMED',
    historicalChanges: [LONG_GEORGIAN, LONG_RUSSIAN],
  },
  utilitiesMatrix: {
    electricity: { status: 'CONFIRMED_CONNECTED', note: LONG_GEORGIAN },
    water: { status: 'CONFIRMED_CONNECTED', note: LONG_RUSSIAN },
    gas: { status: 'NOT_CONFIRMED', note: LONG_GEORGIAN },
    sewage: { status: 'CONFIRMED_CONNECTED' },
    internet: { status: 'NOT_CONFIRMED' },
  },
  /*
   * THE LEGAL-STATUS MATRIX — the section in the reported screenshot.
   *
   * Absent from this fixture entirely, which is why the viewport harness
   * reported green while the live report showed Georgian labels collapsed
   * into one-character vertical columns. The notes below are the real
   * production wording: one SHORT note (that row renders correctly) and
   * several LONG ones (those rows are the defect), because the collapse only
   * happens when the non-shrinking value claims the whole row.
   */
  legalStatus: {
    companyRegistration: { status: 'CONFIRMED', label: 'კომპანიის რეგისტრაცია', note: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.' },
    debtorRegistry: { status: 'CONFIRMED', label: 'მოვალეთა რეესტრი', note: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.' },
    taxpayerStatus: { status: 'NOT_CONFIRMED', label: 'გადასახადის გადამხდელის სტატუსი', note: 'ამ ეტაპზე საჯარო წყაროებით ვერ დადასტურდა.' },
    propertyEncumbrances: { status: 'NOT_CONFIRMED', label: 'ქონებრივი ვალდებულებები', note: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.' },
    constructionPermissions: { status: 'CONFIRMED', label: 'სამშენებლო ნებართვები', note: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.' },
    commissioning: { status: 'CONFIRMED', label: 'ექსპლუატაციაში მიღება', note: 'დადასტურებულია საჯარო წყაროთი — უარყოფითი მტკიცებულება არ გამოვლენილა.' },
  },
  rightsAndRestrictions: { status: 'RESTRICTION_IDENTIFIED', items: [LONG_GEORGIAN, LONG_RUSSIAN], statement: LONG_GEORGIAN, asOf: '2026-09-09' },
  market: {
    comparables: [
      { source: 'portal', url: LONG_URL, project: 'VILLION Krtsanisi Homes', address: 'კრწანისის ქუჩა 6', area: '94.30', rooms: '3', floor: '6', condition: 'მწვანე კარკასი', price: '174455', currency: 'USD', pricePerSqm: '1850', comparableType: 'SAME_PROJECT', listingDate: '2026-08-30' },
      { source: 'portal', url: LONG_URL, project: 'Krtsanisi Residence', address: 'კრწანისის ქუჩა 12', area: '90', rooms: '3', floor: '4', price: '153000', currency: 'USD', pricePerSqm: '1700', comparableType: 'MICRO_LOCATION' },
    ],
    priceEvidence: [LONG_GEORGIAN, LONG_RUSSIAN],
  },
  officialDocuments: [
    { source: 'registry', sourceName: 'საჯარო რეესტრი', url: LONG_URL, title: LONG_GEORGIAN, date: '2026-07-14', type: 'ამონაწერი', parsed: true, textExtractionAvailable: true },
  ],
  technicalFacts: [
    { category: 'ფართობი', key: 'area', value: '94.10 კვ.მ', confidence: 'HIGH' },
    { category: LONG_GEORGIAN, key: 'note', value: LONG_RUSSIAN, confidence: 'MEDIUM' },
  ],
  publicResearch: { amenities: [LONG_GEORGIAN], facts: [LONG_RUSSIAN], currentPhysicalStatus: 'ჩაბარებული' },
  dueDiligenceCoverage: { level: 'HIGH', officialSourcesChecked: 4, documentsRead: 3, marketComparables: 3 },
};

export const STATUS_RESPONSE = {
  id: 'fixture-job',
  status: 'COMPLETE',
  stage: 'COMPLETE',
  created_at: '2026-09-09T22:21:16.289Z',
  updated_at: '2026-09-09T22:30:15.643Z',
  completed_at: '2026-09-09T22:30:15.643Z',
  progress: { phase: 'complete', percent: 100 },
  result_json: RESULT_JSON,
};
