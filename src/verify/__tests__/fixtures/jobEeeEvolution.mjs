// Production Verify report for cadastral 01.72.14.040.030.01.01.004
// (research_jobs eeefada9-…, Kristian Stiven St 18, Digomi; read 2026-10-11):
// the TAS case records the project-evolution layer reads, SANITIZED.
//
//   - applicant names, personal numbers (even masked), home addresses, notary
//     and registry application numbers and the company's directors are
//     dropped from every act text; what remains is the city's own wording
//     about the project;
//   - attachment file names are verbatim (they are what the case lists);
//   - CASE_CHRONOLOGY and PENDING are officialHistory as production holds it
//     (logic v5): AR11136621 and AR11143236 still read "pending" there.

const att = (names) => names.map((fileName, i) => ({ attachedFileId: String(900000 + i), fileName }));
const motion = (date, number, outcome, evidence = null, response = 'PDF') => ({ date, decisionNumber: number, response, decision: { number, outcome, evidence, issueDate: null, validUntil: null } });

const HEAD = (ref, registered) => [
  `TAS case ${ref}`,
  `Registered: ${registered}`,
  'Address: ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა, N 18',
];
const BLOCK = (date, issued, ref, filed, result, form, number, nomenclature) => [
  '',
  `[${date} · motion · response]`,
  '',
  `გაცემის თარიღი: ${issued}გაცნობის თარიღი: -`,
  `განცხადების ნომერი: ${ref}`,
  `შემოსვლის თარიღი: ${filed}`,
  `შედეგი: ${result}`,
  'ქალაქ თბილისის მუნიციპალიტეტის არქიტექტურის სამსახური',
  `${form} No ${number}`,
  'საკადასტრო კოდი: 01.72.14.040.030',
  'ფართობი: 1400.0 კვ.მ',
  'ნომენკლატურა :',
  ...nomenclature,
  'დამკვეთი - განმცხადებელი:',
];

export const TEXT_1095988 = [
  ...HEAD('AR11095988', '2025-06-17'),
  ...BLOCK('2025-06-24', '24/06/2025', 'AR11095988', '17/06/2025', 'თანხმობა', 'ბრძანება', '7528083', ['სამართლებრივი საკითხები', 'ცვლილება ადმინისტრაციულ - სამართლებრივ აქტში']),
  '',
  'ბრძანება',
  'ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 3 აპრილის No7437213 ბრძანებაში ცვლილების',
  'შეტანის თაობაზე',
  'სამსახურმა დაადგინა, რომ 2025 წლის 3 აპრილის No7437213 ბრძანებით',
  'შეთანხმდა მრავალბინიანი საცხოვრებელი სახლის კორექტირებული არქიტექტურული პროექტი.',
  'ხოლო, სამსახურის 2025 წლის 30 აპრილის No7463932 ბრძანებით გაიცა მშენებლობის',
  'ნებართვა. მშენებლობის ვადა განისაზღვრა 2025 წლის 30 აპრილიდან 2026 წლის 30',
  'სექტემბრის ჩათვლით, კალენდარული გრაფიკის შესაბამისად.',
  'განმცხადებელი ითხოვს სამსახურის 2025 წლის 3 აპრილის No7437213 ბრძანების ტექნიკურ-',
  'ეკონომიკურ მაჩვენებლებში ცვლილების შეტანას. კერძოდ, მოთხოვნილია საცხოვრებელ',
  'ფართობად 2211.6 კვ.მ-ის ნაცვლად 2235.6 კვ.მ-ის, საზაფხულო ფართობად 500.4 კვ.მ-ის',
  'ნაცვლად 532.2 კვ.მ-ის, საერთო ფართობად 3653.3  კვ.მ-ის ნაცვლად 3709.1 კვ.მ-ის',
  'დაფიქსირება.',
  'შესაბამისად, განმცხადებლის უფლებამოსილება დგინდება.',
  'ვბრძანებ:',
  '1. შევიდეს ცვლილება ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 3 აპრილის No7437213 ბრძანებაში',
  'და ტექნიკურ-ეკონომიკურ მაჩვენებლებში დაფიქსირდეს: საცხოვრებელი ფართობი: 2235.6',
  'კვ.მ-ის, საზაფხულო ფართობი: 532.2 კვ.მ-ის, საერთო ფართობი: 3709.1 კვ.მ.',
  '2. 2025 წლის 3 აპრილის No7437213 ბრძანება დანარჩენ ნაწილში დარჩეს უცვლელი.',
].join('\n');

