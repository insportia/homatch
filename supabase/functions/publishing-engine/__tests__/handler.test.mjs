// The publishing-engine handler against an in-memory database whose RPCs mirror
// migrations 20261103090000 + 20261105090000. Proves: origin/auth/ownership, impersonation is read-only,
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
    property_photos: [{ id: PHOTO, property_id: PROP }],
    impersonation_sessions: [{ id: 'i1', auth_session_id: IMPERSONATED_SESSION }],
    publishing_engine_listings: [], publishing_engine_versions: [], publishing_engine_jobs: [], publishing_engine_events: [],
    publishing_providers: ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome'].map((id, sort) => ({
      id, enabled: true, sort, create_url: null, logo_url: null, verification: ['korter', 'binebi'].includes(id) ? 'OWNER_CONFIRMED' : 'PAGE_CHECK',
      max_photos: id === 'myhome' ? 16 : null, description_max: null, required_fields: id === 'myhome' ? ['description.ka'] : [],
    })),
    publishing_provider_audit: [],
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
        row = { id: `job-${p_portal}`, listing_id: p_listing, user_id: p_owner, portal_id: p_portal, revision: 0, status: p_set.status, listing_version: p_set.listing_version, external_id: null, external_url: null, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null };
        t.publishing_engine_jobs.push(row);
      } else {
        if (row.revision !== p_revision) return err('REVISION_CONFLICT');
        if (p_set.external_id && t.publishing_engine_jobs.some((j) => j !== row && j.portal_id === p_portal && j.external_id === p_set.external_id)) return err('EXTERNAL_LISTING_ALREADY_LINKED');
        Object.assign(row, p_set, { revision: row.revision + 1 });
      }
      t.publishing_engine_events.push({ id: t.publishing_engine_events.length + 1, listing_id: p_listing, user_id: p_owner, kind: p_event.kind, portal_id: p_portal, from_status: from, to_status: row.status, created_at: String(Date.now()) });
      return { data: row, error: null };
    },
    publishing_listing_lifecycle({ p_owner, p_listing, p_action }) {
      const row = t.publishing_engine_listings.find((l) => l.id === p_listing && l.user_id === p_owner);
      if (!row) return err('OWNED_RECORD_REQUIRED');
      if (['ARCHIVE', 'DELETE'].includes(p_action) && t.publishing_engine_jobs.some((j) => j.listing_id === p_listing && ['VERIFYING', 'PUBLISHED', 'OWNER_CONFIRMED', 'UNPUBLISH_REQUESTED'].includes(j.status))) return err('LIVE_PUBLICATIONS_EXIST');
      if (p_action === 'DELETE') {
        for (const k of ['publishing_engine_events', 'publishing_engine_jobs', 'publishing_engine_versions']) t[k] = t[k].filter((r) => r.listing_id !== p_listing);
        t.publishing_engine_listings = t.publishing_engine_listings.filter((l) => l.id !== p_listing);
        return { data: { deleted: true }, error: null };
      }
      row.archived_at = p_action === 'ARCHIVE' ? 'now' : null;
      return { data: row, error: null };
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
    const failing = table === 'publishing_providers' && t.providersUnreadable;
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: read()[0] ?? null, error: null }),
      then: (ok, ko) => Promise.resolve(failing ? { data: null, error: { code: '42P01', message: 'relation does not exist' } } : { data: read(), error: null }).then(ok, ko),
    };
    return q;
  };
  return { t, from, rpc: async (name, args) => rpc[name](args) };
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
  return { from: (t) => db.from(t), rpc: (n, a) => db.rpc(n, a) };
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
  assert.equal((await call('admin.publication.retry', { publicationId: job.id }, { who: 'admin' })).body.code, 'INVALID_ID');
  job.id = '12121212-1212-4121-8121-121212121212';
  assert.equal((await call('admin.publication.retry', { publicationId: job.id })).status, 403, 'an owner is not an admin');
  const r = await call('admin.publication.retry', { publicationId: job.id }, { who: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(job.status, 'VERIFYING');
  assert.ok(db.t.publishing_engine_events.some((e) => e.kind === 'RETRY_BY_ADMIN' && e.user_id === OWNER), 'history stays on the owner\'s listing');
  assert.equal((await call('admin.publication.retry', { publicationId: job.id }, { who: 'admin' })).body.code, 'NOT_FAILED');
});
