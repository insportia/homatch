// TAS case texts behind the production Verify report for cadastral
// 01.18.06.019.055.03.01.601 (research_jobs 8ba97da9-…, read 2026-10-11),
// as the official worker stored them: SANITIZED EXCERPTS.
//
//   - the lines are copied from the stored case texts (verify_tasks source
//     'tas', documents[].rawText) — drawing title blocks and two reports are
//     in AcadNusx (Georgian typed in a Latin-keyed font) exactly as extracted;
//   - the private former landowner is replaced by a placeholder
//     ("ნინო ბერიძე"), the masked personal-ID fragment by "•••000", and one
//     company director by a placeholder ("ზურაბ მაისურაძე");
//   - CVs keep only their headings and qualification lines: no birth dates,
//     addresses, phones, e-mails or personal ID numbers remain;
//   - long drawing sheets are cut to their title blocks; the test pads the
//     newest case's text with drawing-number lines so its expert report sits
//     where it really does (line ~15 400 of ~27 000).
//
// What the texts establish (and what they do not) is listed in the test.

export const CASE_1161121 = 'AR11161121';
export const TAS = (id) => `https://docs.tbilisi.gov.ge/architect/public.html?docId=${id}`;

/* ── AR11161121: drawing title blocks (AcadNusx) ── */
const TITLE_BLOCK = (sheet) => [
  sheet,
  'proeqtis',
  'saxelwodeba',
  'mravalbiniani ',
  'sacxovrebeli ',
  'kompleqsi',
  'misamarTi',
  'proeqtis avtori',
  'arqiteqtori',
  'darejan SaTaSvili',
  'Tbilisi 2023 w.',
  'SeniSvna:',
  '1. იატაკის ზედაპირები მოეწყობა ისე, რომ ',
  'იქნება მდგრადი, მყარი და არასრიალა.',
  'zomebi ',
  'mocemulia ',
  'milimetrebSi',
  'q. Tbilisi. quCa ',
  'krwanisi, #6;',
  's/k 01.18.06.019.055',
  'daviT sordia',
  'dakavebulobis ',
  'jgufis aRniSvna',
  'rezervuari',
  'satumbi sivrce',
  '-6.20 arqiteqturuli niSnuli',
  'sam saaTiani cecxlmedegobis ',
  'xarisxiani kedeli',
  'giorgi leJava',
];

const GENPLAN = ['[undated · გენგეგმა.pdf]', 'GSPublisherVersion 0.0.100.100', ...TITLE_BLOCK('gen-gegma')];
const PLANS = ['[undated · გეგმები 16,09,2026.pdf]', 'GSPublisherVersion 0.0.100.100', ...TITLE_BLOCK('A bloki'), '+3.25 arqiteqturuli niSnuli', ...TITLE_BLOCK('C bloki'), ...TITLE_BLOCK('gegma +6.50 niSnulze')];

/* ── AR11161121: the adjacent-building file is a scan; its OCR is noise ── */
const ADJACENT = ['[undated · momijnave.pdf]', ',,.\'.,,\'Eksel, ', 'b.:gt,rq3drilhgrq\'n ', 'Jt4r\'rXjgolr '];

