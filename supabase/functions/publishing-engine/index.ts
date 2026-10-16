// PUBLISHING-ENGINE — the backend of the standalone Publishing workspace (/publishing).
//
// One POST endpoint, `{ action, ...params }`. Every request is authenticated, every
// row is owner-scoped, every write refuses an impersonation session, and every
// publication change goes through domain.ts's state machine and one transactional
// RPC (publishing_publication_write) with a revision compare-and-set.
//
// WHAT THIS FUNCTION NEVER DOES: submit a listing to a portal, hold a portal
// password / cookie / OTP, or mark anything PUBLISHED without its own check of the
// public listing page (see domain.ts for why portal publishing is a manual handoff).
// The only outbound requests are a GET of a portal's robots.txt and of a listing
// URL on the portal's own domain (and, for an admin's re-check, the portal's home
// page) — never for a portal whose terms or bot wall rule automated access out.
//
// Admin actions (`admin.*`) re-check is_admin() with the caller's own token on
// every request; the screen hiding them is manners, not authorisation.

import { createClient } from '@supabase/supabase-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { isE164 } from './contacts.ts';
import {
  PENDING_STATES, classifyCheck, isLive, normalizeListing, parseExternalUrl, publicRegistry,
  transition, validateListing, type Command, type Publication, type PortalId,
} from './domain.ts';
import { ACCOUNT_COLUMNS, type AccountRow, accountView, centralCopy, emptyAccount, ownerFooterReady, registeredStatus, routeFor, sanitizeAccountPatch } from './central.ts';
import { type OpKind, BROWSER_CAPABILITIES, cleanStorageState, runnable, sessionExpiry, syncKind } from './automation.ts';
import { fetchListingPage, probeProvider } from './net.ts';
import { sealCredential } from './vault.ts';
import { FIELD_KEYS, OPERATIONS, adapterFor, configs, profileById, sanitizePatch, type Operation, type ProviderConfig, type ProviderRow } from './providers.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Worker screenshots / logs: service-role only, no browser path (like verify-queue's verify-evidence). */
const ARTIFACTS_BUCKET = 'publishing-artifacts';
const READS = new Set(['workspace', 'listing.get', 'provider.operation', 'admin.providers', 'admin.publications', 'admin.accounts', 'admin.queue', 'admin.job.get', 'admin.operations']);
const OP_COLUMNS = 'id,publication_id,portal_id,kind,status,stage,attempts,max_attempts,available_at,submit_started_at,last_error,created_at,updated_at';
const PROVIDER_COLUMNS = 'id,enabled,sort,create_url,logo_url,verification,max_photos,description_max,required_fields,health_status,health_checked_at,health_detail,updated_at';
const fail = (code: string): never => { throw new Error(code); };
const PUBLICATION_COLUMNS = 'id,listing_id,portal_id,status,channel,revision,external_id,external_url,listing_version,check_attempts,last_checked_at,next_check_at,published_at,last_error,contact_consent_at,status_reason,admin_claimed_at,created_at,updated_at';
const ADMIN_JOB_COLUMNS = `${PUBLICATION_COLUMNS},user_id,admin_claimed_by`;
/** Statuses the admin action queue shows by default: everything waiting on a person at HOMATCH. */
const QUEUE_STATUSES = ['ADMIN_ACTION_REQUIRED', 'PUBLISHING', 'AUTH_REQUIRED', 'UNPUBLISH_REQUESTED', 'VERIFICATION_FAILED', 'QUEUED'];

