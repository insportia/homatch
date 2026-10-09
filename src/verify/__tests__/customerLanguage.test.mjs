import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * CUSTOMER-FIRST LANGUAGE (Verify report).
 *
 * The c80f7237 report told a buyer „მიმდინარე ოფიციალური სტატუსი ვერ
 * დადგინდა“, „წინასწარი: …“, „მოითხოვა დადასტურება, რომელიც არ
 * დასრულებულა“ and that a source „დროულად არ უპასუხა“. Those describe our
 * pipeline, not the property. These tests hold the line: no failure narration
 * or internal code in the strings the report renders — while uncertainty is
 * still disclosed, calmly, and a timeout is never adverse.
 */

const SRC = fs.readFileSync(new URL('../../i18n/translations.ts', import.meta.url), 'utf8');
const bundle = (lang) => {
  const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
  const start = SRC.indexOf(opener);
  return SRC.slice(start, SRC.indexOf('\n};', start));
};
const valuesFor = (lang, prefixes) =>
  [...bundle(lang).matchAll(/^  ([a-z0-9_]+): (['"`])(.*)\2,$/gm)]
    .filter((m) => prefixes.some((p) => m[1].startsWith(p)))
    .map((m) => [m[1], m[3]]);

const CUSTOMER_PREFIXES = ['verify_ox_', 'vbi_', 'bc_', 'verify_ads_', 'verify_place_why_'];
const FORBIDDEN_KA = [/ვერ დადგინდა/, /წინასწარი/, /ვერ მოხერხდა/, /არ დასრულებულა/, /დროულად არ/, /ვერ დასრულდა/, /შეზღუდვები/];
const FORBIDDEN_EN = [/could not/i, /did not respond/i, /^Provisional/i, /was not completed/i, /limitations/i];
const CODES = /\b(CAPTCHA|TIMEOUT|GIVE_UP_STALLED|BROWSER_WAITING|CAPTCHA_REQUIRED|NOT_ESTABLISHED|API|2Captcha)\b/;

test('no failure narration in the Georgian report strings', () => {
  const bad = valuesFor('ka', CUSTOMER_PREFIXES).filter(([, v]) => FORBIDDEN_KA.some((re) => re.test(v)));
  assert.deepEqual(bad, []);
});

test('no failure narration in the English report strings', () => {
  const bad = valuesFor('en', CUSTOMER_PREFIXES).filter(([, v]) => FORBIDDEN_EN.some((re) => re.test(v)));
  assert.deepEqual(bad, []);
});

test('no internal codes in any locale', () => {
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
    const bad = valuesFor(lang, CUSTOMER_PREFIXES).filter(([, v]) => CODES.test(v));
    assert.deepEqual(bad, [], lang);
  }
});

test('uncertainty is still disclosed — calmly, and a tax-status timeout is explicitly not adverse', () => {
  const ka = Object.fromEntries(valuesFor('ka', ['vbi_']));
  assert.equal(ka.vbi_followup, 'დამატებით დასაზუსტებელია');
  assert.match(ka.vbi_fin_tax_help, /არც დადებითი ნიშანია და არც უარყოფითი/);
  assert.match(ka.vbi_ads_none_note, /არ ამტკიცებს/);
  const card = fs.readFileSync(new URL('../../components/verify/BuyerIntelligenceCards.tsx', import.meta.url), 'utf8');
  // NOT_CHECKED renders the calm follow-up pill, never a risk tone.
  assert.match(card, /taxStatus\.state === 'CHECKED'[\s\S]{0,400}tone="quiet"[\s\S]{0,40}vbi_followup/);
});

test('report components never render a raw provider state or status code', () => {
  const oi = fs.readFileSync(new URL('../../components/verify/OfficialIntelligence.tsx', import.meta.url), 'utf8');
  assert.ok(!/verify_ox_pstate_\$\{/.test(oi), 'provider states map to a calm label, not a per-code string');
  assert.match(oi, /state === 'NOT_ESTABLISHED'\) return null/);
});

test('every new string keeps its placeholders in all six locales', async () => {
  const { VERIFY_BUYER_INTEL_STRINGS } = await import('../../../scripts/verify-buyer-intel-i18n-data.mjs');
  for (const [key, values] of Object.entries(VERIFY_BUYER_INTEL_STRINGS)) {
    assert.equal(values.length, 6, key);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of values) assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
  }
});
