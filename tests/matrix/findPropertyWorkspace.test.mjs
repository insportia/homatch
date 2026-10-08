import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownedSearchHistory } from '../../supabase/functions/_shared/marketplaceHistory.ts';
import { marketplacePropertyContext } from '../../supabase/functions/_shared/marketplacePropertyContext.ts';
import { claimPropertyTurn } from '../../supabase/functions/_shared/marketplacePropertyTurn.ts';

const searchId = '11111111-1111-4111-8111-111111111111';
function database(tables) {
  const calls = [];
  return { calls, from(table) {
    calls.push(table);
    let rows = [...(tables[table] ?? [])];
    const orders = [];
    const query = {
      select() { return query; },
      eq(key, value) { rows = rows.filter((r) => r[key] === value); return query; },
      order(key, { ascending }) { orders.push([key, ascending]); return query; },
      range(start, end) {
        rows.sort((a, b) => { for (const [key, ascending] of orders) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return ascending ? result : -result; } return 0; });
        return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
      },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
    };
    return query;
  } };
}
const row = (id, status = 'COMPLETE', user_id = 'owner') => ({ id, status, user_id, created_at: '2026-10-07T12:00:00Z', brief: { city: { value: 'Tbilisi' } }, properties_count: 2, strong_matches: 1, stats: { validated: 5 }, telemetry: { secret: true } });

test('owned history retains previous searches and a newer failure never hides completed searches', async () => {
  const searches = [row('01'), row('02', 'FAILED'), row('03', 'COMPLETE', 'another-owner')];
  const db = database({ discovery_marketplace_searches: searches });
  let result = await ownedSearchHistory(db, 'owner', 1);
  assert.deepEqual(result.items.map((r) => [r.id, r.status]), [['02', 'FAILED'], ['01', 'COMPLETE']]);
  assert.equal(result.items[1].uniqueProperties, 2);
  assert.equal(result.items[1].rawListings, 5);
  assert.equal(JSON.stringify(result).includes('telemetry'), false);
  searches.push(row('04'));
  result = await ownedSearchHistory(database({ discovery_marketplace_searches: searches }), 'owner', 1);
  assert.deepEqual(result.items.map((r) => r.id), ['04', '02', '01']);
  assert.deepEqual(db.calls, ['discovery_marketplace_searches'], 'history never loads property payloads');
});

test('history has deterministic bounded pages, including equal timestamps and invalid page inputs', async () => {
  const db = database({ discovery_marketplace_searches: Array.from({ length: 25 }, (_, i) => row(String(i).padStart(2, '0'))) });
  const first = await ownedSearchHistory(db, 'owner', NaN);
  const second = await ownedSearchHistory(db, 'owner', 2);
  const last = await ownedSearchHistory(db, 'owner', 3);
  assert.equal(first.page, 1); assert.equal(first.items.length, 12); assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 12); assert.equal(last.items.length, 1); assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map((r) => r.id)).size, 25);
});

test('property AI cannot read another owner, even with a valid search id and property key', async () => {
  const db = database({ discovery_marketplace_searches: [{ id: searchId, user_id: 'someone-else' }] });
  assert.equal(await marketplacePropertyContext(db, 'owner', { searchId, propertyKey: 'p1' }), null);
  assert.deepEqual(db.calls, ['discovery_marketplace_searches']);
});

test('property AI context uses stored facts and preserves source prices without raw contacts or worker data', async () => {
  const db = database({ discovery_marketplace_searches: [{ id: searchId, user_id: 'owner', request: { priceMaxUsd: 90000 } }],
    discovery_marketplace_properties: [{ search_id: searchId, property_key: 'p1', view: { title: 'Apartment', facts: { priceUsd: 89000 }, sourceCount: 2,
      listings: [{ source: 'myhome', priceUsd: 89000, seller: { publicPhone: 'PRIVATE_TEST_CONTACT' } }, { source: 'ss', priceUsd: 91000 }],
      description: 'x'.repeat(9000), rawSourceData: 'SECRET_WORKER_PAYLOAD', internal: { score: 100 } } }] });
  const context = await marketplacePropertyContext(db, 'owner', { searchId, propertyKey: 'p1', facts: { priceUsd: 1 } });
  assert.equal(context.facts.priceUsd, 89000); assert.equal(context.listingCount, 2);
  assert.deepEqual(context.sourceListings.map((l) => l.priceUsd), [89000, 91000]);
  assert.equal(context.description.length, 2400);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_TEST_CONTACT|SECRET_WORKER_PAYLOAD|internal/);
});

