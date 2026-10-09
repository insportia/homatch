// PHOTO REFRESH — 2026-10-08 production: a MyHome listing the source no longer
// shows. Every refresh still called ZenRows and ScrapingBee (both switched off
// on Admin → Providers) for ~75 s, then wrote error_code
// LISTING_NOT_AVAILABLE — a value outside the import_error_code enum — so the
// UPDATE failed silently and every refresh row stayed PROCESSING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { providerDisabledByAdmin, loadDisabledProviders } = await import('../providerSwitch.ts');
const { apifyDisabledByAdmin } = await (async () => {
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      if (spec.startsWith('https://esm.sh/')) return { url: 'data:text/javascript,export const createClient = () => null;', shortCircuit: true };
      return next(spec, ctx);
    }`));
  globalThis.Deno = { env: { get: () => undefined } };
  return import('../findBuyers/campaign.ts');
})();

const dbWith = (value, error = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }),
});

test('the switch reads the stored list (array or JSON text), case-insensitively; unreadable disables nothing', async () => {
  const prod = ['DATAFORSEO', 'ZENROWS', 'SCRAPINGBEE', 'BRIGHTDATA'];
  assert.equal(providerDisabledByAdmin(prod, 'zenrows'), true);
  assert.equal(providerDisabledByAdmin(JSON.stringify(prod), 'ScrapingBee'), true);
  assert.equal(providerDisabledByAdmin(['APIFY'], 'ZENROWS'), false);
  assert.equal(providerDisabledByAdmin('not json', 'ZENROWS'), false);
  assert.deepEqual([...await loadDisabledProviders(dbWith(prod))].sort(), ['BRIGHTDATA', 'DATAFORSEO', 'SCRAPINGBEE', 'ZENROWS']);
  assert.deepEqual([...await loadDisabledProviders(dbWith('["zenrows"]'))], ['ZENROWS']);
  assert.equal((await loadDisabledProviders(dbWith(undefined))).size, 0);
  assert.equal((await loadDisabledProviders(dbWith(null, { message: 'x' }))).size, 0);
});

test('the Apify switch keeps its behaviour through the shared helper', () => {
  assert.equal(apifyDisabledByAdmin(['APIFY', 'DATAFORSEO']), true);
  assert.equal(apifyDisabledByAdmin('["apify"]'), true);
  assert.equal(apifyDisabledByAdmin(['DATAFORSEO']), false);
  assert.equal(apifyDisabledByAdmin('not json'), false);
});

const SRC = readFileSync(new URL('../../import-property/index.ts', import.meta.url), 'utf8');

test('import-property: a switched-off paid renderer has no key, so it is never called', () => {
  const load = SRC.indexOf('await loadDisabledProviders(supabase)');
  const zen = SRC.indexOf("const zenrowsKey");
  const bee = SRC.indexOf("const scrapingbeeKey");
  assert.ok(load > 0 && load < zen && load < bee, 'the switch is read before either key');
  assert.match(SRC, /const zenrowsKey\s*=\s*disabledProviders\.has\('ZENROWS'\) \? undefined : Deno\.env\.get\('ZENROWS_API_KEY'\)/);
  assert.match(SRC, /const scrapingbeeKey = disabledProviders\.has\('SCRAPINGBEE'\) \? undefined : Deno\.env\.get\('SCRAPINGBEE_API_KEY'\)/);
  assert.equal((SRC.match(/Deno\.env\.get\('ZENROWS_API_KEY'\)/g) ?? []).length, 1, 'no other path reads the ZenRows key');
  assert.equal((SRC.match(/Deno\.env\.get\('SCRAPINGBEE_API_KEY'\)/g) ?? []).length, 1, 'no other path reads the ScrapingBee key');
  assert.ok(/fetch\(\s*`https:\/\/api\.zenrows\.com/.test(SRC) && /if \(!html && zenrowsKey\)/.test(SRC), 'ZenRows only behind its key');
  assert.ok(/if \(!html && scrapingbeeKey\)/.test(SRC), 'ScrapingBee only behind its key');
});

test('import-property: error codes written to the enum column are always enum values', () => {
  /* The enum as the schema defines it (no later migration alters it). */
  const schema = readFileSync(new URL('../../../migrations/20260827203146_homatch_part1_schema.sql', import.meta.url), 'utf8');
  const enumValues = schema.match(/create type import_error_code as enum \(([^)]+)\)/)[1].match(/'([A-Z_]+)'/g).map((v) => v.slice(1, -1));
  const declared = SRC.match(/const DB_ERROR_CODES = new Set\(\[([^\]]+)\]\)/)?.[1].match(/'([A-Z_]+)'/g).map((v) => v.slice(1, -1));
  assert.deepEqual([...declared].sort(), [...enumValues].sort(), 'the guard lists exactly the enum');
  assert.ok(!enumValues.includes('LISTING_NOT_AVAILABLE'), 'the code that broke the write is not an enum value');
  const update = SRC.slice(SRC.indexOf('const updateImport = async'), SRC.indexOf('// ── Step 1'));
  assert.match(update, /!DB_ERROR_CODES\.has\(row\.error_code\)/);
  assert.match(update, /'LISTING_NOT_AVAILABLE' \? 'NOT_A_LISTING'/);
  assert.match(update, /error: updateError/, 'a refused write is logged, not swallowed');
});
