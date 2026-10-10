// Sanitized, realistic fixture of job 220ed087 (Villion, parcel
// 01.18.06.019.055, unit 01.18.06.019.055.03.01.503) as the EXTENDED worker
// emits it: form values with paths, priority cases, attachment text. The
// texts mirror the public TAS page of AR11161121 (fetched by the owner, not
// by this test — nothing here is live-verified). Personal numbers and phones
// are fake and must never survive extraction.

export const COMPLETED_AT = '2026-10-09T18:20:00.000Z';

// Gov. Resolution №255 citation — the only "evidence" of the stored COMMISSIONED outcome.
export const RES255 = 'ქალაქ თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურმა განიხილა განცხადება და საქართველოს მთავრობის 2019 წლის 31 მაისის №255 დადგენილებით დამტკიცებული „მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების“ შესაბამისად';
export const RES255_SHORT = '…მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების…';

const motion = (date, number, outcome, evidence, extra = {}) => ({
  motionId: `m${number}`, date, name: 'პასუხი', status: 'დასრულებული', response: 'PDF', decisionNumber: number,
  decision: { number, outcome, evidence, issueDate: date, validUntil: null }, ...extra,
});

export const ATTACHMENT_TEXT_P1 = [
  'მრავალბინიანი საცხოვრებელი კომპლექსის არქიტექტურული პროექტი (ცვლილება)',
  'შენობის უსაფრთხოების რეგულირების შეფასება',
  'სპეციალისტი: ვასილ ტატიაშვილი, პ/ნ 01019011223',
  'ბელა გოგოლაური — მშენებლობის ორგანიზების გრაფიკი',
  'საინჟინრო-გეოლოგიური საექსპერტო შეფასება – სპეციალისტი: ია მშვიდობაძე, ტელ: 599 12 34 56',
  'დეველოპერი: შპს „მილენიო გრუპი“ (ს/კ 405000001)',
  'ტექნიკურ-ეკონომიკური მაჩვენებლები',
  'მიწის ნაკვეთის ფართობი: 2,145 მ²',
  'კ-2 კოეფიციენტის გაანგარიშების ფართობი: 5 242,3 მ²',
  'მიწისზედა სიმაღლე: 22,75 მ',
  'მიწისქვეშა ნაწილის სიღრმე: 4,2 მ',
  'კონსტრუქციული სიმაღლე: 26,95 მ',
  'გამწვანების ფართობი: 643,5 მ²',
  'K1 = 0,5',
  'K2 = 2,4',
  'K3 = 0,3',
  'საძირკვლის ტიპი: კომბინირებული',
  'ლიფტი: 2 სამგზავრო ლიფტი',
  'ფასადის მოპირკეთება: ბეტონის ფაქტურის ბათქაში, ალუმინის კომპოზიტური პანელები, ალუმინის პროფილები',
  'განხილვის სხდომა დაგეგმილია 03.11.2026',
].join('\n');

