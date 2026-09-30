// META OAUTH — Facebook Login for Business, read from the sources that run
// it: one canonical function (meta-oauth), the config_id dialog, the state and
// nonce checks bound to the user's own row, token sealing, reconnect, the
// preserved Deauthorize callback and the Data Deletion Request callback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const fn = read('supabase/functions/meta-oauth/index.ts');
const shared = read('supabase/functions/_shared/metaAds.ts');
const api = read('supabase/functions/meta-ads-api/index.ts');

test('one OAuth implementation: meta-oauth is the only callback function', () => {
  const oauthish = readdirSync(join(root, 'supabase/functions')).filter((d) => /meta|facebook/i.test(d) && /oauth|login/i.test(d));
  assert.deepEqual(oauthish, ['meta-oauth']);
  assert.match(shared, /return `\$\{base\}\/functions\/v1\/meta-oauth`/, 'the redirect is the meta-oauth function');
});

test('the dialog uses the Login for Business configuration with the code grant', () => {
  assert.match(shared, /configId: metaLoginConfigId\(\)/);
  assert.match(shared, /Deno\.env\.get\('META_LOGIN_CONFIG_ID'\) \?\? META_LOGIN_CONFIG_ID_DEFAULT/);
  const lib = read('src/lib/metaAds/oauth.ts');
  assert.match(lib, /q\.set\('config_id', configId\)/);
  assert.match(lib, /q\.set\('override_default_response_type', 'true'\)/);
  assert.match(api, /oauthStartUrl\(/, 'oauth_start builds the dialog through the shared adapter');
});

test('a system-user token is not passed through fb_exchange_token', () => {
  const ex = shared.slice(shared.indexOf('export async function exchangeCodeForToken'), shared.indexOf('/* ── SIGNED REQUESTS'));
  const cfgBranch = ex.indexOf('if (metaLoginConfigId())');
  assert.ok(cfgBranch > 0 && cfgBranch < ex.indexOf("grant_type: 'fb_exchange_token'"), 'the configuration path returns before the legacy exchange');
});

test('callback: signed state + one-time nonce on the caller\'s own row (tenant isolation)', () => {
  assert.match(fn, /const state = await verifyOAuthState\(url\.searchParams\.get\('state'\) \?\? ''\)/);
  assert.match(fn, /\.select\('id,oauth_nonce'\)\.eq\('user_id', state\.uid\)\.maybeSingle\(\)/);
  assert.match(fn, /conn\.oauth_nonce !== state\.nonce/);
  assert.match(fn, /update\(\{ oauth_nonce: null \}\)\.eq\('id', conn\.id\)/, 'the nonce is single-use');
  assert.match(shared, /return verifyState\(metaAppSecret\(\), state\)/);
});

test('reconnect: the token is sealed first and replaces the old one on the same connection', () => {
  assert.ok(fn.indexOf('await sealToken(token)') < fn.indexOf("status: 'CONNECTED'"));
  assert.match(fn, /from\('meta_tokens'\)\.upsert\(\{\s*connection_id: conn\.id, access_token: sealed/);
  assert.match(api, /oauth_nonce: nonce, oauth_started_at/, 'oauth_start rotates the nonce on every connect/reconnect');
});

test('deauthorize callback is preserved: verified signed_request → REVOKED, token deleted', () => {
  const dea = fn.slice(fn.indexOf('async function deauthorize'), fn.indexOf('async function deleteMetaData'));
  assert.match(dea, /from\('meta_tokens'\)\.delete\(\)/);
  assert.match(dea, /status: 'REVOKED', last_error: 'DEAUTHORIZED_BY_USER'/);
  assert.match(fn, /if \(!parsed\) return new Response\('bad signed_request', \{ status: 400 \}\)/);
  assert.match(fn, /await deauthorize\(sb, parsed\.user_id\)/);
});

test('data deletion: verified, recorded, executed, answered with url + confirmation_code', () => {
  const post = fn.slice(fn.indexOf("if (req.method === 'POST')"), fn.indexOf('await deauthorize(sb, parsed.user_id)'));
  assert.ok(post.indexOf('parseSignedRequest') < post.indexOf("action') === 'data_deletion'"), 'verified before anything else');
  assert.match(post, /from\('meta_data_deletion_requests'\)\s*\.insert\(\{ confirmation_code: code, meta_user_hash: userHash/);
  assert.match(post, /await deleteMetaData\(sb, parsed\.user_id\)/);
  assert.match(post, /return jsonResponse\(deletionResponse\(FUNCTION_URL, code\)\)/);
  const del = fn.slice(fn.indexOf('async function deleteMetaData'), fn.indexOf('function statusPage'));
  assert.match(del, /from\('meta_tokens'\)\.delete\(\)/);
  assert.match(del, /from\('meta_assets'\)\.delete/);
  assert.match(del, /meta_user_external_id: null/);
  assert.match(fn, /CONFIRMATION_CODE\.test\(statusCode\)/, 'the status page accepts only a well-formed code');
});

test('the deletion ledger keeps no Facebook id and is admin-read-only', () => {
  const m = read('supabase/migrations/20261001130000_meta_data_deletion_requests.sql');
  assert.match(m, /meta_user_hash text not null check \(meta_user_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(m, /meta_user_id\s+text/);
  assert.match(m, /enable row level security/);
  assert.match(m, /using \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(m, /grant (insert|update|delete)/i);
});

test('no credential is hard-coded', () => {
  for (const src of [fn, shared, read('src/lib/metaAds/oauth.ts')]) {
    assert.doesNotMatch(src, /EAA[A-Za-z0-9]{20,}/, 'no Meta access token literal');
    assert.doesNotMatch(src, /client_secret: '[^']+'/);
  }
});
