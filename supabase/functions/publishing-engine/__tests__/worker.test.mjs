// publishing-worker (the Railway browser worker's door) against an in-memory
// database whose RPCs mirror migration 20261107090000's publishing_op_*. Proves:
// WORKER_TOKEN auth; a claim hands over only the leased operation's listing copy,
// photos and decrypted session; a created listing is linked only from a URL on the
// portal's own domains and shown PUBLISHED only after the public page check; an
// off-portal or missing URL needs reconciliation; PREPARED (no live-submit
// approval) and failures hand the publication to the admin queue; an expired
// session sends it back to wait; a verified session check connects the account and
// starts the waiting publications.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) return { url: 'data:text/javascript,export const createClient = () => { throw new Error("db must be injected"); };', shortCircuit: true };
    return next(spec, ctx);
  }`));
globalThis.Deno = { env: { get: () => undefined } };
const { handler } = await import('../../publishing-worker/index.ts');
const { sealCredential } = await import('../vault.ts');

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const OWNER = '11111111-1111-4111-8111-111111111111';
const LISTING = '22222222-2222-4222-8222-222222222222';
const PHOTO = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-16T12:00:00Z');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function makeDb({ session = true } = {}) {
  let seq = 100;
  const t = {
    publishing_providers: [],
    publishing_accounts: ['myhome', 'ssge'].map((portal_id) => ({ portal_id, status: 'CONNECTED', connection_method: 'BROWSER_SESSION', account_label: `homatch@${portal_id}`, contact_phone: '+995322000111', verified_at: '2026-10-16T00:00:00Z', failure_count: 0, automation_enabled: true, live_submit_approved: false })),
    publishing_account_sessions: session ? [{ portal_id: 'myhome', envelope: await sealCredential(JSON.stringify({ cookies: [{ name: 'sid', value: 'S', domain: '.myhome.ge' }], origins: [] }), 'session:myhome', KEY), status: 'VALID', expires_at: null }] : [],
    publishing_engine_listings: [{ id: LISTING, version: 3, payload: { title: 'ბინა', description: { ka: 'ბინა ვაკეში.' }, propertyType: 'APARTMENT', dealType: 'SALE', price: 150000, currency: 'USD', city: 'თბილისი', contactName: 'Nino', contacts: [{ phone: '+995599111222' }], photos: [PHOTO] } }],
    publishing_engine_jobs: [
      { id: uuid(1), listing_id: LISTING, user_id: OWNER, portal_id: 'myhome', status: 'QUEUED', channel: 'HOMATCH_ACCOUNT', revision: 0, listing_version: 3, external_id: null, external_url: null, check_attempts: 0, next_check_at: null, published_at: null, last_error: null, contact_consent_at: 'x' },
    ],
    publishing_operations: [], property_photos: [{ id: PHOTO, property_id: LISTING, storage_path: 'property-photos/u/a.jpg' }],
    events: [], accountWrites: [], artifacts: [],
  };
  const err = (message) => ({ data: null, error: { message } });
  const rpc = {
    publishing_op_enqueue({ p_publication, p_portal, p_kind, p_version, p_key }) {
      const dup = t.publishing_operations.find((o) => o.idempotency_key === p_key);
      if (dup) return { data: dup, error: null };
      if (t.publishing_operations.some((o) => o.publication_id === p_publication && p_publication && ['QUEUED', 'RUNNING'].includes(o.status))) return err('OPERATION_ALREADY_ACTIVE');
      const job = t.publishing_engine_jobs.find((j) => j.id === p_publication);
      const op = { id: uuid(seq++), publication_id: p_publication, listing_id: job?.listing_id ?? null, user_id: job?.user_id ?? null, portal_id: p_portal, kind: p_kind, listing_version: p_version, status: 'QUEUED', attempts: 0, max_attempts: 3, submit_started_at: null, lease_token: null, idempotency_key: p_key };
      t.publishing_operations.push(op);
      return { data: op, error: null };
    },
    publishing_op_claim({ p_portals }) {
      const out = [];
      for (const portal of p_portals) {
        if (t.publishing_operations.some((o) => o.portal_id === portal && o.status === 'RUNNING')) continue;
        const op = t.publishing_operations.find((o) => o.portal_id === portal && o.status === 'QUEUED');
        if (!op) continue;
        Object.assign(op, { status: 'RUNNING', attempts: op.attempts + 1, lease_token: uuid(seq++) });
        out.push({ ...op });
      }
      return { data: out, error: null };
    },
    publishing_op_heartbeat: ({ p_op, p_token }) => ({ data: t.publishing_operations.some((o) => o.id === p_op && o.lease_token === p_token && o.status === 'RUNNING'), error: null }),
    publishing_op_mark_submitting({ p_op, p_token }) {
      const o = t.publishing_operations.find((x) => x.id === p_op && x.lease_token === p_token && x.status === 'RUNNING' && !x.submit_started_at);
      if (o) o.submit_started_at = 'now';
      return { data: !!o, error: null };
    },
    publishing_op_finish({ p_op, p_token, p_outcome, p_result, p_error, p_retryable }) {
      const o = t.publishing_operations.find((x) => x.id === p_op);
      if (!o || o.lease_token !== p_token || o.status !== 'RUNNING') return err('LEASE_CONFLICT');
      o.status = p_outcome === 'FAILED' && o.submit_started_at ? 'RECONCILIATION_REQUIRED' : p_outcome === 'FAILED' && p_retryable && o.attempts < o.max_attempts ? 'QUEUED' : p_outcome;
      Object.assign(o, { result: p_result, last_error: p_error, lease_token: null });
      return { data: { ...o }, error: null };
    },
    publishing_publication_write({ p_listing, p_portal, p_revision, p_set, p_event }) {
      const row = t.publishing_engine_jobs.find((j) => j.listing_id === p_listing && j.portal_id === p_portal);
      if (row.revision !== p_revision) return err('REVISION_CONFLICT');
      Object.assign(row, p_set, { revision: row.revision + 1 });
      t.events.push(p_event);
      return { data: row, error: null };
    },
    publishing_account_write({ p_portal, p_patch, p_action }) {
      const a = t.publishing_accounts.find((x) => x.portal_id === p_portal);
      Object.assign(a, p_patch);
      t.accountWrites.push({ p_portal, p_action, p_patch });
      return { data: a, error: null };
    },
  };
  const from = (table) => {
    const filters = [];
    let update = null;
    const read = () => (t[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
      update: (patch) => { update = patch; return q; },
      insert: async (row) => { t.artifacts.push(row); return { error: null }; },
      maybeSingle: async () => ({ data: read()[0] ? { ...read()[0] } : null, error: null }),
      then: (ok, ko) => {
        if (update) { for (const r of read()) Object.assign(r, update); return Promise.resolve({ error: null }).then(ok, ko); }
        return Promise.resolve({ data: read().map((r) => ({ ...r })), error: null }).then(ok, ko);
      },
    };
    return q;
  };
  const storage = { from: () => ({
    createSignedUrl: async (path) => ({ data: { signedUrl: `https://signed.test/${path}` } }),
    createSignedUploadUrl: async (path) => ({ data: { signedUrl: `https://upload.test/${path}`, token: 'tok' }, error: null }),
  }) };
  return { t, db: { from, storage, rpc: async (n, a) => rpc[n](a) } };
}

