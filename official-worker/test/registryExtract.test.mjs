import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRegistryExtract, parseShareholders, parseDirectors,
  parseEncumbrances, verifyClaimedIdentity,
} from '../.tstest-build/evidence/RegistryExtractParser.js';

/*
 * REGISTRY EXTRACT PARSING.
 *
 * Both fixtures are REAL text retrieved by production job
 * 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 (verbatim rawText, abridged only where
 * the tail repeats). They are the evidence that settled the two-id question:
 * 404670272 and 405068386 are DIFFERENT COMPANIES, and the pipeline had been
 * carrying the second one under the first one's name.
 */

const MILENIO = `

*B24099518 *
საქართველოს იუსტიციის სამინისტრო
სსიპ საჯარო რეესტრის ეროვნული სააგენტო
ამონაწერი მეწარმეთა და არასამეწარმეო
(არაკომერციული) იურიდიული პირების
რეესტრიდან
განაცხადის რეგისტრაციის ნომერი, მომზადების თარიღი: B24099518, 15/08/2024 16:46:28
სუბიექტი
საფირმო სახელწოდება:შპს მილენიო გრუპი
სამართლებრივი ფორმა:შეზღუდული პასუხისმგებლობის საზოგადოება
საიდენტიფიკაციო ნომერი:404670272
რეგისტრაციის ნომერი,
თარიღი:
28/03/2023
მარეგისტრირებელი
ორგანო:
სსიპ საჯარო რეესტრის ეროვნული სააგენტო
იურიდიული მისამართი:
საქართველო, თბილისი, კრწანისის რაიონი, კრწანისის ქუჩა,
N6

ინფორმაცია ლიკვიდაციის/ რეორგანიზაციის/ გადახდისუუნარობის პროცესის
მიმდინარეობის შესახებ
რეგისტრირებული არ არის
მმართველობის ორგანო
საერთო კრება
დირექტორატი
ხელმძღვანელობა/წარმომადგენლობა
დირექტორატი
კობა კვანტალიანი, 01015005319 ,ერთობლივი
ლევან ჩაჩუა, 01012012287 ,ერთობლივი
კაპიტალი
   განთავსებული წილი100 ერთეული
პარტნიორები
კლასის ტიპი: /კლასის გარეშე/ , რაოდენობა:100, ნომინალური ღირებულება:არ არის
განსაზღვრული
  მესაკუთრერაოდენობაწილიწილის მმართველი
  ლევან ჩაჩუა, 010120122875050%

კობა კვანტალიანი,
01015005319
5050%
ვალდებულება
რეგისტრირებული არ არის
ყადაღა/აკრძალვა
რეგისტრირებული არ არის
საგადასახადო გირავნობა/იპოთეკის უფლება
რეგისტრირებული არ არის
მოძრავ ნივთებსა და არამატერიალურ ქონებრივ სიკეთეზე გირავნობა/ლიზინგის
უფლება
გირავნობა/ლიზინგის რეესტრი: R23757008 19/12/2023 16:37:23
კრედიტორი : სს საქართველოს ბანკი (საქართველო) 204378869
მესაკუთრე : შპს მილენიო გრუპი (საქართველო) 404670272
`;

