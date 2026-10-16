// SERVICE-CONTROL — the Admin → Service Control Center backend.
//
// Admin only (is_admin() on the caller's OWN token, every request). One POST door:
//   overview    the six services: switches, who/when/why, readiness, running work, audit
//   set         one service's two switches, compare-and-set on `version`
//   pause_all   both switches of all six off, in one transaction
//
// Writes go through the SECURITY DEFINER functions of migration 20261109090000 with the
// caller's token, so the database itself checks the admin and writes the audit row.
// Turning a backend ON is refused (NOT_READY, audited) while its readiness lists a
// blocking gap: an ON switch must never claim a service that cannot run.
// Nothing here returns a secret: readiness reports secret NAMES that are missing.
import { createClient } from '@supabase/supabase-js';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { envReport } from '../_shared/objectStore.ts';
import { SERVICE_KEYS, type ServiceKey, resetServiceControlCache } from '../_shared/serviceControl.ts';
import { type Facts, readiness, SECRETS_CHECKED, TABLES_CHECKED } from './readiness.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const MAX_BODY = 20_000;
const isKey = (v: unknown): v is ServiceKey => typeof v === 'string' && (SERVICE_KEYS as readonly string[]).includes(v);

/** What is running right now that a switch would affect (counts only). */
const RUNNING: Record<ServiceKey, Array<{ label: string; table: string; build: (q: any) => any }>> = {
  publishing: [
    { label: 'operations_active', table: 'publishing_operations', build: (q) => q.in('status', ['QUEUED', 'RUNNING']) },
    { label: 'publications_in_progress', table: 'publishing_engine_jobs', build: (q) => q.in('status', ['VERIFYING', 'UNPUBLISH_REQUESTED']) },
  ],
  ai_talk: [
    { label: 'sessions_active', table: 'comm_talk_sessions', build: (q) => q.eq('state', 'ACTIVE').gt('expires_at', new Date().toISOString()) },
  ],
  ai_call_center: [
    { label: 'campaigns_running', table: 'outreach_campaigns', build: (q) => q.eq('campaign_type', 'AI_CALL').in('status', ['RUNNING', 'SCHEDULED']) },
    { label: 'sends_pending', table: 'outreach_sends', build: (q) => q.eq('channel', 'AI_CALL').in('status', ['PENDING', 'QUEUED', 'SENDING', 'IN_PROGRESS']) },
  ],
  whatsapp: [
    { label: 'campaigns_running', table: 'outreach_campaigns', build: (q) => q.eq('campaign_type', 'WHATSAPP').in('status', ['RUNNING', 'SCHEDULED']) },
    { label: 'sends_pending', table: 'outreach_sends', build: (q) => q.eq('channel', 'WHATSAPP').in('status', ['PENDING', 'QUEUED', 'SENDING']) },
  ],
  live_chat: [
    { label: 'messages_last_hour', table: 'live_chat_messages', build: (q) => q.gt('created_at', new Date(Date.now() - 3_600_000).toISOString()) },
  ],
  design_studio: [
    { label: 'renders_open', table: 'ds_renders', build: (q) => q.not('status', 'in', '(READY,FAILED,CANCELLED)') },
    { label: 'walkthroughs_open', table: 'ds_walkthroughs', build: (q) => q.not('state', 'in', '(READY,FAILED,CANCELLED)') },
    { label: 'gpu_jobs_open', table: 'ds_factory_jobs', build: (q) => q.not('state', 'in', '(COMPLETED,FAILED,CANCELLED)') },
  ],
};

export interface Deps {
  env: (k: string) => string | undefined;
  db?: any;
  caller?: (authorization: string) => any;
}

const defaultDeps: Deps = { env: (k) => Deno.env.get(k) };

