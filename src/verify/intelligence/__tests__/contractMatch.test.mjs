import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareContractToVerify, contractCorpus, matchCounts } from '../contractMatch.ts';

/*
 * THE CONTRACT, READ AGAINST WHAT THE VERIFICATION ALREADY KNOWS.
 *
 * The analysis below is the REAL persisted output for production document
 * d4a86b9c ("- გარაჟი ციალა მელაძე.docx", 25,576 bytes, case 36f05c8f),
 * abridged to the fields the comparison reads. Using the real thing matters:
 * it is a parking-space contract at the same street address as the verified
 * Villion property, it never states a cadastral code, and it says the object
 * is mortgaged to Bank of Georgia — so it exercises MATCH, MISMATCH and
 * INSUFFICIENT without any of them being invented for the test.
 */

const REAL_ANALYSIS = {
  documentType: 'ნასყიდობის ხელშეკრულება (უძრავი ქონების შესახებ)',
  summary: [
    'მყიდველი ყიდულობს მშენებარე ავტოსადგომს თბილისში, კრწანისის ქუჩა №6-ში, ბლოკ „ა“-ში, მე-2 სართულზე, 24.30 კვ.მ. ფართობით.',
    'ხელშეკრულებაში წერია, რომ 15 000 აშშ დოლარის ღირებულება სრულად გადახდილია ხელმოწერის დროისთვის.',
    'ქონება ხელშეკრულების გაფორმების დროს იპოთეკითაა დატვირთული სს „საქართველოს ბანკის“ სასარგებლოდ.',
  ],
  financial: [
    { label: 'ქონების ჯამური ღირებულება', value: '15 000 აშშ დოლარი', quote: 'ნასყიდობის საგნის ჯამური ღირებულება შეადგენს 15 000 (თხუთმეტი ათასი) აშშ დოლარს', page: null },
    { label: 'გადახდის ანგარიში', value: 'GE50BG0000000545803196GEL', quote: 'ა/ა: GE50BG0000000545803196GEL', page: null },
  ],
  obligations: [
    { label: 'იპოთეკის მოხსნა', party: 'SELLER', plain: 'გამყიდველმა იპოთეკა უნდა მოხსნას.', quote: 'ათი საბანკო დღის ვადაში გამყიდველი ვალდებულია მოხსნას რეგისტრირებული იპოთეკა', page: null },
  ],
  clauses: [],
  deadlines: [],
  questions: ['აქვს თუ არა გამყიდველის წარმომადგენელს ხელშეკრულების ხელმოწერისთვის მოქმედი წარმომადგენლობითი უფლებამოსილება?'],
};

/** The Villion company facts, exactly as the register established them. */
const VILLION_COMPANY = {
  status: 'REGISTRY_CONFIRMED',
  legalName: 'შპს მილენიო გრუპი',
  idCode: '404670272',
  representationRule: 'JOINT',
  directors: [
    { name: 'კობა კვანტალიანი', representation: 'ერთობლივი' },
    { name: 'ლევან ჩაჩუა', representation: 'ერთობლივი' },
  ],
  ownership: [], encumbrances: [], registryFields: [], registryBacked: true,
};

const VILLION = {
  cadastralCode: '01.18.06.019.055.03.01.601',
  address: 'საქართველო, თბილისი, კრწანისის რაიონი, კრწანისის ქუჩა, N6',
  company: VILLION_COMPANY,
};

const rowFor = (rows, field) => rows.find((r) => r.field === field);

/* ------------------------------------------------------------------ *
 * The corpus is the analyser's own quotes, not raw text.              *
 * ------------------------------------------------------------------ */

test('the corpus is built from what the analyser actually grounded its findings in', () => {
  const corpus = contractCorpus(REAL_ANALYSIS);
  assert.match(corpus, /კრწანისის ქუჩა №6/, 'quoted passages must be searchable');
  assert.match(corpus, /GE50BG0000000545803196GEL/);
  assert.match(corpus, /საქართველოს ბანკის/);
  assert.equal(contractCorpus(null), '', 'no analysis is an empty corpus, not a crash');
  assert.equal(contractCorpus({}), '');
});

/* ------------------------------------------------------------------ *
 * The real document against the real verification.                    *
 * ------------------------------------------------------------------ */

test('a contract that never states a cadastral code says so, and accuses nobody', () => {
  const rows = compareContractToVerify(REAL_ANALYSIS, VILLION);
  const cadastral = rowFor(rows, 'CADASTRAL');
  assert.equal(
    cadastral.state, 'INSUFFICIENT',
    'absence must never be reported as a different property'
  );
  assert.equal(cadastral.contractValue, undefined);
  assert.equal(cadastral.noteKey, undefined, 'and it earns no warning');
});

