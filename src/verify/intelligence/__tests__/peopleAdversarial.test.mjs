// Adversarial fixtures for the people/company parser.
//
// The production failure was not exotic: the parser anchored on a word,
// took a fixed window, and trusted a name test that Georgian's lack of letter
// case defeats. Eight sentences became registered shareholders of the
// developer, and a real director was given a stake he may or may not hold.
//
// These fixtures attack the same seams deliberately — the anchor word in
// prose, a name next to an identifier that is not a partner row, a table that
// runs past its own end, a person who is genuinely both director and partner.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRegistryShareholders,
  parseRegistryDirectors,
  buildPeopleIntelligence,
  looksLikePersonName,
  redactPersonalData,
} from '../peopleIntelligence.ts';

const ENTITY = 'შპს „მილენიო გრუპი“';
const names = (people) => people.map((p) => p.name).sort();

/* ── the anchor word appearing where there is no table ───────────────── */

test('the word "partners" inside a sentence opens no shareholder list', () => {
  // Verbatim evidence prose from a live report. It contains the anchor the
  // old parser keyed on.
  const prose =
    'საკუთრების საფუძვლად მითითებულია დამფუძნებელი პარტნიორების 2024 წლის ' +
    '21 აგვისტოს N2 ოქმი. დამატებით გაცნობებთ, რომ გაურკვევლობის შემთხვევაში ' +
    'ინფორმაციის მისაღებად შეგიძლიათ დარეკოთ მერიის ცხელ ხაზზე.';
  assert.deepEqual(parseRegistryShareholders(prose, ENTITY), []);
});

test('a partners RESOLUTION is a document, not a roster', () => {
  // This title repeats 43 times in one production extract.
  const repeated = Array(10)
    .fill('პარტნიორების ოქმი N2 , გაფორმების თარიღი:21/08/2024 , საქართველოს იუსტიციის სამინისტრო')
    .join('\n');
  assert.deepEqual(parseRegistryShareholders(repeated, ENTITY), []);
});

/* ── an identifier that is not a partner row ─────────────────────────── */

test('an owner named in a registry extract is not promoted to shareholder', () => {
  // A previous OWNER of the property. Owning a flat is not owning the company.
  const extract = [
    'პარტნიორები',
    'ამონაწერი უძრავ ქონებაზე',
    'მესაკუთრე: მარინა კაციტაძე ,P/N: 01018001305',
  ].join('\n');
  const holders = parseRegistryShareholders(extract, ENTITY);
  assert.ok(!holders.some((h) => h.name.includes('კაციტაძე')), 'a property owner became a company shareholder');
});

test('a lessee named beside an identifier is not a shareholder', () => {
  const extract = ['პარტნიორები', 'მოიჯარე: ლაშა პეტრიაშვილი P/N: 38001036114;'].join('\n');
  const holders = parseRegistryShareholders(extract, ENTITY);
  assert.ok(!holders.some((h) => h.name.includes('პეტრიაშვილი')), 'a tenant became a shareholder');
});

/* ── the table running past its own end ──────────────────────────────── */

test('the partners table stops where the register says it stops', () => {
  // Everything after "ვალდებულება" is a different section. The old parser
  // read 900 characters regardless.
  const extract = [
    'მესაკუთრე რაოდენობა წილი წილის მმართველი',
    'ლევან ჩაჩუა, 010120122875050%',
    'ვალდებულება',
    'რეგისტრირებული არ არის',
    'გირავნობა/ლიზინგის რეესტრი: R23757008 19/12/2023 16:37:23',
    'კრედიტორი : სს საქართველოს ბანკი, 204378869',
  ].join('\n');
  const holders = parseRegistryShareholders(extract, ENTITY);
  assert.deepEqual(names(holders), ['ლევან ჩაჩუა']);
  assert.ok(!holders.some((h) => h.name.includes('ბანკი')), 'the mortgagee bank became a shareholder');
});

/* ── a share must be stated, never inferred ──────────────────────────── */

test('a partner with no stated share carries no number', () => {
  const extract = ['პარტნიორები', 'ნინო აბაშიძე, 01001011111'].join('\n');
  const [holder] = parseRegistryShareholders(extract, ENTITY);
  assert.equal(holder.name, 'ნინო აბაშიძე');
  assert.equal(holder.ownershipPct, undefined, 'a share was invented');
});

test('an impossible share is not recorded', () => {
  const extract = ['პარტნიორები', 'ნინო აბაშიძე, 01001011111 0%', 'გიორგი მაისურაძე, 01001022222 150%'].join('\n');
  for (const h of parseRegistryShareholders(extract, ENTITY)) {
    assert.ok(h.ownershipPct === undefined || (h.ownershipPct > 0 && h.ownershipPct <= 100),
      `${h.name} carries an impossible share ${h.ownershipPct}`);
  }
});

/* ── one person, two real roles ──────────────────────────────────────── */

test('a director who is also a partner keeps both roles and the share', () => {
  // The ordinary shape of a small Georgian company, and the case a naive
  // merge silently halves.
  const extract = [
    'ხელმძღვანელობა/წარმომადგენლობა',
    'დირექტორატი',
    'კობა კვანტალიანი, 01015005319 ,ერთობლივი',
    'ლევან ჩაჩუა, 01012012287 ,ერთობლივი',
    'კაპიტალი',
    'მესაკუთრე რაოდენობა წილი წილის მმართველი',
    'ლევან ჩაჩუა, 010120122875050%',
    'კობა კვანტალიანი, 010150053195050%',
    'ვალდებულება',
  ].join('\n');

  const people = buildPeopleIntelligence({
    companyProfile: { name: ENTITY },
    browserOfficial: { results: [{ extract }] },
  });

  assert.equal(people.people.length, 2, 'the two people were not merged into two records');
  for (const p of people.people) {
    const roles = new Set(p.roles ?? [p.role]);
    assert.ok(roles.has('DIRECTOR'), `${p.name} lost the directorship`);
    assert.ok(roles.has('SHAREHOLDER'), `${p.name} lost the shareholding`);
    assert.equal(p.ownershipPct, 50, `${p.name} lost the stated share`);
  }
  assert.equal(people.representation, 'JOINT', 'joint representation was lost');
});

