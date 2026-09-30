// Facebook Login for Business: the dialog URL, the signed OAuth state and
// Meta's signed_request (Deauthorize / Data Deletion), exercised for real —
// signed, tampered, expired, wrong secret, wrong algorithm.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOAuthDialogUrl, META_LOGIN_CONFIG_ID_DEFAULT, signState, verifyState, STATE_TTL_MS,
  verifySignedRequest, signSignedRequest, newConfirmationCode, CONFIRMATION_CODE, deletionResponse, hashMetaUserId,
  connectionIdentities, signedRequestIdentities,
} from '../oauth.ts';

const SECRET = 'test-app-secret-not-real';
const REDIRECT = 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/meta-oauth';

test('the production configuration id is the Login for Business configuration', () => {
  assert.equal(META_LOGIN_CONFIG_ID_DEFAULT, '970930962712211');
});

test('config_id flow: code grant, override, no scope, exact redirect', () => {
  const u = new URL(buildOAuthDialogUrl({
    apiVersion: 'v26.0', appId: '123', redirectUri: REDIRECT, state: 'abc.def',
    configId: META_LOGIN_CONFIG_ID_DEFAULT, scopes: 'ads_management,pages_show_list',
  }));
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
  assert.equal(u.searchParams.get('client_id'), '123');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('state'), 'abc.def');
  assert.equal(u.searchParams.get('config_id'), '970930962712211');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('override_default_response_type'), 'true');
  assert.equal(u.searchParams.has('scope'), false, 'the configuration, not a scope list, decides permissions');
});

test('without a configuration the legacy scope flow is unchanged', () => {
  const u = new URL(buildOAuthDialogUrl({ apiVersion: 'v26.0', appId: '1', redirectUri: REDIRECT, state: 's', configId: '', scopes: 'ads_read' }));
  assert.equal(u.searchParams.get('scope'), 'ads_read');
  assert.equal(u.searchParams.has('config_id'), false);
  assert.equal(u.searchParams.has('override_default_response_type'), false);
});

test('state: round trip, tampering, wrong secret, expiry, malformed', async () => {
  const now = 1_800_000_000_000;
  const state = await signState(SECRET, { uid: 'user-1', nonce: 'n-1' }, now);
  assert.deepEqual(await verifyState(SECRET, state, now + 1000), { uid: 'user-1', nonce: 'n-1' });
  assert.equal(await verifyState('other-secret', state, now), null, 'another secret');
  const [body, sig] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'attacker', nonce: 'n-1', exp: now + 999999 })).toString('base64url');
  assert.equal(await verifyState(SECRET, `${forged}.${sig}`, now), null, 'payload swapped under the old signature');
  assert.equal(await verifyState(SECRET, `${body}.${sig.slice(0, -1)}0`, now), null, 'signature altered');
  assert.equal(await verifyState(SECRET, state, now + STATE_TTL_MS + 1), null, 'expired');
  assert.equal(await verifyState(SECRET, '', now), null);
  assert.equal(await verifyState(SECRET, 'a.b.c', now), null);
  assert.equal(await verifyState('', state, now), null, 'no secret, no state');
  await assert.rejects(signState('', { uid: 'u', nonce: 'n' }), /STATE_SECRET_MISSING/);
});

test('signed_request: a correctly signed request verifies', async () => {
  const sr = await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA256', issued_at: 1_800_000_000, user_id: '1234567890' });
  const parsed = await verifySignedRequest(SECRET, sr);
  assert.equal(parsed?.user_id, '1234567890');
});

test('signed_request: invalid ones are refused', async () => {
  const good = await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA256', user_id: '42' });
  const [sig, payload] = good.split('.');
  assert.equal(await verifySignedRequest('wrong-secret', good), null, 'wrong secret');
  const other = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '43' })).toString('base64url');
  assert.equal(await verifySignedRequest(SECRET, `${sig}.${other}`), null, 'payload swapped');
  assert.equal(await verifySignedRequest(SECRET, await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA1', user_id: '42' })), null, 'algorithm');
  assert.equal(await verifySignedRequest(SECRET, await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA256' })), null, 'no user_id');
  assert.equal(await verifySignedRequest(SECRET, await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA256', user_id: '' })), null, 'empty user_id');
  for (const junk of ['', 'abc', '.', `${sig}.`, `.${payload}`, `${sig}.${payload}.x`, 'a.!!!']) {
    assert.equal(await verifySignedRequest(SECRET, junk), null, `junk ${JSON.stringify(junk)}`);
  }
  assert.equal(await verifySignedRequest('', good), null, 'no secret configured');
});

test('data deletion: Meta\'s required response shape and an unguessable code', async () => {
  const code = newConfirmationCode();
  assert.match(code, CONFIRMATION_CODE);
  assert.notEqual(code, newConfirmationCode());
  const r = deletionResponse(REDIRECT, code);
  assert.deepEqual(Object.keys(r).sort(), ['confirmation_code', 'url']);
  assert.equal(r.confirmation_code, code);
  assert.equal(r.url, `${REDIRECT}?deletion_status=${code}`);
  const h = await hashMetaUserId('1234567890');
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.notEqual(h, await hashMetaUserId('1234567891'));
  assert.ok(!h.includes('1234567890'), 'the id itself is not kept');
});

test('identities: a system-user connection records every id Meta showed us', () => {
  assert.deepEqual(connectionIdentities('111', { user_id: '222', profile_id: 333 }, true), [
    { kind: 'SYSTEM_USER', external_id: '111' },
    { kind: 'TOKEN_USER', external_id: '222' },
    { kind: 'TOKEN_PROFILE', external_id: '333' },
  ]);
  assert.deepEqual(connectionIdentities('111', { user_id: '111' }, false), [
    { kind: 'APP_SCOPED_USER', external_id: '111' }, { kind: 'TOKEN_USER', external_id: '111' },
  ]);
  assert.deepEqual(connectionIdentities('111', null, true), [{ kind: 'SYSTEM_USER', external_id: '111' }], 'debug_token unavailable');
  assert.deepEqual(connectionIdentities('not-an-id', { user_id: "1' or 1=1" }, true), [], 'only numeric Meta ids');
});

test('identities: a signed_request names user_id and profile_id, nothing else', async () => {
  const sr = await signSignedRequest(SECRET, { algorithm: 'HMAC-SHA256', user_id: '42', profile_id: '77', business_id: '99' });
  const parsed = await verifySignedRequest(SECRET, sr);
  assert.deepEqual(signedRequestIdentities(parsed), ['42', '77']);
  assert.deepEqual(signedRequestIdentities({ user_id: '42', profile_id: '42' }), ['42']);
  assert.deepEqual(signedRequestIdentities({ user_id: 'x' }), []);
});
