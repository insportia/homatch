// RESILIENCE — edge request guards (2026-10-18).
//   - Find Property `start` has a per-user quota on the same atomic limiter as `understand`:
//     a free search fails OPEN when the quota cannot be read; the paid `understand` fails closed.
//   - Document parsing is bounded inside one Edge request: PDFs past MAX_PDF_PAGES and .docx
//     bodies that inflate past MAX_DOCX_XML_BYTES fail with their reason instead of a CPU/memory kill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.Deno ??= { env: { get: () => undefined } };
const { consumeStartQuota, consumeUnderstandQuota, START_RATE_LIMIT, UNDERSTAND_RATE_LIMIT } = await import('../marketplaceSearch.ts');

const rpcDb = (answer) => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return typeof answer === 'function' ? answer(args) : answer; } };
};

test('start quota: the same atomic limiter, its own operation, sized above real use', async () => {
  const db = rpcDb({ data: { allowed: true }, error: null });
  assert.deepEqual(await consumeStartQuota(db, 'u1'), { allowed: true });
  assert.deepEqual(db.calls[0], { name: 'consume_marketplace_rate_limit', args: {
    p_user_id: 'u1', p_operation: 'marketplace_search_start',
    p_burst_limit: 6, p_burst_seconds: 600, p_daily_limit: 30, p_daily_seconds: 86400,
  } });
  /* production on 2026-10-18: at most 7 starts per user per day, 3 in any 10 minutes */
  assert.ok(START_RATE_LIMIT.dailyLimit >= 7 * 4 && START_RATE_LIMIT.burstLimit >= 3 * 2);
  assert.notEqual(START_RATE_LIMIT.operation, UNDERSTAND_RATE_LIMIT.operation, 'separate buckets');
});

test('start quota: refused with a retry time; an unreadable quota never refuses a free search', async () => {
  const limited = await consumeStartQuota(rpcDb({ data: { allowed: false, retry_after_seconds: 240, window: 'BURST' }, error: null }), 'u1');
  assert.deepEqual(limited, { allowed: false, retryAfterSeconds: 240, window: 'BURST' });
  assert.deepEqual(await consumeStartQuota(rpcDb({ data: null, error: { message: 'down' } }), 'u1'), { allowed: true });
  assert.deepEqual(await consumeStartQuota(rpcDb(() => { throw new Error('network'); }), 'u1'), { allowed: true });
  /* the paid understand path still fails closed */
  assert.equal((await consumeUnderstandQuota(rpcDb({ data: null, error: { message: 'down' } }), 'u1')).allowed, false);
});

test('start: the quota is consumed after the idempotent replay check and answers 429 with Retry-After', () => {
  const fn = readFileSync(new URL('../../marketplace-search/index.ts', import.meta.url), 'utf8');
  const start = fn.slice(fn.indexOf("if (action === 'start')"));
  const replay = start.indexOf("if (prior) return json({ search: await summary(db, prior), replayed: true });");
  const quota = start.indexOf('const startQuota = await consumeStartQuota(db, userId);');
  assert.ok(replay > 0 && quota > replay, 'a replayed start never counts twice');
  assert.match(start.slice(quota, quota + 500), /429, \{ 'Retry-After': String\(startQuota\.retryAfterSeconds\) \}/);
  const ui = readFileSync(new URL('../../../../src/components/findProperty/MarketplaceSearchExperience.tsx', import.meta.url), 'utf8');
  assert.match(ui, /code === 'RATE_LIMIT_EXCEEDED' \? 'mps_error_start_rate_limited'/);
});

for (const [fn, table] of [['developer-document-extract', 'dev_documents'], ['deal-room-document-analyze', 'deal_room_documents']]) {
  test(`${fn}: PDF pages and .docx inflation are bounded before parsing`, () => {
    const src = readFileSync(new URL(`../../${fn}/index.ts`, import.meta.url), 'utf8');
    assert.match(src, /const MAX_PDF_PAGES = 60;/);
    assert.match(src, /const MAX_DOCX_XML_BYTES = 20 \* 1024 \* 1024;/);
    const pages = src.indexOf('if (pages > MAX_PDF_PAGES) throw new DocumentTooLarge(');
    const extract = src.indexOf('await extractText(pdf');
    assert.ok(pages > 0 && pages < extract, 'the page count is checked before any text is extracted');
    const inflate = src.indexOf('> MAX_DOCX_XML_BYTES) throw new DocumentTooLarge(');
    const read = src.indexOf("raw = extractDocxText(await entry.async('string'))");
    assert.ok(inflate > 0 && inflate < read, 'the uncompressed size is checked before the body is inflated');
    assert.match(src, /instanceof DocumentTooLarge/);
    assert.match(src, new RegExp(`from\\('${table}'\\)`));
    assert.match(src, /'TOO_LARGE'/);
  });
}
