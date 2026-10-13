import { impersonationVerdict, lookupWith } from '../_shared/impersonation.ts';
import { normalizeOwnedProperty } from '../../../src/publishing/normalize.ts';

const allowedOrigins = new Set([
  'https://homatch.live',
  'https://www.homatch.live',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function createPublisherHandler(dependencies: {
  createClient: (...args: any[]) => any;
  env: (name: string) => string | undefined;
}) {
  const { createClient, env } = dependencies;
  return async (request: Request) => {
    const origin = request.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      ...(origin && allowedOrigins.has(origin)
        ? { 'Access-Control-Allow-Origin': origin }
        : {}),
    };
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.has(origin))
      return reply({ code: 'ORIGIN_REJECTED' }, 403);
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Headers':
            'authorization,apikey,content-type,x-client-info',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
        },
      });
    if (request.method !== 'POST')
      return reply({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer '))
      return reply({ code: 'AUTH_REQUIRED' }, 401);
    try {
      const url = env('SUPABASE_URL')!;
      const caller = createClient(url, env('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false },
      });
      const { data: identity, error: authError } = await caller.auth.getUser();
      if (authError || !identity.user || identity.user.is_anonymous)
        return reply({ code: 'AUTH_REQUIRED' }, 401);
      const { data: user, error: userError } = await caller
        .from('users')
        .select('id,is_admin,suspended_at')
        .eq('auth_id', identity.user.id)
        .maybeSingle();
      if (userError || !user || user.suspended_at)
        return reply({ code: 'ACCOUNT_UNAVAILABLE' }, 403);
      // Read the body with a strict byte bound; never log request bodies, bearer tokens or errors.
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (!reader) return reply({ code: 'INVALID_REQUEST' }, 400);
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return reply({ code: 'REQUEST_TOO_LARGE' }, 413);
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply({ code: 'INVALID_REQUEST' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return reply({ code: 'INVALID_REQUEST' }, 400);
      const action = body.action;
      if (action === 'snapshot') {
        const tables = [
          'publisher_portals',
          'publisher_accounts',
          'publisher_publications',
          'publisher_jobs',
          'publisher_events',
          'publisher_selections',
          'publisher_versions',
        ] as const;
        const results = await Promise.all(
          tables.map((table) => {
            let query = caller
              .from(table)
              .select(
                table === 'publisher_versions'
                  ? 'id,property_id,version,created_at'
                  : '*',
              );
            if (table !== 'publisher_portals')
              query = query.eq('user_id', user.id);
            if (
              [
                'publisher_jobs',
                'publisher_events',
                'publisher_versions',
              ].includes(table)
            )
              query = query.order('created_at', { ascending: false });
            return query.limit(table === 'publisher_portals' ? 30 : 100);
          }),
        );
        if (results.some((result) => result.error))
          return reply({ code: 'PUBLISHING_UNAVAILABLE' }, 503);
        return reply(
          Object.fromEntries(
            tables.map((table, i) => [
              table.replace('publisher_', ''),
              results[i].data ?? [],
            ]),
          ),
        );
      }
      const service = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false },
      });
      if (
        (await impersonationVerdict(auth, lookupWith(service))) !==
        'NOT_IMPERSONATING'
      )
        return reply({ code: 'READ_ONLY_SESSION' }, 403);
      const rpc = async (name: string, args: Record<string, unknown>) => {
        const { data, error } = await service.rpc(name, args);
        if (error)
          throw new Error(
            /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)
              ? error.message
              : 'PUBLISHING_OPERATION_FAILED',
          );
        return data;
      };
      if (action === 'save_selection') {
        if (
          !uuid(body.propertyId) ||
          !Array.isArray(body.portals) ||
          body.portals.length > 20 ||
          body.portals.some(
            (p) => typeof p !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(p),
          )
        )
          return reply({ code: 'INVALID_SELECTION' }, 400);
        await rpc('publisher_save_selection', {
          p_user: user.id,
          p_property: body.propertyId,
          p_portals: body.portals,
        });
        return reply({ saved: true });
      }
      if (action === 'enqueue') {
        if (
          !uuid(body.propertyId) ||
          !uuid(body.confirmationId) ||
          !Array.isArray(body.portals) ||
          body.portals.length > 20 ||
          !['publish', 'update', 'remove', 'status'].includes(
            String(body.operation),
          )
        )
          return reply({ code: 'INVALID_REQUEST' }, 400);
        const { data: property, error } = await caller
          .from('properties')
          .select('*,facts:property_facts(*),photos:property_photos(*)')
          .eq('id', body.propertyId)
          .eq('user_id', user.id)
          .eq('is_deleted', false)
          .maybeSingle();
        if (error || !property)
          return reply({ code: 'PROPERTY_NOT_OWNED' }, 404);
        const version = await rpc('publisher_snapshot', {
          p_user: user.id,
          p_property: body.propertyId,
          p_normalized: normalizeOwnedProperty(property, user.id),
        });
        const jobs = await rpc('publisher_enqueue', {
          p_user: user.id,
          p_property: body.propertyId,
          p_version: version.id,
          p_portals: body.portals,
          p_operation: body.operation,
          p_confirmation: body.confirmationId,
        });
        return reply({ jobs }, 202);
      }
      if (action === 'cancel' || action === 'retry') {
        if (!uuid(body.jobId)) return reply({ code: 'INVALID_REQUEST' }, 400);
        return reply({
          changed: await rpc(
            action === 'cancel' ? 'publisher_cancel' : 'publisher_retry',
            { p_user: user.id, p_job: body.jobId },
          ),
        });
      }
      if (action === 'disconnect') {
        if (!uuid(body.accountId))
          return reply({ code: 'INVALID_REQUEST' }, 400);
        return reply({
          changed: await rpc('publisher_disconnect', {
            p_user: user.id,
            p_account: body.accountId,
          }),
        });
      }
      if (action === 'connect') {
        // No credential or OTP is accepted until a portal-specific permitted connector is installed.
        return reply({ code: 'CONNECTION_NOT_SUPPORTED' }, 409);
      }
      if (action === 'admin') {
        if (
          !user.is_admin ||
          !['snapshot', 'kill_switch', 'portal_switch'].includes(
            String(body.adminAction),
          )
        )
          return reply({ code: 'ADMIN_REQUIRED' }, 403);
        if (
          body.adminAction !== 'snapshot' &&
          typeof body.enabled !== 'boolean'
        )
          return reply({ code: 'INVALID_REQUEST' }, 400);
        return reply(
          await rpc('publisher_admin', {
            p_user: user.id,
            p_action: body.adminAction,
            p_portal: body.portalId ?? null,
            p_enabled: body.enabled ?? null,
          }),
        );
      }
      return reply({ code: 'UNKNOWN_ACTION' }, 400);
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)
          ? error.message
          : 'PUBLISHING_UNAVAILABLE';
      return reply({ code }, 409);
    }
  };
}
