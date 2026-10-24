// ADMIN — External Leads Database import: headers in six languages map to the canonical fields,
// required fields are enforced, countries resolve to ISO-2 from names in any of the six
// languages (unresolvable values stay as typed), and a language is never invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADER_SYNONYMS, IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS, assignColumn, autoMapHeaders, buildCountryResolver,
  buildLanguageResolver, exampleRowCount, fieldForHeader, mapRows, missingRequired, normaliseHeader, unresolvedCountries,
} from '../importMapping.ts';

const CODES = ['GE', 'IL', 'TR', 'RU', 'AE', 'US', 'GB', 'DE', 'UA', 'AM', 'AZ', 'SA', 'FR'];

test('every canonical field has synonyms and no synonym names two fields', () => {
  assert.equal(IMPORT_FIELDS.length, 31);
  const owner = new Map();
  for (const field of IMPORT_FIELDS) {
    assert.ok(HEADER_SYNONYMS[field].length > 0, field);
    for (const word of [field, ...HEADER_SYNONYMS[field]]) {
      const key = normaliseHeader(word);
      if (owner.has(key)) assert.equal(owner.get(key), field, `"${word}" is claimed by ${owner.get(key)} and ${field}`);
      owner.set(key, field);
    }
  }
});

test('the canonical codes themselves map to themselves', () => {
  for (const field of IMPORT_FIELDS) assert.equal(fieldForHeader(field), field);
  assert.equal(fieldForHeader('First Name'), 'first_name');
  assert.equal(fieldForHeader('  E-Mail '), 'email');
  assert.equal(fieldForHeader('first_name *'), 'first_name');
});

test('headers in Georgian, Russian, Turkish, Arabic and Hebrew map', () => {
  assert.deepEqual(autoMapHeaders(['სახელი', 'გვარი', 'ელ. ფოსტა', 'ინტერესი', 'ქვეყანა', 'ენა']),
    ['first_name', 'last_name', 'email', 'interests', 'country', 'languages']);
  assert.deepEqual(autoMapHeaders(['Имя', 'Фамилия', 'Почта', 'Интересы', 'Страна', 'Языки', 'Телефон']),
    ['first_name', 'last_name', 'email', 'interests', 'country', 'languages', 'phone']);
  assert.deepEqual(autoMapHeaders(['Ad', 'Soyad', 'E-posta', 'İlgi', 'Ülke', 'Dil']),
    ['first_name', 'last_name', 'email', 'interests', 'country', 'languages']);
  assert.deepEqual(autoMapHeaders(['الاسم الأول', 'اسم العائلة', 'البريد الإلكتروني', 'الاهتمام', 'الدولة', 'اللغة']),
    ['first_name', 'last_name', 'email', 'interests', 'country', 'languages']);
  assert.deepEqual(autoMapHeaders(['שם פרטי', 'שם משפחה', 'אימייל', 'תחום עניין', 'מדינה', 'שפה']),
    ['first_name', 'last_name', 'email', 'interests', 'country', 'languages']);
});

test('a field is taken once; unknown headers are ignored', () => {
  const m = autoMapHeaders(['email', 'mail', 'favourite colour', 'Budget']);
  assert.deepEqual(m, ['email', null, null, 'budget_max']);
});

test('required fields are reported until mapped, and reassigning moves a field', () => {
  let m = autoMapHeaders(['First name', 'Surname', 'Email', 'Something']);
  assert.deepEqual(missingRequired(m), ['interests', 'country']);
  m = assignColumn(m, 3, 'country');
  assert.deepEqual(missingRequired(m), ['interests']);
  m = assignColumn(m, 2, 'country');
  assert.deepEqual(m, ['first_name', 'last_name', 'country', null]);
  assert.deepEqual(missingRequired(m), ['email', 'interests']);
  assert.deepEqual([...REQUIRED_IMPORT_FIELDS], ['first_name', 'last_name', 'email', 'interests', 'country']);
});

test('countries resolve from names in six languages, ISO-2 and ISO-3', () => {
  const r = buildCountryResolver(CODES);
  assert.equal(r('Georgia'), 'GE');
  assert.equal(r('საქართველო'), 'GE');
  assert.equal(r('Грузия'), 'GE');
  assert.equal(r('Gürcistan'), 'GE');
  assert.equal(r('جورجيا'), 'GE');
  assert.equal(r('גאורגיה'), 'GE');
  assert.equal(r('ge'), 'GE');
  assert.equal(r('GEO'), 'GE');
  assert.equal(r('ISR'), 'IL');
  assert.equal(r('Israel'), 'IL');
  assert.equal(r('USA'), 'US');
  assert.equal(r('UK'), 'GB');
  assert.equal(r('Turkey'), 'TR');
  assert.equal(r('Germany'), 'DE');
  assert.equal(r('  united arab emirates '), 'AE');
});

test('an unresolvable country stays as typed so the server flags it', () => {
  const r = buildCountryResolver(CODES);
  assert.equal(r('Atlantis'), 'Atlantis');
  assert.equal(r(''), '');
  const rows = mapRows(['country'], [['Atlantis'], ['GE']], ['country'], { country: r });
  assert.deepEqual(unresolvedCountries(rows), ['Atlantis']);
});

test('languages: codes pass, names resolve, nothing is guessed', () => {
  const r = buildLanguageResolver();
  assert.equal(r('KA, en'), 'ka, en');
  assert.equal(r('Georgian; Russian'), 'ka, ru');
  assert.equal(r('ქართული'), 'ka');
  assert.equal(r('русский'), 'ru');
  assert.equal(r('Türkçe'), 'tr');
  assert.equal(r('עברית'), 'he');
  assert.equal(r('Klingonese'), 'Klingonese');
  assert.equal(r(''), '');
});

test('mapRows keeps file row numbers, skips blank rows, never derives language from country', () => {
  const headers = ['Name', 'Surname', 'Email', 'Interest', 'Country', 'Notes'];
  const rows = [
    ['Nino', 'Beridze', 'nino@example.com', 'BUY', 'Georgia', ''],
    ['', '', '', '', '', ''],
    ['Anna', 'Ivanova', 'anna@mail.test', 'rent', 'Russia', 'call after 6'],
  ];
  const mapping = assignColumn(autoMapHeaders(headers), 0, 'first_name');
  const out = mapRows(headers, rows, mapping, { country: buildCountryResolver(CODES), languages: buildLanguageResolver() });
  assert.equal(out.length, 2);
  assert.equal(out[0].rowNo, 2);
  assert.equal(out[1].rowNo, 4);
  assert.deepEqual(out[0].data, { first_name: 'Nino', last_name: 'Beridze', email: 'nino@example.com', interests: 'BUY', country: 'GE' });
  assert.equal(out[0].data.languages, undefined);
  assert.equal(out[1].data.admin_notes, 'call after 6');
  assert.equal(out[1].raw.Notes, 'call after 6');
  assert.equal(exampleRowCount(out), 1);
});