/* ── AR11161121: the building-safety expert report (Georgian script) ── */
const SAFETY_EXPERTISE = [
  '[undated · კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf]',
  's a e q s p e r t o  d a s k v n a ',
  'ქ. თბილისში, ქუჩა კრწანისის N6  ( ს/კ01.18.06.019.055) დაპროექტებული ',
  'მრავალბინიანი საცხოვრებელი სახლი არქიტექტურული პროექტის „ტექნიკური ',
  'რეგლამენტის – შენობა-ნაგებობის უსაფრთხოების წესების დამტკიცების თაობაზე“ ',
  'საქართველოს მთავრობის 2016 წლის 28 იანვრის No41  და  2017 წლის 20 ნოემბრის No ',
  '498  დადგენილებების მოთხოვნებთან შესაბამისობის დადგენის მიზნით ',
  ' ',
  'პროექტის მთავარი არქიტექტორი:       დარეჯან შათაშვილი, დავით სორდია. ',
  ' ',
  'ექსპერტი:       ვასილ ტატიაშვილი ',
  'T b i l i s i ',
  '2 0 2 5 ',
  'კორექტირება ',
  'პროექტში შესული ცვლილებები არ ახდენს ზეგავლენას ტექნიკური რეგლამენტის 41 ',
  'დადგენილების შესაბამისობის საექსპერტო შეფასებაზე ',
  'კ) ხანძრისაგანდაცვისსისტემებისშეფასებას; ',
  'გამოყენებული წესები – „შენობა-ნაგებობის უსაფრთხოების წესები“',
  '- ელექტროენერგიაზე მომუშავე სახანძრო ტუმბოები (საქაჩები). ',
  'ექსპერტი:                                               ვასილ ტატიაშვილი ',
  'გამოყენებული (კანონმდებლობა, რეგლამენტები, წესები, სტანდარტები.......) ',
  'ვასილ ',
  'ტატიაშვილი ',
  'დაბადების ',
  'თარიღი: ',
  'ეროვნება: ქართველი ',
  'განათლება: ',
  '2009- 2013 : ბაკალავრის ხარისხი: არქიტექტორი . საქართველოს ტექნიკური ',
];

/* ── AR11161121: construction-organisation project (AcadNusx) ── */
const CONSTRUCTION_ORG = [
  '[undated · მოპი სატრანსპორტო ღობე.pdf]',
  'Sinaarsi ',
  'a/ --',
  'ganmartebiTi  baraTi; ',
  'b/ --',
  'kalendaruli gegma; ',
  'g/ --',
  'grafikuli nawili: naxazi mo-1, mo-2 ',
  '                                   a/ ganmartebiTi    baraTi ',
  '1.     mSeneblobis organizaciis proeqti damuSavebulia СниП 3.01.01-85  Tanaxmad da “saqarTvelos mTavrobis ',
  'Senoba-nagebobis saZirkvlis mowyobis samuSaoebi',
  'ZiriTadi konstruqciuli sistemis mowyoba',
  'SeniSvnebi:    1.  mSeneblobis gansazRvruli vadis aTvla ganxorcieldeba mSeneblobis nebarTvis aRebis Semdg.',
  'daamuSava:                    / b. gogolauri /',
];

