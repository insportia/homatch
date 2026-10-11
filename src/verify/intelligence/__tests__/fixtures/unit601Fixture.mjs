/*
 * SANITIZED reconstruction of job 8ba97da9 (01.18.06.019.055.03.01.601).
 *
 * Structure, dates, registry/case/decision numbers, the creditor and the
 * operative wording follow the real Service 176 and TAS records; the private
 * owner's name and personal number, applicant names and representatives are
 * replaced by placeholders. No personal identification number appears.
 *
 * Register (NAPR / Service 176, exact unit):
 *   892024345129  filed 03.09.2024 → decision -03 09.09.2024 satisfied; extract 09.09.2024:
 *                 owner = developer company; BoG mortgage NCAH000744921 (registered 19.12.2023) ON THIS UNIT
 *   882026715603  filed 11.08.2026 → decision -03 17.08.2026 satisfied; extract 17.08.2026:
 *                 owner = private person (purchase); the BoG mortgage STILL listed
 *   882026724195  BoG's mortgage termination: filed 13.08.2026 → decision -03 18.08.2026 SUSPENDED
 *                 (fee unpaid) → decision -06 24.08.2026 satisfied; extract 24.08.2026: no mortgage
 *
 * TAS (parent parcel 01.18.06.019.055): permits 7152431 (2024-07-26),
 * 7496274 (2025-05-30), 7839183 (published 2026-03-11, corrected project,
 * term 2026-03-11 → 2028-03-11); AR11148112 (2026-06-17) with an unread
 * response 7971330; AR11161121 (2026-09-17) with no response yet.
 */
import { toLegacy } from './propertyRegisterFixture.mjs';

export const CODE = '01.18.06.019.055.03.01.601';
export const PARCEL = '01.18.06.019.055';
const PERSON = 'სატესტო მესაკუთრე ,P/N: 00000000000';
const COMPANY = 'შპს "სატესტო დეველოპერი" , ID ნომერი:404670272';

const head = (app, filed, prepared) => `

*${app}*
მიწის (უძრავი ქონების) საკადასტრო კოდი
N ${CODE}

ამონაწერი საჯარო რეესტრიდან
 განცხადების რეგისტრაცია მომზადების თარიღი
 N ${app}    -  ${filed} ${prepared}
საკუთრების განყოფილება
ზონასექტორიკვარტალინაკვეთიკოდი
თბილისიკრწანისი
011806019/05503/01/601
მისამართი: ქალაქი თბილისი , ქუჩა კრწანისი , N 6
ნაკვეთის საკუთრების ტიპი: თანასაკუთრება
ნაკვეთის ფუნქცია: არასასოფლო სამეურნეო
დაზუსტებული ფართობი:2145.00 კვ.მ.
ნაკვეთის წინა ნომერი: 19;
შენობა-ნაგებობები: N1 (მშენებარე), N2 (მშენებარე) და
N3(მშენებარე)-საერთო ფართობი 6946.6 კვ.მ.
მესაკუთრეები
`;
const owners = (app, filed, rights, basis, ownerLine, ownerShort) => `განცხადების რეგისტრაცია : ნომერი ${app} , თარიღი ${filed}
უფლების რეგისტრაცია: თარიღი  ${rights}
უფლების დამადასტურებელი დოკუმენტი:
${basis}
მესაკუთრეები:
${ownerLine}
მესაკუთრე:
საკუთრების
ტიპი:
საკუთრება:ფართი:წილი:
${ownerShort}საკუთრებაფართი(მშენებარე)სართული6,ბინა
N601,ბლოკი "ც"
94.10
კვ.მ.
იპოთეკა
`;
const MORTGAGE = `1)  განცხადების
რეგისტრაცია
ნომერი
892023420105
თარიღი 19/12/2023
16:15:55
უფლების
რეგისტრაცია: თარიღი
 19/12/2023
იპოთეკარი: სააქციო საზოგადოება "საქართველოს ბანკი" 204378869;
საგანი:სართული6,ბინა N601,ბლოკი "ც",ფართი 94.10 კვ.მ. ;
იპოთეკის ხელშეკრულება NCAH000744921, დამოწმების თარიღი: 19/12/2023,
საქართველოს იუსტიციის სამინისტროს საჯარო რეესტრის ეროვნული სააგენტო ,
`;
const TAIL = `საგადასახადო გირავნობა:
რეგისტრირებული არ არის
ვალდებულება
ყადაღა/აკრძალვა:
რეგისტრირებული არ არის
მოვალეთა რეესტრი:
რეგისტრირებული არ არის

ფიზიკური პირის მიერ არასამეწარმეო საქმიანობის ფარგლებში...
საჯარორეესტრისეროვნულისააგენტო.http://public.reestri.gov.geგვერდი:2(2)`;

