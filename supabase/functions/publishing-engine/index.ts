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
  classifyCheck, isLive, normalizeListing, parseExternalUrl, publicRegistry,
  transition, validateListing, type Command, type Publication, type PortalId,
} from './domain.ts';
import { FIELD_KEYS, OPERATIONS, adapterFor, configs, profileById, robotsAllows, sanitizePatch, type Operation, type ProviderAdapter, type ProviderConfig, type ProviderRow } from './providers.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READS = new Set(['workspace', 'listing.get', 'provider.operation', 'admin.providers', 'admin.publications']);
const PROVIDER_COLUMNS = 'id,enabled,sort,create_url,logo_url,verification,max_photos,description_max,required_fields,health_status,health_checked_at,health_detail,updated_at';
const UA = 'Mozilla/5.0 (compatible; HOMATCH-ListingCheck/1.0; +https://homatch.live)';
const fail = (code: string): never => { throw new Error(code); };
const PUBLICATION_COLUMNS = 'id,listing_id,portal_id,status,revision,external_id,external_url,listing_version,check_attempts,last_checked_at,next_check_at,published_at,last_error,created_at,updated_at';

/** GET with no redirects followed, 10 s, body capped. */
async function get(url: string, cap: number) {
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } });
  } catch (e) {
    return { status: (e instanceof DOMException && e.name === 'TimeoutError') ? 'TIMEOUT' as const : 'NETWORK' as const };
  }
  if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, location: response.headers.get('location') }; }
  const reader = response.body?.getReader();
  let body = '', size = 0;
  const decoder = new TextDecoder();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    body += decoder.decode(value, { stream: true });
    if (size > cap) { await reader.cancel(); break; }
  }
  return { status: 200, body };
}

/**
 * GET the public listing page: the portal's own https hosts only (the URL was
 * parsed against them, and so is every redirect), at most 3 redirects, 10 s,
 * 2 MB — and only when the host's robots.txt allows it. An unreadable robots.txt
 * (404, timeout) is treated as allowing, as RFC 9309 says.
 */
async function fetchListingPage(url: string, adapter: ProviderAdapter) {
  if (!adapter.canCheckPage()) return { status: 'ROBOTS_DISALLOWED' as const };
  let current = url;
  const robots = new Map<string, string>();
  for (let hop = 0; hop < 4; hop++) {
    const target = new URL(current);
    if (target.protocol !== 'https:' || target.port || !adapter.hostAllowed(target.hostname)) return { status: 'REDIRECT_OFF_PORTAL' as const };
    if (!robots.has(target.host)) {
      const r = await get(`https://${target.host}/robots.txt`, 200_000);
      robots.set(target.host, r.status === 200 ? (r as { body: string }).body : '');
    }
    if (!robotsAllows(robots.get(target.host)!, target.pathname + target.search, 'HOMATCH-ListingCheck')) return { status: 'ROBOTS_DISALLOWED' as const };
    const page = await get(current, 2_000_000);
    if (typeof page.status === 'number' && page.status >= 300 && page.status < 400) {
      const next = (page as { location?: string | null }).location;
      if (!next) return { status: page.status };
      current = new URL(next, current).toString();
      continue;
    }
    return page;
  }
  return { status: 'REDIRECT_OFF_PORTAL' as const };
}

/** An admin's re-check: is the portal's home page reachable at all. Never for an owner-confirmed portal. */
async function probeProvider(config: ProviderConfig) {
  if (config.verification !== 'PAGE_CHECK') return { status: 'SKIPPED', detail: config.verificationNote ?? 'NOT_CHECKED' };
  const r = await get(config.siteUrl, 300_000);
  if (r.status === 200) return { status: 'REACHABLE', detail: 'HTTP_200' };
  if (typeof r.status === 'number' && r.status >= 300 && r.status < 400) return { status: 'REACHABLE', detail: `HTTP_${r.status}` };
  return { status: 'UNREACHABLE', detail: typeof r.status === 'number' ? `HTTP_${r.status}` : r.status };
}

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
    return { portals: publicRegistry(providers), listing: { ...listing, validation: validateListing(normalizeListing(listing.payload), providers) }, publications: publications ?? [], events: events ?? [] };
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
          portals: publicRegistry(providers),
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
        const { error } = await db.rpc('publishing_listing_save', { p_owner: owner.id, p_property: property.id, p_version: version, p_payload: listing, p_status: validation.ready ? 'READY' : 'DRAFT' });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'LISTING_SAVE_FAILED');
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
          : action === 'publication.unpublish' ? { type: 'REQUEST_UNPUBLISH' }
          : action === 'publication.confirmRemoved' ? { type: 'CONFIRM_REMOVED' }
          : { type: 'MARK_UPDATED', listingVersion: listing.version };
        await write(listing.id, portal.id, current, cmd);
        return reply(await detail(listing.id));
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
