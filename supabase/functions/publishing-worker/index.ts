// PUBLISHING-WORKER — the Railway browser worker's door to the publishing queue.
//
// Same model as verify-queue: the worker holds no database credential. Every call
// is a POST {action, ...} with the shared WORKER_TOKEN; locking, leases, retries
// and the submit-once door live in Postgres (publishing_op_* in migration
// 20261107090000); this function adds what the worker may see for one claimed
// operation and turns its outcome into publication / account transitions.
//
//   claim        {worker, portals[], leaseSeconds?}  → {tasks[]} (listing copy, photos, decrypted session)
//   heartbeat    {id, token, stage}                  → {ok}
//   submitting   {id, token}                         → {ok} — true exactly once per operation
//   finish       {id, token, outcome, result, error, retryable}
//   session.save {id, token, storageState}           → refreshed cookies, re-sealed
//   artifact     {id, token, kind, stage, name}      → signed upload URL for a screenshot / log
//
// WHAT THE WORKER NEVER RECEIVES: another portal's session, any password, the
// sealing key, or a listing it was not leased. A session is decrypted only into
// the claim response of an operation on that portal, over TLS, and the worker
// keeps it in memory.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type OpKind, cleanStorageState, publicationEffect, sessionExpiry } from '../publishing-engine/automation.ts';
import { ACCOUNT_COLUMNS, type AccountRow, centralCopy, emptyAccount, routeFor } from '../publishing-engine/central.ts';
import { classifyCheck, normalizeListing, transition, type Command, type Publication } from '../publishing-engine/domain.ts';
import { fetchListingPage } from '../publishing-engine/net.ts';
import { adapterFor, configs, type ProviderRow } from '../publishing-engine/providers.ts';
import { openCredential, sealCredential, type Envelope } from '../publishing-engine/vault.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 1_000_000;
const JOB_COLUMNS = 'id,listing_id,user_id,portal_id,status,channel,revision,external_id,external_url,listing_version,check_attempts,last_checked_at,next_check_at,published_at,last_error,contact_consent_at,status_reason';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface Deps {
  env: (k: string) => string | undefined;
  db?: any;
  fetchPage: typeof fetchListingPage;
  now: () => Date;
}