const PURCHASE = 'ხელშეკრულება უძრავი ნივთის ნასყიდობის შესახებ , დამოწმების თარიღი:11/08/2026 , საქართველოს იუსტიციის';
const PARTNERS = 'შ.პ.ს "სატესტო დეველოპერი"-ის დამფუძნებელი პარტნიორების ოქმი N2 , დამოწმების თარიღი:21/08/2024';

export const EXTRACT_2024 = toLegacy(head('892024345129', '03/09/2024 17:34:58', '09/09/2024 15:33:52') + owners('892024345129', '03/09/2024 17:34:58', '09/09/2024', PARTNERS, COMPANY, 'შპს "სატესტო დეველოპერი"') + MORTGAGE + TAIL);
export const EXTRACT_1708 = toLegacy(head('882026715603', '11/08/2026 15:29:40', '17/08/2026 15:59:48') + owners('882026715603', '11/08/2026 15:29:40', '17/08/2026', PURCHASE, PERSON, 'სატესტო მესაკუთრე') + MORTGAGE + TAIL);
export const EXTRACT_2408 = toLegacy(head('882026724195', '13/08/2026 13:10:26', '24/08/2026 08:35:20') + owners('882026715603', '11/08/2026 15:29:40', '17/08/2026', PURCHASE, PERSON, 'სატესტო მესაკუთრე') + TAIL);

const decisionHead = (no, date, title, filed, party, service) => `

${date.split('.').reverse().join('/')}NAPR

გადაწყვეტილება # ${no} (${date})
${title}
განცხადების ნომერი: ${no.replace(/-\d+$/, '')} განცხადების მიღების თარიღი: ${filed}
დაინტერესებული პირი: ${party}
წარმომადგენელი: [REDACTED]
უძრავი ნივთის მისამართი/საკადასტრო კოდი: ქალაქი თბილისი , ქუჩა კრწანისი , N 6,'ც' ბლოკი,სართული
6, ბინა N601, ${CODE}
მომსახურების სახე: ${service}
დ ა სკ ვ ნ ა
`;
const GRANTED = `„საჯარო რეესტრის შესახებ“ საქართველოს კანონის შესაბამისად მიღებული იქნა გადაწყვეტილება
მოთხოვნის დაკმაყოფილების თაობაზე.`;
const TERMINATION = 'იპოთეკის შეწყვეტის რეგისტრაცია უძრავ ნივთზე';
// The suspension text says what is needed "for the request to be satisfied" — the trap the old parser fell into.
export const DECISION_SUSPENDED = decisionHead('882026724195-03', '18.08.2026', 'სარეგისტრაციო წარმოების შეჩერების შესახებ', '13.08.2026 13:10', 'სს საქართველოს ბანკი (204378869)', TERMINATION) + `1. შეჩერდეს სარეგისტრაციო წარმოება „საჯარო რეესტრის შესახებ“ საქართველოს კანონის 21.1. „ა“ პრიმა
მუხლის შესაბამისად.
2. სარეგისტრაციო მოთხოვნის დაკმაყოფილებისთვის:
წარმოსადგენია საჯარო რეესტრის ეროვნული სააგენტოს მიერ გაწეული მომსახურების საფასური.`;
export const DECISION_REGISTERED = decisionHead('882026724195-06', '24.08.2026', 'რეგისტრაციის შესახებ', '13.08.2026 13:10', 'სს საქართველოს ბანკი (204378869)', TERMINATION) + GRANTED;
const DECISION_PURCHASE = decisionHead('882026715603-03', '17.08.2026', 'რეგისტრაციის შესახებ', '11.08.2026 15:29', 'სატესტო მესაკუთრე (00000000000)', 'საკუთრების უფლების რეგისტრაცია გარიგების საფუძველზე უძრავ ნივთზე') + GRANTED;
const DECISION_PARTNERS = decisionHead('892024345129-03', '09.09.2024', 'რეგისტრაციის შესახებ', '03.09.2024 17:34', 'შპს სატესტო დეველოპერი (404670272)', 'ამხანაგობის წევრის/წევრების საკუთრების უფლების რეგისტრაცია უძრავ ნივთზე') + GRANTED;

