// Purchased leads → existing email campaigns: the hand-off URL, the per-language plan,
// and the contacts manager's source filters. Pure functions the pages run as-is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAVE_OUT, audienceLanguages, contactFiltersToParams, copyToTextBody, fallbackForSplit, isCampaignLanguage,
  languageCampaignName, parseCampaignLaunch, parseContactFilters, parseSourceFilter, planLanguageDrafts,
  shouldOfferLanguageSplit, sourceFilterOf, sourceKindQuery, withoutLaunchParams,
} from '../leadCampaigns.ts';

const LIST = '6f1c2a54-1a2b-4c3d-8e9f-0123456789ab';
const PROP = '9a8b7c6d-1111-2222-3333-444455556666';

test('launch params: only new=1 opens, ids are validated, and they are cleared afterwards', () => {
  assert.equal(parseCampaignLaunch(new URLSearchParams(`list=${LIST}`)), null);
  assert.deepEqual(parseCampaignLaunch(new URLSearchParams(`new=1&list=${LIST}&property=${PROP}`)), { listId: LIST, propertyId: PROP });
  assert.deepEqual(parseCampaignLaunch(new URLSearchParams('new=1')), { listId: null, propertyId: null });
  assert.deepEqual(parseCampaignLaunch(new URLSearchParams('new=1&list=<script>&property=a b')), { listId: null, propertyId: null });
  const rest = withoutLaunchParams(new URLSearchParams(`new=1&list=${LIST}&property=${PROP}&tab=drafts`));
  assert.equal(rest.toString(), 'tab=drafts');
});

test('per-language names and languages, unknown always last', () => {
  assert.equal(languageCampaignName(' Vake offer ', 'ka'), 'Vake offer · KA');
  assert.equal(languageCampaignName('', 'en'), 'EN');
  const langs = audienceLanguages({ unknown: { total: 9, eligible: 0 }, en: { total: 3, eligible: 2 }, ka: { total: 5, eligible: 4 }, ru: { total: 0, eligible: 0 } });
  assert.deepEqual(langs.map((x) => x.language), ['ka', 'en', 'unknown']);
  assert.equal(shouldOfferLanguageSplit(langs), true);
  assert.equal(shouldOfferLanguageSplit(audienceLanguages({ ka: { total: 5, eligible: 5 } })), false);
  assert.equal(shouldOfferLanguageSplit(audienceLanguages({ unknown: { total: 1, eligible: 0 } })), true);
  assert.equal(isCampaignLanguage('KA'), true);
  assert.equal(isCampaignLanguage('de'), false);
});

test('fallback is chosen, never guessed; leaving out creates no unknown draft', () => {
  assert.equal(fallbackForSplit(LEAVE_OUT), null);
  assert.equal(fallbackForSplit(''), null);
  assert.equal(fallbackForSplit('ka'), 'ka');
  assert.equal(fallbackForSplit('GE-country'), null);
  const plan = planLanguageDrafts('Offer', [
    { language: 'en', listId: 'l-en', audience: { total: 4, eligible: 3 } },
    { language: 'ka', listId: 'l-ka', audience: { total: 6, eligible: 1 } },
    { language: 'unknown', listId: 'l-unk', audience: { total: 2, eligible: 0 } },
  ]);
  assert.deepEqual(plan.map((p) => [p.language, p.listId, p.name, p.eligible]), [
    ['en', 'l-en', 'Offer · EN', 3], ['ka', 'l-ka', 'Offer · KA', 1],
  ]);
});

test('AI copy becomes the plain-text body without empty paragraphs', () => {
  assert.equal(copyToTextBody({ headline: 'Hi', body: 'A flat in Vake.', cta: '' }), 'Hi\n\nA flat in Vake.');
});

test('contact source filters: URL form, legacy aliases and the query they send', () => {
  assert.equal(parseSourceFilter('CURATED_LEAD'), 'CURATED_LEAD');
  assert.equal(parseSourceFilter('import'), 'UPLOADED');
  assert.equal(parseSourceFilter('MANUAL'), 'UPLOADED');
  assert.equal(parseSourceFilter('nonsense'), null);
  assert.equal(sourceFilterOf(null), 'UPLOADED');
  assert.equal(sourceFilterOf('INTERNAL_MATCH'), 'INTERNAL_MATCH');
  const f = parseContactFilters(new URLSearchParams(`source=CURATED_LEAD&language=Unknown&country=ge&list=${LIST}`));
  assert.deepEqual(f, { source: 'CURATED_LEAD', language: 'unknown', country: 'GE', list: LIST });
  assert.deepEqual(parseContactFilters(new URLSearchParams('language=../x&country=GEO')), { source: null, language: null, country: null, list: null });
  const p = contactFiltersToParams({ source: 'UPLOADED', language: null, country: 'GE', list: null }, new URLSearchParams('language=ka&x=1'));
  assert.equal(p.toString(), 'x=1&source=UPLOADED&country=GE');
  assert.deepEqual(sourceKindQuery('CURATED_LEAD'), { eq: 'CURATED_LEAD' });
  assert.deepEqual(sourceKindQuery('UPLOADED'), { or: 'source_kind.is.null,source_kind.in.(IMPORT,MANUAL)' });
});