export async function handler(req: Request, deps: Deps = { env: (k) => Deno.env.get(k), fetchPage: fetchListingPage, now: () => new Date() }) {
  if (req.method !== 'POST') return json({ code: 'METHOD_DENIED' }, 405);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, deps.env('WORKER_TOKEN') || '')) return json({ code: 'WORKER_AUTH_REQUIRED' }, 401);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  let input: Record<string, any>;
  try { input = JSON.parse(raw || '{}'); } catch { return json({ code: 'INVALID_JSON' }, 400); }
  const db = deps.db ?? createClient(deps.env('SUPABASE_URL')!, deps.env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = deps.env('PUBLISHING_CREDENTIALS_KEY');
  const fail = (code: string): never => { throw new Error(code); };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'QUEUE_REQUEST_FAILED');
    return data;
  };

  const { data: rows } = await db.from('publishing_providers').select('id,enabled,sort,create_url,logo_url,verification,max_photos,description_max,required_fields');
  const providers = configs((rows ?? []) as ProviderRow[]);
  const provider = (id: string) => providers.find((p) => p.id === id) ?? fail('PORTAL_UNKNOWN');
  const account = async (portal: string): Promise<AccountRow> => {
    const { data } = await db.from('publishing_accounts').select(ACCOUNT_COLUMNS).eq('portal_id', portal).maybeSingle();
    return (data as AccountRow) ?? emptyAccount(portal);
  };
  const operation = async (id: unknown, leaseToken: unknown) => {
    if (!UUID.test(String(id || '')) || !UUID.test(String(leaseToken || ''))) fail('INVALID_ID');
    const { data } = await db.from('publishing_operations').select('*').eq('id', id).maybeSingle();
    if (!data || data.lease_token !== leaseToken || data.status !== 'RUNNING') fail('LEASE_CONFLICT');
    return data;
  };
  const job = async (id: string) => {
    const { data } = await db.from('publishing_engine_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
    return data as (Publication & { id: string; listing_id: string; user_id: string; portal_id: string }) | null;
  };
  /** A transition made by the automation, written like an admin's: owner stays owner, the worker is in the history. */
  const move = async (pub: Publication & { listing_id: string; user_id: string; portal_id: string }, cmd: Command, detail: Record<string, unknown> = {}) => {
    const next = transition(pub, cmd, deps.now());
    if ('error' in next) return next.error;
    const { error } = await db.rpc('publishing_publication_write', {
      p_owner: pub.user_id, p_listing: pub.listing_id, p_portal: pub.portal_id, p_revision: pub.revision,
      p_set: next.set, p_event: { kind: next.kind, detail: { ...(next.detail ?? {}), ...detail, by: 'AUTOMATION' } },
    });
    return error ? 'PUBLICATION_WRITE_FAILED' : null;
  };
  const pageCheck = async (pubId: string) => {
    const pub = await job(pubId);
    if (!pub?.external_url || !pub.external_id) return;
    const a = adapterFor(provider(pub.portal_id));
    if (!a.canCheckPage()) return;
    const page = await deps.fetchPage(pub.external_url, a);
    await move(pub, { type: 'CHECK', outcome: classifyCheck({ status: page.status as any, body: (page as any).body, externalId: pub.external_id }) });
  };
  const sessionFor = async (portal: string) => {
    const { data } = await db.from('publishing_account_sessions').select('envelope,status,expires_at').eq('portal_id', portal).maybeSingle();
    if (!data || data.status === 'EXPIRED') return null;
    return JSON.parse(await openCredential(data.envelope as Envelope, `session:${portal}`, key));
  };

  try {
    switch (String(input.action || '')) {
      case 'claim': {
        const portals = (Array.isArray(input.portals) ? input.portals : []).map(String).filter((p: string) => providers.some((c) => c.id === p));
        const claimed = await rpc('publishing_op_claim', { p_worker: String(input.worker || 'worker').slice(0, 80), p_portals: portals, p_lease_seconds: Number(input.leaseSeconds) || 300 }) ?? [];
        const tasks = [];
        for (const op of claimed) {
          const config = provider(op.portal_id);
          const acct = await account(op.portal_id);
          let session: unknown = null;
          try { session = await sessionFor(op.portal_id); } catch (e) {
            // An unreadable session cannot be used: hand the operation back as blocked.
            await rpc('publishing_op_finish', { p_op: op.id, p_token: op.lease_token, p_outcome: 'BLOCKED', p_result: {}, p_error: e instanceof Error ? e.message : 'CREDENTIAL_UNREADABLE', p_retryable: false });
            continue;
          }
          const task: Record<string, unknown> = {
            id: op.id, leaseToken: op.lease_token, kind: op.kind, portalId: op.portal_id, attempt: op.attempts,
            submitAlreadyStarted: !!op.submit_started_at, session,
            account: { contactPhone: acct.contact_phone, liveSubmitApproved: !!acct.live_submit_approved },
            portal: { createUrl: config.createUrl, domains: config.domains, maxPhotos: config.maxPhotos },
          };
          if (op.publication_id) {
            const pub = await job(op.publication_id);
            const { data: l } = await db.from('publishing_engine_listings').select('id,version,payload').eq('id', op.listing_id).maybeSingle();
            if (!pub || !l) {
              await rpc('publishing_op_finish', { p_op: op.id, p_token: op.lease_token, p_outcome: 'BLOCKED', p_result: {}, p_error: 'PUBLICATION_NOT_FOUND', p_retryable: false });
              continue;
            }
            const x = normalizeListing(l.payload);
            const copies = Object.fromEntries((['ka', 'en', 'ru'] as const).filter((lang) => x.description[lang]).map((lang) => [lang, centralCopy(x, config, acct, lang)]));
            const ids = config.maxPhotos != null ? x.photos.slice(0, config.maxPhotos) : x.photos;
            const { data: photoRows } = ids.length ? await db.from('property_photos').select('id,storage_path').eq('property_id', l.id).in('id', ids) : { data: [] };
            const photos = [];
            for (const id of ids) {
              const p = (photoRows ?? []).find((r: { id: string }) => r.id === id);
              if (!p) continue;
              const { data: signed } = await db.storage.from('property-photos').createSignedUrl(String(p.storage_path).replace(/^property-photos\//, ''), 900);
              if (signed?.signedUrl) photos.push({ id, url: signed.signedUrl });
            }
            task.listing = {
              version: l.version, propertyType: x.propertyType, dealType: x.dealType, price: x.price, currency: x.currency,
              area: x.area, rooms: x.rooms, bedrooms: x.bedrooms, bathrooms: x.bathrooms, floor: x.floor, totalFloors: x.totalFloors,
              condition: x.condition, city: x.city, district: x.district, street: x.street, streetNumber: x.streetNumber, amenities: x.amenities,
              title: x.title, ownerName: x.contactName,
            };
            task.copies = copies;
            task.photos = photos;
            task.publication = { externalId: pub.external_id, externalUrl: pub.external_url, status: pub.status };
            if (op.kind === 'CREATE') await move(pub, { type: 'AUTO_START' });
          }
          tasks.push(task);
        }
        return json({ tasks });
      }

      case 'heartbeat':
        return json({ ok: !!(await rpc('publishing_op_heartbeat', { p_op: input.id, p_token: input.token, p_stage: /^[A-Z_]{2,40}$/.test(String(input.stage)) ? input.stage : null, p_lease_seconds: Number(input.leaseSeconds) || 300 })) });

      case 'submitting':
        return json({ ok: !!(await rpc('publishing_op_mark_submitting', { p_op: input.id, p_token: input.token })) });

      case 'session.save': {
        const op = await operation(input.id, input.token);
        const clean = cleanStorageState(input.storageState, provider(op.portal_id).domains);
        if ('error' in clean) fail(clean.error);
        const envelope = await sealCredential(JSON.stringify(clean.state), `session:${op.portal_id}`, key);
        await db.from('publishing_account_sessions').update({ envelope, saved_at: deps.now().toISOString(), expires_at: sessionExpiry(clean.state as { cookies: any[] }) }).eq('portal_id', op.portal_id);
        return json({ ok: true });
      }

      case 'artifact': {
        const op = await operation(input.id, input.token);
        const kind = input.kind === 'LOG' ? 'LOG' : 'SCREENSHOT';
        const name = `${String(input.stage || 'STEP').replace(/[^A-Z_]/g, '').slice(0, 30) || 'STEP'}-${deps.now().getTime()}.${kind === 'LOG' ? 'json' : 'png'}`;
        const path = `${op.id}/${name}`;
        const { data, error } = await db.storage.from('publishing-artifacts').createSignedUploadUrl(path);
        if (error || !data) fail('ARTIFACT_UPLOAD_FAILED');
        await db.from('publishing_artifacts').insert({ operation_id: op.id, kind, stage: input.stage ?? null, path });
        return json({ path, uploadUrl: data.signedUrl, token: data.token });
      }

      case 'finish': {
        const op = await operation(input.id, input.token);
        const outcome = String(input.outcome || '');
        const result = (input.result && typeof input.result === 'object' ? input.result : {}) as Record<string, any>;
        const error = input.error ? String(input.error).replace(/[^A-Z0-9_:]/g, '').slice(0, 120) || 'WORKER_ERROR' : null;
        // The worker reports the listing URL it saw; only a URL on the portal's own
        // domains with a listing id in it is accepted as the created listing.
        let parsed: { url: string; externalId: string } | null = null;
        let finalOutcome = outcome;
        if (op.kind === 'CREATE' && outcome === 'SUCCEEDED') {
          const p = adapterFor(provider(op.portal_id)).parseListingUrl(result.externalUrl);
          if ('error' in p) finalOutcome = 'RECONCILIATION_REQUIRED';
          else parsed = p;
        }
        const finished = await rpc('publishing_op_finish', {
          p_op: op.id, p_token: op.lease_token, p_outcome: finalOutcome,
          p_result: { externalUrl: parsed?.url ?? null, externalId: parsed?.externalId ?? null, state: typeof result.state === 'string' ? result.state.slice(0, 20) : null, fields: Array.isArray(result.fields) ? result.fields.slice(0, 50).map(String) : [] },
          p_error: finalOutcome !== outcome ? 'RESULT_URL_NOT_ON_PORTAL' : error, p_retryable: input.retryable === true,
        });
        const status = finished.status;

        // The account: a session check or an authentication failure is the real account's answer.
        if (op.kind === 'CHECK_SESSION' || error === 'AUTH_REQUIRED') {
          const valid = op.kind === 'CHECK_SESSION' && status === 'SUCCEEDED';
          // Signed out on the portal → expired. Anything else (the page could not tell)
          // is "not verified", never "connected".
          const expired = error === 'AUTH_REQUIRED';
          await db.from('publishing_account_sessions').update({ status: valid ? 'VALID' : expired ? 'EXPIRED' : 'UNVERIFIED', verified_at: valid ? deps.now().toISOString() : null }).eq('portal_id', op.portal_id);
          await db.rpc('publishing_account_write', {
            p_actor: null, p_portal: op.portal_id, p_action: 'SESSION_CHECK',
            p_patch: valid
              ? { status: 'CONNECTED', verified_at: deps.now().toISOString(), verification_result: 'SESSION_VERIFIED_ON_PORTAL', last_error: null }
              : { status: expired ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED', verified_at: null, verification_result: error ?? 'SESSION_CHECK_FAILED', last_error: error },
          });
          // Waiting publications move to their new route (QUEUED → a CREATE operation each).
          const acct = await account(op.portal_id);
          const route = routeFor(provider(op.portal_id), acct, deps.now());
          if (!('error' in route)) {
            const { data: waiting } = await db.from('publishing_engine_jobs').select(JOB_COLUMNS).eq('portal_id', op.portal_id).eq('channel', 'HOMATCH_ACCOUNT').in('status', ['AUTH_REQUIRED', 'ADMIN_ACTION_REQUIRED', 'QUEUED']).limit(500);
            for (const w of waiting ?? []) {
              if (w.status !== route.route) await move(w, { type: 'REROUTE', route: route.route });
              if (route.route === 'QUEUED') {
                const now = await job(w.id);
                if (now?.status === 'QUEUED') {
                  await db.rpc('publishing_op_enqueue', { p_publication: now.id, p_portal: now.portal_id, p_kind: 'CREATE', p_version: now.listing_version, p_payload: {}, p_key: `${now.id}:CREATE:${now.listing_version ?? 0}:${now.revision}` });
                }
              }
            }
          }
        }

        if (op.publication_id) {
          const pub = await job(op.publication_id);
          const effect = pub ? publicationEffect(op.kind as OpKind, status, error) : null;
          if (pub && effect) {
            if (effect.type === 'LINK' && parsed) {
              await move(pub, { type: 'AUTO_LINKED', url: parsed.url, externalId: parsed.externalId, listingVersion: op.listing_version ?? pub.listing_version ?? 1 });
              await db.rpc('publishing_account_write', { p_actor: null, p_portal: op.portal_id, p_action: 'ACTIVITY', p_patch: { last_published_at: deps.now().toISOString(), last_error: null } });
              await pageCheck(pub.id);
            } else if (effect.type === 'FALLBACK') {
              await move(pub, { type: 'AUTO_FALLBACK', to: effect.to, code: effect.code });
              const acct = await account(op.portal_id);
              await db.rpc('publishing_account_write', { p_actor: null, p_portal: op.portal_id, p_action: 'ACTIVITY', p_patch: { failure_count: acct.failure_count + 1, last_error: effect.code } });
            } else if (effect.type === 'CHECK') {
              if (op.kind === 'DELETE') await move(pub, { type: 'AUTO_REMOVED' });
              await pageCheck(pub.id);
            } else if (effect.type === 'UPDATED') {
              await move(pub, { type: 'AUTO_UPDATED', listingVersion: op.listing_version ?? pub.listing_version ?? 1 });
            }
          }
        }
        return json({ ok: true, status });
      }
    }
    return json({ code: 'UNKNOWN_ACTION' }, 404);
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'REQUEST_FAILED';
    if (code === 'REQUEST_FAILED') console.error('publishing-worker', input?.action, e instanceof Error ? e.message : 'unknown');
    return json({ code }, code === 'LEASE_CONFLICT' ? 409 : 400);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve((req) => handler(req));