const pages = new Map();
async function call(db, action, body = {}, token = 'worker-secret') {
  const deps = {
    env: (k) => ({ WORKER_TOKEN: 'worker-secret', PUBLISHING_CREDENTIALS_KEY: KEY })[k],
    db, now: () => NOW,
    fetchPage: async (url) => pages.get(url) ?? { status: 'NETWORK' },
  };
  const res = await handler(new Request('https://edge.test', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...body }) }), deps);
  return { status: res.status, body: await res.json() };
}
const enqueueCreate = (env) => env.db.rpc('publishing_op_enqueue', { p_publication: uuid(1), p_portal: 'myhome', p_kind: 'CREATE', p_version: 3, p_key: 'k1' });

test('the worker token is required, compared exactly', async () => {
  const { db } = await makeDb();
  assert.equal((await call(db, 'claim', {}, 'nope')).status, 401);
  assert.equal((await call(db, 'claim', {}, '')).status, 401);
});

test('claim: the leased operation, its listing copy with the owner footer, signed photos and the decrypted session — and the publication starts', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  const r = await call(env.db, 'claim', { worker: 'w1', portals: ['myhome', 'ssge'] });
  assert.equal(r.body.tasks.length, 1);
  const task = r.body.tasks[0];
  assert.equal(task.kind, 'CREATE');
  assert.deepEqual(task.session.cookies, [{ name: 'sid', value: 'S', domain: '.myhome.ge' }]);
  assert.equal(task.account.contactPhone, '+995322000111', 'the HOMATCH number for the portal contact field');
  assert.equal(task.account.liveSubmitApproved, false);
  assert.ok(task.copies.ka.description.endsWith('განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.'));
  assert.equal(task.copies.ka.contactPhone, '+995322000111');
  assert.deepEqual(task.photos, [{ id: PHOTO, url: 'https://signed.test/u/a.jpg' }]);
  assert.equal(env.t.publishing_engine_jobs[0].status, 'PUBLISHING', 'the customer sees Publishing');
  assert.equal(JSON.stringify(r.body).includes('"envelope"'), false, 'the sealed envelope never leaves');
});

