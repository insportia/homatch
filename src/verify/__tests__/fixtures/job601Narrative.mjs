// Production Verify report for cadastral 01.18.06.019.055.03.01.601
// (research_jobs 8ba97da9-…, _logicVersion 4, read 2026-10-11): the parts the
// final narrative pass reads, SANITIZED.
//
//   - the private unit owner's name is a placeholder; no personal ID numbers,
//     phones, e-mails or home addresses remain (the applicant's address line of
//     the 1101896 case text is dropped);
//   - PROJECT_TEAM_V2_LIVE is the persisted projectTeamV2 exactly as production
//     holds it, all 19 entries, including the drawing-legend fragments that
//     must never render ("განგაშისა და", "საქვეითე გადასასვლელი", …);
//   - CASE_TEXT_1101896 is the head of the 1101896 case text as the TAS
//     reader stores it (browserOfficial document rawText): the city form with
//     its wrapped coefficient labels, and the 7585702 deficiency notice citing
//     the City Hall audit finding.

export const OWNER = 'ნ. ბერიძე';
const TAS = (id) => `https://docs.tbilisi.gov.ge/architect/public.html?docId=${id}`;
const DL = (id) => `https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=${id}`;

/* The project's public description (research-agent publicResearch), technical fields. */
export const PUBLIC_RESEARCH = {
  MEP: null,
  facade: 'პროექტის ოფიციალური ინფორმაციის მიხედვით, ფასადი მოპირკეთებულია ალუმინის ლამელის პროფილებითა და კომპოზიტური პანელებით; აივნებზე გათვალისწინებულია ნაწრთობი შუშის მოაჯირები და ფასადის განათება.',
  parking: 'ორ დონიანი მიწისქვეშა ავტოსადგომი; პროექტის შესახებ საჯაროდ ხელმისაწვდომი ინფორმაციის მიხედვით, 42 საპარკინგე ადგილია მითითებული.',
  windows: 'პროექტის ოფიციალური ინფორმაციის მიხედვით, გათვალისწინებულია ალუმინის იზოლირებული კარფანჯრები დაბალემისიური შუშებით.',
  elevators: 'OTIS-ის პრემიუმ ლიფტები.',
  insulation: 'პროექტის ოფიციალური ინფორმაციის მიხედვით, გათვალისწინებულია GFRC სტანდარტით დათბუნებული ფასადი (55%).',
  seismicDesign: null,
  energyEfficiency: 'პროექტის ოფიციალური ინფორმაციის მიხედვით, მითითებულია 55%-იანი ენერგოეფექტურობა.',
  structuralSystem: 'მონოლითური კარკასი.',
  constructionStart: '2023 წლის დეკემბრიდან არსებობს პროექტის მშენებლობის პროგრესის ფოტო-ქრონოლოგია.',
  constructionMaterials: 'პროექტის შესახებ საჯაროდ ხელმისაწვდომ ინფორმაციაში მითითებულია პრემიუმ სამშენებლო მასალები და საინჟინრო გადაწყვეტილებები; მასალების სრული სპეციფიკაცია არ არის გამოქვეყნებული.',
  currentPhysicalStatus: '2026 წლის 24 სექტემბრით დათარიღებულ საჯარო განცხადებებში მითითებულია, რომ მშენებლობა დასრულებულია და მიმდინარეობს გარე სივრცის მოწყობა. ეს არის საჯაროდ გამოქვეყნებული განცხადების აღწერა და არა ოფიციალური ექსპლუატაციაში მიღების დადასტურება.',
};