export const TEXT_1136621 = [
  ...HEAD('AR11136621', '2026-04-01'),
  ...BLOCK('2026-04-02', '02/04/2026', 'AR11136621', '01/04/2026', 'თანხმობა', 'ბრძანება', '7869341', ['სამართლებრივი საკითხები', 'ცვლილება ადმინისტრაციულ - სამართლებრივ აქტში']),
  '',
  'ბრძანება',
  'ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 30 დეკემბრის No7761945 ბრძანებაში',
  'ცვლილების შეტანის თაობაზე',
  'სამსახურმა დაადგინა, რომ 2025 წლის 30 დეკემბრის No7761945',
  'ბრძანებით შეთანხმდა მრავალბინიანი საცხოვრებელი სახლის კორექტირებული არქიტექტურული',
  'პროექტი და გაიცა მშენებლობის ნებართვა.',
  'განმცხადებელი ითხოვს სამსახურის 2025 წლის 30 დეკემბრის No7761945 ბრძანების',
  'ტექნიკურ-ეკონომიკურ მაჩვენებლებში ცვლილების შეტანას. კერძოდ, მოთხოვნილია',
  'საცხოვრებელ ფართობად 2219.6 კვ.მ-ის ნაცვლად 2243.6 კვ.მ-ის, საერთო ფართობად 3652.4',
  'კვ.მ-ის ნაცვლად 3708.2 კვ.მ-ის დაფიქსირება.',
  'სამსახურმა განმცხადებლის მიერ წარმოდგენილი გასწორებული ტექნიკურ–',
  'ეკონომიკური მაჩვენებლები შეადარა შეთანხმებულ გეგმა - ნახაზებს და დაადგინა, რომ',
  'საპროექტო დოკუმენტაციაში არასწორად იქნა წარმოდგენილი ტექნიკურ–ეკონომიკური',
  'მაჩვენებლები ფართობების არასწორი დაჯამების გამო, რაც შემდგომ აისახა სამსახურის',
  'მიერ გამოცემულ ბრძანებაში. სამსახურმა, ასევე დაადგინა, რომ საერთო ფართობი 3708.2',
  'კვ.მ-ის ნაცვლად შეადგენს 3676.4 კვ.მ.',
  'ვბრძანებ:',
  '1. შევიდეს ცვლილება ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 30 დეკემბრის No7761945',
  'ბრძანებაში და ტექნიკურ-ეკონომიკურ მაჩვენებლებში დაფიქსირდეს საცხოვრებელი',
  'ფართობი 2243.6 კვ.მ., საერთო ფართობი 3676.4 კვ.მ.',
  '2. 2025 წლის 30 დეკემბრის No7761945 ბრძანება დანარჩენ ნაწილში დარჩეს უცვლელი.',
].join('\n');

