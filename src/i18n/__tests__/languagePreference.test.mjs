// Georgian first (owner, 2026-10-29): which language a visitor sees first,
// and when a coarse IP country may OFFER another one. Pure rules, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LANGUAGE, LANGUAGE_ORDER, browserLanguageFrom, mayLookUpCountry, normalizeCountry,
  profileMayApply, resolveInitialLanguage, shouldSuggest, suggestedLanguageForCountry,
} from '../languagePreference.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

test('Georgian is the default and first; then English and Russian', () => {
  assert.equal(DEFAULT_LANGUAGE, 'ka');
  assert.deepEqual([...LANGUAGE_ORDER], ['ka', 'en', 'ru', 'tr', 'ar', 'he']);
  /* The selector order everyone imports. */
  const types = read('src/types/types.ts');
  const codes = [...types.slice(types.indexOf('export const SUPPORTED_LANGUAGES')).matchAll(/code: '([a-z]{2})'/g)].slice(0, 6).map((m) => m[1]);
  assert.deepEqual(codes, ['ka', 'en', 'ru', 'tr', 'ar', 'he']);
  assert.match(read('index.html'), /<html lang="ka">/, 'the first paint announces Georgian');
  /* Server side: a request without a valid language gets Georgian too. */
  const server = read('supabase/functions/_shared/locale.ts');
  assert.match(server, /SUPPORTED_LOCALES: Locale\[\] = \['ka', 'en', 'ru', 'tr', 'ar', 'he'\]/);
  assert.match(server, /DEFAULT_LOCALE: Locale = 'ka'/);
  assert.doesNotMatch(server, /: 'en';|return 'en'/, 'no English fallback left on the server');
});

test('precedence: explicit pick > saved profile > browser > Georgian', () => {
  assert.deepEqual(resolveInitialLanguage({ stored: 'ru', storedSource: 'explicit', browser: ['en-US'] }), { lang: 'ru', source: 'explicit' });
  assert.deepEqual(resolveInitialLanguage({ stored: 'tr', storedSource: 'profile', browser: ['en-US'] }), { lang: 'tr', source: 'profile' });
  /* A stored language from before the source flag was either a pick or a profile: honoured as a pick. */
  assert.deepEqual(resolveInitialLanguage({ stored: 'en', storedSource: null, browser: ['ka'] }), { lang: 'en', source: 'explicit' });
  assert.deepEqual(resolveInitialLanguage({ stored: null, storedSource: null, browser: ['de-DE', 'he-IL'] }), { lang: 'he', source: 'browser' });
  assert.deepEqual(resolveInitialLanguage({ stored: 'xx', storedSource: 'explicit', browser: ['fr-FR'] }), { lang: 'ka', source: 'default' });
  assert.deepEqual(resolveInitialLanguage({ stored: null, storedSource: null, browser: [] }), { lang: 'ka', source: 'default' });
});

test('browser languages: primary subtag, browser order, legacy Hebrew code', () => {
  assert.equal(browserLanguageFrom(['ka-GE']), 'ka');
  assert.equal(browserLanguageFrom(['iw']), 'he');
  assert.equal(browserLanguageFrom(['de', 'ru-RU', 'en']), 'ru');
  assert.equal(browserLanguageFrom(['kab', 'arn']), null, '"kab" is not Georgian and "arn" is not Arabic');
  assert.equal(browserLanguageFrom([null, undefined, '']), null);
});

test('a saved account language never overrides an explicit pick', () => {
  assert.equal(profileMayApply('explicit', 'ru'), false);
  assert.equal(profileMayApply('browser', 'ru'), true);
  assert.equal(profileMayApply('default', 'ru'), true);
  assert.equal(profileMayApply('profile', 'tr'), true);
  assert.equal(profileMayApply('default', 'de'), false);
});

