/*
 * A REDACTED reconstruction of the Service 176 payload for the c80f7237
 * regression (01.18.06.019.055.03.01.503). Structure, dates, registry numbers,
 * creditor and wording follow the real documents; the private owner's name and
 * personal number, and the bank representatives, are replaced by placeholders.
 *
 * Extract PDFs arrive in the legacy 8-bit Georgian font encoding, so the
 * extract bodies are written in Unicode here and encoded with toLegacy() — the
 * parser must see exactly what production sees.
 */
const ALPHABET = 'აბგდევზჱთიკლმნჲოპჟრსტჳუფქღყშჩცძწჭხჴჯჰჵ';
export const toLegacy = (s) => [...s].map((ch) => {
  const i = ALPHABET.indexOf(ch);
  return i >= 0 ? String.fromCharCode(0xc0 + i) : ch;
}).join('');

export const CODE = '01.18.06.019.055.03.01.503';
const OWNER_LINE = 'სატესტო მესაკუთრე ,P/N: 00000000000';

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
011806019/05503/01/503
მისამართი: ქალაქი თბილისი , ქუჩა კრწანისი , N 6
ნაკვეთის საკუთრების ტიპი: თანასაკუთრება
ნაკვეთის ფუნქცია: არასასოფლო სამეურნეო
დაზუსტებული ფართობი:2145.00 კვ.მ.
ნაკვეთის წინა ნომერი: 19;
შენობა-ნაგებობები: N1 (მშენებარე), N2 (მშენებარე) და
N3(მშენებარე)-საერთო ფართობი 6946.6 კვ.მ.
მესაკუთრეები
განცხადების რეგისტრაცია : ნომერი 882026429021 , თარიღი 20/05/2026 14:05:21
უფლების რეგისტრაცია: თარიღი  27/05/2026
უფლების დამადასტურებელი დოკუმენტი:
ხელშეკრულება უძრავი ქონების ნასყიდობის შესახებ , დამოწმების თარიღი:20/05/2026 , საქართველოს იუსტიციის
სამინისტროს საჯარო რეესტრის ეროვნული სააგენტო
მესაკუთრეები:
${OWNER_LINE}
მესაკუთრე:
საკუთრების
ტიპი:
საკუთრება:ფართი:წილი:
სატესტო მესაკუთრესაკუთრებაფართი(მშენებარე)სართული5,ბინა
N503,ბლოკი "ც"
83.20
კვ.მ.
იპოთეკა
`;
const FOOTER = 'საჯარორეესტრისეროვნულისააგენტო.http://public.reestri.gov.geგვერდი:1(2)\n\n';
const M2024 = `1)  განცხადების
რეგისტრაცია
ნომერი
892024345057
თარიღი 03/09/2024
17:30:34
უფლების
რეგისტრაცია: თარიღი
 09/09/2024
იპოთეკარი: სააქციო საზოგადოება "საქართველოს ბანკი" 204378869; 
საგანი: ფართი(მშენებარე) სართული5,ბინა N503,ბლოკი "ც" 83.20 კვ.მ. ;
იპოთეკის ხელშეკრულება NCAH000744921, დამოწმების თარიღი: 19/12/2023,
საქართველოს იუსტიციის სამინისტროს საჯარო რეესტრის ეროვნული სააგენტო ,
`;
const M2026 = (n) => `${n})  განცხადების
რეგისტრაცია
ნომერი
882026787747
თარიღი 02/09/2026
14:48:33
უფლების
რეგისტრაცია: თარიღი
 02/09/2026
იპოთეკარი: სააქციო საზოგადოება "საქართველოს ბანკი" 204378869; 
საგანი:სართული5,ბინა N503,ბლოკი "ც", ფართი 83.20 კვ.მ;
იპოთეკის ხელშეკრულება NMA0003673681, დამოწმების თარიღი02/09/2026,
საქართველოს იუსტიციის სამინისტროს საჯარო რეესტრის ეროვნული სააგენტო
`;
const TAIL = `საგადასახადო გირავნობა:
რეგისტრირებული არ არის
ვალდებულება
ყადაღა/აკრძალვა:
რეგისტრირებული არ არის
მოვალეთა რეესტრი:
რეგისტრირებული არ არის
         