export const TEXT_1143236 = [
  ...HEAD('AR11143236', '2026-05-18'),
  '',
  '[2026-05-20 · motion · response]',
  'DECISION DEFICIENCY N 7924530',
  '',
  'გაცემის თარიღი: 19/05/2026გაცნობის თარიღი: -',
  'განცხადების ნომერი: AR11143236',
  'შემოსვლის თარიღი: 18/05/2026',
  'შედეგი: შუალედური',
  'ბრძანება No 7924530',
  'ნომენკლატურა :',
  'სამართლებრივი საკითხები',
  'ცვლილება ადმინისტრაციულ - სამართლებრივ აქტში',
  'დამკვეთი - განმცხადებელი:',
  '',
  'ბრძანება',
  '2026 წლის 18 მაისის განცხადებასთან დაკავშირებით დამატებით წარმოსადგენი დოკუმენტაციისა და ინფორმაციის განსაზღვრის შესახებ',
  'მოითხოვა სამსახურის 2025 წლის 30 დეკემბრის  No7761945 ბრძანებაში ცვლილების შეტანა.',
  'განმცხადებლის განმარტებით, საზაფხულო ფართობი 500.4 კვ.მ-ის ნაცლად შეადგენს 532.2 კვ.მ-ს,',
  'დამხმარე ფართობი 10.2 კვ.მ-ის ნაცვლად 13.2 კვ.მ-ს., ხოლო საერთო ფართობი 3676.4 კვ.მ-',
  'ის ნაცვლად 3711.2 კვ.მ-ს.',
  'შესაბამისად, არ დგინდება განმცხადებლის',
  'უფლებამოსილება.',
  'ვ ბ რ ძ ა ნ ე ბ:',
  '1. დაევალოს განმცხადებელს 15 (თხუთმეტი) სამუშაო დღის ვადაში წარმოადგინოს უფლებამოსილების დამადასტურებელი დოკუმენტი.',
  '2. ბრძანების პირველი პუნქტის შეუსრულებლობის შემთხვევაში, განცხადება დარჩეს განუხილველი.',
  '',
  '[2026-05-21 · motion · response]',
  '',
  'გაცემის თარიღი: 21/05/2026გაცნობის თარიღი: -',
  'განცხადების ნომერი: AR11143236',
  'შემოსვლის თარიღი: 18/05/2026',
  'შედეგი: თანხმობა',
  'ბრძანება No 7930086',
  'ნომენკლატურა :',
  'სამართლებრივი საკითხები',
  'ცვლილება ადმინისტრაციულ - სამართლებრივ აქტში',
  'დამკვეთი - განმცხადებელი:',
  '',
  'ბრძანება',
  'ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 30 დეკემბრის  No7761945 ბრძანებაში',
  'ცვლილების შეტანის თაობაზე',
  'სამსახურის 2026 წლის 2 აპრილის No7869341 ბრძანებით შევიდა ცვლილება სამსახურის 2025',
  'წლის 30 დეკემბრის No7761945 ბრძანებაში და ტექნიკურ-ეკონომიკურ მაჩვენებლებში საცხოვრებელ ფართობად',
  'დაფიქსირდა 2243.6 კვ.მ., საერთო ფართობად - 3676.4 კვ.მ.',
  'განმცხადებლის განმარტებით, საზაფხულო ფართობი 500.4 კვ.მ-ის ნაცლად შეადგენს 532.2 კვ.მ-ს,',
  'დამხმარე ფართობი 10.2 კვ.მ-ის ნაცვლად 13.2 კვ.მ-ს., ხოლო საერთო ფართობი 3676.4 კვ.მ-',
  'ის ნაცვლად 3711.2 კვ.მ-ს.',
  'სამსახურმა დაადგინა, რომ საპროექტო დოკუმენტაციაში',
  'არასწორად იქნა წარმოდგენილი ტექნიკურ-ეკონომიკურ მაჩვენებლები, ფართობების',
  'არასწორი დაჯამების გამო.',
  'ვ ბ რ ძ ა ნ ე ბ:',
  '1. შეტანილ იქნეს ცვლილება ქ. თბილისის მუნიციპალიტეტის არქიტექტურის სამსახურის 2025 წლის 30 დეკემბრის  No7761945',
  'ბრძანებაში და საზაფხულო ფართობად დაფიქსირდეს - 532.2 კვ.მ., დამხმარე ფართობად -',
  '13.2 კვ.მ-ს., საერთო ფართობად - 3711.2 კვ.მ.',
  '2. 2025 წლის 30 დეკემბრის  No7761945 ბრძანება დანარჩენ ნაწილში დარჩეს უცვლელი.',
].join('\n');

export const TEXT_1110027 = [
  ...HEAD('AR11110027', '2025-09-23'),
  'შენობის K2 კოეფიციენტის საანგარიშო ფართობი (კვ.მ): 2989.2',
  '',
  '[2025-12-19 · motion · response]',
  'DECISION DEFICIENCY N 7675536',
  '',
  'გაცემის თარიღი: 24/10/2025გაცნობის თარიღი: -',
  'შედეგი: შუალედური',
  'გადაწყვეტილება No 7675536',
  'ნომენკლატურა :',
  'მრავალბინიანი საცხოვრებელი სახლი',
  'IV კლასი',
  'შეთანხმებული პროექტის ცვლილება',
  'სტადიები:',
  'პროექტის შეთანხმება',
  'მშენებლობის ნებართვა',
  'დამკვეთი - განმცხადებელი:',
  '',
  '.დადგენილი გაპის ბრძანების ნომერი.: 6607041',
  '.საერთო ფართობი (კვ.მ).: 3652.4',
  '.საცხოვრებელი ფართობი (კვ.მ).: 2219.6',
  '.საზაფხულო ფართობი (კვ.მ).: 500.4',
  '.დამხმარე ფართობი (კვ.მ).: 10.2',
  'გადაწყვეტილება',
  '2. შენობა-ნაგებობის ჭრილები, მასშტაბი 1:100: სწორად მიუთითეთ ღერძების სიმბოლოები და წარმოადგინეთ კორექტირებული',
  'პროექტის შესაბამისი ჭრილები, ცვლილებით გათვალისწინებული არეალების ჩვენებით.',
  '6. დამკვეთად დაფიქსირდეს მიწის ნაკვეთის მესაკუთრე.',
  '•           მიეთითოს ყველა შეცვლილი ფართის წილობრივი საკადასტრო კოდი და არსებობის',
  'შემთხვევაში, წარმოდგენილი იქნას შესაბამისი მესაკუთრის/მომავალი მესაკუთრისა და',
  'იპოთეკარის მიერ გაცემული, სათანადო წესით დამოწმებული თანხმობა.',
].join('\n');