/* ── AR11161121: expert assessment of the geological survey (AcadNusx) ── */
const GEOLOGY = [
  '[undated · გეოლ ექსპერტიზა.pdf]',
  'saeqsperto Sefaseba ',
  'angariSze: `q. TbilisSi, krwanisis q. #6 (s/k 01.18.06.019.055), mravalbiniani ',
  'sacxovrebeli saxlis mSeneblobisaTvis gamoyofil  ',
  'ubanze Catarebuli sainJinro- geologiuri  ',
  'kvlevis Sedegebi” ',
  'sainJinro-geologiuri   samuSaoebi   Sesrulebulia   Sps `geoinJ-',
  'kompleqsi”-s geologiuri jgufis  mier, 2022 wlis mais-ivnisSi. samuSaoebis ',
  'uSualo xelmZRvaneli inJiner-geologi a. pasikaSvili. maT mier vizualurad ',
  'sainJinro-geologiur nawilSi. ',
  'geologia-mineralogiis akademiuri doqtori,  ',
  'saqarTvelos sainJinro akademiis wevr- ',
  'korespondenti,profesori:                                   /ia mSvidobaZe/                           ',
  'CV - მშვიდობაძე ია ',
  '1984 წელს დავამთავრე საქართველოს პოლიტექნიკური ინსტიტუტი, ინჟინერ-მშენებლის სპეციალობით; ',
  '"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან შპს "რეალექსპერტი"-ს ექსპერტი გეოლოგიის დარგში. ',
  // The same PDF continues with the engineering parts' title pages and sheets.
  'თბილისი 2023 წელი',
  'შემსრულებელი კომპანია "ჯეტექს სოლუშენს"',
  'დამკვეთი   კომპანია   შპს  „ლევან ჩაჩუა “',
  'საპროექტო ობიექტი:',
  'მრავალბინიანი საცხოვრებელი სახლი',
  'საინინრო ნაწილი:',
  'გაზმომარაგების   პროექტი',
  'ობიექტის   მისამართი:',
  'ობიექტის მისამართი:',
  'დირექტორი',
  'მასშტაბი:',
  'თანამდედობა',
  'თარიი:',
  'ინჟინერი',
  'დამკვეთი',
  'ფურელი:',
  'დაამუშავა',
  'ხელმოწერაგვარი',
  'არქიტექტორი',
  'შ',
  '.პ.ს',
  'ფორმატი a3',
  'ი. ჯიშკარიანი',
  'ლევან ჩაჩუა',
  'გ.ზუმბაძე',
  'თბილისი 2023 წელი',
  'შემსრულებელი კომპანია "ჯეტექს სოლუშენს"',
  'დამკვეთი   კომპანია   შპს  „ლევან ჩაჩუა “',
  'საპროექტო ობიექტი:',
  'მრავალბინიანი საცხოვრებელი სახლი',
  'საინინრო ნაწილი:',
  'გათბობა-ვენტილაციის  პროექტი',
  'თბილისი 2023 წელი',
  'შემსრულებელი კომპანია "ჯეტექს სოლუშენს"',
  'საპროექტო ობიექტი:',
  'მრავალბინიანი საცხოვრებელი სახლი',
  'საინინრო ნაწილი:',
  'ელექტრობის პროექტი',
];

/** The newest case's text; `pad` drawing-number lines sit before the reports, as in production. */
export function text1161121(pad = 12000) {
  const head = [
    'TAS case AR11161121',
    'Registered: 2026-09-17',
    'Address: ქალაქი თბილისი , ქუჩა კრწანისი , N 6',
    'APPLICANT: ლევან ჩაჩუა',
    'შენობის სიმაღლე (მ): 22.75',
  ];
  const filler = Array.from({ length: pad }, (_, i) => (i % 3 === 0 ? `+${(i % 27).toFixed(2)}` : `${390 + (i % 17)}.${i % 100}`));
  return [...head, ...GENPLAN, ...filler, ...PLANS, ...ADJACENT, ...SAFETY_EXPERTISE, ...CONSTRUCTION_ORG, ...GEOLOGY].join('\n');
}

/* ── AR11026464: the order that changed the client (2024) ── */
const TEXT_1026464 = [
  'TAS case AR11026464',
  'Registered: 2024-03-28',
  'APPLICANT: გიორგი ლეჟავა',
  '',
  '[2024-04-19 · motion · response]',
  'ქ. თბილისის მუნიციპალიტეტის სსიპ – ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახური',
  'მესაკუთრე(ები): შპს ქეი-ელ-გრუპი (404670272)',
  'სახლის არქიტექტურული პროექტის საფუძველზე გაიცა მშენებლობის ნებართვა.',
  'კალენდარული გრაფიკის შესაბამისად. აღნიშნულ ბრძანებაში დამკვეთად დაფიქსირდა',
  'ნინო ბერიძე  (პ/ნ: •••000).',
  'მოთხოვნილია სამსახურის 2023 წლის 30 ოქტომბრის No6732848 ბრძანებაში ცვლილების',
  'შეტანა და დამკვეთად ნინო ბერიძის (პ/ნ: •••000) ნაცვლად - შპს „ქეი-ელ-გრუპი“-',
  'ის (ს/ნ: 404670272) დაფიქსირება.',
  'შპს „ქეი-ელ-გრუპი“-ის (ს/ნ: 404670272)',
  'ხელმძღვანელობა/წარმომადგენლობაზე უფლებამოსილ პირებს წარმოადგენენ ზურაბ',
  'მაისურაძე (ერთობლივი) და ლევან ჩაჩუა (ერთობლივი)',
  'ბრძანებაში და დამკვეთად ნინო ბერიძის (პ/ნ: •••000) ნაცვლად დაფიქსირდეს შპს',
  '„ქეი-ელ-გრუპი“ (ს/ნ: 404670272).',
].join('\n');

