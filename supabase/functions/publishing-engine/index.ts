import { createClient } from '@supabase/supabase-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { normalizeListing, validateListing } from './listing-schema.runtime.ts';
import { advance } from './engine.runtime.ts';
import registry from './registry.runtime.ts';
import { handleV2 } from './v2.ts';
import { handleManagedTick } from './server/handler.ts';

const origins = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const actions = new Set(['checkAuthentication', 'inspect', 'fillListing', 'uploadPhotos', 'verifyForm', 'preparePublish', 'publishAfterConfirmation', 'extractPublishedListing', 'checkStatus']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bucket = 'publishing-engine-photos';
const fail = (code: string): never => { throw Error(code); };

export async function handler(req: Request) {
  if(req.headers.has('x-publishing-worker-token'))return handleManagedTick(req,{
    expectedToken:Deno.env.get('PUBLISHING_WORKER_TOKEN'),
    createAdmin:()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
  });
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', ...(origins.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (!origins.has(origin)) return reply({ code: 'ORIGIN_DENIED' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ code: 'METHOD_DENIED' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error: authError } = await client.auth.getUser();
  if (authError || !user.user) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: owner } = await admin.from('users').select('id').eq('auth_id', user.user.id).maybeSingle();
  if (!owner) return reply({ code: 'OWNER_REQUIRED' }, 403);
  const owned = async (table: string, id: string) => {
    if (!uuid.test(id || '')) fail('INVALID_ID');
    const { data, error } = await admin.from(table).select('*').eq('id', id).eq('user_id', owner.id).maybeSingle();
    if (error || !data) fail('OWNED_RECORD_REQUIRED');
    return data;
  };
  try {
    if (Number(req.headers.get('content-length')) > 12000000) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    const text = await req.text();
    if (text.length > 12000000) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    const { url, body: raw } = JSON.parse(text);
    if (url === '/portals') return reply(registry);
    if (url === '/listings' && !raw) {
      const { data, error } = await admin.from('publishing_engine_listings').select('payload').eq('user_id', owner.id).order('created_at', { ascending: false }).limit(100);
      if (error) fail('LISTINGS_READ_FAILED');
      return reply({ listings: data.map(x => x.payload) });
    }
    if (url === '/jobs' && !raw) {
      const { data, error } = await admin.from('publishing_engine_jobs').select('payload').eq('user_id', owner.id).order('created_at', { ascending: false }).limit(100);
      if (error) fail('JOBS_READ_FAILED');
      return reply({ jobs: data.map(x => x.payload), publications: data.filter(x => x.payload.state === 'PUBLISHED').map(x => x.payload) });
    }
    if (url === '/assets') {
      if (typeof raw.base64 !== 'string' || raw.base64.length > 11000000) fail('INVALID_PHOTO');
      const bytes = Uint8Array.from(atob(raw.base64), c => c.charCodeAt(0));
      if (bytes.length < 12 || bytes.length > 8000000) fail('INVALID_PHOTO');
      const mime = bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) ? 'image/png' : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP' ? 'image/webp' : null;
      if (!mime) fail('INVALID_IMAGE_FORMAT');
      const assetId = crypto.randomUUID(), name = String(raw.name || 'photo').replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 100);
      const { error } = await admin.storage.from(bucket).upload(`${owner.id}/${assetId}`, bytes, { contentType: mime, upsert: false });
      if (error) fail('PHOTO_UPLOAD_FAILED');
      return reply({ assetId, mime, bytes: bytes.length, name });
    }
    const photos = async (items: unknown[], max = 16) => {
      if (!Array.isArray(items) || items.length > max) fail('INVALID_PHOTOS');
      return await Promise.all(items.map(async (p: any) => {
        if (!uuid.test(p.assetId || '')) fail('INVALID_ASSET');
        const { data, error } = await admin.storage.from(bucket).download(`${owner.id}/${p.assetId}`);
        if (error || !data) fail('OWNED_PHOTO_REQUIRED');
        const bytes = new Uint8Array(await data.arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { assetId: p.assetId, name: String(p.name).slice(0, 100), mime: data.type, bytes: bytes.length, base64: btoa(binary) };
      }));
    };
    if (typeof url === 'string' && url.startsWith('/v2/')) return reply(await handleV2(url,raw,{admin,owner,registry,normalize:normalizeListing,photos}));
    if (url === '/photos') return reply({ photos: await photos(raw.photos) });
    if (url === '/listings') {
      const listing = normalizeListing(raw);
      if (listing.portalTargets.some(id => !registry.portals.find(p => p.id === id)?.capabilities.fill)) fail('PORTAL_NOT_IMPLEMENTED');
      const validation = validateListing(listing);
      if (!validation.valid) return reply({ code: 'LISTING_INVALID', errors: validation.errors }, 422);
      if (listing.photos.reduce((n,p) => n + (p.bytes || 0), 0) > 24000000) fail('TOTAL_PHOTOS_MAX_24MB');
      const phone = parsePhoneNumberFromString(listing.contactPhone, 'GE');
      if (!phone?.isValid()) fail('VALID_CONTACT_PHONE_REQUIRED');
      listing.contactPhone = phone.number;
      listing.contactPhoneCountry = phone.country || null;
      const ownedPhotos = await photos(listing.photos); // Ownership and image existence, never a supplied URL.
      if (ownedPhotos.reduce((n,p) => n + p.bytes, 0) > 24000000) fail('TOTAL_PHOTOS_MAX_24MB');
      const { data, error } = await admin.rpc('publishing_engine_save', { p_owner: owner.id, p_id: raw.id || null, p_version: raw.version || 0, p_listing: listing });
      if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'PROPERTY_SAVE_FAILED');
      return reply({ listing: data, validation });
    }
    if (url === '/jobs') {
      const record = await owned('publishing_engine_listings', raw.listingId), listing = record.payload;
      if (!registry.portals.find(p => p.id === raw.portalId)?.capabilities.fill || !listing.portalTargets.includes(raw.portalId)) fail('PORTAL_NOT_SELECTED');
      const { data, error } = await admin.rpc('publishing_engine_start_portal_job', { p_owner: owner.id, p_listing: listing.id, p_version: listing.version, p_portal: raw.portalId });
      if (error) fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'JOB_CREATE_FAILED');
      return reply({ job: data });
    }
    if (url === '/jobs/transition') {
      const record = await owned('publishing_engine_jobs', raw.jobId);
      if (record.revision !== raw.revision) fail('JOB_REVISION_CONFLICT');
      const portal = registry.portals.find(p => p.id === record.payload.portalId);
      if (portal?.execution?.publicationBlocked !== false && ['READY_FOR_REVIEW','SUBMITTING','PUBLISHED'].includes(raw.state)) fail('LIVE_BROWSER_VERIFICATION_REQUIRED');
      const next = advance(record.payload, raw.state, { confirmed: raw.confirmed === true, externalId: raw.externalId, externalUrl: raw.externalUrl, code: raw.code, allowedDomains: portal?.domains || [] });
      const { data, error } = await admin.from('publishing_engine_jobs').update({ payload: next, revision: next.revision }).eq('id', record.id).eq('user_id', owner.id).eq('revision', record.revision).select('id').maybeSingle();
      if (error || !data) fail('JOB_REVISION_CONFLICT');
      return reply({ job: next });
    }
    if (url === '/browser') {
      if (raw.type === 'CONNECT') return reply({ command: { type: 'CONNECT' } });
      const portal = registry.portals.find(p => p.id === raw.portalId);
      if (raw.type !== 'EXECUTE' || !portal?.browser || !Number.isInteger(raw.tabId) || !actions.has(raw.action)) fail('COMMAND_NOT_ALLOWED');
      if (portal.execution?.publicationBlocked !== false && raw.action === 'publishAfterConfirmation') fail('LIVE_BROWSER_VERIFICATION_REQUIRED');
      const command: any = { type: 'EXECUTE', portalId: raw.portalId, tabId: raw.tabId, action: raw.action };
      if (['checkAuthentication', 'inspect', 'extractPublishedListing', 'checkStatus'].includes(raw.action)) return reply({ command });
      const record = await owned('publishing_engine_listings', raw.listingId);
      const job = await owned('publishing_engine_jobs', raw.jobId);
      if (job.payload.listingId !== record.id || job.payload.version !== record.payload.version || job.payload.portalId !== raw.portalId || !record.payload.portalTargets.includes(raw.portalId)) fail('JOB_LISTING_MISMATCH');
      const allowed = { fillListing: ['FILL_FORM'], uploadPhotos: ['UPLOAD_PHOTOS'], verifyForm: ['VERIFY_FORM'], preparePublish: ['VERIFY_FORM', 'READY_FOR_REVIEW', 'WAITING_FOR_USER_OTP'], publishAfterConfirmation: ['SUBMITTING'] };
      if (!allowed[raw.action]?.includes(job.payload.state)) fail('JOB_STATE_MISMATCH');
      command.payload = raw.action === 'uploadPhotos' ? await photos(record.payload.photos) : record.payload;
      if (raw.action === 'publishAfterConfirmation') {
        if (raw.payload?.confirmed !== true || typeof raw.payload.reviewToken !== 'string' || raw.payload.reviewToken.length > 100) fail('PUBLICATION_CONFIRMATION_REQUIRED');
        command.payload = { listing: record.payload, confirmed: true, reviewToken: raw.payload.reviewToken };
      }
      return reply({ command });
    }
    return reply({ code: 'NOT_FOUND' }, 404);
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'REQUEST_FAILED';
    return reply({ code }, code.includes('CONFLICT') ? 409 : 400);
  }
}
Deno.serve(handler);