const ref = (recordId) => ({ recordId, cadastralCode: CODE });
const listed = (appID, regNumber, webTransact, appRegDate, lastActDate) => ({
  appID, regNumber, webTransact, appRegDate, lastActDate, statusId: '10', status: 'სარეგისტრაციო წარმოება დასრულებულია',
  address: "ქალაქი თბილისი , ქუჩა კრწანისი , N 6,'ც' ბლოკი,სართული 6, ბინა N601",
});

export function mygovResult({ withoutLatestExtract = false } = {}) {
  return {
    source: 'mygov',
    adapter: 'service176-public-api',
    queryEntered: CODE,
    retrievedAt: '2026-10-11T06:41:47.972Z',
    traversal: {
      search: {
        cadastralCode: CODE,
        records: [
          listed('35356992', '882026724195', TERMINATION, '1786626626', '1787560633'),
          listed('35347447', '882026715603', 'საკუთრების უფლების რეგისტრაცია გარიგების საფუძველზე უძრავ ნივთზე', '1786462180', '1786982533'),
          listed('28323181', '892024345129', 'ამხანაგობის წევრის/წევრების საკუთრების უფლების რეგისტრაცია უძრავ ნივთზე', '1725384898', '1725896102'),
        ],
      },
      records: [],
    },
    documents: [
      ...(withoutLatestExtract ? [] : [{ title: 'ამონაწერი საჯარო რეესტრიდან', rawText: EXTRACT_2408, sourceReference: ref('35356992') }]),
      // The registered decision is listed BEFORE the suspension, as the live record lists them.
      { title: 'სარეგისტრაციო წარმოება დასრულებულია', rawText: DECISION_REGISTERED, sourceReference: ref('35356992') },
      { title: 'სარეგისტრაციო წარმოება შეჩერებულია', rawText: DECISION_SUSPENDED, sourceReference: ref('35356992') },
      { title: 'ამონაწერი საჯარო რეესტრიდან', rawText: EXTRACT_1708, sourceReference: ref('35347447') },
      { title: 'სარეგისტრაციო წარმოება დასრულებულია', rawText: DECISION_PURCHASE, sourceReference: ref('35347447') },
      { title: 'ამონაწერი საჯარო რეესტრიდან', rawText: EXTRACT_2024, sourceReference: ref('28323181') },
      { title: 'სარეგისტრაციო წარმოება დასრულებულია', rawText: DECISION_PARTNERS, sourceReference: ref('28323181') },
    ],
  };
}

/* ───────────── TAS (parent parcel) ───────────── */

const permitEvidence = (from, until) =>
  `.055) მრავალბინიანი საცხოვრებელი სახლის კორექტირებული არქიტექტურული პროექტი. 2. გაიცეს მშენებლობის ნებართვა და გაცემულად ჩაითვალოს მშენებლობის სანებართვო მოწმობა. 3. მშენებლობის ვადა განისაზღვროს ${from} ${until}`;
const motion = (motionId, date, decision = null, response = decision ? 'PDF' : 'EMPTY') => ({
  motionId, date, name: null, status: null, response, textChars: decision ? 9000 : 0, documentId: null, decisionNumber: decision?.number ?? null, decision,
});
const deficiency = (number) => ({ number, outcome: 'DEFICIENCY', evidence: 'სამსახურმა განიხილა … ხარვეზები … 15 სამუშაო დღე', issueDate: null, validUntil: null });
const permit = (number, from, until) => ({ number, outcome: 'PERMIT_ISSUED', evidence: permitEvidence(from, until), issueDate: null, validUntil: null });
const tasCase = (documentId, date, motions, extra = {}) => ({
  documentId, registrationNumber: `AR1${documentId}`, date, form: { status: 'NOT_AVAILABLE' }, title: null, status: null, statusId: null, docType: null,
  values: [], address: 'ქალაქი თბილისი , ქუჩა კრწანისი , N 6', motions, parties: [], cadastralCodes: [PARCEL],
  attachments: [], technicalFacts: [], description: null, completeness: {}, lastMotionAt: null, ...extra,
});