export const CASE_TEXT_1101896 = [
  'TAS case AR11101896',
  'Registered: 2025-07-29',
  'Address: ქალაქი თბილისი , ქუჩა კრწანისი , N 6',
  'შენობის K2 კოეფიციენტის საანგარიშო ფართობი (კვ.მ): 5242.3',
  'შენობის სიმაღლე (მ): 22.75',
  'შენობის ჩაღრმავება მიწის ზედაპირიდან ქვემოთ (მ): 4.2',
  '',
  '[2025-08-21 · motion · response]',
  'DECISION DEFICIENCY N 7585702',
  'გაცემის თარიღი: 08/08/2025გაცნობის თარიღი: -',
  'განცხადების ნომერი: AR11101896',
  'შედეგი: შუალედური',
  'გადაწყვეტილება No 7585702',
  'საკადასტრო კოდი: 01.18.06.019.055',
  'ფართობი: 2145.0 კვ.მ',
  '.ფუნქციური დანიშნულების სახეობა.: მრავალბინიანი საცხოვრებელი კომპლექსი',
  '.მთავარი არქიტექტორის/სპეციალისტი სახელი და გვარი.: დარეჯან შათაშვილი',
  '.ორგანიზაცია (არესბობის შემთხვევაში).: შ.პ.ს. "არტიტექსი"',
  '.ტექნიკურ - ეკონომიკური მაჩვენებლები (მეათედების სიზუსტით).:',
  '.მიწის ნაკვეთის ფართობი (კვ.მ).: 2145.0',
  '.განაშენიანების ფართობი (კვ.მ).: 7793.7',
  '.საერთო ფართობი (კვ.მ).: 6946.7',
  '.საცხოვრებელი ფართობი (კვ.მ).: 3682.9',
  '.საოფისე ფართობი (კვ.მ).: 409.9',
  '.კომერციული ფართობი (კვ.მ).: 228.6',
  '.საზაფხულო ფართობი (კვ.მ).: 767.6',
  '.კიბის უჯრედისა და სადარბაზოს ფართობი (კვ.მ).: 645.8',
  '.დამხმარე ფართობი (კვ.მ).: 96.5',
  '.ავტოსადგომის ფართობი (კვ.მ).: 1115.4',
  '.სამშენებლო მოცულობა (კუბ.მ).: 22361.0',
  '.შენობა-ნაგებობის კონსტრუქციული სიმაღლე (მ).: 26.95',
  '.კ1 განაშენიანების კოეფიციენტის საანგარიშო ფართობი (კვ.მ და ასახული',
  'კოეფიციენტში). : 1170.8 კ1=0.5',
  '.კ2 განაშენიანების ინტენსივობის კოეფიციენტის საანგარიშო ფართობი (კვ.მ და',
  'ასახული კოეფიციენტში). : 5242.3 კ2=2.4',
  '.კ3 გამწვანების კოეფიციენტის საანგარიშო ფართობი (კვ.მ და ასახული კოეფიციენტში).',
  ': 797.9 კ3=0.4',
  '.შეთანხმებული პროექტის ბრძანების ნომერი.: 7496274',
  '.შეთანხმებული პროექტის ბრძანების თარიღი.: 30.05.2025',
  'გადაწყვეტილება',
  'ქ. თბილისის მუნიციპალიტეტის სსიპ – ქ. თბილისის მუნიციპალიტეტის არქიტექტურის',
  'სამსახურმა განიხილა თქვენ მიერ ელექტრონულად ატვირთული განცხადება და მასზე',
  'თანდართული დოკუმენტაცია, პასუხად გაცნობებთ შემდეგს:',
  '1. წარმოადგინეთ არსებული სიტუაციის ამსახველი განახლებული ფოტოსურათები დღეის',
  'მდგომარეობით დათარიღებული',
  '2. ქ. თბილისის მუნიციპალიტეტის მერიის შიდა აუდიტისა და მონიტორინგის საქალაქო',
  'სამსახურის 13-•••457 წერილით, არქიტექტურის სამსახურისთვის ცნობილი გახდა,',
  'რომ საპროექტო ობიექტის მშენებლობა ნაწარმოებია შეთანხმებული პროექტის',
  'დარღვევით. აქედან გამომდინარე და მოქმედი კანონმდებლობის თანახმად, საჭიროა,',
  'წარმოადგინოთ ქ. თბილისის მუნიციპალიტეტის მერიის მუნიციპალური ინსპექციის მიერ',
  'გაცემული დადგენილება სამშენებლო–სამართალდარღვევის საქმეზე და შესაბამისი',
  'დარღვევისათვის დაკისრებული ჯარიმის გადახდის დამადასტურებელი ქვითარი და',
  'განაახლოთ არსებული ფოტოსურათები დღევანდელი მდგომარეობით.',
].join('\n');

