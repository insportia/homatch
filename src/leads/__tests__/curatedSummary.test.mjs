// EXTERNAL LEADS DATABASE — the curated-lead summary (src/leads/curatedSummary.ts), with the
// real copy from scripts/matching-workspace-i18n-data.mjs in English and Georgian:
//   * the role comes from the recorded interests (BUY never reads as a tenant unless both);
//   * the country and languages are their own fields — a language is never inferred;
//   * no budget, city or type is ever invented; an absent budget is said to be absent;
//   * an administrator's description leads, and the facts still follow it;
//   * deterministic: the same lead gives the same line; no placeholder is left behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelLabels, curatedSummary, curatedSummaryParts, knownInterests, roleKey } from '../curatedSummary.ts';
import { MATCHING_WORKSPACE_STRINGS } from '../../../scripts/matching-workspace-i18n-data.mjs';

const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
function ctx(lang = 'en') {
  const i = LANGS.indexOf(lang);
  const t = (key, vars = {}) => {
    const row = MATCHING_WORKSPACE_STRINGS[key];
    assert.ok(row, `missing key ${key}`);
    return row[i].replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
  };
  const region = new Intl.DisplayNames([lang === 'ka' ? 'ka-GE' : lang], { type: 'region' });
  const language = new Intl.DisplayNames([lang === 'ka' ? 'ka-GE' : lang], { type: 'language' });
  return {
    t, lang,
    countryName: (c) => region.of(c) ?? c,
    languageName: (c) => language.of(c) ?? c,
    money: (n, cur) => `${cur ?? 'USD'} ${n}`,
    list: (items) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(items),
  };
}

const lead = (over = {}) => ({
  country: 'DE', languages: ['en'], interests: ['INVEST'], city: null, region: null, preferredLocation: null,
  budget: null, propertyType: null, description: null,
  channels: { email: true, phone: false, whatsapp: false, telegram: false, facebook: false, linkedin: false, otherSocial: false },
  ...over,
});

test('an investor from Germany with English: role, country, interest, language — facts only', () => {
  const s = curatedSummary(lead(), ctx('en'));
  assert.equal(s, 'Potential investor from Germany interested in real estate investment. English-speaking contact. Email contact available. No specific budget recorded.');
});

test('a tenant from the UAE with no language: no language sentence, "the" before the country, no budget invented', () => {
  const s = curatedSummary(lead({ country: 'AE', interests: ['RENT'], languages: [] }), ctx('en'));
  assert.equal(s, 'Prospective tenant from the United Arab Emirates. Email contact available. No specific budget recorded.');
  assert.doesNotMatch(s, /speaking|Speaks/);
});

test('roles: BUY is never a tenant unless explicitly both; nothing recorded is a potentially interested person', () => {
  assert.equal(roleKey(['BUY']), 'mw_sum_role_BUY');
  assert.equal(roleKey(['RENT', 'BUY']), 'mw_sum_role_BUY_RENT');
  assert.equal(roleKey(['invest', 'buy', 'BUY']), 'mw_sum_role_BUY_INVEST');
  assert.equal(roleKey(['BUY', 'RENT', 'INVEST']), 'mw_sum_role_ALL');
  assert.equal(roleKey([]), 'mw_sum_role_NONE');
  assert.equal(roleKey(['SELL']), 'mw_sum_role_NONE', 'an unknown interest is not a role');
  assert.deepEqual(knownInterests(['RENT', 'BUY']), ['BUY', 'RENT']);
  const buyer = curatedSummary(lead({ interests: ['BUY'] }), ctx('en'));
  assert.match(buyer, /^Potential buyer from Germany\./);
  assert.doesNotMatch(buyer, /tenant|invest/i);
  assert.match(curatedSummary(lead({ interests: [] }), ctx('en')), /^Potentially interested person from Germany\./);
  for (const l of LANGS) assert.doesNotMatch(curatedSummary(lead({ interests: [] }), ctx(l)), /confirmed/i);
});

test('stated facts appear, and only those: budget range, up to, location, type, several languages and channels', () => {
  const s = curatedSummary(lead({
    interests: ['BUY'], languages: ['ru', 'en'], preferredLocation: 'Batumi', propertyType: 'Apartment',
    budget: { min: 100000, max: 250000, currency: 'USD' },
    channels: { email: true, phone: true, whatsapp: true, telegram: false, facebook: false, linkedin: false, otherSocial: false },
  }), ctx('en'));
  assert.equal(s, 'Potential buyer from Germany. Speaks Russian and English. Email, Phone, and WhatsApp contacts available. Preferred location: Batumi. Property type: Apartment. Budget USD 100000 – USD 250000.');
  assert.match(curatedSummary(lead({ budget: { min: null, max: 90000, currency: 'EUR' } }), ctx('en')), /Budget up to EUR 90000\./);
  assert.match(curatedSummary(lead({ budget: { min: 0, max: 0, currency: 'USD' } }), ctx('en')), /No specific budget recorded\./, 'zero is not a budget');
  /* City and region are used only when no preferred location is recorded. */
  assert.match(curatedSummary(lead({ city: 'Tbilisi', region: 'Tbilisi region' }), ctx('en')), /Preferred location: Tbilisi, Tbilisi region\./);
});

test('a language is never inferred from the country; "unknown" is not a language', () => {
  const s = curatedSummary(lead({ country: 'GE', languages: ['unknown'] }), ctx('en'));
  assert.doesNotMatch(s, /Georgian|speaking|Speaks/);
});

test('the administrator description leads, and the facts still follow it', () => {
  const parts = curatedSummaryParts(lead({ description: '  Relocating family,  looking near schools ' }), ctx('en'));
  assert.equal(parts[0], 'Relocating family, looking near schools.');
  assert.equal(parts[1], 'Potential investor from Germany interested in real estate investment.');
  assert.ok(parts.includes('No specific budget recorded.'));
});

test('Georgian reads naturally (no case grammar on the country) and every locale is free of placeholders', () => {
  const ka = curatedSummary(lead(), ctx('ka'));
  assert.match(ka, /^პოტენციური ინვესტორი · გერმანია — დაინტერესებულია უძრავ ქონებაში ინვესტირებით\./);
  assert.match(ka, /კონკრეტული ბიუჯეტი მითითებული არ არის\./);
  assert.match(curatedSummary(lead({ interests: ['RENT'] }), ctx('ka')), /მოიჯარე/);
  for (const l of LANGS) {
    const s = curatedSummary(lead({ interests: ['BUY', 'RENT'], languages: ['en', 'ka'], preferredLocation: 'Tbilisi', budget: { min: 1, max: 2, currency: 'USD' } }), ctx(l));
    assert.doesNotMatch(s, /\{\{|\}\}|undefined|null/, `${l}: ${s}`);
    assert.equal(s, curatedSummary(lead({ interests: ['BUY', 'RENT'], languages: ['en', 'ka'], preferredLocation: 'Tbilisi', budget: { min: 1, max: 2, currency: 'USD' } }), ctx(l)), 'deterministic');
  }
});

test('channel labels follow the record, in a fixed order', () => {
  const { t } = ctx('en');
  assert.deepEqual(channelLabels({ linkedin: true, email: true, telegram: true }, t), ['Email', 'Telegram', 'LinkedIn']);
  assert.deepEqual(channelLabels(null, t), []);
});
