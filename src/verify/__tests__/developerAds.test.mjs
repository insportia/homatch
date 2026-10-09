// Developer Advertising Intelligence — the deterministic core.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDeveloperAdsPolicy, resolveDeveloperIdentity, buildActorInput, normalizeAds, matchAdvertiser,
  summarizeAds, socialProfiles, themesOf, adsCacheKey, adsPromptDigest, nameKey, DEFAULT_ADS_ACTOR,
} from '../developerAds.ts';

const RESULT = {
  projectProfile: { name: 'Archi Vake', aliases: ['არქი ვაკე'], developer: 'Archi', developerCompany: 'შპს არქი', website: 'https://archi.ge' },
  companyProfile: { name: 'შპს არქი', idCode: '404000000', sourceBasis: 'REGISTRY_CONFIRMED' },
  sources: [
    { url: 'https://www.instagram.com/archi.ge/', label: 'Archi' },
    { url: 'https://www.facebook.com/someotherpage', label: 'Unrelated Realty' },
    { url: 'https://www.tiktok.com/@archivake', label: 'Archi Vake' },
  ],
};
const ad = (id, over = {}) => ({ ad_archive_id: String(id), page_id: '111', page_name: 'Archi', is_active: true, start_date: 1_717_200_000, publisher_platform: ['FACEBOOK', 'INSTAGRAM'], snapshot: { body: { text: 'Archi Vake — განვადება 0%, აუზი და პარკინგი. ფასი $1200-დან' }, title: 'Archi Vake', link_url: 'https://archi.ge/vake', cta_text: 'Learn more', page_profile_uri: 'https://www.facebook.com/archi.ge' }, ...over });
const POLICY = parseDeveloperAdsPolicy({ enabled: true });

test('policy: paid runs need explicit enabled:true; actor limited to memo23; caps clamped', () => {
  assert.equal(parseDeveloperAdsPolicy(null).enabled, false);
  assert.equal(parseDeveloperAdsPolicy({ enabled: 'yes' }).enabled, false);
  assert.equal(parseDeveloperAdsPolicy({ actorId: 'evil~actor' }).actorId, DEFAULT_ADS_ACTOR);
  assert.equal(parseDeveloperAdsPolicy({ actorId: 'memo23/facebook-ads-library-scraper-ppe' }).actorId, DEFAULT_ADS_ACTOR);
  assert.equal(parseDeveloperAdsPolicy({ maxItems: 9999, maxChargeUsd: 50 }).maxItems, 100);
  assert.equal(parseDeveloperAdsPolicy({ maxChargeUsd: 50 }).maxChargeUsd, 1);
});

test('identity: developer brand and project from Verify evidence; legal forms stripped; registry basis kept', () => {
  const id = resolveDeveloperIdentity(RESULT);
  assert.equal(id.basis, 'REGISTRY_CONFIRMED');
  assert.equal(id.legalId, '404000000');
  assert.deepEqual(id.searchTerms, ['Archi', 'Archi Vake']);
  assert.equal(nameKey('შპს "არქი"'), 'არქი');
  assert.deepEqual(resolveDeveloperIdentity({}).searchTerms, []);
  assert.equal(resolveDeveloperIdentity({}).basis, 'NONE');
});

test('input uses only fields the live schema declares; no search field → not run', () => {
  const id = resolveDeveloperIdentity(RESULT);
  assert.deepEqual(buildActorInput(['searchTerms', 'searchCountries', 'maxItems', 'adActiveStatus'], id, POLICY), { searchTerms: ['Archi', 'Archi Vake'], searchCountries: ['GE'], maxItems: 50 });
  assert.deepEqual(buildActorInput(['searchTerms'], id, POLICY), { searchTerms: ['Archi', 'Archi Vake'] });
  assert.equal(buildActorInput(['startUrls', 'maxItems'], id, POLICY), null, 'unsupported capability');
  assert.equal(buildActorInput(['searchTerms'], resolveDeveloperIdentity({}), POLICY), null, 'no identity');
});

test('normalization: duplicates removed, non-ads rejected, unknown fields recorded, permalinks real', () => {
  const n = normalizeAds([ad(123456789), ad(123456789), ad(987654321, { is_active: false }), { foo: 1 }, { ad_archive_id: 'x' }]);
  assert.equal(n.ads.length, 2);
  assert.equal(n.duplicates, 1);
  assert.equal(n.unparsed, 2);
  assert.ok(n.unmappedKeys.includes('foo'));
  assert.equal(n.ads[0].libraryUrl, 'https://www.facebook.com/ads/library/?id=123456789');
  assert.equal(n.ads[0].startDate, '2024-06-01');
  assert.equal(n.ads[1].active, false);
});