/* ── AR11084312: the permit form, as the motion response prints it (2025) ── */
const TEXT_1084312 = [
  'TAS case AR11084312',
  'Registered: 2025-04-03',
  '',
  '[2025-04-20 · motion · response]',
  '.მთავარი არქიტექტორის/სპეციალისტი სახელი და გვარი.: დარეჯან შათაშვილი',
  '.ორგანიზაცია (არესბობის შემთხვევაში).: შ.პ.ს. "არტიტექსი"',
  '.დამკვეთის ინფორმაცია.:',
  '.დამკვეთ(ებ)ის სახელი და გვარი.: ლევან ჩაჩუა',
  'მრავალბინიანი საცხოვრებელი სახლი – საპროექტო ობიექტი',
].join('\n');

const ATTACHMENTS_1161121 = [
  ['გენგეგმა.pdf', '5418975'], ['გეგმები 16,09,2026.pdf', '5418979'], ['momijnave.pdf', '5418986'],
  ['კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf', '5418990'],
  ['მოპი სატრანსპორტო ღობე.pdf', '5418992'], ['გეოლ ექსპერტიზა.pdf', '5418993'],
  ['საექსპერტო დასკვნები.pdf', '5418994'],
].map(([fileName, attachedFileId]) => ({ fileName, attachedFileId, format: 'pdf', outcome: 'READ_TEXT' }));

/** The report shape readCaseSources() reads (browserOfficial.results[source=tas]). */
export function job601Report({ pad = 12000 } = {}) {
  const party = (name) => [{ kind: 'PERSON', name, role: 'APPLICANT', organizationId: null }];
  return {
    browserOfficial: {
      results: [{
        source: 'tas',
        tasApi: {
          cases: [
            { documentId: '1161121', registrationNumber: 'AR11161121', date: '2026-09-17T13:28:22.000Z', priority: 1, parties: party('ლევან ჩაჩუა'), values: [], form: { fields: [], status: 'NOT_AVAILABLE' }, attachments: ATTACHMENTS_1161121, motions: [] },
            { documentId: '1148112', registrationNumber: 'AR11148112', date: '2026-06-17T09:58:38.000Z', priority: 2, parties: party('ლევან ჩაჩუა'), values: [], form: { fields: [], status: 'NOT_AVAILABLE' }, attachments: [{ fileName: 'სწორი გეგმები.pdf', attachedFileId: '5317502' }], motions: [] },
            { documentId: '1084312', registrationNumber: 'AR11084312', date: '2025-04-03T11:53:37.000Z', parties: party('ლევან ჩაჩუა'), values: [], attachments: [], motions: [] },
            { documentId: '1026464', registrationNumber: 'AR11026464', date: '2024-03-28T12:52:13.000Z', parties: party('გიორგი ლეჟავა'), values: [], attachments: [], motions: [] },
          ],
        },
        documents: [
          { tasDocumentId: '1161121', title: 'TAS 1161121', url: TAS('1161121'), documentDate: '2026-09-17T13:28:22.000Z', rawText: text1161121(pad), textTruncated: true },
          { tasDocumentId: '1148112', title: 'TAS 1148112', url: TAS('1148112'), documentDate: '2026-06-17T09:58:38.000Z', rawText: '', textTruncated: true },
          { tasDocumentId: '1084312', title: 'TAS 1084312', url: TAS('1084312'), documentDate: '2025-04-03T11:53:37.000Z', rawText: TEXT_1084312, textTruncated: true },
          { tasDocumentId: '1026464', title: 'TAS 1026464', url: TAS('1026464'), documentDate: '2024-03-28T12:52:13.000Z', rawText: TEXT_1026464, textTruncated: true },
        ],
      }],
    },
  };
}
