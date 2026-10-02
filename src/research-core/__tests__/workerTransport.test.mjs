// PHASE 2 — the worker transport: each hop goes to the official worker with
// WORKER_TOKEN; refusals come back typed; a timeout stays a TimeoutError.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WorkerTransport } from '../fetch/worker-transport.ts';
import { compileSupplyPlan, plannedSourceJobs } from '../discovery/discovery-plan.ts';
import { normalisePlan } from '../discovery/search-plan.ts';

async function stubWorker(handler) {
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const out = handler(req, JSON.parse(body || '{}'));
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.json));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('a hop is sent with the token, the honest user agent, and returned as a RawResponse', async () => {
  let seen = null;
  const { server, base } = await stubWorker((req, body) => {
    seen = { auth: req.headers.authorization, body };
    return { json: { ok: true, response: { url: body.url, status: 200, headers: {}, body: '<html/>', bytes: 7, truncated: false, durationMs: 3 } } };
  });
  try {
    const t = new WorkerTransport({ baseUrl: base, token: 'tok', userAgent: 'HomatchResearch/1.0' });
    const r = await t.send({ url: 'https://home.ss.ge/x', method: 'GET', headers: { accept: 'text/html' }, timeoutMs: 2000 });
    assert.equal(r.status, 200);
    assert.equal(r.body, '<html/>');
    assert.equal(seen.auth, 'Bearer tok');
    assert.equal(seen.body.headers['user-agent'], 'HomatchResearch/1.0');
    assert.equal(seen.body.url, 'https://home.ss.ge/x');
  } finally { server.close(); }
});

test('a worker refusal is typed; an unconfigured transport refuses before any request', async () => {
  const { server, base } = await stubWorker(() => ({ json: { ok: false, error: { kind: 'BLOCKED_ADDRESS' } } }));
  try {
    const t = new WorkerTransport({ baseUrl: base, token: 'tok' });
    await assert.rejects(t.send({ url: 'https://x.ge/', method: 'GET', headers: {}, timeoutMs: 1000 }), (e) => e.kind === 'BLOCKED_ADDRESS');
  } finally { server.close(); }
  await assert.rejects(new WorkerTransport({ baseUrl: '', token: '' }).send({ url: 'https://x.ge/', method: 'GET', headers: {}, timeoutMs: 1000 }), (e) => e.kind === 'NOT_CONFIGURED');
});

test('only the portals an operator routes go to the worker', () => {
  const { plan: search } = normalisePlan({ goal: 'RENT', countryCode: 'GE', city: 'Batumi', cityStrength: 'REQUIRED' });
  const plan = compileSupplyPlan({
    plan: search,
    switches: { telegram: false, forum: false, portals: true, livePortalAdapters: ['home-ss-ge', 'place-ge'], workerRoutedAdapters: ['place-ge', 'not-live'] },
    limits: { maxCredits: 50, deadlineMinutes: 30, targetResults: 5, activeDemandMaxDays: 30 },
  });
  assert.deepEqual(plan.workerRoutedAdapters, ['place-ge'], 'never a portal that is not live');
  const jobs = plannedSourceJobs(plan, 'r');
  assert.deepEqual(jobs.map((j) => [j.metadata.adapterId, j.executor]), [['home-ss-ge', 'EDGE'], ['place-ge', 'WORKER']]);
});
