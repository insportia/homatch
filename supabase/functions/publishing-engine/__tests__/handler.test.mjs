// The publishing-engine handler against an in-memory database whose RPCs mirror
// migrations 20261103090000 + 20261106090000. Proves: origin/auth/ownership, impersonation is read-only,
// drafts never create property rows, idempotent prepare, PUBLISHED only after a live
// page check, per-portal partial success, and that removing a listing never touches
// the property; the eight-provider registry, owner-confirmed portals, capability
// errors, listing duplication and the admin control centre's authorisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@supabase/supabase-js') return { url: 'data:text/javascript,export const createClient = (...a) => globalThis.__createClient(...a);', shortCircuit: true };
    if (spec === 'libphonenumber-js') return { url: 'data:text/javascript,export const parsePhoneNumberFromString = (v) => { const d = String(v).replace(/[^0-9+]/g, ""); const n = d.startsWith("+") ? d : "+995" + d; return { isValid: () => /^\\\\+995[0-9]{9}$/.test(n), number: n }; };', shortCircuit: true };
    return next(spec, ctx);
  }`));

globalThis.Deno = { env: { get: (k) => `test-${k}` } };
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PROP = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const PHOTO = '44444444-4444-4444-8444-444444444444';
const IMPERSONATED_SESSION = '55555555-5555-4555-8555-555555555555';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND = '77777777-7777-4777-8777-777777777777';

function makeDb() {
  const t = {
    users: [{ id: OWNER, auth_id: 'auth-owner' }, { id: OTHER, auth_id: 'auth-other' }, { id: ADMIN, auth_id: 'auth-admin' }],
    properties: [
      { id: PROP, user_id: OWNER, is_deleted: false, contact_phone_e164: '+995599111222' },
      { id: FOREIGN, user_id: OTHER, is_deleted: false, contact_phone_e164: null },
    ],
    property_photos: [{ id: PHOTO, property_id: PROP, storage_path: `property-photos/${PROP}/a.jpg`, public_url: null }],
    impersonation_sessions: [{ id: 'i1', auth_session_id: IMPERSONATED_SESSION }],
    publishing_engine_listings: [], publishing_engine_versions: [], publishing_engine_jobs: [], publishing_engine_events: [],
    publishing_providers: ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome'].map((id, sort) => ({
      id, enabled: true, sort, create_url: null, logo_url: null, verification: ['korter', 'binebi'].includes(id) ? 'OWNER_CONFIRMED' : 'PAGE_CHECK',
      max_photos: id === 'myhome' ? 16 : null, description_max: null, required_fields: id === 'myhome' ? ['description.ka'] : [],
    })),
    publishing_provider_audit: [],
    publishing_accounts: ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome'].map((portal_id) => ({
      portal_id, status: 'NOT_CONFIGURED', connection_method: null, account_label: null, contact_phone: null, credential: null, credential_set_at: null,
      session_expires_at: null, verified_at: null, verification_result: null, last_published_at: null, failure_count: 0, last_error: null, updated_at: null,
    })),
    publishing_account_audit: [], publishing_account_sessions: [], publishing_operations: [], publishing_artifacts: [],
  };
  const err = (message) => ({ data: null, error: { message } });
  const rpc = {
    publishing_listing_save({ p_owner, p_property, p_version, p_payload, p_status }) {
      if (!t.properties.some((p) => p.id === p_property && p.user_id === p_owner && !p.is_deleted)) return err('OWNED_PROPERTY_REQUIRED');
      let row = t.publishing_engine_listings.find((l) => l.id === p_property);
      if (!row) {
        if (p_version !== 0) return err('VERSION_CONFLICT');
        row = { id: p_property, user_id: p_owner, version: 1, payload: p_payload, status: p_status, archived_at: null, created_at: 'now', updated_at: 'now' };
        t.publishing_engine_listings.push(row);
      } else {
        if (row.archived_at) return err('LISTING_ARCHIVED');
        if (row.version !== p_version) return err('VERSION_CONFLICT');
        Object.assign(row, { version: row.version + 1, payload: p_payload, status: p_status });
      }
      t.publishing_engine_versions.push({ listing_id: p_property, version: row.version });
      t.publishing_engine_events.push({ id: t.publishing_engine_events.length + 1, listing_id: p_property, user_id: p_owner, kind: 'LISTING_SAVED', created_at: String(Date.now()) });
      return { data: row, error: null };
    },
    publishing_publication_write({ p_owner, p_listing, p_portal, p_revision, p_set, p_event }) {
      if (!t.publishing_engine_listings.some((l) => l.id === p_listing && l.user_id === p_owner)) return err('OWNED_RECORD_REQUIRED');
      let row = t.publishing_engine_jobs.find((j) => j.listing_id === p_listing && j.portal_id === p_portal);
      const from = row?.status ?? null;
      if (!row) {
        if (p_revision !== -1) return err('REVISION_CONFLICT');
        if (p_set.channel === 'HOMATCH_ACCOUNT' && !p_set.contact_consent_at) return err('publishing_engine_jobs_central_consent');
        row = { id: `00000000-0000-4000-8000-${String(t.publishing_engine_jobs.length + 1).padStart(12, "0")}`, listing_id: p_listing, user_id: p_owner, portal_id: p_portal, revision: 0, status: p_set.status, channel: p_set.channel ?? 'OWNER_HANDOFF', contact_consent_at: p_set.contact_consent_at ?? null, listing_version: p_set.listing_version, external_id: null, external_url: null, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null, status_reason: null, admin_claimed_by: null, admin_claimed_at: null };
        t.publishing_engine_jobs.push(row);
      } else {
        if (row.revision !== p_revision) return err('REVISION_CONFLICT');
        if (p_set.external_id && t.publishing_engine_jobs.some((j) => j !== row && j.portal_id === p_portal && j.external_id === p_set.external_id)) return err('EXTERNAL_LISTING_ALREADY_LINKED');
        Object.assign(row, p_set, { revision: row.revision + 1 });
      }
      t.publishing_engine_events.push({ id: t.publishing_engine_events.length + 1, listing_id: p_listing, publication_id: row.id, user_id: p_owner, kind: p_event.kind, portal_id: p_portal, from_status: from, to_status: row.status, detail: p_event.detail ?? {}, created_at: String(Date.now()) });
      return { data: row, error: null };
    },
    publishing_listing_lifecycle({ p_owner, p_listing, p_action }) {
      const row = t.publishing_engine_listings.find((l) => l.id === p_listing && l.user_id === p_owner);
      if (!row) return err('OWNED_RECORD_REQUIRED');
      if (['ARCHIVE', 'DELETE'].includes(p_action) && t.publishing_engine_jobs.some((j) => j.listing_id === p_listing && ['VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'UNPUBLISH_REQUESTED', 'QUEUED', 'PUBLISHING', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED'].includes(j.status))) return err('LIVE_PUBLICATIONS_EXIST');
      if (p_action === 'DELETE') {
        for (const k of ['publishing_engine_events', 'publishing_engine_jobs', 'publishing_engine_versions']) t[k] = t[k].filter((r) => r.listing_id !== p_listing);
        t.publishing_engine_listings = t.publishing_engine_listings.filter((l) => l.id !== p_listing);
        return { data: { deleted: true }, error: null };
      }
      row.archived_at = p_action === 'ARCHIVE' ? 'now' : null;
      return { data: row, error: null };
    },
    // Mirrors 20261108090000 publishing_account_write: per-action key whitelist,
    // verified statuses only from a TEST, the verified-status CHECK, credential never echoed.
    publishing_account_write({ p_actor, p_portal, p_patch, p_action }) {
      const allowed = {
        REGISTER: ['status', 'connection_method', 'account_label', 'contact_phone', 'verification_result', 'last_error'],
        UPDATE: ['status', 'connection_method', 'account_label', 'contact_phone', 'verification_result', 'last_error'],
        CREDENTIAL_SET: ['credential', 'credential_set_at', 'status', 'verified_at', 'session_expires_at'],
        SESSION_SET: ['status', 'connection_method', 'verified_at', 'session_expires_at', 'verification_result', 'last_error'],
        SESSION_CHECK: ['status', 'verified_at', 'verification_result', 'session_expires_at', 'last_error'],
        AUTOMATION: ['automation_enabled', 'live_submit_approved', 'live_submit_approved_by', 'live_submit_approved_at'],
        TEST: ['status', 'verified_at', 'verification_result', 'session_expires_at', 'last_error', 'failure_count'],
        DISCONNECT: ['status', 'connection_method', 'account_label', 'contact_phone', 'credential', 'credential_set_at', 'verified_at', 'session_expires_at', 'verification_result', 'last_error'],
        ACTIVITY: ['last_published_at', 'failure_count', 'last_error'],
      }[p_action];
      if (!allowed) return err('INVALID_ACTION');
      if (Object.keys(p_patch).some((k) => !allowed.includes(k))) return err('FIELD_NOT_EDITABLE');
      if (!['TEST', 'CREDENTIAL_SET', 'SESSION_CHECK'].includes(p_action) && ['CONNECTED', 'PUBLISHING_AVAILABLE'].includes(p_patch.status)) return err('VERIFICATION_REQUIRED');
      const row = t.publishing_accounts.find((r) => r.portal_id === p_portal);
      if (!row) return err('PORTAL_UNKNOWN');
      const next = { ...row, ...p_patch };
      if (['CONNECTED', 'PUBLISHING_AVAILABLE'].includes(next.status) && !next.verified_at) return err('publishing_accounts_verified_status');
      const { credential: _b, ...before } = row;
      Object.assign(row, p_patch);
      const { credential: _a, ...after } = row;
      if (p_action !== 'ACTIVITY') t.publishing_account_audit.push({ id: t.publishing_account_audit.length + 1, portal_id: p_portal, actor: p_actor, action: p_action, before, after, created_at: 'now' });
      return { data: after, error: null };
    },
    publishing_op_enqueue({ p_publication, p_portal, p_kind, p_version, p_key }) {
      const dup = t.publishing_operations.find((o) => o.idempotency_key === p_key);
      if (dup) return { data: dup, error: null };
      if (p_publication && t.publishing_operations.some((o) => o.publication_id === p_publication && ['QUEUED', 'RUNNING'].includes(o.status))) return err('OPERATION_ALREADY_ACTIVE');
      const op = { id: `op-${t.publishing_operations.length + 1}`, publication_id: p_publication, portal_id: p_portal, kind: p_kind, listing_version: p_version, status: 'QUEUED', idempotency_key: p_key, created_at: String(Date.now()) };
      t.publishing_operations.push(op);
      return { data: op, error: null };
    },
    publishing_provider_update({ p_actor, p_provider, p_patch, p_action }) {
      const row = t.publishing_providers.find((r) => r.id === p_provider);
      if (!row) return err('PORTAL_UNKNOWN');
      const before = { ...row };
      Object.assign(row, p_patch);
      t.publishing_provider_audit.push({ id: t.publishing_provider_audit.length + 1, provider_id: p_provider, actor: p_actor, action: p_action, before, after: { ...row }, created_at: 'now' });
      return { data: row, error: null };
    },
  };
  const from = (table) => {
    const filters = [];
    const read = () => (t[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const failing = (table === 'publishing_providers' && t.providersUnreadable) || (table === 'publishing_accounts' && t.accountsUnreadable);
    // Column lists are honoured, so a test can prove a column is never selected.
    const project = (row) => {
      if (!row || !q.cols || q.cols === '*') return row ? { ...row } : row;
      return Object.fromEntries(q.cols.split(',').map((c) => c.trim()).filter((c) => c in row).map((c) => [c, row[c]]));
    };
    const q = {
      select: (cols) => { q.cols = cols; return q; }, order: () => q, limit: () => q,
      eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: project(read()[0] ?? null), error: null }),
      upsert: async (row) => { const list = (t[table] ??= []); const at = list.findIndex((r) => r.portal_id === row.portal_id); if (at >= 0) list[at] = row; else list.push(row); return { error: null }; },
      then: (ok, ko) => Promise.resolve(failing ? { data: null, error: { code: '42P01', message: 'relation does not exist' } } : { data: read().map(project), error: null }).then(ok, ko),
    };
    return q;
  };
  const storage = { from: () => ({ createSignedUrl: async (path) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }) }) };
  return { t, from, storage, rpc: async (name, args) => rpc[name](args) };
}

let db, current;
globalThis.__createClient = (_url, key, opts) => {
  if (key === 'test-SUPABASE_ANON_KEY') {
    const header = opts.global.headers.Authorization;
    const user = header.includes('owner') ? 'auth-owner' : header.includes('other') ? 'auth-other' : header.includes('admin') ? 'auth-admin' : null;
    return {
      auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: user ? null : { message: 'bad' } }) },
      // is_admin() runs with the CALLER's token, so only the admin's own session answers true.
      rpc: async (name) => (name === 'is_admin' ? { data: user === 'auth-admin', error: null } : { data: null, error: { message: 'unexpected' } }),
    };
  }
  return { from: (t) => db.from(t), rpc: (n, a) => db.rpc(n, a), storage: db.storage };
};
const { handler } = await import('../index.ts');

const jwt = (claims) => ['owner', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
const pages = new Map();
const fetched = [];
const deps = {
  fetchPage: async (url, adapter) => { fetched.push(url); assert.equal(adapter.canCheckPage(), true, 'never fetched for an owner-confirmed portal'); return pages.get(url) ?? { status: 'NETWORK' }; },
  probe: async (config) => ({ status: config.verification === 'PAGE_CHECK' ? 'REACHABLE' : 'SKIPPED', detail: 'stub' }),
  now: () => current,
};
async function call(action, body = {}, { who = 'owner', origin = 'https://homatch.live', token } = {}) {
  const auth = token ?? `Bearer ${who}`;
  const res = await handler(new Request('https://edge.test', { method: 'POST', headers: { Origin: origin, Authorization: auth }, body: JSON.stringify({ action, ...body }) }), deps);
  return { status: res.status, body: await res.json() };
}
const listing = (over = {}) => ({
  title: 'Apartment in Vake', description: { ka: 'ბინა ვაკეში' }, propertyType: 'APARTMENT', dealType: 'SALE', price: 150000, currency: 'USD',
  area: 90, city: 'თბილისი', street: 'Chavchavadze', contactName: 'Nino', contacts: [{ phone: '+995599111222' }], photos: [PHOTO], portalTargets: ['myhome', 'ssge'], ...over,
});
const fresh = () => { db = makeDb(); current = new Date('2026-10-15T12:00:00Z'); pages.clear(); fetched.length = 0; };

test('origin, method and authentication are enforced before anything is read', async () => {
  fresh();
  assert.equal((await call('workspace', {}, { origin: 'https://homatch.live.evil.test' })).status, 403);
  assert.equal((await call('workspace', {}, { token: '' })).status, 401);
  assert.equal((await call('workspace', {}, { who: 'nobody' })).status, 401);
});

test('a draft saves for an owned property without creating any property row; the property\'s private number is never copied in without the owner\'s tap', async () => {
  fresh();
  const before = db.t.properties.length;
  const r = await call('listing.save', { propertyId: PROP, version: 0, listing: { title: 'Draft only' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.listing.status, 'DRAFT');
  assert.deepEqual(r.body.listing.payload.contacts, []);
  assert.equal(db.t.properties.length, before);
  // Resubmitting version 0 (a double click) is a conflict, not a second listing.
  assert.equal((await call('listing.save', { propertyId: PROP, version: 0, listing: { title: 'again' } })).status, 409);
  assert.equal(db.t.publishing_engine_listings.length, 1);
});

test('another owner\'s property and listing are unreachable', async () => {
  fresh();
  assert.equal((await call('listing.save', { propertyId: FOREIGN, version: 0, listing: listing() })).body.code, 'OWNED_PROPERTY_REQUIRED');
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  assert.equal((await call('listing.get', { propertyId: PROP }, { who: 'other' })).body.code, 'LISTING_NOT_FOUND');
  assert.equal((await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' }, { who: 'other' })).body.code, 'LISTING_NOT_FOUND');
  assert.deepEqual((await call('workspace', {}, { who: 'other' })).body.listings, []);
});

test('photo ids that are not this property\'s are dropped server-side', async () => {
  fresh();
  const r = await call('listing.save', { propertyId: PROP, version: 0, listing: listing({ photos: [PHOTO, '66666666-6666-4666-8666-666666666666'] }) });
  assert.deepEqual(r.body.listing.payload.photos, [PHOTO]);
});

test('an impersonation session may read but never write', async () => {
  fresh();
  const token = `Bearer ${jwt({ session_id: IMPERSONATED_SESSION })}`;
  assert.equal((await call('workspace', {}, { token })).status, 200);
  const r = await call('listing.save', { propertyId: PROP, version: 0, listing: listing() }, { token });
  assert.equal(r.status, 403);
  assert.equal(db.t.publishing_engine_listings.length, 0);
});

test('prepare requires a ready listing and is idempotent', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: { title: 'incomplete' } });
  assert.equal((await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' })).body.code, 'LISTING_NOT_READY');
  await call('listing.save', { propertyId: PROP, version: 1, listing: listing() });
  const a = await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  const b = await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(db.t.publishing_engine_jobs.length, 1);
  assert.equal(db.t.publishing_engine_jobs[0].status, 'HANDOFF_READY');
});

test('PUBLISHED only after the public page proves the listing; partial success is kept per portal', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  await call('publication.prepare', { propertyId: PROP, portalId: 'ssge' });
  const myhome = 'https://www.myhome.ge/ka/pr/18234567/iyideba-bina';
  const ssge = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-bina-31234567';
  pages.set(myhome, { status: 200, body: '<script>{"statement_id":18234567}</script>' });
  pages.set(ssge, { status: 403 });
  const a = await call('publication.link', { propertyId: PROP, portalId: 'myhome', externalUrl: myhome });
  const b = await call('publication.link', { propertyId: PROP, portalId: 'ssge', externalUrl: ssge });
  const byPortal = Object.fromEntries(b.body.publications.map((p) => [p.portal_id, p]));
  assert.equal(a.status, 200);
  assert.equal(byPortal.myhome.status, 'PUBLISHED');
  assert.equal(byPortal.myhome.external_id, '18234567');
  assert.equal(byPortal.ssge.status, 'VERIFYING', 'a blocked check is pending, never PUBLISHED and never failed outright');
  assert.equal(byPortal.ssge.last_error, 'PORTAL_BLOCKED_CHECK');
  // Immediately checking again is refused by the backoff.
  assert.equal((await call('publication.check', { propertyId: PROP, portalId: 'ssge' })).status, 429);
  // A URL on the wrong portal is refused outright.
  assert.equal((await call('publication.link', { propertyId: PROP, portalId: 'ssge', externalUrl: myhome })).body.code, 'URL_NOT_ON_PORTAL');
});

test('an external listing cannot be claimed by a second HOMATCH publication', async () => {
  fresh();
  db.t.properties.push({ id: SECOND, user_id: OWNER, is_deleted: false, contact_phone_e164: '+995599333444' });
  db.t.property_photos.push({ id: '88888888-8888-4888-8888-888888888888', property_id: '77777777-7777-4777-8777-777777777777' });
  for (const [id, photo] of [[PROP, PHOTO], ['77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888']]) {
    await call('listing.save', { propertyId: id, version: 0, listing: listing({ photos: [photo] }) });
    await call('publication.prepare', { propertyId: id, portalId: 'myhome' });
  }
  const url = 'https://www.myhome.ge/ka/pr/18234567/x';
  pages.set(url, { status: 200, body: '18234567' });
  await call('publication.link', { propertyId: PROP, portalId: 'myhome', externalUrl: url });
  const dup = await call('publication.link', { propertyId: '77777777-7777-4777-8777-777777777777', portalId: 'myhome', externalUrl: url });
  assert.equal(dup.body.code, 'EXTERNAL_LISTING_ALREADY_LINKED');
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'EXTERNAL_LISTING_ALREADY_LINKED');
});

test('unpublish, archive and delete: never the property, and never while a copy may be live', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  const url = 'https://www.myhome.ge/ka/pr/18234567/x';
  pages.set(url, { status: 200, body: '18234567' });
  await call('publication.link', { propertyId: PROP, portalId: 'myhome', externalUrl: url });
  assert.equal((await call('listing.delete', { propertyId: PROP })).body.code, 'LIVE_PUBLICATIONS_EXIST');
  assert.equal((await call('listing.archive', { propertyId: PROP })).body.code, 'LIVE_PUBLICATIONS_EXIST');
  await call('publication.unpublish', { propertyId: PROP, portalId: 'myhome' });
  pages.set(url, { status: 404 });
  current = new Date(current.getTime() + 10 * 60_000);
  const checked = await call('publication.check', { propertyId: PROP, portalId: 'myhome' });
  assert.equal(checked.body.publications[0].status, 'UNPUBLISHED');
  assert.equal((await call('listing.delete', { propertyId: PROP })).status, 200);
  assert.equal(db.t.publishing_engine_listings.length, 0);
  assert.equal(db.t.publishing_engine_jobs.length, 0);
  assert.ok(db.t.properties.some((p) => p.id === PROP && !p.is_deleted), 'the HOMATCH property is untouched');
});

test('editing a published listing flags the portal copy until it is marked updated', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  const url = 'https://www.myhome.ge/ka/pr/18234567/x';
  pages.set(url, { status: 200, body: '18234567' });
  await call('publication.link', { propertyId: PROP, portalId: 'myhome', externalUrl: url });
  const edited = await call('listing.save', { propertyId: PROP, version: 1, listing: listing({ price: 140000 }) });
  assert.equal(edited.body.listing.version, 2);
  assert.equal(edited.body.publications[0].listing_version, 1, 'portal copy is behind');
  const marked = await call('publication.markUpdated', { propertyId: PROP, portalId: 'myhome' });
  assert.equal(marked.body.publications[0].listing_version, 2);
  assert.equal(marked.body.publications[0].status, 'PUBLISHED');
  assert.ok(marked.body.events.some((e) => e.kind === 'PORTAL_COPY_UPDATED'));
});

test('the workspace lists all eight portals; an unreadable registry leaves only the two the old constraint accepts', async () => {
  fresh();
  const r = await call('workspace');
  assert.deepEqual(r.body.portals.map((p) => p.id), ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']);
  assert.ok(r.body.portals.every((p) => p.enabled && p.capabilities.accountConnection === false));
  db.t.providersUnreadable = true;
  const degraded = await call('workspace');
  assert.equal(degraded.status, 200);
  assert.deepEqual(degraded.body.portals.filter((p) => p.enabled).map((p) => p.id), ['myhome', 'ssge']);
});

test('several contact numbers, each with its own channels, are normalised and saved', async () => {
  fresh();
  const r = await call('listing.save', { propertyId: PROP, version: 0, listing: listing({ contacts: [{ phone: '555 12 34 56', whatsapp: true, viber: false }, { phone: '+995577000000', viber: true }] }) });
  assert.deepEqual(r.body.listing.payload.contacts, [{ phone: '+995555123456', whatsapp: true, viber: false }, { phone: '+995577000000', whatsapp: false, viber: true }]);
  assert.equal(r.body.listing.status, 'READY');
  assert.equal('contactPhone' in r.body.listing.payload, false, 'the legacy single field is not written back');
});

test('a disabled portal cannot be prepared or linked', async () => {
  fresh();
  db.t.publishing_providers.find((p) => p.id === 'placege').enabled = false;
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  assert.equal((await call('publication.prepare', { propertyId: PROP, portalId: 'placege' })).body.code, 'PORTAL_DISABLED');
  assert.equal((await call('publication.link', { propertyId: PROP, portalId: 'placege', externalUrl: 'https://place.ge/ge/ads/view/912345' })).body.code, 'PORTAL_DISABLED');
  assert.equal((await call('publication.prepare', { propertyId: PROP, portalId: 'homege' })).status, 200);
});

test('owner-confirmed portals: an explicit statement is required, no page is ever fetched, and it is never PUBLISHED', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'korter' });
  const url = 'https://korter.ge/ka/complex-vake/4521';
  assert.equal((await call('publication.link', { propertyId: PROP, portalId: 'korter', externalUrl: url })).body.code, 'ATTESTATION_REQUIRED');
  const r = await call('publication.link', { propertyId: PROP, portalId: 'korter', externalUrl: url, attest: true });
  const korter = r.body.publications.find((p) => p.portal_id === 'korter');
  assert.equal(korter.status, 'OWNER_CONFIRMED');
  assert.equal((await call('publication.check', { propertyId: PROP, portalId: 'korter' })).body.code, 'CHECK_NOT_AVAILABLE');
  assert.deepEqual(fetched, [], 'HOMATCH made no request to Korter');
  assert.ok(r.body.events.some((e) => e.kind === 'PUBLICATION_ATTESTED_BY_OWNER'));
  assert.equal((await call('listing.archive', { propertyId: PROP })).body.code, 'LIVE_PUBLICATIONS_EXIST');
  await call('publication.unpublish', { propertyId: PROP, portalId: 'korter' });
  const removed = await call('publication.confirmRemoved', { propertyId: PROP, portalId: 'korter' });
  assert.equal(removed.body.publications.find((p) => p.portal_id === 'korter').status, 'UNPUBLISHED');
});

test('API operations answer with an explicit capability error, for every portal', async () => {
  fresh();
  for (const portalId of ['myhome', 'binebi']) {
    for (const operation of ['connectAccount', 'testConnection', 'createListing', 'updateListing', 'deleteListing', 'importListing']) {
      const r = await call('provider.operation', { portalId, operation });
      assert.equal(r.status, 409);
      assert.deepEqual(r.body, { ok: false, code: 'CAPABILITY_NOT_SUPPORTED', capability: operation, provider: portalId });
    }
  }
  assert.equal((await call('provider.operation', { portalId: 'myhome', operation: 'login' })).body.code, 'UNKNOWN_OPERATION');
});

test('duplicating a listing copies its text to another owned property, never its photos, and leaves the source alone', async () => {
  fresh();
  db.t.properties.push({ id: SECOND, user_id: OWNER, is_deleted: false, contact_phone_e164: null });
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  const source = structuredClone(db.t.publishing_engine_listings[0]);
  const r = await call('listing.duplicate', { propertyId: PROP, targetPropertyId: SECOND });
  assert.equal(r.status, 200);
  assert.equal(r.body.listing.id, SECOND);
  assert.equal(r.body.listing.payload.title, 'Apartment in Vake');
  assert.deepEqual(r.body.listing.payload.photos, []);
  assert.deepEqual(db.t.publishing_engine_listings.find((l) => l.id === PROP), source, 'source listing unchanged');
  assert.equal((await call('listing.duplicate', { propertyId: PROP, targetPropertyId: SECOND })).body.code, 'LISTING_ALREADY_EXISTS');
  assert.equal((await call('listing.duplicate', { propertyId: PROP, targetPropertyId: FOREIGN })).body.code, 'OWNED_PROPERTY_REQUIRED');
  assert.equal((await call('listing.duplicate', { propertyId: PROP, targetPropertyId: PROP })).body.code, 'DUPLICATE_TARGET_SAME');
});

test('admin control centre: is_admin() on the caller\'s own token, validated patches, every change audited', async () => {
  fresh();
  for (const action of ['admin.providers', 'admin.publications', 'admin.provider.update', 'admin.provider.recheck']) {
    const r = await call(action, { portalId: 'myhome', providerId: 'myhome', patch: { enabled: false } });
    assert.equal(r.status, 403, action);
    assert.equal(r.body.code, 'ADMIN_REQUIRED');
  }
  assert.equal(db.t.publishing_providers.find((p) => p.id === 'myhome').enabled, true);
  const overview = await call('admin.providers', {}, { who: 'admin' });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.providers.length, 8);
  assert.ok(overview.body.providers.every((p) => Array.isArray(p.evidence) && p.evidence.length > 0));
  assert.equal((await call('admin.provider.update', { providerId: 'placege', patch: { createUrl: 'https://evil.test/add' } }, { who: 'admin' })).body.code, 'CREATE_URL_MUST_BE_ON_PORTAL');
  assert.equal((await call('admin.provider.update', { providerId: 'korter', patch: { verification: 'PAGE_CHECK' } }, { who: 'admin' })).body.code, 'PAGE_CHECK_NOT_PERMITTED');
  assert.equal(db.t.publishing_provider_audit.length, 0, 'refused patches leave no trace in the registry');
  const ok = await call('admin.provider.update', { providerId: 'placege', patch: { enabled: false, requiredFields: ['area', 'photos'] } }, { who: 'admin' });
  assert.equal(ok.status, 200);
  assert.equal(db.t.publishing_provider_audit.length, 1);
  assert.equal(db.t.publishing_provider_audit[0].actor, ADMIN);
  const after = await call('workspace');
  const place = after.body.portals.find((p) => p.id === 'placege');
  assert.equal(place.enabled, false);
  assert.deepEqual(place.requiredFields, ['area', 'photos']);
  const recheck = await call('admin.provider.recheck', { providerId: 'binebi' }, { who: 'admin' });
  assert.equal(recheck.body.health.status, 'SKIPPED', 'an owner-confirmed portal is never probed');
  // The admin's publications view carries no listing payloads or phone numbers.
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'myhome' });
  const pubs = await call('admin.publications', { portalId: 'myhome' }, { who: 'admin' });
  assert.equal(pubs.body.publications.length, 1);
  assert.doesNotMatch(JSON.stringify(pubs.body), /\+995|payload|contacts/);
});

test('an admin may retry a failed verification on the owner\'s behalf — and nothing else', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing() });
  await call('publication.prepare', { propertyId: PROP, portalId: 'ssge' });
  const url = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-bina-31234567';
  pages.set(url, { status: 404 });
  await call('publication.link', { propertyId: PROP, portalId: 'ssge', externalUrl: url });
  const job = db.t.publishing_engine_jobs[0];
  assert.equal(job.status, 'VERIFICATION_FAILED');
  assert.equal((await call('admin.publication.retry', { publicationId: 'job-ssge' }, { who: 'admin' })).body.code, 'INVALID_ID');
  job.id = '12121212-1212-4121-8121-121212121212';
  assert.equal((await call('admin.publication.retry', { publicationId: job.id })).status, 403, 'an owner is not an admin');
  const r = await call('admin.publication.retry', { publicationId: job.id }, { who: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(job.status, 'VERIFYING');
  assert.ok(db.t.publishing_engine_events.some((e) => e.kind === 'RETRY_BY_ADMIN' && e.user_id === OWNER), 'history stays on the owner\'s listing');
  assert.equal((await call('admin.publication.retry', { publicationId: job.id }, { who: 'admin' })).body.code, 'NOT_FAILED');
});

/* ── The central engine: HOMATCH publishes through its own accounts ──────── */

const ready = async () => { await call('listing.save', { propertyId: PROP, version: 0, listing: listing() }); };
const registerAccount = (portalId, over = {}) => call('admin.account.save', { portalId, account: { accountLabel: `homatch@${portalId}`, contactPhone: '+995322000111', ...over } }, { who: 'admin' });

test('publish to selected portals: consent required, per-portal results, nothing reported published', async () => {
  fresh(); await ready();
  assert.equal((await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'] })).body.code, 'CONTACT_CONSENT_REQUIRED');
  assert.equal(db.t.publishing_engine_jobs.length, 0);
  await registerAccount('myhome');
  const r = await call('publication.publish', { propertyId: PROP, portalIds: ['myhome', 'ssge', 'zillow'], consent: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, [
    { portalId: 'myhome', status: 'ADMIN_ACTION_REQUIRED' },
    { portalId: 'ssge', status: 'AUTH_REQUIRED' },
    { portalId: 'zillow', code: 'PORTAL_UNKNOWN' },
  ]);
  for (const j of db.t.publishing_engine_jobs) {
    assert.equal(j.channel, 'HOMATCH_ACCOUNT');
    assert.ok(j.contact_consent_at);
    assert.equal(j.published_at, null);
  }
  // A double click is idempotent: no second job, no status change.
  const again = await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  assert.deepEqual(again.body.results, [{ portalId: 'myhome', status: 'ADMIN_ACTION_REQUIRED' }]);
  assert.equal(db.t.publishing_engine_jobs.length, 2);
  // The customer sees which number HOMATCH listings show, never the account identity.
  const myhome = r.body.portals.find((p) => p.id === 'myhome');
  assert.equal(myhome.homatch.contactPhone, '+995322000111');
  assert.equal(JSON.stringify(r.body).includes('homatch@myhome'), false);
});

test('publish needs the owner name and number for the footer', async () => {
  fresh();
  await call('listing.save', { propertyId: PROP, version: 0, listing: listing({ contactName: '' }) });
  assert.equal((await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true })).body.code, 'OWNER_CONTACT_REQUIRED');
});

test('registering an account reroutes waiting publications; disconnecting sends them back to wait', async () => {
  fresh(); await ready();
  await call('publication.publish', { propertyId: PROP, portalIds: ['ssge'], consent: true });
  assert.equal(db.t.publishing_engine_jobs[0].status, 'AUTH_REQUIRED');
  const saved = await registerAccount('ssge');
  assert.equal(saved.body.status, 'PUBLISHING_RESTRICTED');
  assert.equal(saved.body.rerouted, 1);
  assert.equal(db.t.publishing_engine_jobs[0].status, 'ADMIN_ACTION_REQUIRED');
  await call('admin.account.disconnect', { portalId: 'ssge' }, { who: 'admin' });
  assert.equal(db.t.publishing_engine_jobs[0].status, 'AUTH_REQUIRED');
  assert.equal(db.t.publishing_accounts.find((a) => a.portal_id === 'ssge').status, 'NOT_CONFIGURED');
  assert.deepEqual(db.t.publishing_account_audit.map((a) => a.action), ['REGISTER', 'DISCONNECT']);
});

test('accounts: admin only, never "connected" without a real verification, no credential stored or shown', async () => {
  fresh();
  assert.equal((await call('admin.accounts')).status, 403);
  assert.equal((await registerAccount('myhome', {}, 'owner')).status, 200 /* admin call */);
  assert.equal((await call('admin.account.save', { portalId: 'myhome', account: { accountLabel: 'x', contactPhone: '+995322000111' } })).status, 403);
  const test1 = await call('admin.account.test', { portalId: 'myhome' }, { who: 'admin' });
  assert.equal(test1.body.ok, false);
  assert.equal(test1.body.result, 'CAPABILITY_NOT_SUPPORTED');
  const acct = db.t.publishing_accounts.find((a) => a.portal_id === 'myhome');
  assert.equal(acct.status, 'PUBLISHING_RESTRICTED');
  assert.equal(acct.verified_at, null);
  assert.equal(acct.verification_result, 'CAPABILITY_NOT_SUPPORTED');
  // The database refuses a verified status from anything but a test.
  assert.equal((await db.rpc('publishing_account_write', { p_actor: ADMIN, p_portal: 'myhome', p_action: 'UPDATE', p_patch: { status: 'CONNECTED' } })).error.message, 'VERIFICATION_REQUIRED');
  assert.equal((await db.rpc('publishing_account_write', { p_actor: ADMIN, p_portal: 'myhome', p_action: 'TEST', p_patch: { status: 'CONNECTED' } })).error.message, 'publishing_accounts_verified_status');
  // No verified mechanism would use a credential, so none is accepted.
  const cred = await call('admin.account.credential', { portalId: 'myhome', secret: 'hunter2' }, { who: 'admin' });
  assert.equal(cred.body.code, 'CREDENTIAL_NOT_ACCEPTED');
  assert.equal(acct.credential, null);
  const list = await call('admin.accounts', {}, { who: 'admin' });
  assert.equal(list.status, 200);
  assert.equal(list.body.accounts.length, 8);
  assert.equal(JSON.stringify(list.body).includes('credential"'), false);
  assert.equal(list.body.accounts.find((a) => a.portal.id === 'myhome').account.account_label, 'homatch@myhome');
  assert.equal(list.body.accounts.every((a) => a.acceptsCredential === false), true);
});

test('the admin queue: claim, post by hand, link — published only after the public page check', async () => {
  fresh(); await ready();
  await registerAccount('myhome');
  await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  assert.equal((await call('admin.queue')).status, 403);
  const q = await call('admin.queue', {}, { who: 'admin' });
  assert.equal(q.body.jobs.length, 1);
  const job = q.body.jobs[0];
  assert.equal(job.listing.title, 'Apartment in Vake');
  assert.equal(JSON.stringify(q.body).includes('+995599111222'), false, 'no owner phone in the queue list');
  // The job view: HOMATCH number for the contact field, the owner in the footer, once.
  const view = await call('admin.job.get', { jobId: job.id }, { who: 'admin' });
  assert.equal(view.body.copies.ka.contactPhone, '+995322000111');
  assert.ok(view.body.copies.ka.description.endsWith('განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.'));
  assert.equal(view.body.copies.ka.description.split('ქონების მფლობელი: Nino').length - 1, 1);
  assert.equal(view.body.photos[0].url, `https://signed.test/${PROP}/a.jpg`);
  assert.equal(JSON.stringify(view.body).includes('credential"'), false);
  assert.equal((await call('admin.job.claim', { jobId: job.id }, { who: 'admin' })).body.job.status, 'PUBLISHING');
  // The portal page does not show the listing yet: linked, still verifying, not published.
  const url = 'https://www.myhome.ge/ka/pr/23456789/apartment';
  pages.set('https://www.myhome.ge/ka/pr/23456789/apartment', { status: 200, body: '<html>search page</html>' });
  const done = await call('admin.job.complete', { jobId: job.id, externalUrl: url }, { who: 'admin' });
  assert.equal(done.body.job.status, 'VERIFYING');
  assert.equal(done.body.job.published_at, null);
  // Once the page carries the listing id, the check confirms it.
  pages.set('https://www.myhome.ge/ka/pr/23456789/apartment', { status: 200, body: '<html>ID 23456789</html>' });
  current = new Date(current.getTime() + 120_000);
  await call('admin.job.check', { jobId: job.id }, { who: 'admin' });
  const j = db.t.publishing_engine_jobs[0];
  assert.equal(j.status, 'PUBLISHED');
  assert.equal(j.external_id, '23456789');
  assert.ok(db.t.publishing_engine_events.some((e) => e.kind === 'EXTERNAL_LISTING_LINKED' && e.detail.admin === ADMIN));
  assert.ok(db.t.publishing_accounts.find((a) => a.portal_id === 'myhome').last_published_at);
  // The owner cannot link or attest on HOMATCH's copy.
  assert.equal((await call('publication.link', { propertyId: PROP, portalId: 'myhome', externalUrl: url })).body.code, 'HOMATCH_MANAGED');
});

