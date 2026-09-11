// Shareholders must come from the register, not from nearby words.
//
// The fixture is the VERBATIM partners block from a production report,
// including the lines that follow it — which is what the previous
// proximity-based parser turned into eight shareholders of the developer
// that do not exist, each stamped REGISTERED / OFFICIAL_REGISTRY.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistryShareholders, parseRegistryDirectors } from '../peopleIntelligence.ts';

// Verbatim, newlines as the extract carries them.
const REAL_BLOCK = [
  'მმართველობის ორგანო',
  'საერთო კრება',
  'დირექტორატი',
  'ხელმძღვანელობა/წარმომადგენლობა',
  'დირექტორატი',
  'კობა კვანტალიანი, 01015005319 ,ერთობლივი',
  'ლევან ჩაჩუა, 01012012287 ,ერთობლივი',
  'კაპიტალი',
  'მესაკუთრე რაოდენობა წილი წილის მმართველი',
  '  ლევან ჩაჩუა, 010120122875050%',
  ' ',
  'კობა კვანტალიანი,',
  '01015005319',
  '5050%',
  'ვალდებულება',
  'რეგისტრირებული არ არის',
  'ყადაღა/აკრძალვა',
  'რეგისტრირებული არ არის',
  'საგადასახადო გირავნობა/იპოთეკის უფლება',
  'რეგისტრირებული არ არის',
  'მოძრავ ნივთებსა და არამატერიალურ ქონებრივ სიკეთეზე გირავნობა/ლიზინგის',
  'უფლება',
  'დამატებით გაცნობებთ, რომ გაურკვევლობის შემთხვევაში ინფორმაციის მისაღებად',
  'დოკუმენტაციის წარმოდგენის შემთხვევაში, აღნიშნული განცხადება დარჩება',
  'საჯარო რეესტრის',
  'სამინისტროს სა',
].join('\n');

const names = (people) => people.map((p) => p.name).sort();

/* ── the real partners ───────────────────────────────────────────────── */

test('the two real partners are read, with their shares', () => {
  const people = parseRegistryShareholders(REAL_BLOCK, 'შპს „მილენიო გრუპი“');
  assert.deepEqual(names(people), ['კობა კვანტალიანი', 'ლევან ჩაჩუა']);
  for (const p of people) {
    assert.equal(p.role, 'SHAREHOLDER');
    assert.equal(p.certainty, 'REGISTERED');
    assert.equal(p.ownershipPct, 50, `${p.name} lost their stated share`);
  }
});

test('a partner is never carried with their personal number attached', () => {
  const people = parseRegistryShareholders(REAL_BLOCK, 'entity');
  for (const p of people) {
    assert.ok(!/\d{11}/.test(p.name), 'a personal number is in the name');
    assert.ok(!/\d{11}/.test(p.support ?? ''), 'a personal number is in the supporting text');
  }
});

/* ── the eight that did not exist ────────────────────────────────────── */

test('prose following the table is not turned into shareholders', () => {
  const people = parseRegistryShareholders(REAL_BLOCK, 'შპს „მილენიო გრუპი“');
  for (const invented of [
    'სამინისტროს სა',
    'დოკუმენტაციის წარმოდგენის შემთხვევაში',
    'დამატებით გაცნობებთ',
    'რეგისტრირებული არ არის',
    'ქონებრივი სიკეთე',
    'საჯარო რეესტრის',
    'წილიარ არის განსაზღვრული',
    'მესაკუთრერაოდენობაწილიწილის მმართველი',
  ]) {
    assert.ok(!people.some((p) => p.name === invented), `"${invented}" is a shareholder again`);
  }
  assert.equal(people.length, 2, 'the partners list grew beyond the register');
});

test('with no partners table, nothing is returned rather than guessed', () => {
  // The old parser anchored on the WORD "წილი" anywhere and read the next 900
  // characters. This is evidence prose that contains it.
  const prose =
    'საკუთრების საფუძვლად მითითებულია დამფუძნებელი პარტნიორების 2024 წლის ' +
    '21 აგვისტოს N2 ოქმი. დამატებით გაცნობებთ, რომ გაურკვევლობის შემთხვევაში ' +
    'ინფორმაციის მისაღებად შეგიძლიათ დარეკოთ მერიის ცხელ ხაზზე. წილი და ' +
    'ქონებრივი სიკეთე საჯარო რეესტრის მიხედვით.';
  assert.deepEqual(parseRegistryShareholders(prose, 'entity'), []);
});

test('a name with no identification number beside it is not a registry row', () => {
  const noIds = ['მესაკუთრე რაოდენობა წილი წილის მმართველი', 'ნინო ბერიძე', 'გიორგი მაისურაძე 50%'].join('\n');
  assert.deepEqual(parseRegistryShareholders(noIds, 'entity'), []);
});

/* ── the two blocks stay separate ────────────────────────────────────── */

test('a director is not read as a shareholder by the partners parser', () => {
  // The directorate rows have the same name-comma-id shape. They carry a
  // representation marker, and they sit above the partners header.
  const directorsOnly = ['ხელმძღვანელობა/წარმომადგენლობა', 'დირექტორატი', 'კობა კვანტალიანი, 01015005319 ,ერთობლივი'].join('\n');
  assert.deepEqual(parseRegistryShareholders(directorsOnly, 'entity'), []);
});

test('the directorate parser still reads the directorate', () => {
  // Both roles are real for these two people; they must arrive from their own
  // blocks rather than one being inferred from the other.
  const parsed = parseRegistryDirectors(REAL_BLOCK, 'შპს „მილენიო გრუპი“');
  assert.deepEqual(names(parsed.people), ['კობა კვანტალიანი', 'ლევან ჩაჩუა']);
  assert.equal(parsed.representation, 'JOINT');
});

test('a malformed input yields nothing and never throws', () => {
  for (const v of [null, undefined, '', 42, {}, []]) {
    assert.deepEqual(parseRegistryShareholders(v, 'entity'), []);
  }
});
