// Production Verify report for cadastral 01.18.06.019.055.03.01.601
// (research_jobs 8ba97da9-…, _logicVersion 3, read 2026-10-11), SANITIZED:
//
//   - the private unit owner's name is replaced by a placeholder;
//   - the masked personal-ID fragment in a TAS sentence is reduced to "•••";
//   - no phones, e-mails or personal ID numbers remain;
//   - officialDocuments keep at most four files per case; market.ranked (51
//     raw listings) is dropped, market.closest kept; officialHistory.conflicts
//     are trimmed to two (they are raw OCR fragments).
//
// STORED_SYNTHESIS is the row as persisted (officialVisuals carry storage
// paths). customerSynthesis() simulates verify-synthesis forCustomer(): every
// visual becomes what toCustomerVisualAssets() returns, with a fake signed URL
// of the real shape. Everything else is untouched, so the page receives what
// production serves.

import { toCustomerVisualAssets } from '../../intelligence/visualAssets.ts';

const OWNER = 'ნ. ბერიძე';
const TAS = (id) => `https://docs.tbilisi.gov.ge/architect/public.html?docId=${id}`;
const DL = (id) => `https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=${id}`;

/* [id, kind, category, fileName, documentId, extraction, confidence, role, versionStatus, width, height, attachedFileId] */
const V = [
  ['3c76482289e9f62b138bea23e726d184d2966acc1c83c0bf6645b3654b615cd0', 'RENDER', 'BUILDING', '05.effectsResult.jpg', '919535', 'NATIVE_IMAGE', 0.9, 'LATEST_RENDER', 'HISTORICAL_APPROVED', 2200, 1613, '3807085'],
  ['25eade9c805a4780ea7fd89540ada437504295f20bf0bce792044d9bc4691eaa', 'RENDER', 'BUILDING', '022.effectsResult.jpg', '919535', 'NATIVE_IMAGE', 0.9, 'SUPPORTING', 'HISTORICAL_APPROVED', 2200, 1442, '3807186'],
  ['27a40253ed091144f8eb4ad14531763aa833b84a6998463f41409db0ee7d1f40', 'PHOTO', 'BUILDING', 'photos gapi.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 1500, 844, '2344309'],
  ['8ef96027cb4e7bf1783394671a47435d703d1075d6eaffe78cfae4853f2d03a2', 'PHOTO', 'BUILDING', 'photos gapi.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 1500, 844, '2344309'],
  ['af5298ee0c70d8439a003fc12fcf73bce839cb5658b0358b2df7147bf7e083ec', 'PHOTO', 'BUILDING', 'photos gapi.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 1500, 844, '2344309'],
  ['f45589d7022c66074f39fded0158b8bbe6b203e3b08c901d6031f14367a6dafc', 'PHOTO', 'BUILDING', 'photos gapi.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 1500, 844, '2344309'],
  ['d3befb077382e41df58a2fdb0532e75b0bb801778ef8795e48f3a95d51a859ff', 'ELEVATION', 'ARCHITECTURE', '04. elevations.pdf', '919535', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 600, 600, '3804268'],
  ['2028a05b249f914b28048d3b5e540faea95692d2d54fc2f45acab1e51cc98ae5', 'STRUCTURAL', 'STRUCTURE', '13. geologia, eqspertiza, konstruqciebis eqspertiza konstrukciebi krwanisi, sainjinro proeqti 2022.11.16.pdf', '919535', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 1248, 1719, '3894496'],
  ['5f80ed72242f4b6d4362e4a4629f3a9ad951f556fb28011f84e55a328b1862df', 'STRUCTURAL', 'STRUCTURE', '13. geologia, eqspertiza, konstruqciebis eqspertiza konstrukciebi krwanisi, sainjinro proeqti 2022.11.16.pdf', '919535', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 681, 835, '3894496'],
  ['5a6cc242cca374164c8effeacf0867817668068ae2b8f64e0a3a22b4db3f4288', 'OTHER', 'BUILDING', 'Krtsanisi 05.jpg', '919535', 'NATIVE_IMAGE', 0.35, 'SUPPORTING', 'HISTORICAL_APPROVED', 3264, 2448, '3807187'],
  ['5a0e3ab9b940e701a131140516184bd7e47f115e890b3c8f482a93eaa9d43687', 'ENGINEERING', 'STRUCTURE', '10. TELASI, GWP, ENERGY,ქ. თბილისი, კრწანისის ქ.6, (01,18,06,019,055)-გეოლოგია და საექსპერტო შეფასება, საინჟინრო. 2022.10.27.pdf', '919535', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'HISTORICAL_APPROVED', 720, 1600, '3872832'],
  ['18002e555185eed1f589426a7935b9be73b042ac5a8e69b666ed6ab95966d8ba', 'ENGINEERING', 'STRUCTURE', '10. TELASI, GWP, ENERGY,ქ. თბილისი, კრწანისის ქ.6, (01,18,06,019,055)-გეოლოგია და საექსპერტო შეფასება, საინჟინრო. 2022.10.27.pdf', '919535', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'HISTORICAL_APPROVED', 720, 1040, '3872832'],
  ['37d742171fc15031b059ab03c14c570f94111098e14aa84510666fd17f0e5526', 'PHOTO', 'BUILDING', 'Photos Taxacia 1+.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 2160, 2160, '2392942'],
  ['5fc8a194637c865de5f05f63f4fc425d9af975df92eba9754fedda2df1a93e32', 'PHOTO', 'BUILDING', 'Photos Taxacia 1+.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 2160, 2160, '2392942'],
  ['8bdecb8be5367b238759e160ab14c5420df31dafc0abd1709a7797d4e4cc1ed9', 'PHOTO', 'BUILDING', 'Photos Taxacia 1+.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 2160, 2160, '2392942'],
  ['97c6a9ba21e7bc6c82d3e934a1dd82addfefd1d3c731a4d2020739e68cc109ca', 'PHOTO', 'BUILDING', 'Photos Taxacia 1+.pdf', '639208', 'PDF_EMBEDDED_IMAGE', 0.85, 'SUPPORTING', 'HISTORICAL_APPROVED', 2160, 2160, '2392942'],
  ['6a4affd1cf5d9fbcbdcfe48931e2301b43b0a52f53813245cfa3045ef8b0150b', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['c8dc85b529fc55bc4c41a46ef31f4671c2dac47b3fb0591458f873473a779028', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['cd65d3a1d161d9c05c50df4c1f591aa4c0d929b13a9d79c7e52095fb450f3ab1', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['446d7afd86e683f710e379da43cb89927c5eceff384103b43e813523cd3dd227', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['06d91eb8bb8dcf3f3d6ed3a21bbac5da2237c509819545814d49a987c9b21c8f', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['a21a1b526421382267ae9f2937c901b3bb5881c471fb835a2d133fb8e62838f3', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['777015fef7929c6f549fc08633f5d229f958412d839afeaecec15a947f226e37', 'PHOTO', 'BUILDING', 'ფოტოები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 739, 1600, '5418977'],
  ['9c4f8fb14d6d12a99940fdeb2bb754a8a97975c5d9ea65afbf32e787e19f31a0', 'FACADE', 'ARCHITECTURE', 'ფასადები.pdf', '1161121', 'PDF_EMBEDDED_IMAGE', 0.8, 'SUPPORTING', 'UNDETERMINED', 4856, 4857, '5418981'],
];

export const VISUAL_IDS = V.map((r) => r[0]);

const storedVisuals = V.map(([id, kind, category, fileName, documentId, extraction, confidence, role, versionStatus, width, height, attachedFileId]) => ({
  id, date: null, kind, mime: 'image/jpeg', page: null, role, block: null, scope: 'PROJECT',
  usage: 'OFFICIAL_RECORD_REFERENCE', width, height, source: 'TAS', category, fileName,
  identity: { blocks: [], blockBasis: null, unitLabels: [], floorLabels: [], typicalFloor: false, caseCadastralCodes: ['01.18.06.019.055'] },
  motionId: null, confidence, documentId, extraction, matchBasis: 'PARCEL_CASE',
  storagePath: `tas/${id}.jpg`, versionStatus, attachedFileId, classificationBasis: 'fixture',
}));

/* Production explanations, one per visual (report.visualExplanations). */
const E = {
  '3c7648': ['ეს არის პროექტის უახლესი დამტკიცებული რენდერი.', 'მასალა პროექტის არქიტექტურულ სახეს აჩვენებს.', 'გეხმარებათ გაიგოთ, როგორი საერთო გარემო იყო დაგეგმილი.', 'რენდერი ვერ ადასტურებს შენობის დღევანდელ შესრულებას.'],
  '25eade': ['ეს არის პროექტის ისტორიული რენდერი.', 'იგი ადრინდელ დამტკიცებულ ვერსიას ეკუთვნის.', 'გიჩვენებთ პროექტის განვითარების საწყის ვიზუალურ მიმართულებას.', 'რენდერი ვერ აჩვენებს საბოლოო აშენებულ მდგომარეობას.'],
  'd3befb': ['ეს არის პროექტის ფასადების ნახაზი.', 'ნახაზი დამტკიცებულ არქიტექტურულ გადაწყვეტას ასახავს.', 'გეხმარებათ შეაფასოთ შენობის დაგეგმილი იერსახე.', 'ნახაზი ვერ ადასტურებს ყველა დეტალის შესრულებას.'],
  '2028a0': ['ეს არის კონსტრუქციული და გეოლოგიური მასალა.', 'დოკუმენტი ფუნდამენტისა და საინჟინრო მიდგომების პროექტულ ნაწილს ეხება.', 'გიჩვენებთ, რა ტიპის ტექნიკური გადაწყვეტილებები იყო გათვალისწინებული.', 'მასალა ვერ ადასტურებს შესრულებული სამუშაოს სრულ შესაბამისობას.'],
  '5f80ed': ['ეს არის კონსტრუქციული დოკუმენტი.', 'იგი პროექტის კონსტრუქციულ სქემას უკავშირდება.', 'გაძლევთ ტექნიკურ სურათს შენობის დაგეგმილი სტრუქტურის შესახებ.', 'ნახაზი ვერ ცვლის შესრულებული კონსტრუქციის შემოწმებას.'],
  '5a0e3a': ['ეს არის საინჟინრო დოკუმენტი.', 'მასალა გეოლოგიასა და საინჟინრო კომუნიკაციებს ეხება.', 'გეხმარებათ გაიგოთ პროექტის ტექნიკური მომზადების მასშტაბი.', 'დოკუმენტი ვერ ადასტურებს ექსპლუატაციის საბოლოო მდგომარეობას.'],
  '18002e': ['ეს არის საინჟინრო მასალა.', 'ფაილი გეოლოგიურ და საინჟინრო შეფასებას უკავშირდება.', 'გაძლევთ პროექტის ტექნიკურ ფონს.', 'მასალა ვერ ადასტურებს ყველა გადაწყვეტის შესრულებას.'],
  '9c4f8f': ['ეს არის ფასადის ნახაზი.', 'მასალა აჩვენებს ფასადის დაგეგმილ არქიტექტურულ გადაწყვეტას.', 'გეხმარებათ შეაფასოთ შენობის ვიზუალური კონცეფცია.', 'ნახაზი ვერ ადასტურებს შესრულებული ფასადის საბოლოო ხარისხს.'],
};
const PHOTO_E = ['ეს არის პროექტის ფოტო.', 'ფოტო ისტორიული პროგრესის მასალაა.', 'გეხმარებათ პროექტის განვითარება ვიზუალურად დაინახოთ.', 'ფოტო ვერ ადგენს დღევანდელ მდგომარეობას.'];
const visualExplanations = V.map(([id]) => {
  const [what, interesting, buyerMeaning, uncertain] = E[id.slice(0, 6)] ?? PHOTO_E;
  return { id, what, interesting, buyerMeaning, uncertain };
});

const role = (code, date, caseRef, roleText, withTitle = true) => ({
  code, date, scope: null, caseRef, roleText, sourceUrl: TAS(caseRef.replace(/^AR1/, '')), documentTitle: withTitle ? `TAS ${caseRef.replace(/^AR1/, '')}` : null,
});
const APPLICANT = 'განმცხადებელი';
const CLIENT = 'დამკვეთ(ებ)ის სახელი და გვარი';
const CHIEF = 'მთავარი არქიტექტორის/სპეციალისტი სახელი და გვარი';
const MUNI = 'ქ. თბილისის მუნიციპალიტეტის არქიტექტურის';

/* projectTeamV2 exactly as production holds it — including the extraction noise. */
const projectTeamV2 = [
  { kind: 'PERSON', name: 'ლევან ჩაჩუა', group: 'DEVELOPER', official: true, firstSeen: '2024-05-14', lastSeen: '2026-09-17', organization: null, roles: [
    role('APPLICANT', '2026-09-17', 'AR11161121', APPLICANT, false), role('APPLICANT', '2026-06-17', 'AR11148112', APPLICANT, false),
    role('APPLICANT', '2025-11-04', 'AR11115640', APPLICANT, false), role('APPLICANT', '2025-07-29', 'AR11101896', APPLICANT, false),
    role('DEVELOPER', '2025-07-29', 'AR11101896', CLIENT), role('APPLICANT', '2025-04-03', 'AR11084312', APPLICANT, false),
    role('DEVELOPER', '2025-04-03', 'AR11084312', CLIENT), role('APPLICANT', '2024-05-14', 'AR11034439', APPLICANT, false),
    role('DEVELOPER', '2024-05-14', 'AR11034439', CLIENT),
  ] },
  { kind: 'ORGANIZATION', name: '•••) ნაცვლად - შპს „ქეი-ელ-გრუპი“', group: 'DEVELOPER', official: true, firstSeen: '2024-03-28', lastSeen: '2024-03-28', organization: null, roles: [
    role('DEVELOPER', '2024-03-28', 'AR11026464', 'შეტანა და დამკვეთად მარინა კაციტაძის (პ/ნ'),
  ] },
  { kind: 'ORGANIZATION', name: '•••) ნაცვლად დაფიქსირდეს შპს', group: 'DEVELOPER', official: true, firstSeen: '2024-03-28', lastSeen: '2024-03-28', organization: null, roles: [
    role('DEVELOPER', '2024-03-28', 'AR11026464', 'ბრძანებაში და დამკვეთად მარინა კაციტაძის (პ/ნ'),
  ] },
  { kind: 'PERSON', name: 'მარინა კაციტაძე', group: 'DEVELOPER', official: true, firstSeen: '2022-08-26', lastSeen: '2023-09-20', organization: null, roles: [
    role('DEVELOPER', '2023-09-20', 'AR1990786', CLIENT), role('DEVELOPER', '2023-05-30', 'AR1968595', CLIENT),
    role('DEVELOPER', '2022-12-30', 'AR1942605', CLIENT), role('DEVELOPER', '2022-08-26', 'AR1919535', CLIENT),
  ] },
  { kind: 'PERSON', name: 'დარეჯან შათაშვილი', group: 'ARCHITECTURE', official: true, firstSeen: '2023-05-10', lastSeen: '2025-07-29', organization: null, roles: [
    role('CHIEF_ARCHITECT', '2025-07-29', 'AR11101896', CHIEF), role('CHIEF_ARCHITECT', '2025-04-03', 'AR11084312', CHIEF),
    role('CHIEF_ARCHITECT', '2024-05-14', 'AR11034439', CHIEF), role('APPLICANT', '2023-09-20', 'AR1990786', APPLICANT, false),
    role('APPLICANT', '2023-05-30', 'AR1968595', APPLICANT, false), role('CHIEF_ARCHITECT', '2023-05-30', 'AR1968595', CHIEF),
    role('APPLICANT', '2023-05-10', 'AR1965637', APPLICANT, false),
  ] },
  { kind: 'PERSON', name: 'დავით ლოსაბერიძე', group: 'ARCHITECTURE', official: true, firstSeen: '2018-12-07', lastSeen: '2024-04-22', organization: null, roles: [
    role('APPLICANT', '2024-04-22', 'AR11031305', APPLICANT, false), role('APPLICANT', '2022-12-30', 'AR1942605', APPLICANT, false),
    role('APPLICANT', '2022-08-26', 'AR1919535', APPLICANT, false), role('CHIEF_ARCHITECT', '2022-08-26', 'AR1919535', CHIEF),
    role('APPLICANT', '2022-05-12', 'AR1897963', APPLICANT, false), role('APPLICANT', '2021-09-16', 'AR1850793', APPLICANT, false),
    role('APPLICANT', '2021-09-14', 'AR1850369', APPLICANT, false), role('APPLICANT', '2019-03-18', 'AR1668968', APPLICANT, false),
    role('APPLICANT', '2018-12-07', 'AR1639208', APPLICANT, false),
  ] },
  { kind: 'ORGANIZATION', name: 'ქ. თბილისის მუნიციპალიტეტის სსიპ', group: 'ARCHITECTURE', official: true, firstSeen: '2018-12-07', lastSeen: '2025-11-04', organization: null, roles: [
    role('ARCHITECT', '2025-11-04', 'AR11115640', MUNI), role('ARCHITECT', '2025-07-29', 'AR11101896', MUNI),
    role('ARCHITECT', '2024-04-22', 'AR11031305', MUNI), role('ARCHITECT', '2018-12-07', 'AR1639208', MUNI),
  ] },
  { kind: 'PERSON', name: 'გამოყენებული წესები', group: 'SAFETY', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('SAFETY_ASSESSMENT', '2026-09-17', 'AR11161121', '„შენობა-ნაგებობის უსაფრთხოების წესები“'),
  ] },
  { kind: 'PERSON', name: 'გიორგი ლეჟავა', group: 'OTHER', official: true, firstSeen: '2024-03-28', lastSeen: '2024-03-28', organization: null, roles: [
    role('APPLICANT', '2024-03-28', 'AR11026464', APPLICANT, false),
  ] },
  { kind: 'PERSON', name: 'ლევან გვრიტიშვილი', group: 'OTHER', official: true, firstSeen: '2020-07-17', lastSeen: '2020-07-17', organization: null, roles: [
    role('APPLICANT', '2020-07-17', 'AR1761052', APPLICANT, false),
  ] },
  { kind: 'PERSON', name: 'მრავალბინიანი საცხოვრებელი სახლი', group: 'OTHER', official: true, firstSeen: '2019-03-18', lastSeen: '2019-03-18', organization: null, roles: [
    { ...role('OTHER', '2019-03-18', 'AR1668968', 'საპროექტო ობიექტი'), scope: 'საპროექტო ობიექტი' },
  ] },
  { kind: 'ORGANIZATION', name: 'GBS', group: 'OTHER', official: false, firstSeen: null, lastSeen: null, organization: null, roles: [
    { code: 'OTHER', date: null, scope: null, caseRef: null, roleText: '1,500 მ² კერამიკული ფილის მიწოდება; მიმწოდებლის პორტფოლიოში აღნიშნული შესრულებული სამუშაო', sourceUrl: null, documentTitle: null },
  ] },
];

const spec = (key, label, value, unit, numeric, sourceKind = 'TEXT') => ({
  key, date: '2025-07-29', unit, label, value, source: TAS('1101896'), status: 'APPROVED', caseRef: 'AR11101896', numeric, sourceKind,
});

const file = (fileName, kind, format, outcome, pages, att) => ({ date: null, kind, pages, format, outcome, fileName, sourceUrl: DL(att) });
const doc = (caseRef, caseDate, files, extra = {}) => ({
  title: null, status: null, caseRef, caseDate, priority: null, publicUrl: TAS(caseRef.replace(/^AR1/, '')), documentId: caseRef.replace(/^AR1/, ''), files, ...extra,
});

const milestone = (date, kind, n, caseRef, outcome) => ({ date, kind, title: `№ ${n}`, caseRef, outcome, decisionNumber: n });

export const STORED_SYNTHESIS = {
  mode: 'MODEL',
  empty: false,
  _logicVersion: 3,
  propertyType: 'APARTMENT',
  synthesisModel: 'fixture',
  registerSource: null,
  report: {
    summary: {
      label: 'POSITIVE',
      statement: `Villion Krtsanisi Homes არის დაბალი სიმჭიდროვის, 42-ბინიანი საცხოვრებელი პროექტი კრწანისის ქუჩაზე, კარგი ყოველდღიური ინფრასტრუქტურითა და მწვანე ეზოს კონცეფციით. კონკრეტულ ბინაზე საკუთრება ${OWNER}ს სახელზეა რეგისტრირებული და ამონაწერში მოქმედი იპოთეკა ან სხვა უარყოფითი ჩანაწერი არ ჩანს.`,
      highlights: [
        { cites: ['e129'], detail: 'ამონაწერის მიხედვით მოქმედი იპოთეკა, ყადაღა, აკრძალვა და საგადასახადო გირავნობა რეგისტრირებული არ არის.', headline: 'სუფთა ჩანაწერი ბინაზე', dimension: 'LEGAL_CONTEXT', sentiment: 'POSITIVE' },
        { cites: ['e121'], detail: 'პროექტში ორი რვასართულიანი შენობა და სულ 42 ბინაა.', headline: 'ბუტიკური მასშტაბი', dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE' },
        { cites: ['e120'], detail: 'პროექტთან ახლოს არის მაღაზია, აფთიაქი, სკოლა, საბავშვო ბაღი, კლინიკა და ავტობუსის გაჩერებები.', headline: 'კრწანისის პრაქტიკული მხარე', dimension: 'LOCATION', sentiment: 'POSITIVE' },
        { cites: ['e132'], detail: 'კომპანიის დონეზე საქართველოს ბანკის რეგისტრირებული ვალდებულება განვითარების საბანკო მხარდაჭერაზე მიუთითებს.', headline: 'საბანკო დაფინანსება', dimension: 'DEVELOPER', sentiment: 'POSITIVE' },
        { cites: ['e166'], detail: 'პროექტში ან იმავე ქუჩაზე საკმარისი აქტიური შედარებადი განცხადებები არ ჩანს.', headline: 'ფასის შედარება ჯერ შეზღუდულია', dimension: 'MARKET_POSITION', sentiment: 'BALANCED' },
      ],
    },
    sections: [
      { key: 'SNAPSHOT', title: 'ბინის დღევანდელი სურათი', cites: ['e109'], body: `ეს არის ბინა N601, „ც“ ბლოკში, მეექვსე სართულზე, მისამართზე თბილისი, კრწანისის ქ. 6. 2026 წლის 24 აგვისტოს ამონაწერში მესაკუთრედ ${OWNER} წერია. იმავე ამონაწერში ბინაზე მოქმედი იპოთეკა, საგადასახადო გირავნობა, ყადაღა, აკრძალვა და მოვალეთა რეესტრის ჩანაწერი არ არის.`, metrics: [{ label: 'ბინა', value: 'N601' }, { label: 'სართული', value: '6' }, { label: 'მესაკუთრე', value: OWNER }, { label: 'ამონაწერი', value: '24.08.2026' }] },
      { key: 'PROJECT', title: 'პროექტი და საცხოვრებელი გარემო', cites: ['e121'], body: 'Villion Krtsanisi Homes ორი რვასართულიანი შენობისგან შედგება და პროექტში სულ 42 საცხოვრებელი ერთეულია. დაახლოებით 2. 6 ბინა მოდის თითო სართულზე, ამიტომ ეს უფრო მშვიდი, ბუტიკური ტიპის პროდუქტია, ვიდრე დიდი საცხოვრებელი მასივი. თითო ოჯახზე დაახლოებით 51 მ² მიწის წილი მოდის. პროექტით გათვალისწინებულია დახურული და გამწვანებული ეზო, საბავშვო მოედანი, ლობი, ლიფტები და ორ დონიანი მიწისქვეშა პარკინგი. დამტკიცებულ პროექტში საცხოვრებელი ფართი 3 682. 9 მ²-ია, პარკინგის ფართობი კი 1 115. 4 მ².', metrics: [{ label: 'შენობები', value: '2' }, { label: 'ბინები', value: '42' }, { label: 'მიწა', value: '2 145 მ²' }, { label: 'პარკინგი', value: '2 დონე / 42 ადგილი' }] },
      { key: 'QUALITY', title: 'ხარისხი და მასალები', cites: ['e138'], body: 'დამტკიცებულ საპროექტო მონაცემებში მითითებულია 22. 75 მეტრი მიწისზედა სიმაღლე, 26. 95 მეტრი კონსტრუქციული სიმაღლე და 4. 2 მეტრი მიწისქვეშა ნაწილი. დოკუმენტებში ფუნდამენტისთვის ხიმინჯების გამოყენებაა აღწერილი. ასევე რეკლამირებულია ალუმინის დაბალემისიური კარფანჯრები, OTIS-ის ლიფტები და 55%-იანი ენერგოეფექტურობა.', metrics: [{ label: 'მიწისზედა სიმაღლე', value: '22.75 მ' }, { label: 'მიწისქვეშა ნაწილი', value: '4.2 მ' }, { label: 'ენერგოეფექტურობა', value: '55%, დეველოპერის აღწერით' }] },
      { key: 'LOCATION', title: 'კრწანისის მიკროლოკაცია', cites: ['e120'], body: 'კრწანისი ისტორიული და შედარებით მწვანე უბანია, ძველ თბილისთან და მტკვრის სანაპიროსთან ახლოს. ამ მისამართის მთავარი უპირატესობაა ცენტრთან სიახლოვე და დაბალი სიმჭიდროვის საცხოვრებელი გარემო.', metrics: [{ label: 'ცენტრი', value: 'დაახლოებით 4.3 კმ' }, { label: 'სკოლა', value: 'დაახლოებით 3 წუთი' }, { label: 'ავტობუსის გაჩერება', value: 'დაახლოებით 1 წუთი' }] },
      { key: 'INFRASTRUCTURE', title: 'რაც ყოველდღიურ ცხოვრებას ამარტივებს', cites: ['e143'], body: 'ავტობუსის გაჩერებები კრწანისის ქუჩის N3-ის მოპირდაპირედ და N8-ის მიმდებარედ არის მითითებული.', metrics: [] },
      { key: 'MARKET', title: 'ბაზარი და ფასის პოზიციონირება', cites: ['e166'], body: 'ამ ბინის ფასის შეფასება ახლა ფრთხილად უნდა გაკეთდეს. იმავე პროექტში ან იმავე ქუჩაზე საკმარისი აქტიური განცხადებები არ არის, ხოლო კრწანისის ფარგლებში მხოლოდ ერთი ახლო, მაგრამ მნიშვნელოვნად უფრო დიდი ბინის შეთავაზებაა ხელმისაწვდომი.', metrics: [{ label: 'ქალაქის კონტექსტი', value: 'დაახლოებით $900–3,000/მ²' }, { label: 'პროექტის შედარებადი ბაზა', value: 'შეზღუდული' }] },
      { key: 'PEOPLE', title: 'დეველოპერი და პროექტის ადამიანები', cites: ['e158'], body: 'პროექტის დეველოპერია შპს „მილენიო გრუპი“, რეგისტრირებული 2023 წლის 28 მარტს. კომპანიის 50%-იანი წილის მფლობელები და დირექტორები არიან კობა კვანტალიანი და ლევან ჩაჩუა. ორივე დირექტორის წარმომადგენლობა ერთობლივია. მთავარ არქიტექტორად ან სპეციალისტად დოკუმენტებში მითითებულია დარეჯან შათაშვილი და დავით ლოსაბერიძე.', metrics: [] },
    ],
    finalView: 'ჩემი შეფასებით, ეს არის კარგი საცხოვრებელი არჩევანი მათთვის, ვისაც კრწანისის მშვიდი, ცენტრალურ ნაწილთან ახლოს მდებარე გარემო და მცირე ზომის პროექტი მოსწონს. ფასზე საბოლოო აზრი მხოლოდ კონკრეტული მოთხოვნის ფასისა და ხელშეკრულებით განსაზღვრული ჩაბარების პირობების ნახვის შემდეგ უნდა ჩამოყალიბდეს.',
    keyFindings: [
      { cites: ['e109'], finding: `ბინა N601, ბლოკი „ც“, მეექვსე სართული, რეგისტრირებულია ${OWNER}ს სახელზე 2026 წლის 17 აგვისტოდან, ნასყიდობის საფუძველზე.`, sentiment: 'POSITIVE', whyItMatters: 'თქვენ ყიდულობთ კონკრეტულად რეგისტრირებულ ერთეულს და არა მხოლოდ მშენებარე პროექტში მონაწილეობის უფლებას.' },
      { cites: ['e111'], finding: 'ბინაზე მოქმედი იპოთეკა აღარ არის რეგისტრირებული, ხოლო 2023 წლის იპოთეკის შეწყვეტის წარმოება დასრულებულია.', sentiment: 'POSITIVE', whyItMatters: 'ბინის საკუთრების ჩანაწერი დღეს მოქმედი საბანკო დატვირთვის გარეშე იკითხება.' },
      { cites: ['e37'], finding: 'პროექტის დამტკიცებულ მონაცემებში მიწის ფართობი 2 145 მ², საცხოვრებელი ფართი 3 682. 9 მ² და მიწისქვეშა ნაწილის სიღრმე 4. 2 მეტრია.', sentiment: 'POSITIVE', whyItMatters: 'ეს აჩვენებს პროექტის რეალურ მასშტაბს.' },
      { cites: ['e227'], finding: 'უახლესი ეფექტური ოფიციალური გადაწყვეტილება 2026 წლის 11 მარტის ნებართვაა, ხოლო 2026 წლის 17 ივნისსა და 17 სექტემბერს შეტანილი განაცხადები ჯერ განხილვის პროცესშია.', sentiment: 'BALANCED', whyItMatters: 'პროექტის ოფიციალური მდგომარეობა ამ ეტაპზე მოქმედ ნებართვასა და მიმდინარე ადმინისტრაციულ ცვლილებებზე დგას.' },
      { cites: ['e135'], finding: 'აქტიურ განცხადებებში პროექტი დასრულებულ პრემიუმ კომპლექსად არის წარმოდგენილი, თუმცა რეესტრში შენობა და ბინა კვლავ მშენებარედ არის მონიშნული.', sentiment: 'BALANCED', whyItMatters: 'ყიდვის ხელშეკრულებაში მიღება-ჩაბარების, საერთო სივრცეების დასრულებისა და ექსპლუატაციაში მიღების საკითხები ზუსტად უნდა იყოს გაწერილი.' },
    ],
    currentStatus: {
      statement: '',
      items: [
        { date: '2026-03-11', cites: ['e227'], label: 'მოქმედი მდგომარეობა', value: 'ნებართვა გაცემულია, გადაწყვეტილება №7839183' },
        { date: '2026-06-17', cites: ['e228'], label: 'მიმდინარე განაცხადი', value: 'AR11148112, განმცხადებელი ლევან ჩაჩუა' },
        { date: '2026-09-17', cites: ['e227'], label: 'მიმდინარე განაცხადი', value: 'AR11161121, განმცხადებელი ლევან ჩაჩუა' },
      ],
    },
    propertyStory: { chapters: [
      { key: 'EARLIEST', title: 'პროექტის დასაწყისი', period: '2018–2019', cites: ['e1'], visualIds: [], body: 'პროექტის ისტორია 2018 წლის დეკემბერში იწყება. თავდაპირველ ჩანაწერში ობიექტს საცხოვრებელთან ერთად კომერციულ-სავაჭრო ფუნქციაც ჰქონდა, შემდეგ კი მიმართულება მრავალბინიან საცხოვრებელ სახლად ჩამოყალიბდა.' },
      { key: 'APPROVALS', title: 'დაპროექტება და დამტკიცებები', period: '2021–2023', cites: ['e3'], visualIds: [V[7][0], V[8][0]], body: '2021 წლიდან ოფიციალურ დოკუმენტებში პროექტი მრავალბინიან საცხოვრებელ სახლად არის აღწერილი. 2022 და 2023 წლებში დამტკიცდა შენობის ძირითადი სივრცითი და ტექნიკური პარამეტრები.' },
      { key: 'CHANGES', title: 'პროექტის ცვლილებები', period: '2023–2025', cites: ['e12'], visualIds: [V[1][0], V[6][0], V[23][0]], body: '2023-2025 წლებში პროექტის დოკუმენტაციაში რამდენჯერმე შეიცვალა სიმაღლისა და სართულების აღწერა. საბოლოო დამტკიცებულ მონაცემებში მიწისზედა სიმაღლე 22.75 მეტრია.' },
      { key: 'RECENT', title: 'მშენებლობის ბოლო ეტაპი', period: '2023–2026', cites: ['e135'], visualIds: [V[2][0], V[3][0]], body: 'საჯარო ფოტო-ქრონოლოგია 2023 წლის დეკემბრიდან 2026 წლის მარტამდე გრძელდება. 2026 წლის მარტში გაიცა უახლესი ეფექტური ნებართვა, ხოლო ივნისსა და სექტემბერში ახალი განაცხადები შევიდა.' },
      { key: 'TODAY', title: 'რას ნიშნავს ეს დღეს', period: '2026', cites: ['e129'], visualIds: [V[0][0]], body: 'დღეს ბინა უკვე ცალკე საკუთრებად არის რეგისტრირებული. პროექტის ოფიციალურ ისტორიაში მოქმედი ნებართვა ფიქსირდება, ხოლო რეესტრი შენობას კვლავ მშენებარედ აჩვენებს.' },
    ] },
    visualExplanations,
    contractUpload: { recommend: true, text: 'თუ გაქვთ ნასყიდობის ან წინარე შეთანხმების პროექტი, ატვირთეთ აქ. განსაკუთრებით შევამოწმებ ბინის ზუსტ იდენტობას, ჩაბარების მდგომარეობას, პარკინგის პირობებს, ვადებს და გადახდის გრაფიკს.' },
    attentionPoints: [],
  },
  snapshot: {
    owner: OWNER,
    address: 'თბილისი, კრწანისის ქ. 6',
    parking: 'ორ დონიანი მიწისქვეშა ავტოსადგომი; პროექტის შესახებ საჯაროდ ხელმისაწვდომი ინფორმაციის მიხედვით, 42 საპარკინგე ადგილია მითითებული.',
    project: 'Villion Krtsanisi Homes',
    district: 'კრწანისი',
    amenities: ['გამწვანებული ეზო', 'მიწისქვეშა პარკინგი', 'საბავშვო მოედანი', 'დახურული ეზო და ლობი', 'კომერციული და საოფისე ფართები', 'ლიფტები'],
    developer: 'Millenio Group',
    cadastralCode: '01.18.06.019.055.03.01.601',
    constructionStatus: '2026 წლის 24 სექტემბრით დათარიღებულ საჯარო განცხადებებში მითითებულია, რომ მშენებლობა დასრულებულია და მიმდინარეობს გარე სივრცის მოწყობა. ეს არის საჯაროდ გამოქვეყნებული განცხადების აღწერა და არა ოფიციალური ექსპლუატაციაში მიღების დადასტურება.',
  },
  identity: { unit: '601', parcel: '01.18.06.019.055', status: 'CONFIRMED', building: '03', requested: '01.18.06.019.055.03.01.601', nearMatches: [], unitDocumented: true, documentedBuildings: ['03'] },
  people: {
    representation: 'JOINT',
    people: [
      { name: 'კობა კვანტალიანი', role: 'DIRECTOR', roles: ['DIRECTOR', 'SHAREHOLDER'], entity: 'შპს მილენიო გრუპი', certainty: 'REGISTERED', historical: false, sourceKind: 'OFFICIAL_REGISTRY', ownershipPct: 50, representation: 'JOINT' },
      { name: 'ლევან ჩაჩუა', role: 'DIRECTOR', roles: ['DIRECTOR', 'SHAREHOLDER'], entity: 'შპს მილენიო გრუპი', certainty: 'REGISTERED', historical: false, sourceKind: 'OFFICIAL_REGISTRY', ownershipPct: 50, representation: 'JOINT' },
    ],
    representationNote: 'რეესტრის ჩანაწერით კომპანიას დირექტორები ერთობლივად წარმოადგენენ. პრაქტიკულად ეს ნიშნავს, რომ ხელშეკრულებაზე მხოლოდ ერთი დირექტორის ხელმოწერა შეიძლება საკმარისი არ იყოს.',
  },
  participants: { entity: OWNER, representation: 'JOINT', authorisedSignatories: [{ name: 'კობა კვანტალიანი', role: 'DIRECTOR', certainty: 'REGISTERED' }, { name: 'ლევან ჩაჩუა', role: 'DIRECTOR', certainty: 'REGISTERED' }] },
  companyFinance: {
    pledges: [{ creditor: 'სს საქართველოს ბანკი 204378869', reference: 'R23757008', registeredOn: '2023-12-19' }],
    companyId: '404670272', taxStatus: { state: 'NOT_CHECKED', checkedOn: null }, companyName: 'შპს მილენიო გრუპი',
    debtorRegistry: { state: 'NO_ENTRY', checkedOn: '2026-10-11' },
    financingPartner: 'საქართველოს ბანკი — პროექტის ოფიციალური ინფორმაციით, პროექტი სრულად დაფინანსებულია საქართველოს ბანკის მიერ.',
    registryExtractDate: '2024-08-15', liquidationRegistered: false,
  },
  projectTeam: [
    { name: 'ლევან ჩაჩუა', basis: 'OFFICIAL', roles: ['APPLICANT'] },
    { name: 'დავით ლოსაბერიძე', basis: 'OFFICIAL', roles: ['APPLICANT'] },
    { name: 'გიორგი ლეჟავა', basis: 'OFFICIAL', roles: ['APPLICANT'] },
    { name: 'დარეჯან შათაშვილი', basis: 'OFFICIAL', roles: ['APPLICANT'] },
    { name: 'ლევან გვრიტიშვილი', basis: 'OFFICIAL', roles: ['APPLICANT'] },
    { name: 'GBS', basis: 'PUBLIC', roles: ['OTHER'], roleText: '1,500 მ² კერამიკული ფილის მიწოდება; მიმწოდებლის პორტფოლიოში აღნიშნული შესრულებული სამუშაო' },
  ],
  projectTeamV2,
  technicalSpecs: [
    spec('k2CalculationArea', 'კ-2 კოეფიციენტის გაანგარიშების ფართობი', '5 242.3 მ²', 'მ²', 5242.3, 'FORM'),
    spec('k1Area', 'კ-1 კოეფიციენტის ფართობი (განაშენიანება)', '7 793.7 მ²', 'მ²', 7793.7),
    spec('landArea', 'მიწის ნაკვეთის ფართობი', '2 145 მ²', 'მ²', 2145),
    spec('residentialArea', 'საცხოვრებელი ფართობი', '3 682.9 მ²', 'მ²', 3682.9),
    spec('officeArea', 'საოფისე ფართობი', '409.9 მ²', 'მ²', 409.9),
    spec('commercialArea', 'კომერციული ფართობი', '228.6 მ²', 'მ²', 228.6),
    spec('summerArea', 'საზაფხულო ფართობი (აივნები, ტერასები)', '767.6 მ²', 'მ²', 767.6),
    spec('parkingArea', 'ავტოსადგომის ფართობი', '1 115.4 მ²', 'მ²', 1115.4),
    spec('totalArea', 'საერთო ფართობი', '6 946.7 მ²', 'მ²', 6946.7),
    spec('structuralHeight', 'კონსტრუქციული სიმაღლე', '26.95 მ', 'მ', 26.95),
    spec('undergroundDepth', 'მიწისქვეშა ნაწილის სიღრმე', '4.2 მ', 'მ', 4.2, 'FORM'),
    spec('heightAboveGround', 'მიწისზედა სიმაღლე', '22.75 მ', 'მ', 22.75, 'FORM'),
    spec('buildingFunction', 'შენობის ფუნქცია', 'მრავალბინიანი საცხოვრებელი კომპლექსი', null, null),
  ],
  officialDocuments: [
    doc('AR11161121', '2026-09-17', [file('გენგეგმა.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 1, '5418975'), file('გენგეგმა 16,09,2026.dwg', 'DRAWING', 'dwg', 'UNSUPPORTED_FORMAT', null, '5418976'), file('ფოტოები.pdf', 'PDF', 'pdf', 'SCAN_OR_IMAGE_ONLY', 7, '5418977'), file('grunt cvl.pdf', 'PDF', 'pdf', 'READ_TEXT', 1, '5418978')], { priority: 1 }),
    doc('AR11148112', '2026-06-17', [file('სწორი გეგმები.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 2, '5317502')], { priority: 2 }),
    doc('AR11115640', '2025-11-04', [file('ფოტოები 03,11,2025.pdf', 'PDF', 'pdf', 'NOT_PROCESSED_BUDGET', null, '5077352'), file('დემონტაჟი კრწანისის ქ-ზე.rar', 'ARCHIVE', 'rar', 'UNSUPPORTED_FORMAT', null, '5077353')]),
    doc('AR11101896', '2025-07-29', [file('gengegma.pdf', 'PDF', 'pdf', 'READ_TEXT', 1, '4975477'), file('gengegma.dwg', 'DRAWING', 'dwg', 'UNSUPPORTED_FORMAT', null, '4975478'), file('ახალი ფოტოები.pdf', 'PDF', 'pdf', 'SCAN_OR_IMAGE_ONLY', 7, '4975480')]),
    doc('AR11084312', '2025-04-03', [file('gengegma.pdf', 'PDF', 'pdf', 'READ_TEXT', 1, '4850044'), file('ჭრილები.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 3, '4850047')]),
    doc('AR11034439', '2024-05-14', [file('მონტაჟი.pdf', 'PDF', 'pdf', 'READ_TEXT', 1, '4517162'), file('fasadebi.pdf', 'PDF', 'pdf', 'READ_TEXT', 9, '4517165')]),
    doc('AR11031305', '2024-04-22', []),
    doc('AR1990786', '2023-09-20', [file('proeqti.pdf', 'PDF', 'pdf', 'READ_TEXT', 25, '4249588'), file('Binder1.pdf', 'PDF', 'pdf', 'SCAN_OR_IMAGE_ONLY', 10, '4249589')]),
    doc('AR1968595', '2023-05-30', [file('გენ-გეგმა.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 2, '4101760'), file('გეგმები.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 18, '4101762'), file('ჭრილი.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 3, '4101763')], { filesOmitted: 33 }),
    doc('AR1942605', '2022-12-30', [file('POS - 2022.12.30.pdf', 'PDF', 'pdf', 'READ_TEXT', 12, '3944703'), file('konstruqciebis eqspertiza konstrukciebi krwanisi 2022.12.30.pdf', 'PDF', 'pdf', 'READ_TEXT', 113, '3944713')]),
    doc('AR1919535', '2022-08-26', [file('01. site.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 3, '3804004'), file('02. floor plans.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 32, '3804266'), file('03. sections.pdf', 'DRAWING', 'pdf', 'READ_TEXT', 3, '3804267')], { filesOmitted: 34 }),
    doc('AR1897963', '2022-05-12', [file('Photos 2021.09.16.pdf', 'PDF', 'pdf', 'READ_TEXT', 8, '3679919')]),
    doc('AR1639208', '2018-12-07', [file('photos gapi.pdf', 'PDF', 'pdf', 'SCAN_OR_IMAGE_ONLY', 12, '2344309')]),
  ],
  officialVisuals: storedVisuals,
  officialHistory: {
    team: [
      { kind: 'PERSON', name: 'ლევან ჩაჩუა', roles: ['APPLICANT'], blocks: ['2, ბინა 34', 'ს მოედნის'], lastSeen: '2026-09-17', firstSeen: '2024-05-14' },
      { kind: 'PERSON', name: 'დავით ლოსაბერიძე', roles: ['APPLICANT'], blocks: ['ს გარემოს დაცვის საქალაქო', '20ბ, ბინა 3', 'ს მოედნის'], lastSeen: '2024-04-22', firstSeen: '2018-12-07' },
      { kind: 'PERSON', name: 'გიორგი ლეჟავა', roles: ['APPLICANT'], blocks: [], lastSeen: '2024-03-28', firstSeen: '2024-03-28' },
      { kind: 'PERSON', name: 'დარეჯან შათაშვილი', roles: ['APPLICANT'], blocks: ['ს მოედნის'], lastSeen: '2023-09-20', firstSeen: '2023-05-10' },
      { kind: 'PERSON', name: 'ლევან გვრიტიშვილი', roles: ['APPLICANT'], blocks: [], lastSeen: '2020-07-17', firstSeen: '2020-07-17' },
    ],
    legal: [
      { key: 'PERMIT_ISSUED', status: 'CONFIRMED', basis: [{ date: '2024-07-26', block: '2, ბინა 34', caseRef: 'AR11034439', decisionNumber: '7152431' }, { date: '2025-05-30', block: '2, ბინა 34', caseRef: 'AR11084312', decisionNumber: '7496274' }, { date: '2026-03-11', block: '2, ბინა 34', caseRef: 'AR11101896', decisionNumber: '7839183' }] },
      { key: 'CONSTRUCTION_STARTED', basis: [], status: 'NOT_VERIFIED' },
      { key: 'CONSTRUCTION_COMPLETED', basis: [], status: 'NOT_VERIFIED' },
      { key: 'COMMISSIONING_APPLIED', basis: [], status: 'NOT_VERIFIED' },
      { key: 'COMMISSIONING_APPROVED', basis: [], status: 'NOT_VERIFIED' },
    ],
    status: { since: '2026-03-11', state: 'PERMITTED', caseRef: 'AR11101896', caveats: ['LATER_UNDETERMINED_DECISION', 'PROCESSING_INCOMPLETE'], conclusive: false, validUntil: null, pendingCount: 0, decisionNumber: '7839183' },
    visuals: V.map(([id, , , , , , , , versionStatus]) => ({ id, versionStatus })),
    evolution: [
      { to: 'მრავალბინიანი საცხოვრებელი სახლი; IV', key: 'buildingFunction', from: 'ა-საცხოვრებელი,კომერციულისავაჭრო', block: null, label: 'buildingFunction', toDate: '2021-09-16', fromDate: '2018-12-07' },
      { to: '5242.3', key: 'K2', from: '4605.7', block: 'ს მოედნის', label: 'შენობის K2 კოეფიციენტის საანგარიშო ფართობი (კვ.მ)', toDate: '2026-09-17', fromDate: '2022-12-30' },
      { to: 'მიწის დონიდან არის 26,00 მეტრი, ხოლო შენობის ყველაზე', key: 'height', from: '25.8', block: 'ს მოედნის', label: 'შენობის სიმაღლე (მ)', toDate: '2026-09-17', fromDate: '2022-12-30' },
    ],
    milestones: [
      milestone('2018-12-13', 'DECISION', '4303543', 'AR1639208', 'DEFICIENCY'),
      milestone('2022-07-11', 'APPROVAL', '6030016', 'AR1897963', 'APPROVED'),
      milestone('2022-12-30', 'APPROVAL', '6272569', 'AR1919535', 'APPROVED'),
      milestone('2023-09-21', 'APPROVAL', '6673781', 'AR1968595', 'APPROVED'),
      milestone('2023-10-04', 'APPROVAL', '6689190', 'AR1990786', 'APPROVED'),
      milestone('2024-07-26', 'PERMIT', '7152431', 'AR11034439', 'PERMIT_ISSUED'),
      milestone('2025-05-30', 'PERMIT', '7496274', 'AR11084312', 'PERMIT_ISSUED'),
      milestone('2025-08-21', 'DECISION', '7585702', 'AR11101896', 'DEFICIENCY'),
      milestone('2025-11-11', 'DECISION', '7699436', 'AR11115640', 'DEFICIENCY'),
      milestone('2026-03-11', 'PERMIT', '7839183', 'AR11101896', 'PERMIT_ISSUED'),
    ],
    milestoneGroups: [
      { kind: 'DECISION', count: 1, outcome: 'DEFICIENCY', lastDate: '2018-12-13', firstDate: '2018-12-13', decisionNumbers: ['4303543'] },
      { kind: 'APPROVAL', count: 4, outcome: 'APPROVED', lastDate: '2023-10-04', firstDate: '2022-07-11', decisionNumbers: ['6030016', '6272569', '6673781', '6689190'] },
      { kind: 'PERMIT', count: 2, outcome: 'PERMIT_ISSUED', lastDate: '2025-05-30', firstDate: '2024-07-26', decisionNumbers: ['7152431', '7496274'] },
      { kind: 'DECISION', count: 2, outcome: 'DEFICIENCY', lastDate: '2025-11-11', firstDate: '2025-08-21', decisionNumbers: ['7585702', '7699436'] },
      { kind: 'PERMIT', count: 1, outcome: 'PERMIT_ISSUED', lastDate: '2026-03-11', firstDate: '2026-03-11', decisionNumbers: ['7839183'] },
    ],
    currentPosition: {
      pending: [
        { date: '2026-09-17', status: 'UNDER_REVIEW', caseRef: 'AR11161121', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null },
        { date: '2026-06-17', status: 'UNDER_REVIEW', caseRef: 'AR11148112', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null },
      ],
      conflicts: [
        { block: 'ს მოედნის', label: 'height', values: [{ date: '2026-09-17', value: '22.75' }, { date: '2026-09-17', value: 'მიწის დონიდან არის 26,00 მეტრი, ხოლო შენობის ყველაზე' }] },
        { block: '20ბ, ბინა 3', label: 'K1', values: [{ date: '2022-08-26', value: '1 2' }, { date: '2022-08-26', value: '3' }] },
      ],
      effective: { date: '2026-03-11', state: 'PERMITTED', permit: null, caseRef: 'AR11101896', outcome: 'PERMIT_ISSUED', validUntil: null, decisionNumber: '7839183' },
      conclusive: false,
    },
    pendingApplications: [
      { date: '2026-09-17', status: 'UNDER_REVIEW', caseRef: 'AR11161121', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null },
      { date: '2026-06-17', status: 'UNDER_REVIEW', caseRef: 'AR11148112', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null },
    ],
    futureDatedReferences: [],
    funnel: { incomplete: true, milestones: 10, retainedFacts: 173, visualsHidden: 0, retainedEvents: 68, visualsSelected: 24, discoveredMotions: 133, incompleteReasons: ['ATTACHMENTS_DEFERRED_BY_BUDGET', 'ATTACHMENTS_FAILED', 'RUN_DEADLINE'], processedResponses: 133, deferredAttachments: 43, discoveredDocuments: 19, processedAttachments: 334, discoveredAttachments: 440 },
  },
  propertyRegister: {
    latest: { owners: [{ kind: 'PERSON', name: OWNER }], seizure: 'NONE', taxLien: 'NONE', issuedAt: '2026-08-24T08:35:20', recordId: '35356992', mortgages: [], landAreaSqm: 2145, unitAreaSqm: 94.1, landFunction: 'არასასოფლო სამეურნეო', debtorRegistry: 'NONE', ownershipBasis: 'PURCHASE', applicationNumber: '882026724195', ownershipRegisteredOn: '2026-08-17', unitUnderConstruction: true, buildingsUnderConstruction: true },
    coverage: { read: 3, found: 3, documents: 7, notOpened: 0 },
    proceedings: [
      { kind: 'PARTNERSHIP_OWNERSHIP', read: true, filedOn: '2024-09-03', outcome: 'SATISFIED', typeText: 'ამხანაგობის წევრის/წევრების საკუთრების უფლების რეგისტრაცია უძრავ ნივთზე', completedOn: '2024-09-09', decisionDate: '2024-09-09', decisionNumber: '892024345129-03', applicationNumber: '892024345129' },
      { kind: 'OWNERSHIP_TRANSFER', read: true, filedOn: '2026-08-11', outcome: 'SATISFIED', typeText: 'საკუთრების უფლების რეგისტრაცია გარიგების საფუძველზე უძრავ ნივთზე', completedOn: '2026-08-17', decisionDate: '2026-08-17', decisionNumber: '882026715603-03', applicationNumber: '882026715603' },
      { kind: 'MORTGAGE_TERMINATED', read: true, filedOn: '2026-08-13', outcome: 'SATISFIED', typeText: 'იპოთეკის შეწყვეტის რეგისტრაცია უძრავ ნივთზე', completedOn: '2026-08-24', decisionDate: '2026-08-18', decisionNumber: '882026724195-03', applicationNumber: '882026724195' },
    ],
    cadastralCode: '01.18.06.019.055.03.01.601',
    currentMortgages: [],
    removedMortgages: [{ creditor: 'სააქციო საზოგადოება "საქართველოს ბანკი"', removedBy: { decisionDate: '2026-08-18', decisionNumber: '882026724195-03', applicationNumber: '882026724195' }, creditorId: '204378869', lastSeenAt: '2024-09-09T15:33:52', registeredOn: '2023-12-19', agreementDate: '2023-12-19', agreementNumber: 'NCAH000744921', applicationNumber: '892023420105' }],
  },
  market: {
    max: null, min: null, mean: null, median: null, basis: 'EVIDENCE_LIMITED', count: 0, currency: 'USD', basisCount: 0, basisIsThin: true,
    tiers: [
      { max: 1947, min: 1947, thin: true, tier: 'SAME_DISTRICT', count: 1, median: 1947, contextOnly: true, outliersTrimmed: 0 },
      { max: 2760, min: 928, thin: false, tier: 'WIDER_MARKET', count: 50, median: 1600, contextOnly: true, outliersTrimmed: 3 },
    ],
    closest: [
      { url: 'https://home.ss.ge/default/real-estate/iyideba-3-otaxiani-bina-ortatchalashi-33664293', area: 149.5, tier: 'SAME_DISTRICT', floor: 36, rooms: 3, state: 'UNKNOWN', source: 'საჯარო განცხადება', reasons: ['same district'], segment: 'UNKNOWN', currency: 'USD', district: 'KRTSANISI', ageMonths: 2.4, relevance: 40, similarity: 'კრწანისის მიმდებარე მიკროლოკაცია; სუბიექტზე მნიშვნელოვნად დიდი ფართობი.', totalPrice: 291000, pricePerSqm: 1947, headlineEligible: false, relevanceReasons: ['SAME_DISTRICT', 'UNNAMED_STOCK', 'CONTEXT_ONLY'] },
      { url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36984028', area: 53, tier: 'WIDER_MARKET', floor: 5, state: 'ACTIVE', source: 'ss.ge', reasons: ['currently listed'], segment: 'UNKNOWN', currency: 'USD', district: 'DIDI_DIGHOMI', ageMonths: 0, relevance: 20, similarity: 'district დიდი დიღომი; asking sale price', totalPrice: 103000, pricePerSqm: 1940, headlineEligible: false, relevanceReasons: ['OTHER_DISTRICT', 'UNNAMED_STOCK', 'ACTIVE', 'CONTEXT_ONLY'] },
      { url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36910148', area: 48, tier: 'WIDER_MARKET', floor: 5, state: 'ACTIVE', source: 'ss.ge', reasons: ['currently listed'], segment: 'UNKNOWN', currency: 'USD', district: 'DIDI_DIGHOMI', ageMonths: 0.3, relevance: 20, similarity: 'district დიდი დიღომი; asking sale price', totalPrice: 75000, pricePerSqm: 1560, headlineEligible: false, relevanceReasons: ['OTHER_DISTRICT', 'UNNAMED_STOCK', 'ACTIVE', 'CONTEXT_ONLY'] },
      { url: 'https://home.ss.ge/ka/real-estate/iyideba-2-otaxiani-bina-did-dighomshi-36983839', area: 51, tier: 'WIDER_MARKET', floor: 4, state: 'ACTIVE', source: 'ss.ge', reasons: ['currently listed'], segment: 'UNKNOWN', currency: 'USD', district: 'DIDI_DIGHOMI', ageMonths: 0, relevance: 20, similarity: 'district დიდი დიღომი; asking sale price', totalPrice: 68800, pricePerSqm: 1350, headlineEligible: false, relevanceReasons: ['OTHER_DISTRICT', 'UNNAMED_STOCK', 'ACTIVE', 'CONTEXT_ONLY'] },
      { url: 'https://home.ss.ge/ka/real-estate/iyideba-3-otaxiani-bina-did-dighomshi-36983673', area: 70, tier: 'WIDER_MARKET', floor: 16, state: 'ACTIVE', source: 'ss.ge', reasons: ['currently listed'], segment: 'UNKNOWN', currency: 'USD', district: 'DIDI_DIGHOMI', ageMonths: 0, relevance: 20, similarity: 'district დიდი დიღომი; asking sale price', totalPrice: 103000, pricePerSqm: 1470, headlineEligible: false, relevanceReasons: ['OTHER_DISTRICT', 'UNNAMED_STOCK', 'ACTIVE', 'CONTEXT_ONLY'] },
    ],
    headline: { max: null, min: null, mean: null, basis: 'EVIDENCE_LIMITED', count: 0, state: 'EVIDENCE_LIMITED', median: null, tiersUsed: [], trimMethod: 'NONE', minimumSample: 3, outliersTrimmed: 0 },
    tierCounts: { SAME_STREET: 0, PEER_PROJECT: 0, SAME_PROJECT: 0, WIDER_MARKET: 50, SAME_DISTRICT: 1 },
    whySelected: [{ code: 'EVIDENCE_LIMITED', count: 0 }, { code: 'CONTEXT_ONLY_TIER', tier: 'SAME_DISTRICT', count: 1 }, { code: 'CONTEXT_ONLY_TIER', tier: 'WIDER_MARKET', count: 50 }, { code: 'EXCLUDED_OTHER_DISTRICT', count: 42 }, { code: 'EXCLUDED_DISTRICT_UNKNOWN', count: 5 }],
    conditionMix: { grades: {}, unknown: 0, dominant: null },
    analyzedCount: 51,
    qualityFactors: [{ factor: 'პარკინგი', direction: 'SUPPORTS_PREMIUM' }, { factor: 'ლიფტი', direction: 'SUPPORTS_PREMIUM' }, { factor: 'გამწვანებული ეზო', direction: 'SUPPORTS_PREMIUM' }],
    expiredExcluded: 0, contextAvailable: true, subjectValuation: 'EVIDENCE_LIMITED', conditionMismatch: false, duplicatesRemoved: 0,
    projectAskingRange: null, askingNotTransaction: true, projectAskingEvidence: [],
  },
  location: {
    city: 'თბილისი', district: 'კრწანისი', minimal: false,
    nearby: [
      { name: 'Karpuri', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 1 წუთია.', whyKey: 'verify_place_why_supermarket', category: 'SUPERMARKET' },
      { name: 'Pharmadepo', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 3 წუთია.', whyKey: 'verify_place_why_pharmacy', category: 'PHARMACY' },
      { name: '№144 საჯარო სკოლა', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 3 წუთია.', whyKey: 'verify_place_why_school', category: 'SCHOOL' },
      { name: 'PSP New Hospitals', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 2 წუთია.', whyKey: 'verify_place_why_clinic', category: 'CLINIC' },
      { name: 'ჟანი კალანდაძის პარკი', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 8 წუთია.', whyKey: 'verify_place_why_park', category: 'PARK' },
    ],
    profile: { district: 'კრწანისი', character: 'ისტორიული, მწვანე უბანი ძველ თბილისთან და მტკვრის სანაპიროსთან ახლოს, სადაც ბოლო წლებში რამდენიმე ბუტიკური საცხოვრებელი პროექტი განვითარდა.', context: ['ძველი თბილისისა და ცენტრის სიახლოვე', 'მტკვრის სანაპირო და გამწვანებული ტერიტორიები'], likelyResidents: ['ექსპატები', 'გრძელვადიანი პრემიუმ მოიჯარეები'] },
  },
  developerAds: {
    themes: [{ count: 1, theme: 'COMPLETION' }], country: 'GE', outcome: 'CACHED',
    examples: [{ cta: 'Send WhatsApp message', text: '🏡 ვილიონ კრწანისი — დასრულებული პრემიუმ საცხოვრებელი პროექტი თბილისის ერთ-ერთ ყველაზე პრესტიჟულ უბანში.', title: null, active: true, endDate: '2026-10-09', linkUrl: null, pageName: 'Villion • ვილიონ', platforms: ['FACEBOOK', 'INSTAGRAM'], startDate: '2026-07-06', libraryUrl: 'https://www.facebook.com/ads/library/?id=1304665511650233', adArchiveId: '1304665511650233' }],
    identity: { basis: 'WEB_RESEARCH_ONLY', legalName: 'შპს „მილენიო გრუპი“', projectNames: ['Villion Krtsanisi Homes', 'Villion'], developerNames: ['Millenio Group', 'შპს „მილენიო გრუპი“'] },
    platforms: ['FACEBOOK', 'INSTAGRAM'], verifiedAt: '2026-10-10T07:14:09.899Z', activeCount: 1,
    advertisers: [{ url: 'https://www.facebook.com/villionkrtsanisi/', owner: 'PROJECT', pageName: 'Villion • ვილიონ', activeAds: 1 }],
    limitations: ['META_ONLY', 'IDENTITY_FROM_WEB_RESEARCH', 'OTHER_ADVERTISERS_EXCLUDED'], searchedFor: ['Villion', 'Millenio'],
    concentration: 'MULTI_PLATFORM', socialProfiles: [], historicalCount: 0,
    librarySearchUrl: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GE&q=Villion&search_type=keyword_unordered',
    platformSearched: 'META_AD_LIBRARY', duplicatesRemoved: 0, otherAdvertiserAds: 1, projectsAdvertised: [], unknownStatusCount: 0,
  },
  checklist: [
    { key: 'EXTRACT_ON_SIGNING_DAY', url: 'https://www.my.gov.ge/ka-ge/services/5/service/176', value: '01.18.06.019.055.03.01.601', params: { date: '24.08.2026' }, labelKey: 'bc_fresh_extract_label', detailKey: 'bc_fresh_extract_detail' },
    { key: 'SELLER_IS_OWNER', params: { date: '24.08.2026', name: OWNER, since: '17.08.2026' }, labelKey: 'bc_seller_owner_label', detailKey: 'bc_seller_owner_named_detail' },
    { key: 'PAYMENT_ACCOUNT', labelKey: 'bc_payment_label', detailKey: 'bc_payment_owner_detail' },
    { key: 'PARKING_RIGHTS', labelKey: 'bc_parking_label', detailKey: 'bc_parking_detail' },
    { key: 'PRICE_AGAINST_MARKET', labelKey: 'bc_price_label', detailKey: 'bc_price_detail' },
  ],
  selfChecks: [{ url: 'https://www.my.gov.ge/ka-ge/services/5/service/176', kind: 'PROPERTY_EXTRACT', copyLabel: 'cadastral', copyValue: '01.18.06.019.055.03.01.601' }],
  research: {
    providers: [{ state: 'VERIFIED', provider: 'tas_map' }, { state: 'PARTIAL', provider: 'tas' }, { state: 'VERIFIED', provider: 'mygov' }, { state: 'VERIFIED', provider: 'enreg' }],
    researchedAt: '2026-10-11T07:07:57.383+00:00', officialPagesRead: 7319, officialCasesReviewed: 19, officialStepsReviewed: 133, marketListingsAnalyzed: 51,
    officialAttachmentsRead: 276, officialMilestonesShown: 10, marketplaceListingsAdded: 8, officialFactsConsolidated: 173, officialRecordsDiscovered: 19,
    latestOfficialDocumentDate: '2026-09-17', earliestOfficialDocumentDate: '2018-12-07', officialProcessingIncomplete: true,
    officialAttachmentsDiscovered: 440, officialEvidenceSelectedForSynthesis: 45,
  },
  evidenceGroups: [],
  evidence: [],
};

/** The signed-URL host the fixture uses (the real project's form). */
export const SIGNED_HOST = 'https://ptxajsjhobhvsfhmutjn.supabase.co';

/**
 * What verify-synthesis forCustomer() returns for the stored row: _usage and
 * _timing dropped, every visual turned into a VerifyVisualAsset with a signed
 * URL. `host` lets a browser harness point the URLs at a local image server.
 */
export async function customerSynthesis({ host = SIGNED_HOST } = {}) {
  const { _usage, _timing, officialVisuals, ...rest } = STORED_SYNTHESIS;
  const signed = await toCustomerVisualAssets(
    officialVisuals,
    async (paths) => Object.fromEntries(paths.map((p) => [p, `${host}/storage/v1/object/sign/verify-official-visuals/${p}?token=x`])),
    { explanations: rest.report.visualExplanations },
  );
  return { ...rest, officialVisuals: signed, persisted: true };
}