test('CREATE succeeded: linked from a portal URL, PUBLISHED only once the public page carries the id', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  const [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  assert.equal((await call(env.db, 'submitting', { id: task.id, token: task.leaseToken })).body.ok, true);
  assert.equal((await call(env.db, 'submitting', { id: task.id, token: task.leaseToken })).body.ok, false, 'the submit door opens once');
  pages.set('https://www.myhome.ge/ka/pr/23456789/', { status: 200, body: 'id 23456789' });
  const r = await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'SUCCEEDED', result: { externalUrl: 'https://www.myhome.ge/ka/pr/23456789/?utm=x' } });
  assert.equal(r.body.status, 'SUCCEEDED');
  const job = env.t.publishing_engine_jobs[0];
  assert.equal(job.external_id, '23456789');
  assert.equal(job.status, 'PUBLISHED');
  assert.ok(env.t.events.some((e) => e.kind === 'EXTERNAL_LISTING_LINKED' && e.detail.linkedBy === 'AUTOMATION'));
  assert.ok(env.t.accountWrites.some((w) => w.p_action === 'ACTIVITY' && w.p_patch.last_published_at));
});

test('a reported URL off the portal is not trusted: reconciliation, handed to the admin queue', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  const [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  const r = await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'SUCCEEDED', result: { externalUrl: 'https://evil.example/pr/1' } });
  assert.equal(r.body.status, 'RECONCILIATION_REQUIRED');
  assert.equal(env.t.publishing_engine_jobs[0].status, 'ADMIN_ACTION_REQUIRED');
  assert.equal(env.t.publishing_engine_jobs[0].external_id, null);
});

test('PREPARED (no live-submit approval) hands the publication to the admin queue, nothing submitted', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  const [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'PREPARED', result: { fields: ['price', 'area'] } });
  const job = env.t.publishing_engine_jobs[0];
  assert.equal(job.status, 'ADMIN_ACTION_REQUIRED');
  assert.equal(job.last_error, 'AUTOMATION_PREPARED_NOT_SUBMITTED');
  assert.equal(job.published_at, null);
});

test('a retryable failure keeps the publication in progress; an expired session sends it back to wait', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  let [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  assert.equal((await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'FAILED', error: 'PORTAL_TIMEOUT', retryable: true })).body.status, 'QUEUED');
  assert.equal(env.t.publishing_engine_jobs[0].status, 'PUBLISHING');
  [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'BLOCKED', error: 'AUTH_REQUIRED' });
  assert.equal(env.t.publishing_engine_jobs[0].status, 'AUTH_REQUIRED');
  assert.equal(env.t.publishing_accounts.find((a) => a.portal_id === 'myhome').status, 'SESSION_EXPIRED');
  assert.equal(env.t.publishing_account_sessions[0].status, 'EXPIRED');
  // A stale lease cannot finish twice.
  assert.equal((await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'SUCCEEDED' })).status, 409);
});

test('a verified session check connects the account and starts the publications waiting for it', async () => {
  const env = await makeDb();
  Object.assign(env.t.publishing_accounts[0], { status: 'AUTH_REQUIRED', verified_at: null });
  Object.assign(env.t.publishing_engine_jobs[0], { status: 'AUTH_REQUIRED' });
  await env.db.rpc('publishing_op_enqueue', { p_publication: null, p_portal: 'myhome', p_kind: 'CHECK_SESSION', p_version: null, p_key: 'chk' });
  const [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  assert.equal(task.kind, 'CHECK_SESSION');
  assert.equal(task.listing, undefined, 'a session check carries no listing');
  await call(env.db, 'finish', { id: task.id, token: task.leaseToken, outcome: 'SUCCEEDED' });
  const acct = env.t.publishing_accounts[0];
  assert.equal(acct.status, 'CONNECTED');
  assert.ok(acct.verified_at);
  assert.equal(env.t.publishing_engine_jobs[0].status, 'QUEUED');
  assert.ok(env.t.publishing_operations.some((o) => o.kind === 'CREATE' && o.status === 'QUEUED'), 'a CREATE operation is queued for the waiting publication');
});

test('an unreadable session blocks the operation instead of running it', async () => {
  const env = await makeDb();
  env.t.publishing_account_sessions[0].envelope = { v: 1, kid: 'other', iv: 'x', ct: 'y' };
  await enqueueCreate(env);
  const r = await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] });
  assert.equal(r.body.tasks.length, 0);
  assert.equal(env.t.publishing_operations[0].status, 'BLOCKED');
  assert.equal(env.t.publishing_operations[0].last_error, 'CREDENTIAL_KEY_MISMATCH');
});

test('artifacts: a signed upload path under the operation, recorded', async () => {
  const env = await makeDb();
  await enqueueCreate(env);
  const [task] = (await call(env.db, 'claim', { worker: 'w1', portals: ['myhome'] })).body.tasks;
  const r = await call(env.db, 'artifact', { id: task.id, token: task.leaseToken, kind: 'SCREENSHOT', stage: 'FILLED' });
  assert.match(r.body.path, new RegExp(`^${task.id}/FILLED-\\d+\\.png$`));
  assert.equal(env.t.artifacts.length, 1);
});