export async function handler(req: Request, deps: Deps = defaultDeps): Promise<Response> {
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

  const env = deps.env;
  const caller = deps.caller ? deps.caller(auth) : createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: authError } = await caller.auth.getUser();
  if (authError || !who?.user) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
  if (adminError || isAdmin !== true) return reply({ code: 'ADMIN_REQUIRED' }, 403);
  const db = deps.db ?? createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  let input: Record<string, any>;
  try { input = JSON.parse(raw || '{}'); } catch { return reply({ code: 'INVALID_JSON' }, 400); }
  const action = String(input?.action || '');
  if (action !== 'overview') {
    const refused = await refuseIfImpersonating(db, auth, headers);
    if (refused) return refused;
  }

  const facts = async (): Promise<Facts> => {
    const secrets = Object.fromEntries(SECRETS_CHECKED.map((n) => [n, typeof env(n) === 'string' && env(n)!.trim().length > 0]));
    const tables: Record<string, boolean> = {};
    await Promise.all(TABLES_CHECKED.map(async (t) => {
      const { error } = await db.from(t).select('*', { count: 'exact', head: true }).limit(1);
      tables[t] = !error;
    }));
    const [{ data: settingRows }, { data: routes }, { data: products }] = await Promise.all([
      db.from('admin_settings').select('key,value').in('key', ['ai_talk_enabled', 'design_studio_billing_enabled']),
      db.from('comm_provider_routes').select('role,provider,enabled,kill_switch').in('role', ['TELEPHONY', 'MESSAGING']),
      db.from('billable_products').select('code,enabled,pricing_active,kill_switch').in('code', ['AI_CALL', 'WHATSAPP']),
    ]);
    let r2Configured = false;
    try { r2Configured = envReport().allPresent; } catch { r2Configured = false; }
    return {
      secrets, tables, r2Configured,
      settings: Object.fromEntries((settingRows ?? []).map((r: any) => [r.key, r.value])),
      routes: (routes ?? []) as Facts['routes'],
      products: (products ?? []) as Facts['products'],
    };
  };
  const adminId = async () => {
    const { data } = await db.from('users').select('id').eq('auth_id', who.user.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const rpcError = (error: { message?: string } | null) => {
    const code = error?.message && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
    return reply({ code }, code === 'FORBIDDEN' ? 403 : code === 'REQUEST_FAILED' ? 500 : 400);
  };

  try {
    switch (action) {
      case 'overview': {
        const [{ data: rows, error }, f, { data: audit }] = await Promise.all([
          db.from('service_controls').select('service_key,frontend_enabled,backend_enabled,version,reason,updated_by,updated_at'),
          facts(),
          db.from('admin_audit_log').select('id,admin_id,action,entity_id,metadata,created_at').eq('entity_type', 'service_controls').order('created_at', { ascending: false }).limit(120),
        ]);
        if (error) return reply({ code: 'SERVICE_CONTROLS_UNREADABLE' }, 503);
        const ids = [...new Set([...(rows ?? []).map((r: any) => r.updated_by), ...(audit ?? []).map((a: any) => a.admin_id)].filter(Boolean))];
        const { data: people } = ids.length ? await db.from('users').select('id,full_name,email').in('id', ids) : { data: [] as any[] };
        const name = (id: string | null) => {
          const p = (people ?? []).find((x: any) => x.id === id);
          return p ? (p.full_name || p.email || null) : null;
        };
        const services = await Promise.all(SERVICE_KEYS.map(async (key) => {
          const row = (rows ?? []).find((r: any) => r.service_key === key);
          const running = Object.fromEntries(await Promise.all(RUNNING[key].map(async (r) => {
            const { count, error: e } = await r.build(db.from(r.table).select('*', { count: 'exact', head: true }));
            return [r.label, e ? null : (count ?? 0)];
          })));
          const ready = readiness(key, f);
          const backend = row?.backend_enabled === true;
          const frontend = backend && row?.frontend_enabled === true;
          return {
            key,
            frontend, backend,
            version: row?.version ?? null,
            reason: row?.reason ?? null,
            updatedAt: row?.updated_at ?? null,
            updatedBy: name(row?.updated_by ?? null),
            // The effective state of the service, not just the switch: RUNNING only
            // when its backend is on AND nothing blocking is missing.
            effective: !backend ? 'PAUSED' : ready.ready ? (frontend ? 'LIVE' : 'BACKEND_ONLY') : 'DEGRADED',
            readiness: ready,
            running,
            history: (audit ?? []).filter((a: any) => a.entity_id === key).slice(0, 8).map((a: any) => ({
              at: a.created_at, by: name(a.admin_id), action: a.action,
              result: a.metadata?.result ?? null, reason: a.metadata?.reason ?? null, requestId: a.metadata?.request_id ?? null,
              before: a.metadata?.before ?? null, after: a.metadata?.after ?? null, missing: a.metadata?.missing ?? null,
            })),
          };
        }));
        return reply({ services, checkedAt: new Date().toISOString(), propagationSeconds: 10 });
      }

      case 'set': {
        const key = input.service;
        if (!isKey(key)) return reply({ code: 'SERVICE_UNKNOWN' }, 400);
        if (typeof input.frontend !== 'boolean' || typeof input.backend !== 'boolean' || !Number.isInteger(input.expectedVersion)) return reply({ code: 'INVALID_ARGUMENT' }, 400);
        if (input.frontend && !input.backend) return reply({ code: 'FRONTEND_REQUIRES_BACKEND' }, 400);
        const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : null;
        const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(input.requestId) ? input.requestId : null;
        const { data: current } = await db.from('service_controls').select('backend_enabled,version').eq('service_key', key).maybeSingle();
        if (!current) return reply({ code: 'SERVICE_CONTROLS_UNREADABLE' }, 503);
        // Activation: validate before anything changes. A gap leaves the service paused.
        if (input.backend && current.backend_enabled !== true) {
          const ready = readiness(key, await facts());
          if (!ready.ready) {
            const admin = await adminId();
            if (admin) {
              await db.from('admin_audit_log').insert({ admin_id: admin, action: 'SERVICE_CONTROL_NOT_READY', entity_type: 'service_controls', entity_id: key,
                metadata: { result: 'NOT_READY', request_id: requestId, reason, missing: ready.missing, expected_version: input.expectedVersion } });
            }
            return reply({ code: 'NOT_READY', missing: ready.missing, notes: ready.notes }, 409);
          }
        }
        const { data, error } = await caller.rpc('service_control_set', {
          p_key: key, p_frontend: input.frontend, p_backend: input.backend,
          p_expected_version: input.expectedVersion, p_reason: reason, p_request_id: requestId,
        });
        if (error) return rpcError(error);
        resetServiceControlCache();
        if (data?.result === 'CONFLICT') return reply({ code: 'VERSION_CONFLICT', control: data.control }, 409);
        return reply({ result: data?.result, control: data?.control, readiness: readiness(key, await facts()) });
      }

      case 'pause_all': {
        const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : null;
        const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(input.requestId) ? input.requestId : null;
        const { data, error } = await caller.rpc('service_control_pause_all', { p_reason: reason, p_request_id: requestId });
        if (error) return rpcError(error);
        resetServiceControlCache();
        return reply(data);
      }

      default:
        return reply({ code: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    console.error('service-control', action, e instanceof Error ? e.message : 'unknown');
    return reply({ code: 'REQUEST_FAILED' }, 500);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve((req) => handler(req));