test('advertiser match is exact and whole-word: similar names are not the developer', () => {
  const id = resolveDeveloperIdentity(RESULT);
  assert.equal(matchAdvertiser('Archi', id), 'DEVELOPER');
  assert.equal(matchAdvertiser('Archi Vake', id), 'DEVELOPER');
  assert.equal(matchAdvertiser('Archive Realty', id), null);
  assert.equal(matchAdvertiser('Archimedes Group', id), null);
  assert.equal(matchAdvertiser(null, id), null);
});

test('summary: active vs historical, other advertisers excluded and counted, themes, no invented spend', () => {
  const id = resolveDeveloperIdentity(RESULT);
  const n = normalizeAds([ad(1000001), ad(1000002, { is_active: false, publisher_platform: ['FACEBOOK'] }), ad(1000003, { page_name: 'Archive Realty', page_id: '999' }), ad(1000004, { is_active: undefined })]);
  const v = summarizeAds({ outcome: 'COMPLETE', verifiedAt: '2026-10-08T20:00:00Z', policy: POLICY, identity: id, normalized: n, result: RESULT });
  assert.equal(v.activeCount, 1);
  assert.equal(v.historicalCount, 1);
  assert.equal(v.unknownStatusCount, 1);
  assert.equal(v.otherAdvertiserAds, 1);
  assert.ok(v.limitations.includes('OTHER_ADVERTISERS_EXCLUDED'));
  assert.ok(v.limitations.includes('NO_SPEND_OR_REACH_REPORTED'));
  assert.deepEqual(v.platforms, ['FACEBOOK', 'INSTAGRAM']);
  assert.equal(v.concentration, 'MULTI_PLATFORM');
  assert.deepEqual(v.projectsAdvertised, ['Archi Vake']);
  assert.deepEqual(v.themes.map((t) => t.theme).sort(), ['AMENITIES', 'PAYMENT_TERMS', 'PRICE'].sort());
  assert.equal(v.examples[0].active, true);
  assert.ok(!JSON.stringify(v).match(/spend"\s*:\s*"\d|impressions"\s*:\s*"\d/), 'no invented figures');
});

test('social profiles: Ad Library advertiser page and website are OFFICIAL; name matches POSSIBLE; unrelated pages dropped', () => {
  const id = resolveDeveloperIdentity(RESULT);
  const matched = normalizeAds([ad(1000001)]).ads.map((a) => ({ ...a, owner: 'DEVELOPER' }));
  const p = socialProfiles(RESULT, id, matched);
  const fb = p.find((x) => x.url === 'https://www.facebook.com/archi.ge');
  assert.deepEqual([fb.status, fb.basis], ['OFFICIAL', 'AD_LIBRARY_ADVERTISER']);
  assert.equal(p.find((x) => x.platform === 'WEBSITE').status, 'OFFICIAL');
  assert.equal(p.find((x) => x.platform === 'INSTAGRAM').status, 'POSSIBLE');
  assert.equal(p.find((x) => x.platform === 'TIKTOK').status, 'POSSIBLE');
  assert.ok(!p.some((x) => x.url.includes('someotherpage')));
});

test('missing data: no ads → zero counts, NONE concentration, never "inactive"; a not-run search says why', () => {
  const id = resolveDeveloperIdentity(RESULT);
  const v = summarizeAds({ outcome: 'UNSUPPORTED', verifiedAt: null, policy: POLICY, identity: id, normalized: { ads: [], duplicates: 0 }, result: RESULT });
  assert.equal(v.activeCount, 0);
  assert.equal(v.concentration, 'NONE');
  assert.ok(v.limitations.includes('NOT_SEARCHED_UNSUPPORTED'));
  assert.match(adsPromptDigest(v), /no ads found never means the developer is inactive/);
});

test('cache key: same actor, country and terms are the same search, order-insensitive', () => {
  const a = resolveDeveloperIdentity(RESULT);
  const b = { ...a, searchTerms: [...a.searchTerms].reverse() };
  assert.equal(adsCacheKey(POLICY, a), adsCacheKey(POLICY, b));
  assert.notEqual(adsCacheKey(POLICY, a), adsCacheKey({ ...POLICY, country: 'AM' }, a));
});