test('legacy missing dossier uses existing read-only catalogue reconstruction, still scoped to its owner', async () => {
  const db = database({ discovery_marketplace_searches: [{ id: searchId, user_id: 'owner', request: {} }] });
  let calls = 0;
  const context = await marketplacePropertyContext(db, 'owner', { searchId, propertyKey: 'older-key' }, async (_db, search) => {
    calls += 1; assert.equal(search.id, searchId);
    return [{ key: 'older-key', facts: { priceUsd: 89000 }, listings: [], intelligence: {} }];
  });
  assert.equal(context.facts.priceUsd, 89000); assert.equal(calls, 1);
  assert.equal(await marketplacePropertyContext(db, 'another-owner', { searchId, propertyKey: 'older-key' }, async () => { throw Error('must not execute'); }), null);
});

test('AI budget overage is separate from the premium against a comparison property', async () => {
  const db = database({ discovery_marketplace_searches: [{ id: searchId, user_id: 'owner', request: { priceMaxUsd: 200000 } }],
    discovery_marketplace_properties: [{ search_id: searchId, property_key: 'upgrade', view: { facts: { priceUsd: 205000 }, listings: [],
      upgrade: { extraPriceUsd: 75000, overMaxPct: 0.025, baselineKey: 'comparison', advantages: [] } } }] });
  const context = await marketplacePropertyContext(db, 'owner', { searchId, propertyKey: 'upgrade' });
  assert.equal(context.budgetOverageUsd, 5000);
  assert.equal(context.upgrade.comparisonPremiumUsd, 75000);
  assert.equal(context.upgrade.overBudgetRatio, 0.025);
  assert.equal('extraPriceUsd' in context.upgrade, false);
});

test('property analysis uses existing billed chat and fails closed before provider execution', () => {
  const edge = readFileSync('supabase/functions/homatch-ai/index.ts', 'utf8');
  const ui = readFileSync('src/components/findProperty/PropertyAI.tsx', 'utf8');
  assert.match(ui, /useAIChat\(\)/);
  assert.match(edge, /productCode: CHAT_PRODUCT_CODE/);
  assert.match(edge, /idempotencyKey: `\$\{CHAT_PRODUCT_CODE\}:\$\{interactionId\}`/);
  assert.match(edge, /marketplaceScope && \(!billingEnabled \|\| !interactionId\)/);
  assert.match(edge, /if \(marketplaceScope\) return json\(\{ error: 'Paid AI analysis unavailable'/);
  assert.match(edge, /Property conversation scope mismatch/);
  assert.ok(edge.indexOf('await marketplacePropertyContext') < edge.indexOf('grant = await beginExecution'));
  assert.doesNotMatch(ui, /credits.*update|reserve.*rpc|functions\.invoke/);
  assert.match(edge, /grant\.funding !== 'PAYG'/, 'property analysis cannot fall through to a free allowance');
  assert.match(edge, /await claimPropertyTurn/, 'the same paid turn cannot start concurrent providers');
});

test('concurrent paid property retries claim one provider; settled/failed/foreign turns cannot execute again', async () => {
  const reservation = { id: 'reservation', user_id: 'owner', status: 'RESERVED', job_ref: 'conversation', metadata: { searchId, propertyKey: 'p1' } };
  const db = { from(table) {
    assert.equal(table, 'usage_reservations');
    const filters = []; let mutation = null;
    const query = { select() { return query; }, update(value) { mutation = value; return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      is(key) { filters.push((row) => !row.metadata[key.split('->')[1]]); return query; },
      async maybeSingle() {
        if (!filters.every((filter) => filter(reservation))) return { data: null, error: null };
        if (mutation) Object.assign(reservation, mutation);
        return { data: structuredClone(reservation), error: null };
      } };
    return query;
  } };
  const input = { reservationId: 'reservation', userId: 'owner', conversationId: 'conversation', searchId, propertyKey: 'p1' };
  const attempts = await Promise.all([claimPropertyTurn(db, input), claimPropertyTurn(db, input)]);
  assert.equal(attempts.filter((state) => state === 'STARTED').length, 1);
  assert.equal(attempts.filter((state) => state === 'PENDING').length, 1);
  reservation.status = 'SETTLED'; assert.equal(await claimPropertyTurn(db, input), 'SETTLED');
  reservation.status = 'RELEASED'; assert.equal(await claimPropertyTurn(db, input), 'FAILED');
  assert.equal(await claimPropertyTurn(db, { ...input, userId: 'another-owner' }), 'SCOPE_MISMATCH');
  assert.equal(await claimPropertyTurn(db, { ...input, propertyKey: 'another-property' }), 'SCOPE_MISMATCH');
});