export const TEXT_1078892 = [
  ...HEAD('AR11078892', '2025-02-20'),
  '',
  '[2025-03-14 · motion · response]',
  'DECISION DEFICIENCY N 7394698',
  '',
  'გაცემის თარიღი: 27/02/2025გაცნობის თარიღი: -',
  'შედეგი: შუალედური',
  'გადაწყვეტილება No 7394698',
  'ნომენკლატურა :',
  'მრავალბინიანი საცხოვრებელი სახლი',
  'IV კლასი',
  'შეთანხმებული პროექტის ცვლილება',
  'პროექტის შეთანხმება',
  'დამკვეთი - განმცხადებელი:',
  '',
  '.დადგენილი გაპის ბრძანების ნომერი.: 6607041',
  '.საერთო ფართობი (კვ.მ).: 3653.3',
  '.საცხოვრებელი ფართობი (კვ.მ).: 2211.6',
  'გადაწყვეტილება',
  '5. .კ2 განაშენიანების ინტენსივობის კოეფიციენტის საანგარიშო ფართობი. :   კ2-ში შეყვანილ იქნეს ასევე ყველა სართულზე 6-5 ღერძებში',
  'კორექტირების შედეგად გაჩენილი კედელი.',
  '6. .გეგმების pdf ფაილი.: -კორექტირების შედეგად "5" ღერძთან გაჩენილი ბინის ფართის ნაწილში',
  'გათვალისწინებულ იქნეს ტექნიკური რეგლამენტის მოთხოვნები.',
  '7. .ფასადების  pdf ფაილი.:   7-1 ფასადი მოვიდეს გეგმბთან შესაბამისობაში.',
].join('\n');