/* A minimal raw result: the 1101896 case, the newest case with its photo file, and publicResearch. */
export function rawResult601() {
  return {
    publicResearch: PUBLIC_RESEARCH,
    browserOfficial: {
      results: [{
        source: 'tas',
        tasApi: {
          cases: [
            { documentId: '1101896', registrationNumber: 'AR11101896', date: '2025-07-29', title: 'შეთანხმებული პროექტის ცვლილება', status: 'დასრულებული', attachments: [], motions: [] },
            { documentId: '1161121', registrationNumber: 'AR11161121', date: '2026-09-17', title: 'შეთანხმებული პროექტის ცვლილება', status: 'განხილვის პროცესში', attachments: [{ attachedFileId: '5418977', fileName: 'ფოტოები.pdf' }, { attachedFileId: '5418975', fileName: 'გენგეგმა.pdf' }], motions: [] },
          ],
        },
        documents: [{ tasDocumentId: '1101896', rawText: CASE_TEXT_1101896, title: 'TAS 1101896', documentDate: '2025-07-29T12:38:32.000Z' }],
      }],
    },
  };
}

const d = (date, number, outcome, effect, term = null, extra = {}) => ({ date, term, effect, number, outcome, dateBasis: 'RESPONSE_PUBLISHED', publishedOn: date, correctedProject: /CORRECTED/.test(effect ?? ''), ...extra });
const K2 = (v) => ({ label: 'შენობის K2 კოეფიციენტის საანგარიშო ფართობი (კვ.მ)', value: v });
const row = (caseRef, filedOn, stage, effect, decisions = [], extra = {}) => ({
  scope: 'PARENT_PARCEL', stage, effect, caseRef, filedOn, metrics: [], deadline: null, decisions,
  parcelCodes: ['01.18.06.019.055'], lastActivityOn: filedOn, unreadResponses: [], supersedesPermit: null, deficiencyNotices: 0, ...extra,
});

/* officialHistory.caseChronology as persisted (attachments counts dropped). */
export const CASE_CHRONOLOGY = [
  row('AR1639208', '2018-12-07', 'DECIDED', 'PROJECT_APPROVED', [d('2019-02-20', '4381827', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 3 }),
  row('AR1668968', '2019-03-18', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '4424454', publishedOn: '2019-03-21' }] }),
  row('AR1761052', '2020-07-17', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '5032001', publishedOn: '2020-07-22' }] }),
  row('AR1850369', '2021-09-14', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '5616651', publishedOn: '2021-09-28' }] }),
  row('AR1850793', '2021-09-16', 'UNDER_REVIEW', null, [], { deficiencyNotices: 3 }),
  row('AR1897963', '2022-05-12', 'DECIDED', 'PROJECT_APPROVED', [d('2022-07-11', '6030016', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 3 }),
  row('AR1919535', '2022-08-26', 'DECIDED', 'PROJECT_APPROVED', [d('2022-12-30', '6272569', 'APPROVED', 'PROJECT_APPROVED')], { metrics: [K2('4597.7')], deficiencyNotices: 11 }),
  row('AR1942605', '2022-12-30', 'RESPONSE_UNREAD', null, [], { metrics: [K2('4605.7')], unreadResponses: [{ number: '6732848', publishedOn: '2023-10-30' }] }),
  row('AR1965637', '2023-05-10', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '6469126', publishedOn: '2023-05-19' }] }),
  row('AR1968595', '2023-05-30', 'DECIDED', 'PROJECT_APPROVED', [d('2023-09-21', '6673781', 'APPROVED', 'PROJECT_APPROVED')], { metrics: [K2('4633.2')], deficiencyNotices: 8 }),
  row('AR1990786', '2023-09-20', 'DECIDED', 'PROJECT_APPROVED', [d('2023-10-04', '6689190', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 1 }),
  row('AR11026464', '2024-03-28', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '6991188', publishedOn: '2024-04-19' }] }),
  row('AR11031305', '2024-04-22', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '7000543', publishedOn: '2024-04-24' }] }),
  row('AR11034439', '2024-05-14', 'DECIDED', 'PERMIT_FOR_CORRECTED_PROJECT', [d('2024-07-26', '7152431', 'PERMIT_ISSUED', 'PERMIT_FOR_CORRECTED_PROJECT', { from: '2024-07-26', until: '2027-01-26' })], { deficiencyNotices: 6 }),
  row('AR11084312', '2025-04-03', 'DECIDED', 'PERMIT_FOR_CORRECTED_PROJECT', [d('2025-05-30', '7496274', 'PERMIT_ISSUED', 'PERMIT_FOR_CORRECTED_PROJECT', { from: '2025-05-30', until: '2027-11-30' })], { supersedesPermit: { date: '2024-07-26', caseRef: 'AR11034439', decisionNumber: '7152431' }, deficiencyNotices: 5 }),
  row('AR11101896', '2025-07-29', 'DECIDED', 'PERMIT_FOR_CORRECTED_PROJECT', [d('2026-03-11', '7839183', 'PERMIT_ISSUED', 'PERMIT_FOR_CORRECTED_PROJECT', { from: '2026-03-11', until: '2028-03-11' })], { supersedesPermit: { date: '2025-05-30', caseRef: 'AR11084312', decisionNumber: '7496274' }, deficiencyNotices: 7 }),
  row('AR11115640', '2025-11-04', 'UNDER_REVIEW', null, [], { deficiencyNotices: 1 }),
  row('AR11148112', '2026-06-17', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '7971330', publishedOn: '2026-06-22' }] }),
  row('AR11161121', '2026-09-17', 'SUBMITTED', null, [], { metrics: [K2('5242.3'), { label: 'შენობის სიმაღლე (მ)', value: '22.75' }] }),
];

