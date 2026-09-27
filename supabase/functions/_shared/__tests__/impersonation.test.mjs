// "LOG IN AS USER" — the guarantees, checked without a browser or a database.
//
// Three layers carry the promise and each is pinned here:
//
//   _shared/impersonation.ts   decides, from the SIGNED session_id claim,
//                              whether a request is an admin viewing as
//                              somebody — and refuses rather than guesses when
//                              it cannot tell.
//   impersonate-user           mints the session. It must refuse non-admins,
//                              require a reason, audit before minting, never
//                              return a refresh token, and revoke only the
//                              minted session (scope 'local').
//   the money/message paths    must ask before writing with the service role.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  impersonationVerdict,
  jwtClaims,
  refuseIfImpersonating,
  sessionIdOf,
} from '../impersonation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, '..', '..');
const read = (p) => readFileSync(join(FUNCTIONS, p), 'utf8');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bearer = (claims) => `Bearer ${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

const SID = '5b1c9d2e-8f7a-4b3c-9d2e-1f0a9b8c7d6e';

test('the session id is read from the token claims, and only when it is a uuid', () => {
  assert.equal(sessionIdOf(bearer({ sub: 'u', session_id: SID })), SID);
  assert.equal(sessionIdOf(bearer({ sub: 'u' })), null);
  assert.equal(sessionIdOf(bearer({ sub: 'u', session_id: 'x' })), null);
  assert.equal(sessionIdOf('Bearer not-a-jwt'), null);
  assert.equal(sessionIdOf(null), null);
  assert.equal(jwtClaims(bearer({ sub: 'abc' }))?.sub, 'abc');
});

test('a recorded session is IMPERSONATING, an unrecorded one is not', async () => {
  const seen = [];
  const yes = async (sid) => { seen.push(sid); return { found: true, error: null }; };
  const no = async () => ({ found: false, error: null });
  assert.equal(await impersonationVerdict(bearer({ session_id: SID }), yes), 'IMPERSONATING');
  assert.deepEqual(seen, [SID]);
  assert.equal(await impersonationVerdict(bearer({ session_id: SID }), no), 'NOT_IMPERSONATING');
  /* No claim, no lookup: an ordinary service-role or anon call is untouched. */
  let called = false;
  assert.equal(await impersonationVerdict(bearer({}), async () => { called = true; return { found: true }; }), 'NOT_IMPERSONATING');
  assert.equal(called, false);
});

test('a lookup that fails refuses, except when the columns do not exist yet', async () => {
  const failing = (code) => async () => ({ found: false, error: { code, message: 'x' } });
  assert.equal(await impersonationVerdict(bearer({ session_id: SID }), failing('08006')), 'UNKNOWN');
  assert.equal(await impersonationVerdict(bearer({ session_id: SID }), async () => { throw new Error('net'); }), 'UNKNOWN');
  /* Before the migration no session could have been minted (impersonate-user
     refuses to hand out a token it could not record), so billing keeps working. */
  assert.equal(await impersonationVerdict(bearer({ session_id: SID }), failing('42703')), 'NOT_IMPERSONATING');
});

test('refuseIfImpersonating answers 403 for an impersonation session and 503 when unsure', async () => {
  const client = (result) => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => result }) }) }),
  });
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const blocked = await refuseIfImpersonating(client({ data: [{ id: 1 }], error: null }), bearer({ session_id: SID }), cors);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'READ_ONLY_IMPERSONATION');
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), '*');
  const unsure = await refuseIfImpersonating(client({ data: null, error: { code: '08006' } }), bearer({ session_id: SID }), cors);
  assert.equal(unsure.status, 503);
  assert.equal(await refuseIfImpersonating(client({ data: [], error: null }), bearer({ session_id: SID }), cors), null);
});

test('impersonate-user refuses non-admins, requires a reason, and audits before minting', () => {
  const src = read('impersonate-user/index.ts');
  const adminCheck = src.indexOf("if (!adminRow?.is_admin) return json({ error: 'Forbidden: admin required' }, 403);");
  const start = src.indexOf('/* ── start ──');
  assert.ok(adminCheck > 0, 'the admin check is present and answers 403');
  assert.ok(start > adminCheck, 'start is reachable only after the admin check');
  assert.match(src, /if \(!enabled\) return json\(\{ error: 'Impersonation is disabled'/);
  assert.match(src, /reason\.length < 5/);
  assert.match(src, /Administrators cannot be impersonated/);
  assert.match(src, /email_confirmed_at/);
  const audit = src.indexOf("action: 'IMPERSONATION_START'");
  const mint = src.indexOf('generateLink(');
  assert.ok(audit > 0 && mint > audit, 'the audit row is written before any session is minted');
  assert.match(src, /action: 'IMPERSONATION_END'/);
});

test('impersonate-user never returns a refresh token and revokes only the minted session', () => {
  const src = read('impersonate-user/index.ts');
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /refresh_token/, 'no refresh token is read or returned');
  assert.doesNotMatch(code, /action_link/, 'the magic link itself is never used or returned');
  for (const call of code.matchAll(/auth\.admin\.signOut\(([^)]*)\)/g)) {
    assert.match(call[1], /'local'/, `signOut must be scope 'local': ${call[0]}`);
  }
  assert.match(code, /auth_session_id: authSessionId/, 'the minted session id is recorded');
  /* A session Postgres could not recognise is revoked, not returned. */
  assert.match(code, /if \(recordErr\) \{\s*await svc\.auth\.admin\.signOut\(minted\.access_token, 'local'\)/);
});

test('every service-role money and message path asks before writing', () => {
  for (const fn of ['credits-topup', 'billing', 'payment-method-setup', 'atomic-unlock',
    'research-purchase', 'unlock-external-contact', 'send-message']) {
    const src = read(`${fn}/index.ts`);
    assert.match(src, /from '\.\.\/_shared\/impersonation\.ts'/, `${fn} imports the guard`);
    assert.match(src, /await refuseIfImpersonating\(/, `${fn} calls the guard`);
    assert.match(src, /if ?\(impersonating\) return impersonating;/, `${fn} returns the refusal`);
  }
});

test('admin-user360 searches through the SQL function, not a string-built filter', () => {
  const src = read('admin-user360/index.ts');
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\.or\(`/, 'no template-literal PostgREST filter');
  assert.match(code, /rpc\('admin_search_users'/);
  assert.match(code, /Forbidden: admin role required/);
  assert.doesNotMatch(code, /from\('users'\)\.select\('\*'\)/, 'user360 names its columns');
});
