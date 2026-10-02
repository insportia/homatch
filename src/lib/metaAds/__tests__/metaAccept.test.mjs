// META ADS — FINAL ACCEPTANCE. What the owner saw on a real phone, pinned:
// no raw key ever, every readiness item leads to its field, one universal
// location search, the connection says ONE thing that is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHECK_TARGET, DETAIL_KEYS, GAP_TARGET, checkTitleKey, issueTarget, severityOf } from '../readiness.ts';
import { preflightDetails } from '../../../components/metaAds/builder/steps.ts';
import { META_ACCEPT_STRINGS as A } from '../../../../scripts/meta-accept-i18n-data.mjs';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const bundle = read('src/i18n/translations.ts');
const LOCALE_START = ['const en = {', 'const ka: ', 'const ru: ', 'const tr: ', 'const ar: ', 'const he: '].map((m) => bundle.indexOf(m));
/** Is `key` defined in every one of the six locale blocks? */
function inAllLocales(key) {
  return LOCALE_START.every((start, i) => {
    const end = LOCALE_START[i + 1] ?? bundle.length;
    return bundle.slice(start, end).includes(`\n  ${key}: `);
  });
}

const engine = read('supabase/functions/meta-ads-api/engine.ts');
const preflightSrc = engine.slice(engine.indexOf('export async function runPreflight'), engine.indexOf('export async function domainCheck'));