export const PENDING = [
  { date: '2026-09-17', stage: 'SUBMITTED', status: 'UNDER_REVIEW', caseRef: 'AR11161121', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null, lastResponse: null },
  { date: '2026-06-17', stage: 'RESPONSE_UNREAD', status: 'UNDER_REVIEW', caseRef: 'AR11148112', subject: null, deadline: null, applicant: 'ლევან ჩაჩუა', statusText: null, lastResponse: { number: '7971330', publishedOn: '2026-06-22' } },
];

export const STATUS = { since: '2026-03-11', state: 'PERMITTED', caseRef: 'AR11101896', caveats: ['LATER_UNDETERMINED_DECISION', 'PROCESSING_INCOMPLETE'], conclusive: false, validUntil: '2028-03-11', pendingCount: 0, decisionNumber: '7839183' };

export const HISTORY_601 = { status: STATUS, caseChronology: CASE_CHRONOLOGY, pendingApplications: PENDING, legal: [], milestones: [], milestoneGroups: [] };

export const UNIT_LEGAL_POSITION = {
  scope: 'EXACT_UNIT',
  evidence: { source: 'NAPR_EXTRACT', extractIssuedAt: '2026-08-24T08:35:20' },
  mortgages: {
    asOf: '2026-08-24T08:35:20',
    state: 'NONE_REGISTERED',
    history: [{
      scope: 'EXACT_UNIT',
      steps: [
        { date: '2023-12-19', step: 'MORTGAGE_REGISTERED' },
        { date: '2026-08-13', step: 'TERMINATION_APPLIED' },
        { date: '2026-08-18', step: 'SUSPENDED' },
        { date: '2026-08-24', step: 'CANCELLATION_REGISTERED' },
      ],
      creditor: 'სააქციო საზოგადოება "საქართველოს ბანკი"',
      lifecycle: 'CANCELLATION_REGISTERED',
      registeredOn: '2023-12-19',
    }],
  },
  ownership: { asOf: '2026-08-24T08:35:20', basis: 'PURCHASE', owners: [{ kind: 'PERSON', name: OWNER }], registeredOn: '2026-08-17' },
  restrictions: { asOf: '2026-08-24T08:35:20', seizure: 'NONE', taxLien: 'NONE', debtorRegistry: 'NONE' },
  openProceedings: [],
};