test('the same street address is recognised despite different formatting', () => {
  // Register: "…კრწანისის ქუჩა, N6". Contract: "კრწანისის ქუჩა №6-ში".
  const address = rowFor(compareContractToVerify(REAL_ANALYSIS, VILLION), 'ADDRESS');
  assert.equal(address.state, 'MATCH', 'punctuation and № vs N are not a different address');
});

test('the address rows show words, never the internal comparison key', () => {
  /*
   * FOUND ON THE DEPLOYED PAGE, NOT IN THE FILE.
   *
   * The comparison normalises an address to `street|number` so that
   * "…კრწანისის ქუჩა, N6" and "კრწანისის ქუჩა №6-ში" compare equal. That key
   * was also what got rendered, so a buyer opening a real contract in
   * production was shown `კრწანისის|6` where an address belonged.
   */
  const address = rowFor(compareContractToVerify(REAL_ANALYSIS, VILLION), 'ADDRESS');
  assert.equal(address.state, 'MATCH');
  for (const side of [address.contractValue, address.verifyValue]) {
    assert.ok(side, 'a matched address must show both sides');
    assert.ok(!side.includes('|'), `the comparison key leaked into the UI: ${side}`);
  }
  assert.match(address.verifyValue, /კრწანისის/, 'the verified side shows the registry address');
  assert.match(address.contractValue, /კრწანისის/, 'the document side shows what the document says');
});

test('a company the contract never names is INSUFFICIENT, not a mismatch', () => {
  const rows = compareContractToVerify(REAL_ANALYSIS, VILLION);
  // This contract is between private parties; it does not name the developer.
  assert.equal(rowFor(rows, 'COMPANY_NAME').state, 'INSUFFICIENT');
  assert.equal(rowFor(rows, 'COMPANY_ID').state, 'INSUFFICIENT');
});

test('joint representation is reported as a check, never as a verdict', () => {
  const rows = compareContractToVerify(REAL_ANALYSIS, VILLION);
  const rep = rowFor(rows, 'REPRESENTATION');
  assert.ok(rep, 'a jointly represented company must produce this row');
  // The document names neither registered director, so nothing is concluded.
  assert.equal(rep.state, 'INSUFFICIENT');
  assert.equal(rep.noteKey, 'cm_note_joint_unknown');
  assert.equal(rep.verifyValue, 'JOINT');
});

/* ------------------------------------------------------------------ *
 * The states that matter, driven deliberately.                        *
 * ------------------------------------------------------------------ */

test('a cadastral code that genuinely differs is a mismatch with advice', () => {
  const other = { ...REAL_ANALYSIS, summary: ['საკადასტრო კოდი 01.10.05.001.002 მითითებულია'] };
  const cadastral = rowFor(compareContractToVerify(other, VILLION), 'CADASTRAL');
  assert.equal(cadastral.state, 'MISMATCH');
  assert.equal(cadastral.contractValue, '01.10.05.001.002');
  assert.equal(cadastral.verifyValue, '01.18.06.019.055.03.01.601');
  assert.equal(cadastral.noteKey, 'cm_note_cadastral_mismatch');
});

test('the production pair: same parent parcel, different unit, stays a mismatch', () => {
  /*
   * THE REAL ONE, FROM THE DEPLOYED PAGE.
   *
   * A parking space at 01.18.06.019.055.01.04.003 was filed against the flat
   * verified as 01.18.06.019.055.03.01.601. They share the parent parcel
   * 01.18.06.019.055 and they share a street, and they are two different
   * properties. Neither is a prefix of the other, so the prefix rule that
   * makes a parcel and its unit the same property must NOT reach across
   * them — a buyer told "same property" here would be told something false
   * about the thing they are about to sign for.
   */
  // The code is ADDED to the real analysis rather than replacing it, so the
  // corpus still contains the address the document genuinely states. Swapping
  // the summary out would remove the address too and prove nothing about it.
  const parking = {
    ...REAL_ANALYSIS,
    summary: [
      ...REAL_ANALYSIS.summary,
      'საკადასტრო კოდი 01.18.06.019.055.01.04.003, ავტოსადგომი',
    ],
  };
  const rows = compareContractToVerify(parking, VILLION);
  const cadastral = rowFor(rows, 'CADASTRAL');
  assert.equal(cadastral.state, 'MISMATCH', 'a different unit is not the same property');
  assert.equal(cadastral.contractValue, '01.18.06.019.055.01.04.003');
  assert.equal(cadastral.verifyValue, '01.18.06.019.055.03.01.601');
  assert.equal(cadastral.noteKey, 'cm_note_cadastral_mismatch');

  // And the address still matches, because it genuinely does: same building.
  // Both facts are true at once and the buyer needs both.
  assert.equal(rowFor(rows, 'ADDRESS').state, 'MATCH');
});