const ARTITEXI = `

*B26373325 *
საქართველოს იუსტიციის სამინისტრო
სსიპ საჯარო რეესტრის ეროვნული სააგენტო
ამონაწერი მეწარმეთა და არასამეწარმეო
(არაკომერციული) იურიდიული პირების
რეესტრიდან
განაცხადის რეგისტრაციის ნომერი, მომზადების თარიღი: B26373325, 04/06/2026 13:47:00
სუბიექტი
საფირმო სახელწოდება:შპს არტიტექსი
სამართლებრივი ფორმა:შეზღუდული პასუხისმგებლობის საზოგადოება
საიდენტიფიკაციო ნომერი:405068386
რეგისტრაციის ნომერი,
თარიღი:
23/10/2014
მარეგისტრირებელი
ორგანო:
სსიპ საჯარო რეესტრის ეროვნული სააგენტო
იურიდიული მისამართი:
საქართველო, თბილისი, საბურთალოს რაიონი, მუხრან
მაჭავარიანის ქუჩა, N7, სართული 2, ბინა N7

ინფორმაცია ლიკვიდაციის/ რეორგანიზაციის/ გადახდისუუნარობის პროცესის
მიმდინარეობის შესახებ
რეგისტრირებული არ არის
მმართველობის ორგანო
საერთო კრება
დირექტორი
ხელმძღვანელობა/წარმომადგენლობა
დირექტორი
დარეჯან შათაშვილი, 01024003718 ,ერთპიროვნული
კაპიტალი
   განთავსებული წილი10000 ერთეული
პარტნიორები
კლასის ტიპი: /კლასის გარეშე/ , რაოდენობა:10000, ნომინალური ღირებულება:1 ლარი
  მესაკუთრერაოდენობაწილიწილის მმართველი

დარეჯან შათაშვილი,
01024003718
250025%

ალექსანდრე ბურჭულაძე,
01008007608
377037.7%

არჩილ ძიძიგური,
01008031848
161516.15%

კონსტანტინე ღვინჯილია,
19001097637
161516.15%
  ოლგა კახიანი, 010320005215005%
ვალდებულება
რეგისტრირებული არ არის
ყადაღა/აკრძალვა
რეგისტრირებული არ არის
საგადასახადო გირავნობა/იპოთეკის უფლება
რეგისტრირებული არ არის
მოძრავ ნივთებსა და არამატერიალურ ქონებრივ სიკეთეზე გირავნობა/ლიზინგის
უფლება
რეგისტრირებული არ არის
მოვალეთა რეესტრი
რეგისტრირებული არ არის
`;

/* ------------------------------------------------------------------ *
 * Identity.                                                           *
 * ------------------------------------------------------------------ */

test('the extract identifies the company from the registry itself, not from a guess', () => {
  const e = parseRegistryExtract(MILENIO);
  assert.equal(e.legalName, 'შპს მილენიო გრუპი');
  assert.equal(e.idCode, '404670272');
  assert.equal(e.registrationDate, '28/03/2023');
  assert.equal(e.extractNumber, 'B24099518');
  assert.match(e.address, /კრწანისის ქუჩა/);
  assert.equal(e.liquidationRegistered, false);
});

test('THE PRODUCTION FINDING: 405068386 is a DIFFERENT company, not Millenio', () => {
  const e = parseRegistryExtract(ARTITEXI);
  assert.equal(e.idCode, '405068386');
  assert.equal(e.legalName, 'შპს არტიტექსი', 'the registry says Artitexi, not Millenio Group');
  assert.equal(e.registrationDate, '23/10/2014');
  assert.match(e.address, /საბურთალოს რაიონი/);
});

test('a name carried with the wrong id is reported as CONFLICTING, never silently merged', () => {
  const artitexi = parseRegistryExtract(ARTITEXI);
  // Exactly what the pipeline believed about 405068386.
  const v = verifyClaimedIdentity(artitexi, { idCode: '405068386', name: 'შპს მილენიო გრუპი' });
  assert.equal(v.agrees, false);
  assert.equal(v.state, 'CONFLICTING');
  assert.match(v.note, /არტიტექსი/);
});

test('a matching identity is CONFIRMED', () => {
  const v = verifyClaimedIdentity(parseRegistryExtract(MILENIO), { idCode: '404670272', name: 'შპს მილენიო გრუპი' });
  assert.equal(v.agrees, true);
  assert.equal(v.state, 'CONFIRMED');
});

test('an extract for a different id is CONFLICTING', () => {
  const v = verifyClaimedIdentity(parseRegistryExtract(MILENIO), { idCode: '405068386', name: null });
  assert.equal(v.state, 'CONFLICTING');
});

test('a missing extract is UNAVAILABLE, never a false agreement', () => {
  const v = verifyClaimedIdentity(null, { idCode: '404670272', name: 'x' });
  assert.equal(v.agrees, false);
  assert.equal(v.state, 'UNAVAILABLE');
});

/* ------------------------------------------------------------------ *
 * Shareholders with EXACT percentages.                                *
 * ------------------------------------------------------------------ */

test('Millenio: two shareholders at exactly 50% each', () => {
  const { shareholders, totalUnits } = parseShareholders(MILENIO.replace(/[ \t]+/g, ' '));
  assert.equal(totalUnits, 100);
  const byName = Object.fromEntries(shareholders.map((s) => [s.name, s]));
  assert.equal(shareholders.length, 2);
  assert.equal(byName['ლევან ჩაჩუა'].percentage, 50);
  assert.equal(byName['ლევან ჩაჩუა'].idNumber, '01012012287');
  assert.equal(byName['კობა კვანტალიანი'].percentage, 50);
});