test('themes are detected in Georgian, English and Russian', () => {
  assert.deepEqual(themesOf(['investment with 12% yield']).map((t) => t.theme), ['INVESTMENT']);
  assert.ok(themesOf(['рассрочка без процентов']).some((t) => t.theme === 'PAYMENT_TERMS'));
  assert.ok(themesOf(['ჩაბარება 2027 წელს']).some((t) => t.theme === 'COMPLETION'));
});

// ───────────── customer surface: links, report guard, payload ─────────────

import { safeLibraryHref, safeProfileHref } from '../developerAds.ts';
import { guardAdvertising } from '../intelligence/report.ts';
import { readFileSync } from 'node:fs';
const code = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('only Meta Ad Library addresses and OFFICIAL https profiles are linkable', () => {
  assert.equal(safeLibraryHref('https://www.facebook.com/ads/library/?id=123'), 'https://www.facebook.com/ads/library/?id=123');
  for (const bad of ['http://www.facebook.com/ads/library/?id=1', 'https://evil.example/ads/library/?id=1', 'javascript:alert(1)', 'https://www.facebook.com.evil.example/ads/library/?id=1', 'https://www.facebook.com/ads/library/?id=1" onmouseover="x', null, undefined]) {
    assert.equal(safeLibraryHref(bad), null, String(bad));
  }
  assert.equal(safeProfileHref({ status: 'OFFICIAL', url: 'https://www.instagram.com/archi.ge/' }), 'https://www.instagram.com/archi.ge/');
  assert.equal(safeProfileHref({ status: 'POSSIBLE', url: 'https://www.instagram.com/archi.ge/' }), null, 'a name match is never linked');
  assert.equal(safeProfileHref({ status: 'OFFICIAL', url: 'http://archi.ge' }), null);
  assert.equal(safeProfileHref({ status: 'OFFICIAL', url: 'javascript:alert(1)' }), null);
  assert.equal(safeProfileHref({ status: 'OFFICIAL', url: 'https://user:pw@archi.ge' }), null);
});

test('the advertising assessment cannot turn ads into financial, trust or official claims', () => {
  const g = guardAdvertising({
    statement: 'The developer advertises installments on Facebook and Instagram. This shows the developer is financially strong.',
    points: ['Ads emphasise 0% installments.', 'A reliable developer with strong sales.', 'The project is inactive.'],
    cites: ['E1'],
  });
  assert.equal(g.statement, 'The developer advertises installments on Facebook and Instagram.');
  assert.deepEqual(g.points, ['Ads emphasise 0% installments.']);
  assert.equal(guardAdvertising({ statement: 'სანდო დეველოპერია.', points: [], cites: [] }), undefined);
});

test('the report section links only through the safe helpers, never an ad landing page, and says ads are claims', () => {
  const src = code('src/components/verify/DeveloperAdvertising.tsx');
  assert.ok(!/linkUrl/.test(src), 'an advertiser-controlled landing page must not be rendered');
  const hrefs = [...src.matchAll(/href=\{([^}]+)\}/g)].map((m) => m[1].trim());
  assert.deepEqual([...new Set(hrefs)].sort(), ['href', 'search'], 'hrefs come only from the two safe-helper variables');
  assert.match(src, /<OutLink href=\{href\}>/);
  assert.ok((src.match(/const href = safe(Library|Profile)Href\(/g) || []).length === 2, 'every linked href comes from a safe helper');
  assert.match(src, /const search = safeLibraryHref\(/);
  assert.match(src, /rel="noopener noreferrer nofollow"/);
  assert.match(src, /verify_ads_marketing_note/);
  assert.match(src, /view\.outcome !== 'COMPLETE' && view\.outcome !== 'CACHED'/, 'only a completed stage renders');
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<DeveloperAdvertising view=\{synthesis\.developerAds\} assessment=\{r\.advertisingAssessment\} \/>/);
});

test('customer payloads carry the view only, never the stage internals', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.match(agent, /delete \w+\._developerAds/, 'the internal stage state is stripped from customer payloads');
  const synth = code('supabase/functions/verify-synthesis/index.ts');
  assert.match(synth, /developerAds: pkg\.developerAds && \(pkg\.developerAds\.outcome === 'COMPLETE' \|\| pkg\.developerAds\.outcome === 'CACHED'\)/);
  assert.ok(!/_developerAds/.test(synth), 'synthesis never reads the internal stage state');
  // Seeded on by the owner's release authorization (2026-10-09); a missing or
  // unreadable setting still means OFF.
  assert.match(code('supabase/migrations/20261023090000_verify_official_visuals_and_switches.sql'), /\('verify_developer_ads', '\{"enabled":true,[^']*"maxChargeUsd":0\.5,/);
  assert.equal(parseDeveloperAdsPolicy(null).enabled, false);
  assert.equal(parseDeveloperAdsPolicy({ enabled: 'true' }).enabled, false, 'only a literal true enables paid runs');
});