test('the parent parcel of the verified unit is the same property, not a different one', () => {
  const parent = { ...REAL_ANALYSIS, summary: ['ნაკვეთი 01.18.06.019.055'] };
  assert.equal(rowFor(compareContractToVerify(parent, VILLION), 'CADASTRAL').state, 'MATCH');
});

test('an exact cadastral match is reported plainly', () => {
  const exact = { ...REAL_ANALYSIS, summary: ['საკადასტრო კოდი: 01.18.06.019.055.03.01.601'] };
  const row = rowFor(compareContractToVerify(exact, VILLION), 'CADASTRAL');
  assert.equal(row.state, 'MATCH');
  assert.equal(row.noteKey, undefined);
});

test('the company id is matched exactly, never fuzzily', () => {
  const named = { ...REAL_ANALYSIS, summary: ['გამყიდველი: შპს მილენიო გრუპი, ს/კ 404670272'] };
  const rows = compareContractToVerify(named, VILLION);
  assert.equal(rowFor(rows, 'COMPANY_ID').state, 'MATCH');
  assert.equal(rowFor(rows, 'COMPANY_NAME').state, 'MATCH', 'the legal-form prefix is not part of the name');

  const wrong = { ...REAL_ANALYSIS, summary: ['გამყიდველი: ს/კ 405068386'] };
  const row = rowFor(compareContractToVerify(wrong, VILLION), 'COMPANY_ID');
  assert.equal(row.state, 'MISMATCH');
  assert.equal(row.contractValue, '405068386');
});

test('one of two required signatories is flagged for confirmation, not called invalid', () => {
  const single = { ...REAL_ANALYSIS, summary: ['ხელს აწერს დირექტორი კობა კვანტალიანი'] };
  const rep = rowFor(compareContractToVerify(single, VILLION), 'REPRESENTATION');
  assert.equal(rep.state, 'MISMATCH');
  assert.equal(rep.contractValue, 'კობა კვანტალიანი');
  assert.equal(rep.noteKey, 'cm_note_joint_partial');
});

test('both registered directors present reads as consistent', () => {
  const both = { ...REAL_ANALYSIS, summary: ['ხელს აწერენ კობა კვანტალიანი და ლევან ჩაჩუა'] };
  const rep = rowFor(compareContractToVerify(both, VILLION), 'REPRESENTATION');
  assert.equal(rep.state, 'MATCH');
  assert.equal(rep.noteKey, undefined);
});

test('a company without joint representation produces no representation row', () => {
  const sole = { ...VILLION, company: { ...VILLION_COMPANY, representationRule: 'SOLE' } };
  assert.equal(rowFor(compareContractToVerify(REAL_ANALYSIS, sole), 'REPRESENTATION'), undefined);
});

/* ------------------------------------------------------------------ *
 * Degenerate inputs.                                                  *
 * ------------------------------------------------------------------ */

test('no verification context and no analysis never throw', () => {
  assert.doesNotThrow(() => compareContractToVerify(null, {}));
  assert.doesNotThrow(() => compareContractToVerify(REAL_ANALYSIS, {}));
  const rows = compareContractToVerify(null, VILLION);
  assert.ok(rows.every((r) => r.state === 'INSUFFICIENT'), 'nothing known means nothing claimed');
});

test('a phone or account number is never read as a cadastral code or company id', () => {
  const noise = { ...REAL_ANALYSIS, summary: ['ტელ: 995322123456, ა/ა GE50BG0000000545803196GEL'] };
  const rows = compareContractToVerify(noise, VILLION);
  assert.equal(rowFor(rows, 'CADASTRAL').state, 'INSUFFICIENT');
  // 9 consecutive digits inside a longer run must not be harvested.
  assert.equal(rowFor(rows, 'COMPANY_ID').contractValue, undefined);
});

test('the counts a header may state are the counts of the rows', () => {
  const rows = compareContractToVerify(REAL_ANALYSIS, VILLION);
  const counts = matchCounts(rows);
  assert.equal(counts.MATCH + counts.MISMATCH + counts.INSUFFICIENT, rows.length);
  assert.equal(counts.MATCH, 1, 'the address is the one thing this contract confirms');
});