export function tasCases() {
  const cases = [
    tasCase('1034439', '2024-05-14T08:48:48.000Z', [motion('7038028', '2024-05-24T12:17:22.000Z', deficiency('7037988')), motion('7152492', '2024-07-26T13:40:15.000Z', permit('7152431', '2024 წლის 26 ივლისიდან', '2027 წლის 26 იანვრის'))]),
    tasCase('1084312', '2025-04-03T11:53:37.000Z', [motion('7443770', '2025-04-11T12:44:33.000Z', deficiency('7443726')), motion('7498084', '2025-05-30T13:55:14.000Z', permit('7496274', '2025 წლის 30 მაისიდან', '2027 წლის 30 ნოემბრის'))]),
    tasCase('1101896', '2025-07-29T12:38:32.000Z', [
      motion('7585902', '2025-08-21T10:58:45.000Z', deficiency('7585702')),
      motion('7816856', '2026-03-10T07:42:52.000Z', deficiency('7816547')),
      motion('7839183', '2026-03-11T15:34:47.000Z'),
      motion('7839253', '2026-03-11T15:34:47.000Z', permit('7839183', '2026 წლის 11 მარტიდან', '2028 წლის 11 მარტის')),
    ]),
    tasCase('1148112', '2026-06-17T09:58:38.000Z', [
      motion('7971330', '2026-06-22T04:27:32.000Z'),
      motion('7971579', '2026-06-22T04:27:32.000Z', { number: '7971330', outcome: 'UNDETERMINED', evidence: null, issueDate: null, validUntil: null }),
    ], {
      parties: [{ kind: 'PERSON', name: 'სატესტო განმცხადებელი', role: 'APPLICANT', organizationId: null }],
      // The applicant's HOME address, mis-read by the worker as a building block.
      technicalFacts: [{ key: 'buildingBlock', value: '2, ბინა 34', category: 'PROJECT', rawLabel: 'კორპუსი', confidence: 'HIGH' }],
      attachments: [{ fileName: 'სწორი გეგმები.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 2 }],
    }),
    tasCase('1161121', '2026-09-17T13:28:22.000Z', [], {
      parties: [{ kind: 'PERSON', name: 'სატესტო განმცხადებელი', role: 'APPLICANT', organizationId: null }],
      values: [
        { key: '851962', label: 'შენობის K2 კოეფიციენტის საანგარიშო ფართობი (კვ.მ)', value: '5242.3' },
        { key: '851963', label: 'შენობის სიმაღლე (მ)', value: '22.75' },
      ],
      attachments: [
        { fileName: 'გენგეგმა.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 1 },
        { fileName: 'გენგეგმა 16,09,2026.dwg', format: 'dwg', outcome: 'UNSUPPORTED_FORMAT' },
        { fileName: 'ფოტოები.pdf', format: 'pdf', outcome: 'SCAN_OR_IMAGE_ONLY', pages: 7 },
        { fileName: 'გეგმები 16,09,2026.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 55 },
      ],
    }),
  ];
  // Deliberately NOT in filing order: the chronology must sort by filing date.
  return [cases[4], cases[1], cases[3], cases[0], cases[2]];
}

export function tasResult() {
  return {
    source: 'tas',
    status: 'VERIFIED',
    tasApi: {
      version: 'tas-api-2', implementation: 'API_FIRST', cases: tasCases(),
      reconciliation: { sourceTotal: 5, reconciled: true },
      ledger: { incomplete: false },
      accounting: { responses: { PDF: 6 } },
    },
    documents: [],
  };
}

/** The job's result_json, as research-agent persisted it (fields relevant here). */
export function unit601Result({ withoutLatestExtract = false } = {}) {
  return {
    exactUnit: { code: CODE, note: null, verified: false },
    identifiedParent: { name: 'Villion Krtsanisi Homes', parcelCode: PARCEL, address: 'თბილისი, კრწანისის ქ. 6' },
    reconciledIdentity: { address: 'თბილისი, კრწანისის ქ. 6', project: 'Villion Krtsanisi Homes', developer: 'Millenio Group', confidence: 'HIGH' },
    service176Evidence: [
      { field: 'CADCODE', value: CODE, claim: `Cadastral code: ${CODE}`, category: 'PROPERTY', provenance: { serviceId: 176, cadastralCode: CODE } },
      { field: 'ADDRESS', value: "ქალაქი თბილისი , ქუჩა კრწანისი , N 6,'ც' ბლოკი,სართული 6, ბინა N601", claim: 'Registered property address', category: 'PROPERTY', provenance: { serviceId: 176, cadastralCode: CODE } },
    ],
    rightsAndRestrictions: {
      asOf: '2026-10-11T07:07:56.134Z',
      items: [],
      status: 'NONE_FOUND_IN_CHECKED_SOURCE',
      statement: 'მოძიებულ მიმდინარე მტკიცებულებაში (2026-10-11T07:07:56.134Z) არსებითი რეგისტრირებული შეზღუდვა არ გამოვლენილა.',
    },
    browserOfficial: { results: [tasResult(), mygovResult({ withoutLatestExtract })] },
  };
}