/* The raw research result: every case with its files and steps, and the texts above. */
export function rawResultEee() {
  const cases = [
    { documentId: '79674', registrationNumber: 'AR179674', date: '2012-09-12T06:15:10.000Z', attachments: att(['arsebulii pdf.pdf', 'montaji pdf.pdf', 'diRomi.TIF']), motions: [motion('2012-09-17T13:10:37.000Z', '354387', 'UNDETERMINED')] },
    { documentId: '81025', registrationNumber: 'AR181025', date: '2012-09-18T20:58:21.000Z', attachments: att(['arsebulii pdf.pdf', 'montajii.pdf']), motions: [motion('2012-09-24T14:24:42.000Z', '363643', 'UNDETERMINED')] },
    { documentId: '86169', registrationNumber: 'AR186169', date: '2012-10-12T09:44:57.000Z', attachments: att(['suratebi didi digomi.pdf', 'sz-5 regul. xazi..pdf']), motions: [motion('2012-10-15T14:12:38.000Z', '390703', 'INFORMATIONAL')] },
    { documentId: '95157', registrationNumber: 'AR195157', date: '2012-12-04T11:47:38.000Z', attachments: att(['posi zura.pdf', 'foto.pdf', 'gegmebi z.pdf', 'jrilebi z.pdf', 'fasadebi z.pdf', 'simaglis ganmsazgvreli z.pdf', 'gengegmaz.pdf', 'fotomontaji da aqsiometriuli xedebi.pdf']),
      motions: [motion('2012-12-13T14:29:32.000Z', '470093', 'PERMIT_ISSUED', 'N 01.72.14.040.030) ინდივიდუალური საცხოვრებელი სახლის არქიტექტურული პროექტი. 2. გაიცეს მშენებლობის ნებართვა და სანებართვო მოწმობა. 3. მშენებლობის ვადა განისაზღვროს 2013 წლის 01 იანვრიდან 2014 წლის 01 იანვრამდე')] },
    { documentId: '137104', registrationNumber: 'AR1137104', date: '2013-06-07T08:57:51.000Z', attachments: att(['gen-gegma.pdf', 'gegmebi.pdf', 'wrilebi.pdf', 'fasadebi.pdf', 'arsebuli.pdf']), motions: [motion('2013-06-18T16:40:54.000Z', '747739', 'INFORMATIONAL')] },
    { documentId: '144566', registrationNumber: 'AR1144566', date: '2013-07-06T13:51:57.000Z', attachments: att(['Masterplan.pdf', 'Plans.pdf', 'Section.pdf', 'Facade.pdf', 'Render.pdf', 'photo.pdf']),
      motions: [motion('2013-07-17T11:33:19.000Z', '780001', 'DEFICIENCY', '. ვინაიდან საპროექტო შენობა განთავსებულია რეგულირების ხაზის დარღვევით გიხარვეზებთ მთლიან საპროექტო დოკუმენტაციას.')] },
    { documentId: '980594', registrationNumber: 'AR1980594', date: '2023-07-26T11:16:20.000Z', attachments: att(['ფოტო.pdf', 'ტოპო-ტოპო სკანირებული.pdf', 'კვლევა.pdf', 'შენობის განთავსება.pdf']),
      motions: [motion('2023-08-10T08:54:38.000Z', '6607041', 'APPROVED', 'ბრძანება 1. დაკმაყოფილდეს 2023 წლის 26 ივლისის განცხადება და დამტკიცდეს თანდართული მიწის ნაკვეთის სამშენებლ')] },
    { documentId: '1014318', registrationNumber: 'AR11014318', date: '2024-02-07T17:28:34.000Z', attachments: att(['არსებული ფოტოები.pdf', 'გენგეგმა +ტოპო.pdf', 'გეგმები07.02.pdf', 'ჭრილები 07.02.pdf', 'ფასადები 07.02.pdf', 'fotomontaji.pdf']),
      motions: [motion('2024-02-13T15:17:44.000Z', '6900001', 'DEFICIENCY', 'წარმოდგენილ იქნას საპროექტო ობიექტის კონსტრუქციული სქემა')] },
    { documentId: '1022993', registrationNumber: 'AR11022993', date: '2024-03-12T13:49:06.000Z',
      attachments: att(['ფოტოები.pdf', 'მონტაჟი.pdf', 'გენგეგმა ტოპო.pdf', 'გეგმები 12.03.pdf', 'ჭრილები 12.03.pdf', 'ფასადები 12.03.pdf', 'ჭრილები 30.04.pdf', 'ფასადები 30.04.pdf', 'სიმაღლის სქემა 30.04.pdf', 'ფასადები 27,05.pdf', 'ფასადები 31.05.pdf', 'ფასადები 03,06.pdf', 'ფასადები 06,06.pdf', 'გეგმები+ცხრილები 03.07.pdf', 'დასკვნა მომიჯნავე მიწის ნაკვეთებზე შვიდ სართულიანი მრავაბინიანი საცხოვრებელი სახლი-signed.pdf']),
      motions: [motion('2024-07-29T14:17:03.000Z', '7154564', 'APPROVED', 'ბრძანება შეთანხმდეს: ქ. თბილისში, სოფელი დიღომი, კრისტიან სტივენის ქუჩა N18-ში, კერძო საკუთრებაში არსებულ მიწის ნაკვეთ')] },
    { documentId: '1051702', registrationNumber: 'AR11051702', date: '2024-08-05T14:00:53.000Z', attachments: att(['მოპი 02-06.pdf', 'ფოტო 05-08.pdf', 'დემონტაჟის ორგანიაზციის პროექტის ექსპერტიზა კრისტიან სტივენის ქუჩა 18-signed.pdf', 'პოსი 22-08.pdf']),
      motions: [motion('2024-09-02T14:03:45.000Z', '7200272', 'PERMIT_ISSUED', '0.030) იმრავალბინიანი საცხოვრებელი სახლის არქიტექტურული პროექტის საფუძველზე. 2. გაიცეს მშენებლობის ნებართვა და გაცემულად ჩაითვალოს მშენებლობის სანებართვო მოწმობა. 3. მშენებლობის ვადა განისაზღვროს 2024')] },
    { documentId: '1059939', registrationNumber: 'AR11059939', date: '2024-09-30T16:02:46.000Z', attachments: att(['პოსი 30-09-2024_merged.pdf', 'ფოტო 05-08.pdf']), motions: [motion('2024-10-08T14:12:22.000Z', '7240001', 'DEFICIENCY', 'არასრულყოფილი დოკუმენტაციის გამო')] },
    { documentId: '1078892', registrationNumber: 'AR11078892', date: '2025-02-20T13:50:41.000Z',
      attachments: att(['gengegma.pdf', 'ჭრილები 20.02.pdf', 'ფასადები 20.02.pdf', 'სიმაღლის სქემა 20.02.pdf', 'SeTanxmebuli monraJi.pdf', 'გეგმები+ ცხრილები.pdf', 'ფასადები 14,03.pdf', 'ფოტომონტაჟი.pdf', 'ფასადები 23.03.pdf', '23,03 კრისტიან სტივენის ქ18 კორექტირება.pla', 'ფასადები 27.03.pdf', 'gemgebi 27.03.pdf', 'ჭრილები 02,04.pdf']),
      motions: [motion('2025-03-14T13:58:46.000Z', '7394698', 'DEFICIENCY', 'ზების სქემა'), motion('2025-04-03T15:14:43.000Z', '7437213', 'APPROVED', 'ბრძანება შეთანხმდეს ქ. თბილისში, სოფელი დიღომი, კრისტიან სტივენის ქუჩა, N18-ში')] },
    { documentId: '1087185', registrationNumber: 'AR11087185', date: '2025-04-14T07:01:57.000Z', attachments: att(['ფოტო 14-04-2025.pdf', 'ეტაპები.pdf', 'პოსი 28-04-2025_merged.pdf']),
      motions: [motion('2025-04-28T11:49:32.000Z', '7460001', 'DEFICIENCY', 'კორექტირებული პროექტის მშენებლობის ორგანიზების კალენდარული გრაფიკი'), motion('2025-04-30T15:16:05.000Z', '7463932', 'PERMIT_ISSUED', 'ს საფუძველზე მშენებლობის ნებართვა და გაცემულად ჩაითვალოს სანებართვო მოწმობა. 2. გაიცეს მშენებლობის ნებართვა და გაცემულად ჩაითვალოს მშენებლობის სანებართვო მოწმობა. 3. მშენებლობის ვადა განისაზღვროს 2025')] },
    { documentId: '1095988', registrationNumber: 'AR11095988', date: '2025-06-17T07:45:21.000Z', attachments: [], motions: [motion('2025-06-24T14:00:16.000Z', '7528083', 'UNDETERMINED')] },
    { documentId: '1110027', registrationNumber: 'AR11110027', date: '2025-09-23T19:30:54.000Z',
      attachments: att(['გენგემა+14.03.dwg', 'ჭრილები.pdf', 'ფასადები.pdf', 'სიმაღლე.pdf', 'ფოტომონტაჟი.pdf', 'arsebuli situacia 23.09.pdf', 'გემგები+ცხრილები 23.09.pdf', 'ჭრილები18,12.pdf', 'გეგმები 18.12.pdf', 'ფასადები 18,12.pdf', 'გეგმები +ცხრილები 27,12.pdf', 'ფასადები 27,12.pdf']),
      motions: [motion('2025-12-19T08:43:02.000Z', '7675536', 'DEFICIENCY', 'წარმოადგინეთ შეთანხმებული გამწვანების პროექტი.'), motion('2025-12-30T17:53:40.000Z', '7761945', 'APPROVED', 'ბრძანება 1.შეთანხმდეს ქ. თბილისში, სოფელი დიღომი, კრისტიან სტივენის ქუჩა, N 18, კერძო საკუთრებაში არსებულ მიწის ნაკვეთზე')] },
    { documentId: '1136621', registrationNumber: 'AR11136621', date: '2026-04-01T14:03:58.000Z', priority: 2, attachments: [], motions: [motion('2026-04-02T13:44:42.000Z', '7869341', 'UNDETERMINED')] },
    { documentId: '1143236', registrationNumber: 'AR11143236', date: '2026-05-18T09:16:17.000Z', priority: 1, attachments: att(['mind guk.pdf']),
      motions: [motion('2026-05-20T11:18:19.000Z', '7924530', 'DEFICIENCY', 'ან ერთი თვის ვადაში. განცხადება დარჩება განუხილველი.'), motion('2026-05-21T10:22:11.000Z', '7930086', 'UNDETERMINED')] },
  ];
  const doc = (id, text) => ({ tasDocumentId: id, rawText: text, title: `TAS ${id}` });
  return {
    browserOfficial: {
      results: [{
        source: 'tas',
        tasApi: { cases },
        documents: [doc('1095988', TEXT_1095988), doc('1136621', TEXT_1136621), doc('1143236', TEXT_1143236), doc('1110027', TEXT_1110027), doc('1078892', TEXT_1078892)],
      }],
    },
  };
}