test('READINESS: every check the server can emit has a title in six languages and a field to fix it', () => {
  const keys = [...new Set([...preflightSrc.matchAll(/add\('([a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 20, `found ${keys.length} checks`);
  for (const k of keys) {
    assert.ok(CHECK_TARGET[k], `${k} has a target step/field`);
    assert.equal(checkTitleKey(k), `mads_check_${k}`);
    assert.ok(inAllLocales(`mads_check_${k}`), `mads_check_${k} in all six locales`);
  }
  assert.equal(checkTitleKey('something_new'), 'mm_r_check_other', 'an unknown check is "needs attention", never its id');
  assert.ok(inAllLocales('mm_r_check_other'));
});

test('READINESS: every detail code becomes words — never a key, a rule id or a scope name', () => {
  for (const k of DETAIL_KEYS) assert.ok(inAllLocales(k), `${k} in all six locales`);
  const targeting = read('src/lib/metaAds/targeting.ts');
  const plan = read('src/lib/metaAds/strategy.ts');
  const codes = new Set([
    ...[...targeting.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]),
    ...[...plan.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]),
    ...[...preflightSrc.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]),
  ]);
  const skip = /^(READY|WARNING|ACTION_REQUIRED|CUSTOM|PAGE|AD_ACCOUNT|INSTAGRAM|PIXEL|LEAD_FORM|WHATSAPP|SUSPENDED|REAL|MOCK|MANUAL_REVIEW|NEEDS_CHANGES|BLOCKED|IN_REVIEW|APPROVED|OPEN|HIGH|ENGAGEMENT|LEADS_ON_META|LEADS_ON_WEBSITE|SITE_REGISTRATIONS|PROMOTE|BLOCKING_ERROR|PAGE_REQUIRED|NONE|DISCONNECTED|META_FORM|MESSAGING|WEBSITE)$/;
  for (const c of codes) {
    if (skip.test(c)) continue;
    const d = preflightDetails(c);
    for (const { key } of d) assert.ok(inAllLocales(key), `${c} → ${key} in all six locales`);
  }
  assert.deepEqual(preflightDetails('LOCATION_REQUIRED'), [{ key: 'madsb_pfd_location_required', value: 'LOCATION_REQUIRED' }].map((x) => ({ ...x, value: '' })));
  assert.deepEqual(preflightDetails('ads_management,ads_read,business_management'), [{ key: 'mm_r_pfd_permissions', value: '' }]);
  assert.deepEqual(preflightDetails('SOME_FUTURE_CODE'), [], 'unknown → left out (the check title still speaks)');
  assert.deepEqual(preflightDetails('meta_err_<script>'), [], 'only a well-formed meta_err_ key passes');
});

test('READINESS: the screen renders titles through the map — the raw `mads_check_${key}` lookup is gone', () => {
  const review = read('src/components/metaAds/builder/ReviewStep.tsx');
  assert.doesNotMatch(review, /t\(`mads_check_\$\{ch\.key\}`/);
  assert.match(review, /t\(checkTitleKey\(ch\.key\) as never\)/);
  const steps = read('src/components/metaAds/builder/steps.ts');
  assert.match(steps, /DETAIL_KEYS\.has\(key\) \? \{ key, value: '' \} : null/, 'no unshipped key is ever built');
});

test('READINESS: issue code → step → field; BLOCKER / WARNING kept apart', () => {
  assert.deepEqual(issueTarget('targeting', 'LOCATION_REQUIRED'), { step: 'audience', field: 'locations' });
  assert.deepEqual(issueTarget('targeting', 'AGE_RANGE_INVALID'), { step: 'audience', field: 'who' });
  assert.deepEqual(issueTarget('creatives', 'HEADLINE_REQUIRED,NO_MEDIA'), { step: 'creative', field: 'headline' });
  assert.deepEqual(issueTarget('permissions', 'ads_management'), { step: 'account', field: 'connect' });
  assert.deepEqual(issueTarget('balance', 'SHORT_100'), { step: 'review', field: 'funding' });
  assert.deepEqual(issueTarget('unknown_check'), { step: 'review', field: 'check' });
  assert.equal(severityOf('ACTION_REQUIRED'), 'BLOCKER');
  assert.equal(severityOf('WARNING'), 'WARNING');
  assert.equal(severityOf('READY'), null);
  assert.equal(severityOf(undefined, false), 'BLOCKER');
});

test('READINESS: every field a link can land on exists on screen', () => {
  const sources = ['src/pages/outreach/MetaAdsCreatePage.tsx', ...['AccountPanel', 'DestinationStep', 'AudienceStep', 'BudgetStep', 'CreativeStep', 'ReviewStep', 'FundingCard']
    .map((f) => `src/components/metaAds/builder/${f}.tsx`)].map(read).join('\n');
  const fields = new Set([...Object.values(CHECK_TARGET), ...Object.values(GAP_TARGET)].map((x) => x.field));
  fields.delete('check'); // the check itself, on the review step
  for (const f of fields) {
    const anchored = sources.includes(`data-mm-field="${f}"`) || sources.includes(`field="${f}"`)
      || (f === 'page' || f === 'ad_account') && /data-mm-field=\{kind === 'PAGE' \? 'page' : kind === 'AD_ACCOUNT' \? 'ad_account'/.test(sources);
    assert.ok(anchored, `field "${f}" has an anchor`);
  }
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /if \(field\) focusField\(field\);/);
  assert.match(page, /left=\{openSteps\.length\} onLeft=/, '"N left" is a link');
  assert.match(page, /data-mm-gap-link=/, 'the footer hint is a link');
  const focus = read('src/components/metaAds/builder/focusField.ts');
  assert.match(focus, /scrollIntoView\(\{ behavior: reduce \? 'auto' : 'smooth', block: 'center' \}\)/);
  assert.match(focus, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focus, /\[data-mm-fold\]\[aria-expanded="false"\]/, 'a folded section opens');
  assert.doesNotMatch(focus, /setInterval/, 'bounded, never a poller');
});

test('copy: every new key has six real translations with the placeholders intact', () => {
  const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
  for (const [k, v] of Object.entries(A)) {
    assert.equal(v.length, 6, k);
    for (const s of v) { assert.ok(s.trim(), k); assert.equal(ph(s), ph(v[0]), `${k} placeholders`); }
    assert.ok(inAllLocales(k), `${k} applied`);
  }
});
