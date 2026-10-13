import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublisherHandler } from '../../supabase/functions/publisher-center/handler.ts';
const userId = '11111111-1111-4111-8111-111111111111';
const propertyId = '33333333-3333-4333-8333-333333333333';
const jobId = '77777777-7777-4777-8777-777777777777';
function setup(options = {}) {
  const calls = [];
  const user = {
    id: userId,
    is_admin: Boolean(options.admin),
    suspended_at: options.suspended ? '2026-10-13' : null,
  };
  const client = {
    auth: {
      getUser: async () => {
        calls.push(['getUser']);
        return {
          data: {
            user: options.authError
              ? null
              : { id: 'auth-owner', is_anonymous: Boolean(options.anonymous) },
          },
          error: options.authError ? {} : null,
        };
      },
    },
    from(table) {
      const result = {
        data:
          table === 'impersonation_sessions'
            ? options.impersonating
              ? [{ id: 'session' }]
              : []
            : [],
        error: options.schemaError ? { code: '42P01' } : null,
      };
      const query = {
        select() {
          return this;
        },
        eq(column, value) {
          calls.push(['filter', table, column, value]);
          return this;
        },
        order() {
          return this;
        },
        limit: async () => result,
        maybeSingle: async () => ({
          data:
            table === 'users'
              ? user
              : table === 'properties'
                ? options.missingProperty
                  ? null
                  : {
                      id: propertyId,
                      user_id: userId,
                      transaction_type: 'SALE',
                      property_type: 'APARTMENT',
                      facts: {},
                      photos: [],
                    }
                : null,
          error: null,
        }),
      };
      return query;
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        data: name === 'publisher_snapshot' ? { id: jobId } : true,
        error: null,
      };
    },
  };
  const handler = createPublisherHandler({
    env: (name) =>
      ({
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_ANON_KEY: 'fixture-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
      })[name],
    createClient: () => client,
  });
  const request = (body, headers = {}) =>
    new Request('https://fixture.supabase.co/functions/v1/publisher-center', {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture-valid-verified-by-fake-getUser',
        'content-type': 'application/json',
        origin: 'https://homatch.live',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { handler, request, calls };
}
test('edge rejects untrusted origins before authentication or database access', async () => {
  const s = setup();
  const response = await s.handler(
    s.request({ action: 'snapshot' }, { origin: 'https://evil.example' }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(s.calls, []);
});
test('edge requires a bearer token and successful server verification', async () => {
  const s = setup({ authError: true });
  assert.equal(
    (await s.handler(s.request({ action: 'snapshot' }))).status,
    401,
  );
  assert.equal(
    (
      await s.handler(
        new Request('https://fixture/', { method: 'POST', body: '{}' }),
      )
    ).status,
    401,
  );
});
test('anonymous and suspended accounts cannot operate publishing', async () => {
  for (const option of [{ anonymous: true }, { suspended: true }]) {
    const s = setup(option);
    assert.ok(
      [401, 403].includes(
        (await s.handler(s.request({ action: 'snapshot' }))).status,
      ),
    );
    assert.ok(!s.calls.some((c) => c[0].startsWith('publisher_')));
  }
});
test('exact owner mapping is injected server-side and caller user ID is ignored', async () => {
  const s = setup();
  const response = await s.handler(
    s.request({
      action: 'save_selection',
      userId: 'attacker-choice',
      propertyId,
      portals: ['myhome'],
    }),
  );
  assert.equal(response.status, 200);
  const call = s.calls.find((c) => c[0] === 'publisher_save_selection');
  assert.equal(call[1].p_user, userId);
  assert.deepEqual(call[1].p_portals, ['myhome']);
});
test('malformed and unbounded selections never reach RPC', async () => {
  for (const portals of [Array(21).fill('myhome'), ['../escape'], [null]]) {
    const s = setup();
    assert.equal(
      (
        await s.handler(
          s.request({ action: 'save_selection', propertyId, portals }),
        )
      ).status,
      400,
    );
    assert.ok(!s.calls.some((c) => c[0] === 'publisher_save_selection'));
  }
});
test('OTP and connection requests cannot imply a successful unauthorized connector', async () => {
  const s = setup();
  const response = await s.handler(
    s.request({ action: 'connect', portalId: 'myhome', otp: '123456' }),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CONNECTION_NOT_SUPPORTED');
  assert.ok(!JSON.stringify(s.calls).includes('123456'));
});
test('read-only impersonation sessions cannot enqueue or change selections', async () => {
  const s = setup({ impersonating: true });
  const token = `x.${Buffer.from(JSON.stringify({ session_id: jobId })).toString('base64url')}.x`;
  const response = await s.handler(
    s.request(
      { action: 'save_selection', propertyId, portals: ['myhome'] },
      { authorization: `Bearer ${token}` },
    ),
  );
  assert.equal(response.status, 403);
  assert.ok(!s.calls.some((c) => c[0] === 'publisher_save_selection'));
});
test('missing or foreign property cannot be snapshotted or enqueued', async () => {
  const s = setup({ missingProperty: true });
  const response = await s.handler(
    s.request({
      action: 'enqueue',
      propertyId,
      confirmationId: jobId,
      operation: 'publish',
      portals: ['myhome'],
    }),
  );
  assert.equal(response.status, 404);
  assert.ok(!s.calls.some((c) => c[0] === 'publisher_snapshot'));
});
test('enqueue forwards exact targets and server-generated version', async () => {
  const s = setup();
  const response = await s.handler(
    s.request({
      action: 'enqueue',
      propertyId,
      confirmationId: jobId,
      operation: 'publish',
      portals: ['myhome'],
    }),
  );
  assert.equal(response.status, 202);
  const call = s.calls.find((c) => c[0] === 'publisher_enqueue');
  assert.equal(call[1].p_user, userId);
  assert.equal(call[1].p_version, jobId);
  assert.deepEqual(call[1].p_portals, ['myhome']);
});
test('admin monitoring and switches require current admin status', async () => {
  const s = setup();
  assert.equal(
    (
      await s.handler(
        s.request({
          action: 'admin',
          adminAction: 'kill_switch',
          enabled: true,
        }),
      )
    ).status,
    403,
  );
  assert.ok(!s.calls.some((c) => c[0] === 'publisher_admin'));
});
test('request bodies have a hard size limit and malformed JSON is rejected', async () => {
  const s = setup();
  assert.equal(
    (
      await s.handler(
        s.request({ action: 'snapshot', extra: 'x'.repeat(17000) }),
      )
    ).status,
    413,
  );
  const request = new Request('https://fixture/', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture' },
    body: '{',
  });
  assert.equal((await s.handler(request)).status, 400);
});
test('snapshot fails truthfully when schema has not been installed', async () => {
  const s = setup({ schemaError: true });
  const response = await s.handler(s.request({ action: 'snapshot' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'PUBLISHING_UNAVAILABLE');
});