const d = (date, number, outcome, effect, term = null) => ({ date, term, effect, number, outcome, dateBasis: 'RESPONSE_PUBLISHED', publishedOn: date, correctedProject: false });
const row = (caseRef, filedOn, stage, effect, decisions = [], extra = {}) => ({
  scope: 'PARENT_PARCEL', stage, effect, caseRef, filedOn, metrics: [], deadline: null, decisions,
  parcelCodes: ['01.72.14.040.030'], lastActivityOn: filedOn, unreadResponses: [], supersedesPermit: null, deficiencyNotices: 0, ...extra,
});

/* officialHistory.caseChronology exactly as production holds it (logic v5). */
export const CASE_CHRONOLOGY = [
  row('AR179674', '2012-09-12', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '354387', publishedOn: '2012-09-17' }] }),
  row('AR181025', '2012-09-18', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '363643', publishedOn: '2012-09-24' }] }),
  row('AR186169', '2012-10-12', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '390703', publishedOn: '2012-10-15' }] }),
  row('AR195157', '2012-12-04', 'DECIDED', 'PERMIT', [d('2012-12-13', '470093', 'PERMIT_ISSUED', 'PERMIT', { from: '2013-01-01', until: '2014-01-01' })]),
  row('AR1137104', '2013-06-07', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '747739', publishedOn: '2013-06-18' }] }),
  row('AR1144566', '2013-07-06', 'UNDER_REVIEW', null, [], { deficiencyNotices: 1 }),
  row('AR1980594', '2023-07-26', 'DECIDED', 'PROJECT_APPROVED', [d('2023-08-10', '6607041', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 1 }),
  row('AR11014318', '2024-02-07', 'UNDER_REVIEW', null, [], { deficiencyNotices: 1 }),
  row('AR11022993', '2024-03-12', 'DECIDED', 'PROJECT_APPROVED', [d('2024-07-29', '7154564', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 7 }),
  row('AR11051702', '2024-08-05', 'DECIDED', 'PERMIT', [d('2024-09-02', '7200272', 'PERMIT_ISSUED', 'PERMIT', { from: '2024-09-02', until: null })], { supersedesPermit: { date: '2012-12-13', caseRef: 'AR195157', decisionNumber: '470093' }, deficiencyNotices: 4 }),
  row('AR11059939', '2024-09-30', 'UNDER_REVIEW', null, [], { deficiencyNotices: 1 }),
  row('AR11078892', '2025-02-20', 'DECIDED', 'PROJECT_APPROVED', [d('2025-04-03', '7437213', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 4 }),
  row('AR11087185', '2025-04-14', 'DECIDED', 'PERMIT', [d('2025-04-30', '7463932', 'PERMIT_ISSUED', 'PERMIT', { from: '2025-04-30', until: null })], { supersedesPermit: { date: '2024-09-02', caseRef: 'AR11051702', decisionNumber: '7200272' }, deficiencyNotices: 3 }),
  row('AR11095988', '2025-06-17', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '7528083', publishedOn: '2025-06-24' }] }),
  row('AR11110027', '2025-09-23', 'DECIDED', 'PROJECT_APPROVED', [d('2025-12-30', '7761945', 'APPROVED', 'PROJECT_APPROVED')], { deficiencyNotices: 2 }),
  row('AR11136621', '2026-04-01', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '7869341', publishedOn: '2026-04-02' }] }),
  row('AR11143236', '2026-05-18', 'RESPONSE_UNREAD', null, [], { unreadResponses: [{ number: '7930086', publishedOn: '2026-05-21' }], deficiencyNotices: 1 }),
];