test('rejections carry a reason the owner sees; the owner can withdraw before posting and republish after', async () => {
  fresh(); await ready();
  await registerAccount('placege');
  await call('publication.publish', { propertyId: PROP, portalIds: ['placege'], consent: true });
  const jobId = db.t.publishing_engine_jobs[0].id;
  assert.equal((await call('admin.job.reject', { jobId, reason: '' }, { who: 'admin' })).body.code, 'REASON_REQUIRED');
  await call('admin.job.reject', { jobId, reason: 'Portal moderation refused the photos' }, { who: 'admin' });
  const seen = (await call('listing.get', { propertyId: PROP })).body.publications[0];
  assert.equal(seen.status, 'REJECTED');
  assert.equal(seen.status_reason, 'Portal moderation refused the photos');
  assert.equal(db.t.publishing_accounts.find((a) => a.portal_id === 'placege').failure_count, 1);
  await call('publication.publish', { propertyId: PROP, portalIds: ['placege'], consent: true });
  assert.equal(db.t.publishing_engine_jobs[0].status, 'ADMIN_ACTION_REQUIRED');
  await call('publication.unpublish', { propertyId: PROP, portalId: 'placege' });
  assert.equal(db.t.publishing_engine_jobs[0].status, 'UNPUBLISHED');
  assert.ok(db.t.publishing_engine_events.some((e) => e.kind === 'PUBLISH_WITHDRAWN'));
});

