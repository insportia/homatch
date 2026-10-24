// queueCompleteTimeout.test.mjs — prod a7177a89: a finished MyGov result (every CAPTCHA solved) was lost to four 20 s
// timeouts of the queue's complete call, and the lease expiry re-ran every solve. The complete call gets a longer window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueGateway, COMPLETE_TIMEOUT_MS } from '../.tstest-build/queue/gateway.js';

test('complete waits longer than the ordinary calls; other calls keep the default', async () => {
  assert.ok(COMPLETE_TIMEOUT_MS >= 60_000);
  const seen = [];
  const fetcher = async (_url, init) => {
    seen.push({ action: JSON.parse(init.body).action, signal: init.signal });
    return new Response(JSON.stringify({ ok: true, state: 'OK' }), { status: 200 });
  };
  const gw = new QueueGateway({ url: 'https://example.test/verify-queue', token: 't', fetcher, timeoutMs: 50, retries: 0 });
  const task = { id: 'x', fencingToken: 1 };
  await gw.complete(task, { result: { big: 'x'.repeat(1000) } });
  await gw.heartbeat(task);
  // A signal's timeout is not inspectable directly: a 50 ms default would already have fired after a 120 ms wait.
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(seen[0].action, 'complete');
  assert.equal(seen[0].signal.aborted, false, 'complete is still within its window');
  assert.equal(seen[1].action, 'heartbeat');
  assert.equal(seen[1].signal.aborted, true, 'heartbeat keeps the short default');
});