export const PENDING = [
  { date: '2026-05-18', stage: 'RESPONSE_UNREAD', status: 'UNDER_REVIEW', caseRef: 'AR11143236', subject: null, deadline: null, applicant: null, statusText: null, lastResponse: { number: '7930086', publishedOn: '2026-05-21' } },
  { date: '2026-04-01', stage: 'RESPONSE_UNREAD', status: 'UNDER_REVIEW', caseRef: 'AR11136621', subject: null, deadline: null, applicant: null, statusText: null, lastResponse: { number: '7869341', publishedOn: '2026-04-02' } },
];

/* officialHistory.status as production holds it: validUntil is the 2012 permit's term. */
export const STATUS = { since: '2025-04-30', state: 'PERMITTED', caseRef: 'AR11087185', caveats: ['LATER_UNDETERMINED_DECISION', 'PROCESSING_INCOMPLETE', 'VALIDITY_PASSED'], conclusive: false, validUntil: '2014-01-01', pendingCount: 1, decisionNumber: '7463932' };

export const HISTORY_EEE = {
  status: STATUS, caseChronology: CASE_CHRONOLOGY, pendingApplications: PENDING, legal: [], milestones: [], milestoneGroups: [],
  currentPosition: { pending: PENDING, effective: { date: '2025-04-30', state: 'PERMITTED', caseRef: 'AR11087185', outcome: 'PERMIT_ISSUED', validUntil: '2014-01-01', decisionNumber: '7463932' } },
};

