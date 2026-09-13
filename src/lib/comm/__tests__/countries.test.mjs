// The country list a customer can actually pick from.
//
// The parser was always global. The two dropdowns in front of it were not:
// eleven hand-typed ISO codes each, so a customer with Spanish or Brazilian
// contacts had no way to say which country local-format numbers belonged to,
// and those rows arrived as "unusable" with nothing explaining why.
//
// These tests exist to stop that list ever being hand-typed again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryOptions, countryLabel } from '../countries.ts';
import { parsePhone } from '../phone.ts';

test('the list is the whole world, not a shortlist', () => {
  const options = countryOptions('en');
  // 245-ish in libphonenumber's metadata. The exact number moves with
  // releases; what must never happen is a return to a curated handful.
  assert.ok(options.length > 200, `only ${options.length} countries offered`);
});

test('countries Homatch never listed before are present and dialable', () => {
  const options = countryOptions('en');
  const byCode = new Map(options.map((o) => [o.code, o]));

  // The cases that motivated this: places the old eleven-entry list excluded.
  for (const [code, dial] of [['ES', '34'], ['BR', '55'], ['NG', '234'], ['IN', '91'], ['JP', '81']]) {
    const option = byCode.get(code);
    assert.ok(option, `${code} is missing from the country list`);
    assert.equal(option.dialCode, dial, `${code} has the wrong dialling code`);
  }
});

test('a local-format number resolves for a country that used to be unavailable', () => {
  // This is the whole point. Without ES in the picker, this number could only
  // be imported if the customer happened to write it with a + prefix.
  const spanish = parsePhone('612 345 678', 'ES');
  assert.equal(spanish.e164, '+34612345678');
  assert.equal(spanish.country, 'ES');

  const brazilian = parsePhone('11 91234 5678', 'BR');
  assert.equal(brazilian.e164, '+5511912345678');
  assert.equal(brazilian.country, 'BR');
});

test('an explicit prefix still beats the chosen country', () => {
  // Widening the list must not weaken the rule that a written + wins, or a
  // sheet that is mostly Georgian would re-home a UK number to Georgia.
  const uk = parsePhone('+44 20 7946 0958', 'GE');
  assert.equal(uk.country, 'GB');
  assert.equal(uk.countryInferred, false);
});

test("Homatch's own markets are offered first", () => {
  const options = countryOptions('en');
  const first = options.slice(0, 11).map((o) => o.code);
  assert.equal(first[0], 'GE', 'Georgia must be the first option');
  for (const code of ['TR', 'RU', 'AM', 'AZ', 'UA', 'IL', 'AE', 'GB', 'US', 'DE']) {
    assert.ok(first.includes(code), `${code} should be in the priority block`);
  }
});

test('the rest are sorted by name, in the reader’s language', () => {
  const en = countryOptions('en').slice(11);
  const collator = new Intl.Collator('en');
  for (let i = 1; i < Math.min(en.length, 40); i++) {
    assert.ok(
      collator.compare(en[i - 1].name, en[i].name) <= 0,
      `${en[i - 1].name} should not sort after ${en[i].name}`,
    );
  }
});

test('names are localised rather than ISO codes', () => {
  const en = countryOptions('en');
  const ka = countryOptions('ka');
  const germanyEn = en.find((c) => c.code === 'DE');
  const germanyKa = ka.find((c) => c.code === 'DE');

  assert.equal(germanyEn.name, 'Germany');
  // Georgian must not fall back to the bare code; "AE" means nothing to a
  // customer reading the product in Georgian.
  assert.notEqual(germanyKa.name, 'DE');
  assert.ok(germanyKa.name.length > 1);
});

test('every option carries a usable dialling code', () => {
  for (const option of countryOptions('en')) {
    assert.match(option.dialCode, /^\d{1,4}$/, `${option.code} has dial code ${option.dialCode}`);
    assert.ok(option.name.length > 0);
  }
});

test('the label reads as a country, not a code', () => {
  const ge = countryOptions('en').find((c) => c.code === 'GE');
  assert.equal(countryLabel(ge), 'Georgia (+995)');
});

test('the list is memoised per locale rather than rebuilt per render', () => {
  // ~245 entries and an Intl lookup each. A select that rebuilds the world on
  // every keystroke janks while somebody is typing next to it.
  assert.strictEqual(countryOptions('en'), countryOptions('en'));
  assert.notStrictEqual(countryOptions('en'), countryOptions('ka'));
});