const role = (code, date, caseRef, roleText, extra = {}) => ({ code, date, scope: null, caseRef, roleText, sourceUrl: TAS(caseRef?.replace(/^AR1?/, '') ?? ''), documentTitle: null, ...extra });

/* projectTeamV2 exactly as production holds it (19 entries). */
export const PROJECT_TEAM_V2_LIVE = [
  { kind: 'PERSON', name: 'ლევან ჩაჩუა', group: 'DEVELOPER', official: true, firstSeen: '2024-05-14', lastSeen: '2026-09-17', organization: null, roles: [
    role('APPLICANT', '2026-09-17', 'AR11161121', 'განმცხადებელი'), role('APPLICANT', '2026-06-17', 'AR11148112', 'განმცხადებელი'),
    role('APPLICANT', '2025-11-04', 'AR11115640', 'განმცხადებელი'), role('DEVELOPER', '2025-08-21', 'AR11101896', 'დამკვეთი', { documentTitle: 'TAS 1101896' }),
    role('APPLICANT', '2025-07-29', 'AR11101896', 'განმცხადებელი'), role('DEVELOPER', '2025-04-11', 'AR11084312', 'დამკვეთი'),
    role('APPLICANT', '2025-04-03', 'AR11084312', 'განმცხადებელი'), role('DEVELOPER', '2024-05-24', 'AR11034439', 'დამკვეთი'),
    role('APPLICANT', '2024-05-14', 'AR11034439', 'განმცხადებელი'),
  ] },
  { kind: 'ORGANIZATION', name: 'შპს „ქეი-ელ-გრუპი“', group: 'DEVELOPER', official: true, firstSeen: '2024-04-19', lastSeen: '2024-04-19', organization: null, roles: [role('DEVELOPER', '2024-04-19', 'AR11026464', 'დამკვეთი')] },
  { kind: 'PERSON', name: 'მარინა კაციტაძე', group: 'DEVELOPER', official: true, firstSeen: '2022-10-07', lastSeen: '2023-09-29', organization: null, roles: [
    role('DEVELOPER', '2023-09-29', 'AR1990786', 'დამკვეთი'), role('DEVELOPER', '2023-07-03', 'AR1968595', 'დამკვეთი'),
    role('DEVELOPER', '2023-01-23', 'AR1942605', 'დამკვეთი'), role('DEVELOPER', '2022-10-07', 'AR1919535', 'დამკვეთი'),
  ] },
  { kind: 'PERSON', name: 'დავით სორდია', group: 'ARCHITECTURE', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('CHIEF_ARCHITECT', '2026-09-17', 'AR11161121', 'პროექტის მთავარი არქიტექტორი', { sourceUrl: DL('5418990'), documentTitle: 'კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf' }),
  ] },
  { kind: 'PERSON', name: 'დარეჯან შათაშვილი', group: 'ARCHITECTURE', official: true, firstSeen: '2023-05-10', lastSeen: '2026-09-17', organization: 'შპს „არტიტექსი“', roles: [
    role('ARCHITECT', '2026-09-17', 'AR11161121', 'პროექტის ავტორი, არქიტექტორი', { sourceUrl: DL('5418975'), documentTitle: 'გენგეგმა.pdf' }),
    role('CHIEF_ARCHITECT', '2026-09-17', 'AR11161121', 'პროექტის მთავარი არქიტექტორი', { sourceUrl: DL('5418990'), documentTitle: 'კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf' }),
    role('CHIEF_ARCHITECT', '2025-08-21', 'AR11101896', 'მთავარი არქიტექტორი/სპეციალისტი', { documentTitle: 'TAS 1101896' }),
    role('CHIEF_ARCHITECT', '2025-04-11', 'AR11084312', 'მთავარი არქიტექტორი/სპეციალისტი'),
    role('CHIEF_ARCHITECT', '2024-05-24', 'AR11034439', 'მთავარი არქიტექტორი/სპეციალისტი'),
    role('APPLICANT', '2023-09-20', 'AR1990786', 'განმცხადებელი'),
    role('CHIEF_ARCHITECT', '2023-07-03', 'AR1968595', 'მთავარი არქიტექტორი/სპეციალისტი'),
    role('APPLICANT', '2023-05-30', 'AR1968595', 'განმცხადებელი'),
    role('APPLICANT', '2023-05-10', 'AR1965637', 'განმცხადებელი'),
  ] },
  { kind: 'PERSON', name: 'დავით ლოსაბერიძე', group: 'ARCHITECTURE', official: true, firstSeen: '2018-12-07', lastSeen: '2024-04-22', organization: 'შპს „ეი ბი 5“', roles: [
    role('APPLICANT', '2024-04-22', 'AR11031305', 'განმცხადებელი'), role('APPLICANT', '2022-12-30', 'AR1942605', 'განმცხადებელი'),
    role('CHIEF_ARCHITECT', '2022-10-07', 'AR1919535', 'მთავარი არქიტექტორი/სპეციალისტი'), role('APPLICANT', '2022-08-26', 'AR1919535', 'განმცხადებელი'),
    role('APPLICANT', '2022-05-12', 'AR1897963', 'განმცხადებელი'), role('APPLICANT', '2021-09-16', 'AR1850793', 'განმცხადებელი'),
    role('APPLICANT', '2021-09-14', 'AR1850369', 'განმცხადებელი'), role('APPLICANT', '2019-03-18', 'AR1668968', 'განმცხადებელი'),
    role('APPLICANT', '2018-12-07', 'AR1639208', 'განმცხადებელი'),
  ] },
  { kind: 'ORGANIZATION', name: 'შპს „არტიტექსი“', group: 'ARCHITECTURE', official: true, firstSeen: '2023-07-03', lastSeen: '2025-08-21', organization: null, roles: [
    role('ARCHITECTURAL_ORGANIZATION', '2025-08-21', 'AR11101896', 'საპროექტო ორგანიზაცია'), role('ARCHITECTURAL_ORGANIZATION', '2025-04-11', 'AR11084312', 'საპროექტო ორგანიზაცია'),
    role('ARCHITECTURAL_ORGANIZATION', '2024-05-24', 'AR11034439', 'საპროექტო ორგანიზაცია'), role('ARCHITECTURAL_ORGANIZATION', '2023-07-03', 'AR1968595', 'საპროექტო ორგანიზაცია'),
  ] },
  { kind: 'ORGANIZATION', name: 'შპს „ეი ბი 5“', group: 'ARCHITECTURE', official: true, firstSeen: '2022-10-07', lastSeen: '2022-10-07', organization: null, roles: [role('ARCHITECTURAL_ORGANIZATION', '2022-10-07', 'AR1919535', 'საპროექტო ორგანიზაცია')] },
  { kind: 'PERSON', name: 'ია მშვიდობაძე', group: 'GEOTECHNICAL', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('GEOTECHNICAL_EXPERT_ASSESSMENT', '2026-09-17', 'AR11161121', 'ხელმომწერი: საინჟინრო-გეოლოგიური კვლევის საექსპერტო შეფასება', { scope: 'საინჟინრო-გეოლოგიური კვლევის საექსპერტო შეფასება', sourceUrl: DL('5418993'), documentTitle: 'გეოლ ექსპერტიზა.pdf' }),
  ] },
  { kind: 'PERSON', name: 'ბ. გოგოლაური', group: 'CONSTRUCTION_ORG', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('CONSTRUCTION_ORGANIZATION_SCHEDULE', '2026-09-17', 'AR11161121', 'დაამუშავა: მშენებლობის ორგანიზაციის პროექტი', { scope: 'მშენებლობის ორგანიზაციის პროექტი', sourceUrl: DL('5418992'), documentTitle: 'მოპი სატრანსპორტო ღობე.pdf' }),
  ] },
  { kind: 'PERSON', name: 'განგაშისა და', group: 'SAFETY', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('SAFETY_ASSESSMENT', '2026-09-17', 'AR11161121', 'სახანძრო', { sourceUrl: DL('5418979'), documentTitle: 'გეგმები 16,09,2026.pdf' }),
  ] },
  { kind: 'PERSON', name: 'ვასილ ტატიაშვილი', group: 'SAFETY', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('SAFETY_ASSESSMENT', '2026-09-17', 'AR11161121', 'ექსპერტი: შენობა-ნაგებობის უსაფრთხოების წესებთან შესაბამისობის საექსპერტო დასკვნა', { scope: 'შენობა-ნაგებობის უსაფრთხოების წესებთან შესაბამისობის საექსპერტო დასკვნა', sourceUrl: DL('5418990'), documentTitle: 'კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf' }),
  ] },
  { kind: 'PERSON', name: 'საქვეითე გადასასვლელი', group: 'SAFETY', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('SAFETY_ASSESSMENT', '2026-09-17', 'AR11161121', 'უსაფრთხოების ლენტი', { sourceUrl: DL('5418992'), documentTitle: 'მოპი სატრანსპორტო ღობე.pdf' }),
  ] },
  { kind: 'PERSON', name: 'გიორგი ლეჟავა', group: 'OTHER', official: true, firstSeen: '2024-03-28', lastSeen: '2026-09-17', organization: null, roles: [
    role('DRAWING_TITLE_BLOCK', '2026-09-17', 'AR11161121', 'დასახელებულია ნახაზების ძირითად წარწერაში (როლი მითითებული არ არის)', { sourceUrl: DL('5418975'), documentTitle: 'გენგეგმა.pdf' }),
    role('APPLICANT', '2024-03-28', 'AR11026464', 'განმცხადებელი'),
  ] },
  { kind: 'PERSON', name: 'საავტომობილო გადაადგილება', group: 'OTHER', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('OTHER', '2026-09-17', 'AR11161121', 'საპროექტო ტერიტორია', { sourceUrl: DL('5418992'), documentTitle: 'მოპი სატრანსპორტო ღობე.pdf' }),
  ] },
  { kind: 'PERSON', name: 'საშუალებები და პირობითი აღნიშვნები', group: 'OTHER', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('OTHER', '2026-09-17', 'AR11161121', 'საგზაო მოძრაობის ორგანიზების ტექნიკური', { sourceUrl: DL('5418992'), documentTitle: 'მოპი სატრანსპორტო ღობე.pdf' }),
  ] },
  { kind: 'ORGANIZATION', name: 'ჯეტექს სოლუშენს', group: 'OTHER', official: true, firstSeen: '2026-09-17', lastSeen: '2026-09-17', organization: null, roles: [
    role('MEP_ENGINEER', '2026-09-17', 'AR11161121', 'შემსრულებელი კომპანია: გაზმომარაგების პროექტი', { scope: 'გაზმომარაგების პროექტი', sourceUrl: DL('5418993'), documentTitle: 'გეოლ ექსპერტიზა.pdf' }),
    role('MEP_ENGINEER', '2026-09-17', 'AR11161121', 'შემსრულებელი კომპანია: გათბობა-ვენტილაციის პროექტი', { scope: 'გათბობა-ვენტილაციის პროექტი', sourceUrl: DL('5418993'), documentTitle: 'გეოლ ექსპერტიზა.pdf' }),
    role('MEP_ENGINEER', '2026-09-17', 'AR11161121', 'შემსრულებელი კომპანია: ელექტრობის პროექტი', { scope: 'ელექტრობის პროექტი', sourceUrl: DL('5418993'), documentTitle: 'გეოლ ექსპერტიზა.pdf' }),
  ] },
  { kind: 'PERSON', name: 'ლევან გვრიტიშვილი', group: 'OTHER', official: true, firstSeen: '2020-07-17', lastSeen: '2020-07-17', organization: null, roles: [role('APPLICANT', '2020-07-17', 'AR1761052', 'განმცხადებელი')] },
  { kind: 'ORGANIZATION', name: 'GBS', group: 'OTHER', official: false, firstSeen: null, lastSeen: null, organization: null, roles: [
    { code: 'OTHER', date: null, scope: null, caseRef: null, roleText: '1,500 მ² კერამიკული ფილის მიწოდება; მიმწოდებლის პორტფოლიოში აღნიშნული შესრულებული სამუშაო', sourceUrl: null, documentTitle: null },
  ] },
];