test('country -> offered language is narrow, and never Russian for everyone', () => {
  assert.equal(suggestedLanguageForCountry('GE'), null, 'Georgia is already the default');
  assert.equal(suggestedLanguageForCountry('TR'), 'tr');
  assert.equal(suggestedLanguageForCountry('IL'), 'he');
  for (const c of ['SA', 'AE', 'EG', 'IQ', 'JO', 'MA']) assert.equal(suggestedLanguageForCountry(c), 'ar', c);
  for (const c of ['RU', 'BY', 'KZ', 'KG']) assert.equal(suggestedLanguageForCountry(c), 'ru', c);
  for (const c of ['UA', 'PL', 'DE', 'US', 'GB', 'IN', 'CN', 'LT', 'LV', 'EE', 'MD']) assert.equal(suggestedLanguageForCountry(c), 'en', c);
  assert.equal(suggestedLanguageForCountry('ge'), null, 'case-insensitive');
  for (const bad of ['XX', 'T1', 'GEO', '', null, 42, 'G1']) assert.equal(suggestedLanguageForCountry(bad), null, String(bad));
  assert.equal(normalizeCountry(' de '), 'DE');
});

test('the offer is only for a visitor on the Georgian default, never against a choice', () => {
  assert.equal(mayLookUpCountry('default', false), true);
  for (const source of ['explicit', 'profile', 'browser']) assert.equal(mayLookUpCountry(source, false), false, source);
  assert.equal(mayLookUpCountry('default', true), false, 'a dismissal is remembered');
  assert.equal(shouldSuggest({ source: 'default', current: 'ka', suggested: 'en', dismissed: false }), true);
  assert.equal(shouldSuggest({ source: 'default', current: 'ka', suggested: null, dismissed: false }), false);
  assert.equal(shouldSuggest({ source: 'default', current: 'en', suggested: 'en', dismissed: false }), false);
  assert.equal(shouldSuggest({ source: 'explicit', current: 'ka', suggested: 'ru', dismissed: false }), false);
});

test('the geo endpoint returns the country only, uncached, and the SPA rewrite leaves it alone', async () => {
  const src = read('api/geo.ts');
  assert.match(src, /x-vercel-ip-country/);
  assert.doesNotMatch(src, /x-forwarded-for|x-real-ip|x-vercel-ip-city|x-vercel-ip-latitude|x-vercel-ip-country-region/, 'nothing finer than the country');
  const { default: handler } = await import(new URL('api/geo.ts', ROOT).href);
  const res = handler(new Request('https://x/api/geo', { headers: { 'x-vercel-ip-country': 'de', 'x-forwarded-for': '203.0.113.9' } }));
  assert.match(res.headers.get('cache-control'), /no-store/);
  const body = await res.json();
  assert.deepEqual(body, { country: 'DE' });
  assert.deepEqual(await handler(new Request('https://x/api/geo')).json(), { country: null });
  assert.deepEqual(await handler(new Request('https://x/api/geo', { headers: { 'x-vercel-ip-country': 'XX' } })).json(), { country: null });
  const spa = JSON.parse(read('vercel.json')).rewrites.find((r) => r.destination === '/index.html');
  assert.ok(!new RegExp(`^${spa.source}$`).test('/api/geo'));
});

test('the client: explicit picks are flagged, the suggestion is mounted and never switches by itself', () => {
  const ctx = read('src/contexts/LanguageContext.tsx');
  assert.match(ctx, /writeStorage\(LANG_SOURCE_KEY, 'explicit'\)/);
  assert.match(ctx, /writeStorage\(LANG_SOURCE_KEY, 'profile'\)/);
  const sug = read('src/components/common/LanguageSuggestion.tsx');
  assert.match(sug, /mayLookUpCountry/);
  assert.match(sug, /duration: Infinity/);
  /* setLang appears only inside the toast's action, never on the fetch path. */
  assert.equal((sug.match(/setLang\(/g) ?? []).length, 1);
  assert.match(sug, /onClick: \(\) => \{\s*switched = true;\s*setLang\(target\)/);
  assert.match(read('src/App.tsx'), /<LanguageSuggestion\/>/);
});