test('one advertiser page is listed once, under its named profile rather than its numeric id', () => {
  const id = resolveDeveloperIdentity(RESULT);
  const n = normalizeAds([
    ad(2000001, { snapshot: { body: { text: 'x' }, title: 'Archi Vake' } }), // no profile URI → facebook.com/111
    ad(2000002), // same page_id, named profile URI
  ]);
  const profiles = socialProfiles(RESULT, id, n.ads.map((a) => ({ ...a, owner: 'DEVELOPER' }))).filter((p) => p.basis === 'AD_LIBRARY_ADVERTISER');
  assert.deepEqual(profiles.map((p) => p.url), ['https://www.facebook.com/archi.ge']);
});

test('the stage obeys the same APIFY switch as Find Buyers, through the shared reader', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.match(agent, /import \{ providerDisabledByAdmin \} from '\.\.\/_shared\/providerSwitch\.ts';/);
  assert.equal((agent.match(/providerDisabledByAdmin\(await adminSettingJson\(sb, 'provider_disabled_list'\), 'APIFY'\)/g) || []).length, 2, 'the stage and its admin card both check the switch');
});

test('a street address is never searched as a project name (production shape: Kristian Stiven Street, 18)', () => {
  const id = resolveDeveloperIdentity({
    projectProfile: { name: 'Kristian Stiven Street, 18', aliases: ['18 Kristian Stiven Street, Digomi, Tbilisi', 'ქრისტიან სტივენის ქუჩა 18'], developer: 'შპს „ჯეო სითი დიღომი“', address: '18 Kristian Stiven Street, Digomi, Tbilisi' },
    companyProfile: { name: 'შპს „ჯეო სითი დიღომი“', sourceBasis: 'REGISTRY_CONFIRMED' },
  });
  assert.deepEqual(id.searchTerms, ['ჯეო სითი დიღომი']);
  assert.deepEqual(id.projectNames, []);
  for (const keep of ['Archi Isani 2', 'Tbilisi Towers 2', 'm2 at Mtatsminda', 'Royal Vake']) {
    assert.deepEqual(resolveDeveloperIdentity({ projectProfile: { name: keep, address: '22 Kipshidze Street, Vake, Tbilisi' } }).projectNames, [keep], keep);
  }
  assert.deepEqual(resolveDeveloperIdentity({ projectProfile: { name: 'Kipshidze 22', address: '22 Kipshidze Street, Vake, Tbilisi' } }).projectNames, []);
});

test('the finished report keeps the advertising stage (job c80f7237: billed, then dropped by finish())', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const fin = agent.slice(agent.indexOf('async function finish('), agent.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE'"));
  assert.match(fin, /developerAds: prior\.developerAds \?\? null,/, 'customer view carried into the final result_json');
  assert.match(fin, /_developerAds: prior\._developerAds \?\? null,/, 'internal state (input, schema, price, cache key) carried too');
  // ...and still never reaches a customer payload.
  assert.match(agent, /delete r\[k\];/);
  assert.match(agent, /'_developerAds'\]\) delete r\[k\]/);
});

test('a financial lookup is claimed before the worker is started (job c80f7237 started rstax twice)', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const fn = agent.slice(agent.indexOf('async function startFinancialEntity('), agent.indexOf('async function processFinancialQueue('));
  const claim = fn.indexOf(".eq('updated_at', j.updated_at)");
  const call = fn.indexOf('await wf(FINANCIAL_ENDPOINT[source]');
  assert.ok(claim > 0 && call > claim, 'the conditional claim precedes the worker call');
  assert.match(fn, /if \(!claimed\?\.length\) return null;/, 'a tick that loses the claim starts nothing');
  assert.match(fn, /\.eq\('updated_at', claimedAt\)/, 'a failed start hands the row back');
  assert.match(agent, /stallLimitsFor\(prior\._financialEntityRequestedFor\?\.source\)/, 'the stall limit is per source');
});