export const villionV3 = () => ({
  exactUnit: { code: '01.18.06.019.055.03.01.503', verified: false },
  projectProfile: { name: 'Villion' },
  publicResearch: {
    partners: ['თიბისი ბანკი — იპოთეკური შეძენის შესაძლებლობა'],
  },
  browserOfficial: {
    results: [
      {
        source: 'tas',
        documents: [
          { tasDocumentId: '1161121', rawText: 'TAS case AR11161121\nStatus: განხილვის პროცესში\nAPPLICANT: ლევან ჩაჩუა', title: 'AR11161121' },
        ],
        tasApi: {
          accounting: { motions: 12, attachments: 30, attachmentOutcomes: { READ_TEXT: 20 } },
          ledger: { discovered: { documents: 3, motions: 12, attachments: 30 }, processed: {}, deferred: {}, incomplete: false, incompleteReasons: [] },
          cases: [
            {
              documentId: '761052', registrationNumber: 'AR10761052', title: 'მშენებლობის ნებართვა', docType: 'მშენებლობის ნებართვის გაცემა', status: 'დასრულებული',
              date: '2023-12-01', parties: [], technicalFacts: [], attachments: [],
              values: [
                { label: 'მიწის ნაკვეთის ფართობი', value: '2145 კვ.მ', path: 'ნაკვეთი' },
                { label: 'K2', value: '2,2', path: 'კოეფიციენტები' },
              ],
              motions: [motion('2023-12-20', '6800001', 'PERMIT_ISSUED', 'ვბრძანებ: გაიცეს მშენებლობის ნებართვა')],
            },
            {
              documentId: '1101896', registrationNumber: 'AR11101896', title: 'ნებართვაში ცვლილება', docType: 'ნებართვაში ცვლილების შეტანა', status: 'დასრულებული',
              date: '2026-02-20', parties: [], technicalFacts: [
                { key: 'contractorCompany', value: '"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან შპს "რეალექსპერტი"-ს ექსპერტი გეოლოგიის დარგში.' },
                { key: 'coAuthors', value: 'ს - დავით ხაბულიანის სანოტარო წესით' },
              ],
              attachments: [{ attachedFileId: 'f9', fileName: 'ნებართვა.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 3, date: '2026-03-11' }],
              values: [{ label: 'K2', value: '2.4', path: 'კოეფიციენტები' }],
              motions: [
                motion('2026-03-11', '7839253', 'COMMISSIONED', RES255_SHORT),
                motion('2026-03-11', '7839254', 'AMENDMENT_APPROVED', 'ვბრძანებ: შეთანხმდეს ცვლილება და გაიცეს მშენებლობის ნებართვა'),
              ],
            },
            {
              documentId: '1161121', registrationNumber: 'AR11161121', priority: 1,
              title: 'მრავალბინიანი საცხოვრებელი კომპლექსის არქიტექტურული პროექტის და მშენებლობის ნებართვის ცვლილების მოთხოვნა',
              docType: 'IV კლასის შენობის მშენებლობის ნებართვაში ცვლილების შეტანა', status: 'განხილვის პროცესში',
              description: 'რედაქცია K3: გამწვანების კონტურების ცვლილება', deadline: '2026-10-16',
              date: '2026-09-17',
              parties: [
                { role: 'APPLICANT', name: 'ლევან ჩაჩუა', kind: 'PERSON', organizationId: null },
                { role: 'დეველოპერი', name: 'შპს „მილენიო გრუპი“', kind: 'ORGANIZATION', organizationId: '405000001' },
              ],
              technicalFacts: [],
              values: [
                { label: 'მთავარი არქიტექტორი', value: 'დარეჯან შათაშვილი', path: 'არქიტექტურული პროექტი > ავტორები' },
                { label: 'თანაავტორი', value: 'დავით სორდია, გიორგი ლეჟავა', path: 'არქიტექტურული პროექტი > ავტორები' },
                { label: 'არქიტექტურული ორგანიზაცია', value: 'შპს "არტიტექსი" (ს/კ 405000002)', path: 'არქიტექტურული პროექტი' },
                { label: 'სპეციალისტი', value: 'გოგა რეხვიაშვილი', path: 'საექსპერტო შეფასებები > მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება' },
                { label: 'სპეციალისტი', value: 'გიორგი რეხვიაშვილი პ/ნ 01001012345', path: 'საექსპერტო შეფასებები > საძირკვლისა და ძირითადი კონსტრუქციული ელემენტების საექსპერტო შეფასება' },
                { label: 'შენობის კლასი', value: 'IV კლასი', path: 'ზოგადი' },
                { label: 'საცხოვრებელი ფართი', value: '3 960,4 მ²', path: 'ფართობები' },
                { label: 'სართულიანობა', value: '7', path: 'ზოგადი' },
              ],
              attachments: [
                { attachedFileId: 'a1', fileName: 'არქიტექტურული_პროექტი_K3.pdf', format: 'pdf', outcome: 'READ_TEXT', pages: 64, date: '2026-09-17', text: ATTACHMENT_TEXT_P1, textComplete: true },
                { attachedFileId: 'a2', fileName: 'გენგეგმა.dwg', format: 'dwg', outcome: 'UNSUPPORTED_FORMAT', pages: null, date: '2026-09-17' },
                { attachedFileId: 'a3', fileName: 'ფოტო.jpg', format: 'jpg', outcome: 'IMAGE', pages: null, date: '2026-09-17' },
              ],
              motions: [
                { motionId: 'm1', date: '2026-09-17', name: 'განცხადების რეგისტრაცია', status: 'მიმდინარე', response: 'EMPTY', decisionNumber: null, decision: null },
                // A date cited in the papers that lies after the check: never an issued decision.
                motion('2026-09-18', '7999999', 'APPROVED', 'ვბრძანებ: შეთანხმდეს', { decision: { number: '7999999', outcome: 'APPROVED', evidence: 'ვბრძანებ: შეთანხმდეს', issueDate: '2026-11-03', validUntil: null } }),
              ],
            },
          ],
        },
      },
    ],
  },
});
