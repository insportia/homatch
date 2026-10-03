// PHASE 2 provenance (P1–P3) — every Find Property external result can take
// the customer to its exact original source in one click, says where it came
// from and who posted it, keeps the post as written, and never offers a link
// that is not a real http(s) URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { recordCommunitySupply } from '../../supabase/functions/_shared/communitySupply.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('P1: find-property resolves provenance in two batched reads, never per result', () => {
  const fn = code('supabase/functions/find-property/index.ts');
  assert.match(fn, /source_id,field_origins/, 'observations carry their provenance pointer');
  assert.match(fn, /from\('raw_signals'\)\s*\.select\('id,platform,source_id,source_url,parent_url,author_public_name,author_public_url,profile_url,original_text'\)\s*\.in\('id', signalIds\)/);
  assert.match(fn, /from\('source_registry'\)\s*\.select\('id,name,url'\)\.in\('id', sourceIds\)/);
  const start = fn.indexOf('const allResults = distinct.map(');
  assert.ok(start > 0, 'results are built in one map over the distinct rows');
  const map = fn.slice(start);
  assert.doesNotMatch(map.slice(0, map.indexOf('supply: brokerBlock(')), /await db|\.from\(/, 'no query inside the per-result map');
  assert.match(fn, /url: attribution\?\.permalink \?\? null/, 'the action opens the validated exact link');
  assert.match(fn, /^\s*attribution,$/m, 'attribution is returned with every result');
});

test('P1: attribution reaches the card for every external result, labelled in six languages', () => {
  const page = code('src/pages/FindPropertyPage.tsx');
  assert.match(page, /href=\{a\?\.permalink \?\? listing\.url\}/);
  assert.match(page, /attribution=\{attribution\}/);
  const card = code('src/components/customer/ListingCard.tsx');
  assert.match(card, /const actionHref = safeExternalUrl\(href\)/);
  for (const field of ['sourceUrl', 'threadUrl', 'authorUrl']) {
    assert.match(card, new RegExp(`safeExternalUrl\\(attribution\\.${field}\\)`), `${field} re-checked in the browser`);
  }
  assert.match(card, /rel="noopener noreferrer nofollow"/);
  assert.match(card, /aria-expanded=\{open\}/);
  const tr = read('src/i18n/translations.ts');
  for (const key of ['p2d_attr_open_post', 'p2d_attr_posted_by', 'p2d_attr_source', 'p2d_attr_original_text']) {
    assert.equal((tr.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 6, `${key} in all six locales`);
  }
});

test('P2: native forum.ge stores the exact post, its thread and the author profile (forward)', () => {
  const dd = code('supabase/functions/demand-discovery/index.ts');
  assert.match(dd, /source_url: safeWebUrl\(signal\.contentUrl\) \?\? safeWebUrl\(signal\.sourceUrl\)/);
  assert.match(dd, /parent_url: safeWebUrl\(signal\.sourceUrl\)/);
  assert.match(dd, /author_public_url: safeWebUrl\(signal\.authorUrl\)/);
  assert.match(read('src/research-core/adapters/forum/sources.ts'), /authorProfile: \{ pattern: \/\[\?&\]showuser=/);
});

test('P3: no fake canonical URL, and Matches opens only validated links with noopener', () => {
  const cs = code('supabase/functions/_shared/communitySupply.ts');
  assert.doesNotMatch(cs, /signal:\$\{/, 'signal:<id> is never written as a URL');
  assert.match(cs, /canonical_url: permalink/);
  const matches = code('src/pages/property/MatchesPage.tsx');
  assert.doesNotMatch(matches, /window\.open\(unlock\./);
  assert.match(matches, /openExternal\(unlock\.full_source_url\)/);
  assert.match(matches, /openExternal\(unlock\.full_profile_url\)/);
  assert.match(code('src/lib/safeExternalUrl.ts'), /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
});

function fakeDb() {
  const upserts = [];
  return {
    upserts,
    from() {
      const chain = {
        upsert(row) { upserts.push(row); return chain; },
        select() { return chain; },
        single() { return Promise.resolve({ data: { id: `obs-${upserts.length}` }, error: null }); },
      };
      return chain;
    },
  };
}

const POST = 'Сдается 2-комн. квартира в Батуми, ул. Руставели 12, 65 м², 5 этаж, 700$ в месяц.\n'
  + 'Звоните +995 599 12 34 56, WhatsApp wa.me/995599123456, @batumi_rent';
const signal = (over) => ({
  id: 'sig-1', platform: 'TELEGRAM', source_id: 'src-1', external_id: 'moonlightbatumi2023/4521',
  source_url: 'https://t.me/moonlightbatumi2023/4521', original_text: POST, language: 'ru',
  published_at: '2026-10-02T15:00:00Z', content_fingerprint: null, source: { city: 'Batumi', country_code: 'GE' }, ...over,
});

test('community supply: the exact post is the canonical URL and the text is kept verbatim, contacts included', async () => {
  const db = fakeDb();
  assert.ok(await recordCommunitySupply(db, signal()));
  const row = db.upserts[0];
  assert.equal(row.canonical_url, 'https://t.me/moonlightbatumi2023/4521');
  assert.equal(row.description, POST, 'nothing redacted');
  assert.match(row.description, /\+995 599 12 34 56/);
  assert.match(row.description, /@batumi_rent/);
  assert.equal(row.field_origins.rawSignalId, 'sig-1', 'the pointer find-property follows back');
});

test('community supply: no real link means no observation, never a signal: placeholder', async () => {
  for (const source_url of [null, '', 'signal:abc', 'javascript:alert(1)']) {
    const db = fakeDb();
    assert.equal(await recordCommunitySupply(db, signal({ source_url })), null, String(source_url));
    assert.equal(db.upserts.length, 0);
  }
});