/* unitLegalPosition / unitIdentity / companyFinance, owner replaced by a placeholder. */
export const OWNER = 'გ. ბ.';
export const UNIT_LEGAL_POSITION = {
  scope: 'EXACT_UNIT',
  evidence: { source: 'NAPR_EXTRACT', extractIssuedAt: '2026-06-22T11:58:07', proceedingsObservedAt: '2026-10-11T14:21:20.232Z' },
  mortgages: {
    asOf: '2026-06-22T11:58:07',
    state: 'NONE_REGISTERED',
    history: [{
      scope: 'EXACT_UNIT', lifecycle: 'CANCELLATION_REGISTERED', registeredOn: '2024-12-18', creditor: 'სააქციო საზოგადოება "კრედო ბანკი"',
      steps: [{ date: '2024-12-18', step: 'MORTGAGE_REGISTERED' }, { date: '2026-06-16', step: 'TERMINATION_APPLIED' }, { date: '2026-06-22', step: 'CANCELLATION_REGISTERED' }],
    }],
  },
  ownership: { asOf: '2026-06-22T11:58:07', basis: 'PURCHASE', owners: [{ kind: 'PERSON', name: OWNER }], registeredOn: '2026-06-15' },
  ownershipHistory: [
    { basis: 'OTHER', owners: [{ kind: 'COMPANY', name: 'შპს ჯეო სითი დიღომი' }], registeredOn: '2025-10-22', seenInExtractOf: '2025-10-22T12:32:14' },
    { basis: 'PURCHASE', owners: [{ kind: 'PERSON', name: OWNER }], registeredOn: '2026-06-15', seenInExtractOf: '2026-06-15T11:12:41' },
  ],
  notCovered: ['COMPANY_OBLIGATIONS', 'PROJECT_FINANCING', 'PARENT_PARCEL_ENCUMBRANCES'],
  restrictions: { asOf: '2026-06-22T11:58:07', seizure: 'NONE', taxLien: 'NONE', debtorRegistry: 'NONE' },
  cadastralCode: '01.72.14.040.030.01.01.004',
  openProceedings: [],
};
export const UNIT_IDENTITY = {
  project: { name: 'Kristian Stiven Street, 18', source: 'RESEARCH_IDENTITY', developer: 'შპს „ჯეო სითი დიღომი“' },
  building: { block: null, scope: 'BUILDING', source: 'CADASTRAL_CODE', groupCode: '01' },
  exactUnit: { code: '01.72.14.040.030.01.01.004', basis: 'NAPR_EXTRACT', block: null, floor: '2', scope: 'EXACT_UNIT', areaSqm: null, verified: true, apartment: '4', observedAt: '2026-10-11T14:21:20.232Z', evidenceDate: '2026-06-22T11:58:07', registeredAddress: 'ქალაქი თბილისი, სოფელი დიღომი, კრისტიან სტივენის ქუჩა, N 18, სართული2,ბინა N4', underConstruction: true },
  parentParcel: { code: '01.72.14.040.030', scope: 'PARENT_PARCEL', source: 'NAPR_EXTRACT', landAreaSqm: 1400, landFunction: 'არასასოფლო სამეურნეო' },
};
export const COMPANY_FINANCE = { pledges: [], companyName: 'შპს ჯეო სითი დიღომი', debtorRegistry: { state: 'NO_ENTRY', checkedOn: '2026-10-11' }, financingPartner: null, registryExtractDate: '2026-10-06', liquidationRegistered: false };
