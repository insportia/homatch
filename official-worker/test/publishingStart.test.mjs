import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPublishingWorker } from '../.tstest-build/publishing/start.js';

// The publishing runner holds portal sessions; it authenticates with its own
// PUBLISHING_WORKER_TOKEN and never with the WORKER_TOKEN the verify / research
// queues share. Off unless PUBLISHING_AUTOMATION_ENABLED=1.
test('publishing worker: off by default, and never starts on the shared WORKER_TOKEN', () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    assert.equal(startPublishingWorker({ SUPABASE_URL: 'https://x.test', PUBLISHING_WORKER_TOKEN: 'p'.repeat(40) }), null);
    assert.equal(startPublishingWorker({ PUBLISHING_AUTOMATION_ENABLED: '1', SUPABASE_URL: 'https://x.test', WORKER_TOKEN: 's'.repeat(40) }), null);
  } finally { console.error = orig; }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PUBLISHING_WORKER_TOKEN required/);
  assert.doesNotMatch(errors.join('\n'), /s{40}/, 'no secret value is logged');
});

test('publishing worker: sends only PUBLISHING_WORKER_TOKEN to the publishing door', async () => {
  const seen = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') }); return new Response(JSON.stringify({ tasks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const runner = startPublishingWorker({ PUBLISHING_AUTOMATION_ENABLED: '1', SUPABASE_URL: 'https://x.test/', PUBLISHING_WORKER_TOKEN: 'p'.repeat(40), WORKER_TOKEN: 's'.repeat(40), PUBLISHING_CONCURRENCY: '1' });
  try {
    assert.ok(runner);
    for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.length, 'the runner polled the publishing door');
    for (const s of seen) {
      assert.equal(s.url, 'https://x.test/functions/v1/publishing-worker');
      assert.equal(s.auth, `Bearer ${'p'.repeat(40)}`);
    }
  } finally {
    await runner?.stop();
    globalThis.fetch = origFetch;
  }
});