test('Artitexi: five shareholders with exact, uneven percentages', () => {
  const { shareholders, totalUnits } = parseShareholders(ARTITEXI.replace(/[ \t]+/g, ' '));
  assert.equal(totalUnits, 10000);
  const byName = Object.fromEntries(shareholders.map((s) => [s.name, s]));
  assert.equal(shareholders.length, 5);
  assert.equal(byName['დარეჯან შათაშვილი'].percentage, 25);
  assert.equal(byName['ალექსანდრე ბურჭულაძე'].percentage, 37.7);
  assert.equal(byName['არჩილ ძიძიგური'].percentage, 16.15);
  assert.equal(byName['კონსტანტინე ღვინჯილია'].percentage, 16.15);
  assert.equal(byName['ოლგა კახიანი'].percentage, 5);
});

test('percentages are read, never derived by division', () => {
  const e = parseRegistryExtract(ARTITEXI);
  // 3770/10000 = 37.7 either way, but the value must come from the printed
  // "37.7%" so an extract with unusual rounding is never silently corrected.
  const burch = e.shareholders.find((s) => s.name.startsWith('ალექსანდრე'));
  assert.equal(burch.percentage, 37.7);
  assert.equal(burch.units, 3770);
});

test('shareholding consistency is checked, not assumed', () => {
  assert.equal(parseRegistryExtract(MILENIO).shareholdingConsistent, true);
  assert.equal(parseRegistryExtract(ARTITEXI).shareholdingConsistent, true);
});

/* ------------------------------------------------------------------ *
 * Directors / representation.                                         *
 * ------------------------------------------------------------------ */

test('directors and their representation rights are captured', () => {
  const m = parseDirectors(MILENIO.replace(/[ \t]+/g, ' '));
  assert.equal(m.length, 2);
  assert.equal(m.every((d) => /ერთობლივი/.test(d.representation)), true, 'joint representation');

  const a = parseDirectors(ARTITEXI.replace(/[ \t]+/g, ' '));
  assert.equal(a.length, 1);
  assert.equal(a[0].name, 'დარეჯან შათაშვილი');
  assert.match(a[0].representation, /ერთპიროვნული/);
});

/* ------------------------------------------------------------------ *
 * Encumbrances — absence is a real finding.                           *
 * ------------------------------------------------------------------ */

test('Millenio has a registered Bank of Georgia pledge with its reference and date', () => {
  const enc = parseEncumbrances(MILENIO.replace(/[ \t]+/g, ' '));
  const pledge = enc.find((e) => e.kind === 'PLEDGE_LEASE');
  assert.equal(pledge.registered, true);
  assert.equal(pledge.reference, 'R23757008');
  assert.equal(pledge.registeredAt, '19/12/2023');
  assert.match(pledge.creditor, /საქართველოს ბანკი/);
});

test('"not registered" is captured as a positive negative, not as missing data', () => {
  const enc = parseEncumbrances(MILENIO.replace(/[ \t]+/g, ' '));
  for (const kind of ['OBLIGATION', 'SEIZURE', 'TAX_LIEN']) {
    const e = enc.find((x) => x.kind === kind);
    assert.equal(e.registered, false, `${kind} must be recorded as explicitly not registered`);
  }
});

test('Artitexi has no encumbrances at all, including the debtor registry', () => {
  const enc = parseEncumbrances(ARTITEXI.replace(/[ \t]+/g, ' '));
  assert.equal(enc.every((e) => e.registered === false), true);
  assert.equal(enc.some((e) => e.kind === 'DEBTOR_REGISTRY'), true);
});

/* ------------------------------------------------------------------ *
 * Robustness.                                                         *
 * ------------------------------------------------------------------ */

test('non-extract text returns null rather than a half-parsed company', () => {
  for (const junk of ['', null, undefined, 'hello world', '<html><body>404</body></html>']) {
    assert.equal(parseRegistryExtract(junk), null);
  }
});

test('a truncated extract yields what is present and nulls for what is not', () => {
  const e = parseRegistryExtract('საიდენტიფიკაციო ნომერი:404670272 \nსაფირმო სახელწოდება:შპს ტესტი');
  assert.equal(e.idCode, '404670272');
  assert.equal(e.shareholders.length, 0);
  assert.equal(e.shareholdingConsistent, null, 'no shareholders means no consistency claim');
});
