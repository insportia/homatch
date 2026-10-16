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
// The only outbound request is a GET of a listing URL on the portal's own domain.

import { createClient } from '@supabase/supabase-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import {
  classifyCheck, hostAllowed, isLive, normalizeListing, parseExternalUrl, portalById, publicRegistry,
  transition, validateListing, type Command, type Publication, type PortalId,
} from './domain.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READS = new Set(['workspace', 'listing.get']);
const fail = (code: string): never => { throw new Error(code); };
const PUBLICATION_COLUMNS = 'id,listing_id,portal_id,status,revision,external_id,external_url,listing_version,check_attempts,last_checked_at,next_check_at,published_at,last_error,created_at,updated_at';

/** GET the public listing page: portal domains only, at most 3 same-portal redirects, 10 s, 2 MB. */
async function fetchListingPage(url: string, portalId: PortalId) {
  const portal = portalById(portalId)!;
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HOMATCH-ListingCheck/1.0; +https://homatch.live)', Accept: 'text/html' },
      });
    } catch (e) {
      return { status: (e instanceof DOMException && e.name === 'TimeoutError') ? 'TIMEOUT' as const : 'NETWORK' as const };
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) return { status: response.status };
      const target = new URL(next, current);
      if (target.protocol !== 'https:' || !hostAllowed(portal, target.hostname)) return { status: 'REDIRECT_OFF_PORTAL' as const };
      current = target.toString();
      continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); return { status: response.status }; }
    const reader = response.body?.getReader();
    let body = '', size = 0;
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      body += decoder.decode(value, { stream: true });
      if (size > 2_000_000) { await reader.cancel(); break; }
    }
    return { status: 200, body };
  }
  return { status: 'REDIRECT_OFF_PORTAL' as const };
}

export async function handler(req: Request, deps = { fetchPage: fetchListingPage, now: () => new Date() }) {
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

  const ownedProperty = async (id: unknown) => {
    if (!UUID.test(String(id || ''))) fail('INVALID_ID');
    const { data } = await db.from('properties').select('id,contact_phone_e164').eq('id', id).eq('user_id', owner.id).eq('is_deleted', false).maybeSingle();
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
    const page = await deps.fetchPage(pub.external_url!, pub.portal_id);
    const outcome = classifyCheck({ status: page.status as any, body: (page as any).body, externalId: pub.external_id! });
    return await write(listingId, pub.portal_id, pub, { type: 'CHECK', outcome });
  };
  const detail = async (listingId: string) => {
    const listing = await ownedListing(listingId);
    const [{ data: publications }, { data: events }] = await Promise.all([
      db.from('publishing_engine_jobs').select(PUBLICATION_COLUMNS).eq('listing_id', listingId).eq('user_id', owner.id),
      db.from('publishing_engine_events').select('id,kind,portal_id,from_status,to_status,detail,created_at').eq('listing_id', listingId).eq('user_id', owner.id).order('created_at', { ascending: false }).limit(100),
    ]);
    return { listing: { ...listing, validation: validateListing(normalizeListing(listing.payload)) }, publications: publications ?? [], events: events ?? [] };
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
          portals: publicRegistry(),
          listings: (listings ?? []).map((l) => ({ ...l, validation: validateListing(normalizeListing(l.payload)) })),
          publications: publications ?? [],
        });
      }
      case 'listing.get':
        return reply(await detail(String(input.propertyId)));

      case 'listing.save': {
        const property = await ownedProperty(input.propertyId);
        const listing = normalizeListing(input.listing);
        if (listing.contactPhone) {
          const phone = parsePhoneNumberFromString(listing.contactPhone, 'GE');
          listing.contactPhone = phone?.isValid() ? phone.number : listing.contactPhone;
        } else if (property.contact_phone_e164) {
          listing.contactPhone = property.contact_phone_e164;
        }
        if (listing.photos.length) {
          const { data: photos } = await db.from('property_photos').select('id').eq('property_id', property.id).in('id', listing.photos);
          const mine = new Set((photos ?? []).map((p) => p.id));
          listing.photos = listing.photos.filter((id) => mine.has(id));
        }
        const validation = validateListing(listing);
        const version = Number.isInteger(input.version) ? input.version : 0;
        const { error } = await db.rpc('publishing_listing_save', { p_owner: owner.id, p_property: property.id, p_version: version, p_payload: listing, p_status: validation.ready ? 'READY' : 'DRAFT' });
        if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'LISTING_SAVE_FAILED');
        return reply(await detail(property.id));
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
        const portal = portalById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        if (listing.archived_at) fail('LISTING_ARCHIVED');
        const validation = validateListing(normalizeListing(listing.payload));
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
        const portal = portalById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const parsed = parseExternalUrl(portal.id, input.externalUrl);
        if ('error' in parsed) fail(parsed.error);
        const current = await publicationFor(listing.id, portal.id);
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
        const portal = portalById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const current = await publicationFor(listing.id, portal.id) ?? fail('PUBLICATION_NOT_FOUND');
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
        const portal = portalById(input.portalId) ?? fail('PORTAL_UNKNOWN');
        const current = await publicationFor(listing.id, portal.id) ?? fail('PUBLICATION_NOT_FOUND');
        const cmd: Command = action === 'publication.retry' ? { type: 'RETRY' }
          : action === 'publication.unpublish' ? { type: 'REQUEST_UNPUBLISH' }
          : action === 'publication.confirmRemoved' ? { type: 'CONFIRM_REMOVED' }
          : { type: 'MARK_UPDATED', listingVersion: listing.version };
        await write(listing.id, portal.id, current, cmd);
        return reply(await detail(listing.id));
      }
    }
    return reply({ code: 'UNKNOWN_ACTION' }, 404);
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'REQUEST_FAILED';
    if (code === 'REQUEST_FAILED') console.error('publishing-engine', action, e instanceof Error ? e.message : 'unknown');
    const status = code.includes('CONFLICT') || code === 'EXTERNAL_LISTING_ALREADY_LINKED' ? 409
      : code.endsWith('NOT_FOUND') || code.endsWith('_REQUIRED') && code.startsWith('OWNED') ? 404 : 400;
    return reply({ code }, status);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve((req) => handler(req));