export async function handler(req: Request, deps = { fetchPage: fetchListingPage, probe: probeProvider, now: () => new Date() }) {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    ...(ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}),
  };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (!ORIGINS.has(origin)) return reply({ code: 'ORIGIN_DENIED' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ code: 'METHOD_DENIED' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return reply({ code: 'AUTH_REQUIRED' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: authError } = await caller.auth.getUser();
  if (authError || !who?.user) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: owner } = await db.from('users').select('id').eq('auth_id', who.user.id).maybeSingle();
  if (!owner) return reply({ code: 'OWNER_REQUIRED' }, 403);

  let input: Record<string, any>;
  try {
    const raw = await req.text();
    if (raw.length > 200_000) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    input = JSON.parse(raw || '{}');
  } catch { return reply({ code: 'INVALID_JSON' }, 400); }
  const action = String(input?.action || '');
  if (!READS.has(action)) {
    const refused = await refuseIfImpersonating(db, auth, headers);
    if (refused) return refused;
  }

  // The provider registry: code profiles + the admin's rows. Unreadable rows (the
  // registry migration not yet applied) leave only the two portals the existing
  // portal_id constraint accepts enabled — anything else would fail on write.
  const { data: providerRows, error: providerError } = await db.from('publishing_providers').select(PROVIDER_COLUMNS);
  if (providerError) console.error('publishing-engine', 'provider registry unreadable', providerError.code ?? 'unknown');
  const providers = providerError
    ? configs().map((c) => (c.id === 'myhome' || c.id === 'ssge' ? c : { ...c, enabled: false }))
    : configs((providerRows ?? []) as ProviderRow[]);
  const providerById = (id: unknown) => providers.find((c) => c.id === id) ?? null;

  // The HOMATCH accounts. Unreadable (migration not applied yet) → every portal
  // unregistered, so a publish request waits as AUTH_REQUIRED instead of failing.
  const { data: accountRows, error: accountError } = await db.from('publishing_accounts').select(ACCOUNT_COLUMNS);
  if (accountError) console.error('publishing-engine', 'accounts unreadable', accountError.code ?? 'unknown');
  const accountFor = (id: string): AccountRow => ((accountRows ?? []) as AccountRow[]).find((a) => a.portal_id === id) ?? emptyAccount(id);
  /** The registry for a customer: plus whether HOMATCH can take the portal, and the number listings there will show. */
  const customerRegistry = () => publicRegistry(providers).map((p) => {
    const config = providerById(p.id)!;
    const route = routeFor(config, accountFor(p.id), deps.now());
    const account = accountFor(p.id);
    return { ...p, homatch: { route: 'error' in route ? null : route.route, unavailable: 'error' in route ? route.error : null, contactPhone: account.status === 'NOT_CONFIGURED' ? null : account.contact_phone } };
  });
  const adapter = (id: unknown) => adapterFor(providerById(id) ?? fail('PORTAL_UNKNOWN'));
  const requireAdmin = async () => {
    const { data, error } = await caller.rpc('is_admin');
    if (error || data !== true) fail('ADMIN_REQUIRED');
  };

  const ownedProperty = async (id: unknown) => {
    if (!UUID.test(String(id || ''))) fail('INVALID_ID');
    const { data } = await db.from('properties').select('id').eq('id', id).eq('user_id', owner.id).eq('is_deleted', false).maybeSingle();
    return data ?? fail('OWNED_PROPERTY_REQUIRED');
  };
  const ownedListing = async (id: unknown) => {
    if (!UUID.test(String(id || ''))) fail('INVALID_ID');
    const { data } = await db.from('publishing_engine_listings').select('id,version,status,payload,archived_at,created_at,updated_at').eq('id', id).eq('user_id', owner.id).maybeSingle();
    return data ?? fail('LISTING_NOT_FOUND');
  };
  const publicationFor = async (listingId: string, portalId: string) => {
    const { data } = await db.from('publishing_engine_jobs').select(PUBLICATION_COLUMNS).eq('listing_id', listingId).eq('portal_id', portalId).eq('user_id', owner.id).maybeSingle();
    return data as (Publication & { id: string; portal_id: PortalId }) | null;
  };
  const write = async (listingId: string, portalId: PortalId, current: Publication | null, cmd: Command) => {
    const next = transition(current, cmd, deps.now());
    if ('error' in next) fail(next.error);
    const { data, error } = await db.rpc('publishing_publication_write', {
      p_owner: owner.id, p_listing: listingId, p_portal: portalId, p_revision: current ? current.revision : -1,
      p_set: next.set, p_event: { kind: next.kind, detail: next.detail ?? {} },
    });
    if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'PUBLICATION_WRITE_FAILED');
    return data;
  };
  const check = async (listingId: string, pub: Publication & { portal_id: PortalId }) => {
    const a = adapter(pub.portal_id);
    if (!a.canCheckPage()) fail('CHECK_NOT_AVAILABLE');
    const page = await deps.fetchPage(pub.external_url!, a);
    const outcome = classifyCheck({ status: page.status as any, body: (page as any).body, externalId: pub.external_id! });
    return await write(listingId, pub.portal_id, pub, { type: 'CHECK', outcome });
  };
  const detail = async (listingId: string) => {
    const listing = await ownedListing(listingId);
    const [{ data: publications }, { data: events }] = await Promise.all([
      db.from('publishing_engine_jobs').select(PUBLICATION_COLUMNS).eq('listing_id', listingId).eq('user_id', owner.id),
      db.from('publishing_engine_events').select('id,kind,portal_id,from_status,to_status,detail,created_at').eq('listing_id', listingId).eq('user_id', owner.id).order('created_at', { ascending: false }).limit(100),
    ]);
    // Real progress from the backend worker: the latest operation per publication (stage and status only).
    const ids = (publications ?? []).filter((p: any) => p.channel === 'HOMATCH_ACCOUNT').map((p: any) => p.id);
    const { data: ops } = ids.length
      ? await db.from('publishing_operations').select('publication_id,kind,status,stage,attempts,updated_at').in('publication_id', ids).order('created_at', { ascending: false }).limit(200)
      : { data: [] as any[] };
    const latest = new Map<string, unknown>();
    for (const o of ops ?? []) if (!latest.has(o.publication_id)) latest.set(o.publication_id, o);
    return { portals: customerRegistry(), listing: { ...listing, validation: validateListing(normalizeListing(listing.payload), providers) }, publications: publications ?? [], events: events ?? [], operations: [...latest.values()] };
  };

  const adminJob = async (id: unknown) => {
    if (!UUID.test(String(id || ''))) fail('INVALID_ID');
    const { data } = await db.from('publishing_engine_jobs').select(ADMIN_JOB_COLUMNS).eq('id', id).maybeSingle();
    return (data ?? fail('PUBLICATION_NOT_FOUND')) as Publication & { id: string; listing_id: string; user_id: string; portal_id: PortalId };
  };
  /** A transition on someone else's publication, made by an admin: the owner stays the row's owner, the admin is in the history. */
  const adminWrite = async (job: Publication & { listing_id: string; user_id: string; portal_id: PortalId }, cmd: Command) => {
    const next = transition(job, cmd, deps.now());
    if ('error' in next) fail(next.error);
    const { error } = await db.rpc('publishing_publication_write', {
      p_owner: job.user_id, p_listing: job.listing_id, p_portal: job.portal_id, p_revision: job.revision,
      p_set: next.set, p_event: { kind: next.kind, detail: { ...(next.detail ?? {}), admin: owner.id } },
    });
    if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'PUBLICATION_WRITE_FAILED');
  };
  /** Queue one backend browser operation; a repeat (same key) or an already-active one is a no-op. */
  const enqueue = async (pub: { id: string; portal_id: string; revision: number }, kind: OpKind, version: number | null, payload: Record<string, unknown> = {}) => {
    if (!runnable(pub.portal_id, kind)) return null;
    const { data, error } = await db.rpc('publishing_op_enqueue', {
      p_publication: pub.id, p_portal: pub.portal_id, p_kind: kind, p_version: version, p_payload: payload,
      p_key: `${pub.id}:${kind}:${version ?? 0}:${pub.revision}`,
    });
    if (error && !/OPERATION_ALREADY_ACTIVE/.test(error.message)) console.error('publishing-engine', 'enqueue failed', kind, error.code ?? 'unknown');
    return data ?? null;
  };

  /** After an account change: every waiting central publication on the portal moves to its new route. */
  const rerouteWaiting = async (portalId: string, account: AccountRow) => {
    const config = providerById(portalId)!;
    const { data: waiting } = await db.from('publishing_engine_jobs').select(ADMIN_JOB_COLUMNS)
      .eq('portal_id', portalId).eq('channel', 'HOMATCH_ACCOUNT').in('status', PENDING_STATES).limit(1000);
    const route = routeFor(config, account, deps.now());
    if ('error' in route) return 0;
    let moved = 0;
    for (const job of (waiting ?? []) as Array<Publication & { id: string; listing_id: string; user_id: string; portal_id: PortalId }>) {
      try { await adminWrite(job, { type: 'REROUTE', route: route.route }); moved++; } catch { /* NO_CHANGE or a concurrent write — leave it */ }
      if (route.route === 'QUEUED') {
        const now = await adminJob(job.id).catch(() => null);
        if (now?.status === 'QUEUED') await enqueue(now as any, 'CREATE', now.listing_version);
      }
    }
    return moved;
  };

  try {
    switch (action) {
      case 'workspace': {
        const [{ data: listings, error: le }, { data: publications, error: pe }] = await Promise.all([
          db.from('publishing_engine_listings').select('id,version,status,payload,archived_at,created_at,updated_at').eq('user_id', owner.id).order('updated_at', { ascending: false }).limit(500),
          db.from('publishing_engine_jobs').select(PUBLICATION_COLUMNS).eq('user_id', owner.id).limit(2000),
        ]);
        if (le || pe) fail('WORKSPACE_READ_FAILED');
        return reply({
          portals: customerRegistry(),
          listings: (listings ?? []).map((l) => ({ ...l, validation: validateListing(normalizeListing(l.payload), providers) })),
          publications: publications ?? [],
        });
      }
      case 'listing.get':
        return reply(await detail(String(input.propertyId)));

      case 'listing.save': {
        const property = await ownedProperty(input.propertyId);
        const listing = normalizeListing(input.listing);
        listing.contacts = listing.contacts.map((c) => {
          const phone = parsePhoneNumberFromString(c.phone, 'GE');
          return { ...c, phone: phone?.isValid() ? phone.number : c.phone };
        });
        if (listing.photos.length) {
          const { data: photos } = await db.from('property_photos').select('id').eq('property_id', property.id).in('id', listing.photos);
          const mine = new Set((photos ?? []).map((p) => p.id));
          listing.photos = listing.photos.filter((id) => mine.has(id));
        }
        const validation = validateListing(listing, providers);
        const version = Number.isInteger(input.version) ? input.version : 0;
        const { data: before } = await db.from('publishing_engine_listings').select('payload').eq('id', property.id).maybeSingle();
        const { data: saved, error } = await db.rpc('publishing_listing_save', { p_owner: owner.id, p_property: property.id, p_version: version, p_payload: listing, p_status: validation.ready ? 'READY' : 'DRAFT' });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'LISTING_SAVE_FAILED');
        // HOMATCH is the source of truth: a live HOMATCH-account copy follows the edit
        // through the browser worker where that operation is supported; otherwise the
        // admin queue shows the copy as outdated.
        const kind = syncKind((before?.payload ?? null) as Record<string, unknown> | null, listing as unknown as Record<string, unknown>);
        if (kind && saved && before) {
          const { data: live } = await db.from('publishing_engine_jobs').select('id,portal_id,revision,status,channel').eq('listing_id', property.id).eq('channel', 'HOMATCH_ACCOUNT').in('status', ['PUBLISHED', 'OWNER_CONFIRMED']);
          for (const pub of live ?? []) {
            if (validation.portals[pub.portal_id]?.length) continue;
            if (accountFor(pub.portal_id).automation_enabled) await enqueue(pub, kind, (saved as { version: number }).version);
          }
        }
        return reply(await detail(property.id));
      }

      case 'listing.duplicate': {
        // A copy of the LISTING for another of the owner's properties. The source
        // property is untouched; photos stay behind because they belong to it.
        const source = await ownedListing(input.propertyId);
        const target = await ownedProperty(input.targetPropertyId);
        if (target.id === source.id) fail('DUPLICATE_TARGET_SAME');
        const { data: existing } = await db.from('publishing_engine_listings').select('id').eq('id', target.id).maybeSingle();
        if (existing) fail('LISTING_ALREADY_EXISTS');
        const copy = { ...normalizeListing(source.payload), photos: [] };
        const validation = validateListing(copy, providers);
        const { error } = await db.rpc('publishing_listing_save', { p_owner: owner.id, p_property: target.id, p_version: 0, p_payload: copy, p_status: validation.ready ? 'READY' : 'DRAFT' });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'LISTING_SAVE_FAILED');
        return reply(await detail(target.id));
      }

      case 'provider.operation': {
        // The adapter interface's API operations. No provider has an authorised API,
        // so each answers with the capability it lacks — never a pretend success.
        const a = adapter(input.portalId);
        const op = String(input.operation) as Operation;
        if (!OPERATIONS.includes(op)) fail('UNKNOWN_OPERATION');
        return reply(a.run(op), 409);
      }

      case 'listing.archive':
      case 'listing.restore':
      case 'listing.delete': {
        const listing = await ownedListing(input.propertyId);
        const op = action.split('.')[1].toUpperCase();
        const { error } = await db.rpc('publishing_listing_lifecycle', { p_owner: owner.id, p_listing: listing.id, p_action: op });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'LISTING_UPDATE_FAILED');
        return reply(op === 'DELETE' ? { deleted: true, id: listing.id } : await detail(listing.id));
      }

      case 'publication.prepare': {
        const listing = await ownedListing(input.propertyId);
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        if (!portal.enabled) fail('PORTAL_DISABLED');
        if (listing.archived_at) fail('LISTING_ARCHIVED');
        const validation = validateListing(normalizeListing(listing.payload), providers);
        if (!validation.ready || validation.portals[portal.id].length) return reply({ code: 'LISTING_NOT_READY', validation }, 422);
        const current = await publicationFor(listing.id, portal.id);
        try {
          await write(listing.id, portal.id, current, { type: 'PREPARE', listingVersion: listing.version });
        } catch (e) {
          // A repeated click on an already-prepared handoff is a no-op, not an error.
          if (!(e instanceof Error && e.message === 'NO_CHANGE')) throw e;
        }
        return reply(await detail(listing.id));
      }

      case 'publication.link': {
        const listing = await ownedListing(input.propertyId);
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        if (!portal.enabled) fail('PORTAL_DISABLED');
        const parsed = parseExternalUrl(portal, input.externalUrl);
        if ('error' in parsed) fail(parsed.error);
        const current = await publicationFor(listing.id, portal.id);
        if (portal.verification === 'OWNER_CONFIRMED') {
          // HOMATCH may not look at this portal's pages, so the owner's explicit
          // statement is the only evidence — recorded as theirs, never as a check.
          if (input.attest !== true) fail('ATTESTATION_REQUIRED');
          await write(listing.id, portal.id, current, { type: 'LINK', url: parsed.url, externalId: parsed.externalId, listingVersion: listing.version, verification: 'OWNER_CONFIRMED' });
          return reply(await detail(listing.id));
        }
        if (current?.external_id === parsed.externalId && current.status === 'VERIFYING') {
          // Same URL pasted twice: re-use the pending verification instead of re-linking.
        } else {
          await write(listing.id, portal.id, current, { type: 'LINK', url: parsed.url, externalId: parsed.externalId, listingVersion: listing.version });
        }
        const linked = await publicationFor(listing.id, portal.id);
        if (linked && isLive(linked.status) && (!linked.next_check_at || Date.parse(linked.next_check_at) <= deps.now().getTime())) await check(listing.id, linked);
        return reply(await detail(listing.id));
      }

      case 'publication.check': {
        const listing = await ownedListing(input.propertyId);
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const current = await publicationFor(listing.id, portal.id) ?? fail('PUBLICATION_NOT_FOUND');
        if (portal.verification !== 'PAGE_CHECK') fail('CHECK_NOT_AVAILABLE');
        if (current.next_check_at && Date.parse(current.next_check_at) > deps.now().getTime()) {
          return reply({ code: 'CHECK_TOO_SOON', retryAt: current.next_check_at }, 429);
        }
        await check(listing.id, current);
        return reply(await detail(listing.id));
      }

      case 'publication.retry':
      case 'publication.unpublish':
      case 'publication.confirmRemoved':
      case 'publication.markUpdated': {
        const listing = await ownedListing(input.propertyId);
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const current = await publicationFor(listing.id, portal.id) ?? fail('PUBLICATION_NOT_FOUND');
        const cmd: Command = action === 'publication.retry' ? { type: 'RETRY' }
          : action === 'publication.unpublish' && current.channel === 'HOMATCH_ACCOUNT' && PENDING_STATES.includes(current.status) ? { type: 'CANCEL' }
          : action === 'publication.unpublish' ? { type: 'REQUEST_UNPUBLISH' }
          : action === 'publication.confirmRemoved' ? { type: 'CONFIRM_REMOVED' }
          : { type: 'MARK_UPDATED', listingVersion: listing.version };
        const after = await write(listing.id, portal.id, current, cmd);
        if (cmd.type === 'REQUEST_UNPUBLISH' && after?.channel === 'HOMATCH_ACCOUNT' && accountFor(portal.id).automation_enabled) await enqueue(after, 'DELETE', listing.version);
        return reply(await detail(listing.id));
      }

      /* ── The central engine: Publish to Selected Portals ──────────────── */
      case 'publication.publish': {
        // One request, many portals. Each portal's publication is its own
        // transaction (publishing_publication_write); a portal that cannot be
        // taken reports why without blocking the others. A repeated click is a
        // no-op per portal (NO_CHANGE), so the request is idempotent.
        const listing = await ownedListing(input.propertyId);
        if (listing.archived_at) fail('LISTING_ARCHIVED');
        if (input.consent !== true) fail('CONTACT_CONSENT_REQUIRED');
        const ids = [...new Set((Array.isArray(input.portalIds) ? input.portalIds : []).map(String))];
        if (!ids.length || ids.length > providers.length) fail('PORTALS_REQUIRED');
        const x = normalizeListing(listing.payload);
        const validation = validateListing(x, providers);
        if (!validation.ready) return reply({ code: 'LISTING_NOT_READY', validation }, 422);
        if (!ownerFooterReady(x)) fail('OWNER_CONTACT_REQUIRED');
        const consentAt = deps.now().toISOString();
        const results: Array<{ portalId: string; status?: string; code?: string }> = [];
        for (const id of ids) {
          const config = providerById(id);
          if (!config) { results.push({ portalId: id, code: 'PORTAL_UNKNOWN' }); continue; }
          if (validation.portals[config.id]?.length) { results.push({ portalId: id, code: 'LISTING_NOT_READY' }); continue; }
          const route = routeFor(config, accountFor(config.id), deps.now());
          if ('error' in route) { results.push({ portalId: id, code: route.error }); continue; }
          const current = await publicationFor(listing.id, config.id);
          try {
            const row = await write(listing.id, config.id, current, { type: 'PUBLISH', listingVersion: listing.version, route: route.route, consentAt });
            if (row?.status === 'QUEUED') await enqueue(row, 'CREATE', listing.version);
            results.push({ portalId: id, status: row?.status ?? route.route });
          } catch (e) {
            const code = e instanceof Error ? e.message : 'PUBLICATION_WRITE_FAILED';
            results.push(code === 'NO_CHANGE' ? { portalId: id, status: current?.status } : { portalId: id, code });
          }
        }
        return reply({ ...(await detail(listing.id)), results });
      }

      case 'publication.cancel': {
        const listing = await ownedListing(input.propertyId);
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const current = await publicationFor(listing.id, portal.id) ?? fail('PUBLICATION_NOT_FOUND');
        await write(listing.id, portal.id, current, { type: 'CANCEL' });
        return reply(await detail(listing.id));
      }

      /* ── Admin → HOMATCH portal accounts ─────────────────────────────── */
      case 'admin.accounts': {
        await requireAdmin();
        const { data: audit, error } = await db.from('publishing_account_audit').select('id,portal_id,action,actor,created_at').order('created_at', { ascending: false }).limit(100);
        // Session metadata only — the sealed envelope is never selected here.
        const { data: sessionRows } = await db.from('publishing_account_sessions').select('portal_id,status,saved_at,expires_at,verified_at');
        const sessions = sessionRows ?? [];
        if (error || accountError) fail('ADMIN_READ_FAILED');
        return reply({
          accounts: providers.map((c) => ({
            portal: publicRegistry([c])[0], account: accountView(accountFor(c.id), c.id), acceptsCredential: adapterFor(c).acceptsCredential(),
            browser: BROWSER_CAPABILITIES[c.id], session: sessions.find((x: { portal_id: string }) => x.portal_id === c.id) ?? null,
          })),
          audit: audit ?? [],
        });
      }

      case 'admin.account.save': {
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const raw = (input.account ?? {}) as Record<string, unknown>;
        const phone = parsePhoneNumberFromString(String(raw.contactPhone ?? ''), 'GE');
        const clean = sanitizeAccountPatch({ ...raw, contactPhone: phone?.isValid() ? phone.number : raw.contactPhone });
        if ('error' in clean) fail(clean.error);
        const before = accountFor(config.id);
        const status = registeredStatus(config, clean.patch);
        const { error } = await db.rpc('publishing_account_write', {
          p_actor: owner.id, p_portal: config.id, p_action: before.status === 'NOT_CONFIGURED' ? 'REGISTER' : 'UPDATE',
          p_patch: { ...clean.patch, status, verification_result: null, last_error: null },
        });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_WRITE_FAILED');
        // Publications waiting for this account move to where it can now take them.
        const rerouted = await rerouteWaiting(config.id, { ...before, ...clean.patch, status });
        return reply({ ok: true, status, rerouted });
      }

      case 'admin.account.test': {
        // A test against the REAL account, through the adapter. No adapter has a
        // verified mechanism, so the answer is CAPABILITY_NOT_SUPPORTED and the
        // status is left as it is — never upgraded to CONNECTED on assumption.
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const account = accountFor(config.id);
        if (account.status === 'NOT_CONFIGURED') fail('ACCOUNT_NOT_CONFIGURED');
        const result = adapterFor(config).run('testConnection');
        const { error } = await db.rpc('publishing_account_write', {
          p_actor: owner.id, p_portal: config.id, p_action: 'TEST',
          p_patch: { verification_result: result.code },
        });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_WRITE_FAILED');
        return reply({ ok: false, result: result.code, status: account.status });
      }

      case 'admin.account.credential': {
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        // Refused before the secret is even read: no verified mechanism would use it.
        if (!adapterFor(config).acceptsCredential()) fail('CREDENTIAL_NOT_ACCEPTED');
        const envelope = await sealCredential(String(input.secret ?? ''), config.id, Deno.env.get('PUBLISHING_CREDENTIALS_KEY'));
        const { error } = await db.rpc('publishing_account_write', {
          p_actor: owner.id, p_portal: config.id, p_action: 'CREDENTIAL_SET',
          p_patch: { credential: envelope, credential_set_at: deps.now().toISOString(), status: 'AUTH_REQUIRED', verified_at: null },
        });
        if (error) fail('ACCOUNT_WRITE_FAILED');
        return reply({ ok: true });
      }

      case 'admin.account.disconnect': {
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const { error } = await db.rpc('publishing_account_write', {
          p_actor: owner.id, p_portal: config.id, p_action: 'DISCONNECT',
          p_patch: { status: 'NOT_CONFIGURED', connection_method: null, account_label: null, contact_phone: null, credential: null, credential_set_at: null, verified_at: null, session_expires_at: null, verification_result: null, last_error: null },
        });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_WRITE_FAILED');
        const rerouted = await rerouteWaiting(config.id, emptyAccount(config.id));
        return reply({ ok: true, rerouted });
      }

      case 'admin.account.session': {
        // A portal session the owner captured by signing in BY HAND (scripts/publishing/
        // capture-session.mjs — SMS / CAPTCHA are handled by the person, never bypassed).
        // Cookies are pinned to the portal's domains, sealed with AES-GCM here, and only
        // the browser worker's own check against the real portal can mark it valid.
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        if (!runnable(config.id, 'CHECK_SESSION')) fail('BROWSER_ADAPTER_NOT_AVAILABLE');
        const account = accountFor(config.id);
        if (account.status === 'NOT_CONFIGURED') fail('ACCOUNT_NOT_CONFIGURED');
        const clean = cleanStorageState(input.storageState, config.domains);
        if ('error' in clean) fail(clean.error);
        const envelope = await sealCredential(JSON.stringify(clean.state), `session:${config.id}`, Deno.env.get('PUBLISHING_CREDENTIALS_KEY'));
        const expires = sessionExpiry(clean.state as { cookies: any[] });
        const { error: se } = await db.from('publishing_account_sessions').upsert({ portal_id: config.id, envelope, saved_by: owner.id, saved_at: deps.now().toISOString(), expires_at: expires, verified_at: null, status: 'UNVERIFIED' });
        if (se) fail('SESSION_WRITE_FAILED');
        const { error } = await db.rpc('publishing_account_write', {
          p_actor: owner.id, p_portal: config.id, p_action: 'SESSION_SET',
          p_patch: { status: 'AUTH_REQUIRED', connection_method: 'BROWSER_SESSION', verified_at: null, session_expires_at: expires, verification_result: 'SESSION_AWAITING_CHECK', last_error: null },
        });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_WRITE_FAILED');
        const { error: oe } = await db.rpc('publishing_op_enqueue', { p_publication: null, p_portal: config.id, p_kind: 'CHECK_SESSION', p_version: null, p_payload: {}, p_key: `${config.id}:CHECK_SESSION:${deps.now().getTime()}` });
        if (oe) console.error('publishing-engine', 'session check enqueue failed', oe.code ?? 'unknown');
        return reply({ ok: true, cookies: clean.state.cookies.length, expires });
      }

      case 'admin.account.automation': {
        // The owner's switches. Turning live submit ON is the explicit approval for
        // the worker to press the portal's final publish button — audited, and
        // refused unless the request says so in words.
        await requireAdmin();
        const config = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        if (!runnable(config.id, 'CREATE')) fail('BROWSER_ADAPTER_NOT_AVAILABLE');
        const patch: Record<string, unknown> = {};
        if (typeof input.enabled === 'boolean') patch.automation_enabled = input.enabled;
        if (typeof input.liveSubmit === 'boolean') {
          if (input.liveSubmit && input.confirm !== 'APPROVE_LIVE_PUBLISHING') fail('LIVE_SUBMIT_CONFIRMATION_REQUIRED');
          patch.live_submit_approved = input.liveSubmit;
          patch.live_submit_approved_by = input.liveSubmit ? owner.id : null;
          patch.live_submit_approved_at = input.liveSubmit ? deps.now().toISOString() : null;
        }
        if (!Object.keys(patch).length) fail('NOTHING_TO_UPDATE');
        const { error } = await db.rpc('publishing_account_write', { p_actor: owner.id, p_portal: config.id, p_action: 'AUTOMATION', p_patch: patch });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_WRITE_FAILED');
        const rerouted = await rerouteWaiting(config.id, { ...accountFor(config.id), ...(patch as Partial<AccountRow>) });
        return reply({ ok: true, rerouted });
      }

      case 'admin.operations': {
        await requireAdmin();
        let q = db.from('publishing_operations').select(OP_COLUMNS).order('created_at', { ascending: false }).limit(100);
        if (input.portalId) q = q.eq('portal_id', (providerById(input.portalId) ?? fail('PORTAL_UNKNOWN')).id);
        if (input.publicationId) { if (!UUID.test(String(input.publicationId))) fail('INVALID_ID'); q = q.eq('publication_id', input.publicationId); }
        const { data: ops, error } = await q;
        if (error) fail('ADMIN_READ_FAILED');
        const opIds = (ops ?? []).map((o) => o.id);
        const { data: arts } = opIds.length ? await db.from('publishing_artifacts').select('operation_id,kind,stage,path,created_at').in('operation_id', opIds).order('created_at', { ascending: false }).limit(300) : { data: [] as any[] };
        const artifacts = [];
        for (const a of arts ?? []) {
          const { data: signed } = await db.storage.from(ARTIFACTS_BUCKET).createSignedUrl(a.path, 600);
          artifacts.push({ ...a, url: signed?.signedUrl ?? null });
        }
        return reply({ operations: ops ?? [], artifacts });
      }

      /* ── Admin → Publishing queue ────────────────────────────────────── */
      case 'admin.queue': {
        await requireAdmin();
        const statuses = Array.isArray(input.statuses) && input.statuses.length ? input.statuses.map(String).slice(0, 20) : QUEUE_STATUSES;
        let q = db.from('publishing_engine_jobs').select(ADMIN_JOB_COLUMNS).eq('channel', 'HOMATCH_ACCOUNT').in('status', statuses).order('updated_at', { ascending: true }).limit(200);
        if (input.portalId) q = q.eq('portal_id', (providerById(input.portalId) ?? fail('PORTAL_UNKNOWN')).id);
        const { data: jobs, error } = await q;
        if (error) fail('ADMIN_READ_FAILED');
        const ids = [...new Set((jobs ?? []).map((j) => j.listing_id))];
        const { data: listings } = ids.length
          ? await db.from('publishing_engine_listings').select('id,version,payload').in('id', ids)
          : { data: [] as Array<{ id: string; version: number; payload: unknown }> };
        const byId = new Map((listings ?? []).map((l) => [l.id, l]));
        // A summary only — no phone numbers in the list; the job view has the full copy.
        return reply({
          jobs: (jobs ?? []).map((j) => {
            const l = byId.get(j.listing_id);
            const x = normalizeListing((l?.payload ?? {}) as Record<string, unknown>);
            return { ...j, listing: { title: x.title, city: x.city, dealType: x.dealType, propertyType: x.propertyType, price: x.price, currency: x.currency, version: l?.version ?? null }, outdated: l ? j.listing_version !== l.version : false };
          }),
        });
      }

      case 'admin.job.get': {
        // Everything an administrator needs to post the listing in the HOMATCH
        // account: the portal-ready copy with the owner footer (the owner
        // consented to it), the HOMATCH number for the contact field, and photos.
        await requireAdmin();
        const job = await adminJob(input.jobId);
        const config = providerById(job.portal_id) ?? fail('PORTAL_UNKNOWN');
        const { data: l } = await db.from('publishing_engine_listings').select('id,version,payload').eq('id', job.listing_id).maybeSingle();
        if (!l) fail('LISTING_NOT_FOUND');
        const x = normalizeListing(l.payload);
        const account = accountFor(config.id);
        const copies = Object.fromEntries((['ka', 'en', 'ru'] as const).filter((lang) => x.description[lang]).map((lang) => [lang, centralCopy(x, config, account, lang)]));
        const photoIds = config.maxPhotos != null ? x.photos.slice(0, config.maxPhotos) : x.photos;
        const { data: photoRows } = photoIds.length
          ? await db.from('property_photos').select('id,storage_path,public_url').eq('property_id', l.id).in('id', photoIds)
          : { data: [] as Array<{ id: string; storage_path: string; public_url: string | null }> };
        const photos = [];
        for (const id of photoIds) {
          const p = (photoRows ?? []).find((r) => r.id === id);
          if (!p) continue;
          const path = p.storage_path.replace(/^property-photos\//, '');
          const { data: signed } = await db.storage.from('property-photos').createSignedUrl(path, 3600);
          photos.push({ id, url: signed?.signedUrl ?? p.public_url ?? null });
        }
        const { data: events } = await db.from('publishing_engine_events').select('id,kind,from_status,to_status,detail,created_at').eq('publication_id', job.id).order('created_at', { ascending: false }).limit(50);
        return reply({
          job, portal: publicRegistry([config])[0], account: accountView(account, config.id),
          listing: {
            version: l.version, title: x.title, propertyType: x.propertyType, dealType: x.dealType, price: x.price, currency: x.currency,
            area: x.area, rooms: x.rooms, bedrooms: x.bedrooms, bathrooms: x.bathrooms, floor: x.floor, totalFloors: x.totalFloors,
            condition: x.condition, city: x.city, district: x.district, street: x.street, streetNumber: x.streetNumber, amenities: x.amenities,
          },
          copies, photos, events: events ?? [],
        });
      }

      case 'admin.job.claim':
      case 'admin.job.release':
      case 'admin.job.complete':
      case 'admin.job.reject':
      case 'admin.job.fail':
      case 'admin.job.confirmRemoved':
      case 'admin.job.markUpdated':
      case 'admin.job.check': {
        await requireAdmin();
        const job = await adminJob(input.jobId);
        const config = providerById(job.portal_id) ?? fail('PORTAL_UNKNOWN');
        const { data: l } = await db.from('publishing_engine_listings').select('id,version').eq('id', job.listing_id).maybeSingle();
        if (!l) fail('LISTING_NOT_FOUND');
        if (action === 'admin.job.check') {
          if (!adapterFor(config).canCheckPage()) fail('CHECK_NOT_AVAILABLE');
          const page = await deps.fetchPage(job.external_url ?? fail('NOTHING_TO_CHECK'), adapterFor(config));
          const outcome = classifyCheck({ status: page.status as any, body: (page as any).body, externalId: job.external_id ?? '' });
          await adminWrite(job, { type: 'CHECK', outcome });
          return reply({ ok: true, outcome });
        }
        let cmd: Command;
        if (action === 'admin.job.claim') cmd = { type: 'ADMIN_CLAIM', admin: owner.id };
        else if (action === 'admin.job.release') cmd = { type: 'ADMIN_RELEASE' };
        else if (action === 'admin.job.reject') cmd = { type: 'ADMIN_REJECT', reason: String(input.reason ?? ''), admin: owner.id };
        else if (action === 'admin.job.fail') cmd = { type: 'ADMIN_FAIL', reason: String(input.reason ?? ''), admin: owner.id };
        else if (action === 'admin.job.confirmRemoved') cmd = { type: 'ADMIN_CONFIRM_REMOVED', admin: owner.id };
        else if (action === 'admin.job.markUpdated') cmd = { type: 'ADMIN_MARK_UPDATED', listingVersion: l.version, admin: owner.id };
        else {
          const parsed = parseExternalUrl(config, input.externalUrl);
          if ('error' in parsed) fail(parsed.error);
          cmd = { type: 'ADMIN_COMPLETE', url: parsed.url, externalId: parsed.externalId, listingVersion: job.listing_version ?? l.version, verification: config.verification, admin: owner.id };
        }
        await adminWrite(job, cmd);
        if (action === 'admin.job.complete') {
          // Creation on the portal is confirmed by its public page, not by the admin's click.
          const linked = await adminJob(job.id);
          if (linked.status === 'VERIFYING') {
            const page = await deps.fetchPage(linked.external_url!, adapterFor(config));
            const outcome = classifyCheck({ status: page.status as any, body: (page as any).body, externalId: linked.external_id! });
            try { await adminWrite(linked, { type: 'CHECK', outcome }); } catch { /* the next check retries */ }
          }
          await db.rpc('publishing_account_write', { p_actor: owner.id, p_portal: config.id, p_action: 'ACTIVITY', p_patch: { last_published_at: deps.now().toISOString(), last_error: null } });
        }
        if (action === 'admin.job.fail' || action === 'admin.job.reject') {
          await db.rpc('publishing_account_write', { p_actor: owner.id, p_portal: config.id, p_action: 'ACTIVITY', p_patch: { failure_count: accountFor(config.id).failure_count + 1, last_error: action === 'admin.job.reject' ? 'PORTAL_REJECTED' : 'PUBLISH_FAILED' } });
        }
        return reply({ ok: true, job: await adminJob(job.id) });
      }

      /* ── Admin → Integrations → Property portals ─────────────────────── */
      case 'admin.providers': {
        await requireAdmin();
        const [{ data: jobs, error: je }, { data: audit, error: ae }] = await Promise.all([
          db.from('publishing_engine_jobs').select('portal_id,status').limit(20_000),
          db.from('publishing_provider_audit').select('id,provider_id,action,before,after,created_at').order('created_at', { ascending: false }).limit(100),
        ]);
        if (je || ae || providerError) fail('ADMIN_READ_FAILED');
        const stats: Record<string, Record<string, number>> = {};
        for (const j of jobs ?? []) {
          const row = (stats[j.portal_id] ??= {});
          row[j.status] = (row[j.status] ?? 0) + 1;
        }
        return reply({
          providers: providers.map((c) => ({ ...publicRegistry([c])[0], sort: c.sort, evidence: c.evidence, health: c.health, stats: stats[c.id] ?? {}, configured: (providerRows ?? []).some((r: { id: string }) => r.id === c.id) })),
          audit: audit ?? [],
          fieldKeys: FIELD_KEYS,
        });
      }

      case 'admin.publications': {
        await requireAdmin();
        const portal = providerById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        // No payloads and no phone numbers: the admin sees the job, not the listing's private data.
        const { data, error } = await db.from('publishing_engine_jobs')
          .select('id,listing_id,status,external_url,check_attempts,last_checked_at,next_check_at,published_at,last_error,updated_at')
          .eq('portal_id', portal.id).order('updated_at', { ascending: false }).limit(100);
        if (error) fail('ADMIN_READ_FAILED');
        return reply({ publications: data ?? [] });
      }

      case 'admin.publication.retry': {
        // Retry a failed verification on the owner's behalf: the same RETRY transition
        // the owner has, recorded with the admin as its source. Never anything else.
        await requireAdmin();
        if (!UUID.test(String(input.publicationId || ''))) fail('INVALID_ID');
        const { data: job } = await db.from('publishing_engine_jobs').select(`${PUBLICATION_COLUMNS},user_id`).eq('id', input.publicationId).maybeSingle();
        if (!job) fail('PUBLICATION_NOT_FOUND');
        const next = transition(job as Publication, { type: 'RETRY' }, deps.now());
        if ('error' in next) fail(next.error);
        const { error } = await db.rpc('publishing_publication_write', {
          p_owner: job.user_id, p_listing: job.listing_id, p_portal: job.portal_id, p_revision: job.revision,
          p_set: next.set, p_event: { kind: 'RETRY_BY_ADMIN', detail: { admin: owner.id } },
        });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'PUBLICATION_WRITE_FAILED');
        return reply({ ok: true });
      }

      case 'admin.provider.update': {
        await requireAdmin();
        const profile = profileById(input.providerId) ?? fail('PORTAL_UNKNOWN');
        const clean = sanitizePatch(profile, (input.patch ?? {}) as Record<string, unknown>);
        if ('error' in clean) fail(clean.error);
        const { error } = await db.rpc('publishing_provider_update', { p_actor: owner.id, p_provider: profile.id, p_patch: clean.patch, p_action: 'UPDATE' });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'PROVIDER_UPDATE_FAILED');
        return reply({ ok: true });
      }

      case 'admin.provider.recheck': {
        await requireAdmin();
        const config = providerById(input.providerId) ?? fail('PORTAL_UNKNOWN');
        const result = await deps.probe(config);
        const { error } = await db.rpc('publishing_provider_update', {
          p_actor: owner.id, p_provider: config.id, p_action: 'RECHECK',
          p_patch: { health_status: result.status, health_detail: result.detail, health_checked_at: deps.now().toISOString() },
        });
        if (error) fail('PROVIDER_UPDATE_FAILED');
        return reply({ health: result });
      }
    }
    return reply({ code: 'UNKNOWN_ACTION' }, 404);
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'REQUEST_FAILED';
    if (code === 'REQUEST_FAILED') console.error('publishing-engine', action, e instanceof Error ? e.message : 'unknown');
    const status = code === 'ADMIN_REQUIRED' ? 403
      : code.includes('CONFLICT') || code === 'EXTERNAL_LISTING_ALREADY_LINKED' || code === 'LISTING_ALREADY_EXISTS' ? 409
      : code.endsWith('NOT_FOUND') || code.endsWith('_REQUIRED') && code.startsWith('OWNED') ? 404 : 400;
    return reply({ code }, status);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve((req) => handler(req));