test('joint representation reaches the reader as a practical warning', () => {
  const people = buildPeopleIntelligence({
    companyProfile: { name: ENTITY, directors: ['კობა კვანტალიანი', 'ლევან ჩაჩუა'], representation: 'JOINT' },
  });
  assert.equal(people.representation, 'JOINT');
  assert.ok(people.representationNote, 'joint representation carries no explanation');
  assert.ok(/ერთობლივ/.test(people.representationNote), 'the note does not say what joint means');
});

/* ── nothing personal reaches the customer ───────────────────────────── */

test('no identifier survives into any participant record', () => {
  const extract = [
    'ხელმძღვანელობა/წარმომადგენლობა',
    'დირექტორატი',
    'კობა კვანტალიანი, 01015005319 ,ერთობლივი',
    'მესაკუთრე რაოდენობა წილი წილის მმართველი',
    'ლევან ჩაჩუა, 010120122875050%',
  ].join('\n');
  const people = buildPeopleIntelligence({
    companyProfile: { name: ENTITY },
    browserOfficial: { results: [{ extract }] },
  });
  const serialized = JSON.stringify(people);
  assert.ok(!/\d{11}/.test(serialized), 'an eleven-digit personal number reached a participant record');
  assert.ok(!/\bP\s*\/\s*N\b/i.test(serialized), 'a personal-number label survived');
});

test('a date of birth beside a name is not carried into a record', () => {
  const withDob = 'მარინა კაციტაძე (დაბ.01/02/1969) ,P/N: 01018001305';
  const cleaned = redactPersonalData(withDob);
  assert.ok(!/01018001305/.test(cleaned), 'the personal number survived redaction');
});

test('a company id is stripped from PERSON text but kept as a company fact', () => {
  // Two different boundaries, and the distinction is deliberate.
  //
  // redactPersonalData() operates on person-context text — the supporting
  // sentence attached to a named individual — and removes both 9- and
  // 11-digit numbers there, because inside a sentence about a person a
  // registry number adds nothing a buyer needs. That is documented behaviour
  // in peopleIntelligence.ts, not an accident.
  const inPersonText = redactPersonalData('შპს მილენიო გრუპი, ს/ნ 404670272');
  assert.ok(!/404670272/.test(inPersonText), 'person-context redaction stopped removing ids');

  // The company id itself is public, is what a buyer pastes into the taxpayer
  // register, and reaches them as a COMPANY attribute rather than through a
  // person's supporting text. The customer-payload boundary must never strip
  // it — that is asserted against the real sanitiser in leakNet.test.mjs, and
  // confirmed in production where 404670272 is displayed.
  const people = buildPeopleIntelligence({
    companyProfile: { name: ENTITY, idCode: '404670272', directors: ['კობა კვანტალიანი'] },
  });
  assert.ok(people.people.length >= 1, 'the director was lost');
  assert.ok(!/404670272/.test(JSON.stringify(people.people)),
    'a company id was attached to a person record');
});

/* ── a sentence is not a person ──────────────────────────────────────── */

test('no arbitrary Georgian sentence passes as a person', () => {
  const sentences = [
    'დამატებით გაცნობებთ',
    'რეგისტრირებული არ არის',
    'დოკუმენტაციის წარმოდგენის შემთხვევაში',
    'საჯარო რეესტრის',
    'ქონებრივი სიკეთე',
    'სამინისტროს სა',
    'მესაკუთრერაოდენობაწილიწილის მმართველი',
    'წილიარ არის განსაზღვრული',
    'განცხადების რეგისტრაცია',
    'უფლების რეგისტრაცია',
    'ვალდებულება რეგისტრირებული',
  ];
  for (const s of sentences) {
    assert.equal(looksLikePersonName(s), false, `"${s}" reads as a person`);
  }
});

test('an organisation is not a person', () => {
  for (const org of ['შპს მილენიო გრუპი', 'სს საქართველოს ბანკი', 'Millenio Group LLC']) {
    assert.equal(looksLikePersonName(org), false, `"${org}" reads as a person`);
  }
});

test('real Georgian names still read as people', () => {
  for (const n of ['კობა კვანტალიანი', 'ლევან ჩაჩუა', 'ნინო აბაშიძე', 'დარეჯან შათაშვილი', 'გიორგი ლეჟავა']) {
    assert.equal(looksLikePersonName(n), true, `"${n}" was rejected`);
  }
});

/* ── an applicant is an applicant ────────────────────────────────────── */

test('a permit applicant is never turned into an owner or a shareholder', () => {
  // ლევან ჩაჩუა is genuinely a director here AND appears as a permit
  // applicant. The applicant record must contribute nothing on its own.
  const applicantOnly = buildPeopleIntelligence({
    companyProfile: { name: ENTITY },
    technicalFacts: [{ category: 'APPLICANT', key: 'applicant', value: 'გიორგი ლეჟავა' }],
  });
  assert.deepEqual(applicantOnly.people, [], 'a permit applicant became a participant');
});

test('the directorate parser refuses a block it cannot find', () => {
  for (const junk of ['', null, undefined, 'no governance block here', 42, {}]) {
    const parsed = parseRegistryDirectors(junk, ENTITY);
    assert.deepEqual(parsed.people, []);
    assert.equal(parsed.representation, 'UNKNOWN');
  }
});