ფიზიკური პირის მიერ არასამეწარმეო საქმიანობის ფარგლებში 2 წლამდე ვადით საკუთრებაში არსებული ქონების მიწოდებით...
საჯარორეესტრისეროვნულისააგენტო.http://public.reestri.gov.geგვერდი:2(2)`;

export const EXTRACT_0209 = toLegacy(head('882026787747', '02/09/2026 14:48:33', '02/09/2026 15:25:51') + FOOTER + M2024 + M2026(2) + TAIL);
export const EXTRACT_2209 = toLegacy(head('882026834519', '16/09/2026 16:54:15', '22/09/2026 09:47:44') + M2026(1) + TAIL);

const decision = (no, day, filed, service) => `

${day}NAPR
  
გადაწყვეტილება # ${no}-03 (${day.split('/').map((x) => x.padStart(2, '0')).reverse().join('.')})
რეგისტრაციის შესახებ
განცხადების ნომერი: ${no} განცხადების მიღების თარიღი: ${filed}
დაინტერესებული პირი: სს საქართველოს ბანკი (204378869)
წარმომადგენელი: [REDACTED]
უძრავი ნივთის მისამართი/საკადასტრო კოდი: ქალაქი თბილისი , ქუჩა კრწანისი , N 6,'ც' ბლოკი,სართული
5, ბინა ნომერი 503, ${CODE}
მომსახურების სახე: ${service}
დ ა სკ ვ ნ ა
„საჯარო რეესტრის შესახებ“ საქართველოს კანონის შესაბამისად მიღებული იქნა გადაწყვეტილება
მოთხოვნის დაკმაყოფილების თაობაზე.`;
// The decision page header prints the date as m/d/yyyy; the decision line as dd.mm.yyyy.
export const DECISION_TERMINATION = decision('882026834519', '2026/09/22', '16.09.2026 16:54', 'იპოთეკის შეწყვეტის რეგისტრაცია უძრავ ნივთზე');
export const DECISION_CREATION = decision('882026787747', '2026/09/02', '02.09.2026 14:48', 'იპოთეკის წარმოშობის რეგისტრაცია უძრავ ნივთზე');

const ref = (recordId) => ({ recordId, cadastralCode: CODE });
const listed = (appID, regNumber, webTransact, appRegDate, lastActDate) => ({
  appID, regNumber, webTransact, appRegDate, lastActDate, statusId: '10', status: 'სარეგისტრაციო წარმოება დასრულებულია',
});

export function browserOfficial() {
  const records = [
    listed('35489011', '882026834519', 'იპოთეკის შეწყვეტის რეგისტრაცია უძრავ ნივთზე', '1789577655', '1790070488'),
    listed('35433671', '882026787747', 'იპოთეკის წარმოშობის რეგისტრაცია უძრავ ნივთზე', '1788360513', '1788362824'),
    listed('34988026', '882026429021', 'საკუთრების უფლების რეგისტრაცია გარიგების საფუძველზე უძრავ ნივთზე', '1779285921', '1779889896'),
    listed('28323116', '892024345057', 'ამხანაგობის წევრის/წევრების საკუთრების უფლების რეგისტრაცია უძრავ ნივთზე', '1725384634', '1725874217'),
  ];
  return {
    results: [
      { source: 'tas', status: 'VERIFIED' },
      {
        source: 'mygov',
        adapter: 'service176-public-api',
        queryEntered: CODE,
        status: 'CAPTCHA_REQUIRED',
        traversal: {
          search: { cadastralCode: CODE, records },
          records: [{ recordId: '35489011', info: {} }, { recordId: '35433671', info: {} }],
          continuations: [{ state: 'CAPTCHA_REQUIRED', recordId: '34988026' }, { state: 'CAPTCHA_REQUIRED', recordId: '28323116' }],
        },
        documents: [
          { title: 'ამონაწერი საჯარო რეესტრიდან', rawText: EXTRACT_2209, sourceReference: ref('35489011') },
          { title: 'სარეგისტრაციო წარმოება დასრულებულია', rawText: DECISION_TERMINATION, sourceReference: ref('35489011') },
          { title: 'ამონაწერი საჯარო რეესტრიდან', rawText: EXTRACT_0209, sourceReference: ref('35433671') },
          { title: 'სარეგისტრაციო წარმოება დასრულებულია', rawText: DECISION_CREATION, sourceReference: ref('35433671') },
        ],
      },
    ],
  };
}