test('a queued publication blocks archiving; owner-confirmed portals are attested by the admin, never fetched', async () => {
  fresh(); await ready();
  await registerAccount('korter');
  await call('publication.publish', { propertyId: PROP, portalIds: ['korter'], consent: true });
  assert.equal((await call('listing.archive', { propertyId: PROP })).body.code, 'LIVE_PUBLICATIONS_EXIST');
  const jobId = db.t.publishing_engine_jobs[0].id;
  const r = await call('admin.job.complete', { jobId, externalUrl: 'https://korter.ge/en/project/4521' }, { who: 'admin' });
  assert.equal(r.body.job.status, 'OWNER_CONFIRMED');
  assert.equal(fetched.length, 0);
  assert.ok(db.t.publishing_engine_events.some((e) => e.kind === 'PUBLICATION_ATTESTED_BY_ADMIN'));
});

test('the HOMATCH accounts being unreadable leaves publishing waiting, not failing', async () => {
  fresh(); await ready();
  db.t.accountsUnreadable = true;
  const r = await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  assert.deepEqual(r.body.results, [{ portalId: 'myhome', status: 'AUTH_REQUIRED' }]);
});


/* ── Backend browser automation: sessions, switches, the queue ────────────── */

const KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
const withKey = async (fn) => {
  const get = globalThis.Deno.env.get;
  globalThis.Deno.env.get = (k) => (k === 'PUBLISHING_CREDENTIALS_KEY' ? KEY : get(k));
  try { return await fn(); } finally { globalThis.Deno.env.get = get; }
};
const COOKIES = { cookies: [{ name: 'sid', value: 'SECRET-COOKIE', domain: '.myhome.ge' }, { name: 'track', value: 'x', domain: '.ads.example' }], origins: [] };

test('a captured session: admin only, portal cookies only, sealed, and NOT connected until the worker checks it', async () => withKey(async () => {
  fresh();
  await registerAccount('myhome');
  assert.equal((await call('admin.account.session', { portalId: 'myhome', storageState: COOKIES })).status, 403);
  assert.equal((await call('admin.account.session', { portalId: 'placege', storageState: COOKIES }, { who: 'admin' })).body.code, 'BROWSER_ADAPTER_NOT_AVAILABLE');
  assert.equal((await call('admin.account.session', { portalId: 'myhome', storageState: { cookies: [{ name: 'a', value: 'b', domain: '.evil.example' }], origins: [] } }, { who: 'admin' })).body.code, 'SESSION_HAS_NO_PORTAL_COOKIES');
  const r = await call('admin.account.session', { portalId: 'myhome', storageState: COOKIES }, { who: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.body.cookies, 1, 'the off-portal cookie is dropped');
  const row = db.t.publishing_account_sessions[0];
  assert.equal(JSON.stringify(row).includes('SECRET-COOKIE'), false, 'only ciphertext is stored');
  assert.equal(row.status, 'UNVERIFIED');
  const acct = db.t.publishing_accounts.find((a) => a.portal_id === 'myhome');
  assert.equal(acct.status, 'AUTH_REQUIRED', 'never connected by upload alone');
  assert.equal(acct.verified_at, null);
  assert.ok(db.t.publishing_operations.some((o) => o.kind === 'CHECK_SESSION' && o.portal_id === 'myhome'), 'the worker is asked to check it');
  const list = await call('admin.accounts', {}, { who: 'admin' });
  assert.equal(JSON.stringify(list.body).includes('SECRET-COOKIE') || JSON.stringify(list.body).includes('"envelope"'), false);
  assert.equal(list.body.accounts.find((a) => a.portal.id === 'myhome').browser.CREATE, 'FIXTURE_TESTED');
}));

test('the sealing key missing: the session is refused, nothing stored', async () => {
  fresh();
  await registerAccount('myhome');
  const get = globalThis.Deno.env.get;
  globalThis.Deno.env.get = (k) => (k === 'PUBLISHING_CREDENTIALS_KEY' ? undefined : get(k));
  try {
    assert.equal((await call('admin.account.session', { portalId: 'myhome', storageState: COOKIES }, { who: 'admin' })).body.code, 'CREDENTIAL_KEY_NOT_CONFIGURED');
  } finally { globalThis.Deno.env.get = get; }
  assert.equal(db.t.publishing_account_sessions.length, 0);
});

test('automation switches: live submit needs the words of approval; portals without a browser adapter refuse', async () => {
  fresh();
  await registerAccount('myhome');
  assert.equal((await call('admin.account.automation', { portalId: 'myhome', enabled: true }, { who: 'owner' })).status, 403);
  assert.equal((await call('admin.account.automation', { portalId: 'brokeri', enabled: true }, { who: 'admin' })).body.code, 'BROWSER_ADAPTER_NOT_AVAILABLE');
  assert.equal((await call('admin.account.automation', { portalId: 'myhome', liveSubmit: true }, { who: 'admin' })).body.code, 'LIVE_SUBMIT_CONFIRMATION_REQUIRED');
  await call('admin.account.automation', { portalId: 'myhome', enabled: true, liveSubmit: true, confirm: 'APPROVE_LIVE_PUBLISHING' }, { who: 'admin' });
  const acct = db.t.publishing_accounts.find((a) => a.portal_id === 'myhome');
  assert.equal(acct.automation_enabled, true);
  assert.equal(acct.live_submit_approved, true);
  assert.equal(acct.live_submit_approved_by, ADMIN);
  assert.ok(db.t.publishing_account_audit.some((a) => a.action === 'AUTOMATION'));
});

test('publish with automation on and a verified session: QUEUED with a CREATE operation; a double click queues nothing more', async () => {
  fresh(); await ready();
  await registerAccount('myhome');
  Object.assign(db.t.publishing_accounts.find((a) => a.portal_id === 'myhome'), { status: 'CONNECTED', verified_at: '2026-10-15T00:00:00Z', automation_enabled: true });
  const r = await call('publication.publish', { propertyId: PROP, portalIds: ['myhome', 'placege'], consent: true });
  assert.deepEqual(r.body.results.map((x) => [x.portalId, x.status]), [['myhome', 'QUEUED'], ['placege', 'AUTH_REQUIRED']]);
  assert.deepEqual(db.t.publishing_operations.map((o) => [o.portal_id, o.kind]), [['myhome', 'CREATE']]);
  await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  assert.equal(db.t.publishing_operations.length, 1, 'idempotent');
  assert.ok(Array.isArray(r.body.operations), 'progress is part of the listing view');
});

test('automation off: the same publish goes to the admin queue and no browser operation is created', async () => {
  fresh(); await ready();
  await registerAccount('myhome');
  Object.assign(db.t.publishing_accounts.find((a) => a.portal_id === 'myhome'), { status: 'CONNECTED', verified_at: '2026-10-15T00:00:00Z', automation_enabled: false });
  const r = await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  assert.equal(r.body.results[0].status, 'ADMIN_ACTION_REQUIRED');
  assert.equal(db.t.publishing_operations.length, 0);
});

test('editing a live HOMATCH copy only queues operations the adapter supports (none are recorded yet)', async () => {
  fresh(); await ready();
  await registerAccount('myhome');
  Object.assign(db.t.publishing_accounts.find((a) => a.portal_id === 'myhome'), { status: 'CONNECTED', verified_at: '2026-10-15T00:00:00Z', automation_enabled: true });
  await call('publication.publish', { propertyId: PROP, portalIds: ['myhome'], consent: true });
  Object.assign(db.t.publishing_engine_jobs[0], { status: 'PUBLISHED' });
  db.t.publishing_operations[0].status = 'SUCCEEDED';
  await call('listing.save', { propertyId: PROP, version: 1, listing: listing({ price: 140000 }) });
  assert.equal(db.t.publishing_operations.length, 1, 'PRICE is NOT_EXPLORED on MyHome: no operation, the admin queue shows the copy as outdated');
});
