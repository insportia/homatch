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
  assert.match(shared, /configId: metaLoginConfigId\(configOverride\)/, 'the admin setting can switch the configuration');
  assert.match(api, /oauthStartUrl\(await signOAuthState\(\{ uid, nonce, ret \}\), settings\.loginConfigId\)/);
  assert.match(shared, /Deno\.env\.get\('META_LOGIN_CONFIG_ID'\) \?\? META_LOGIN_CONFIG_ID_DEFAULT/);
  const lib = read('src/lib/metaAds/oauth.ts');
  assert.match(lib, /q\.set\('config_id', configId\)/);
  assert.match(lib, /q\.set\('override_default_response_type', 'true'\)/);
  assert.match(api, /oauthStartUrl\(/, 'oauth_start builds the dialog through the shared adapter');
});

test('a system-user token is not passed through fb_exchange_token; a short-lived user token is upgraded server-side', () => {
  const ex = shared.slice(shared.indexOf('export async function exchangeCodeForToken'), shared.indexOf('/* ── SIGNED REQUESTS'));
  const longBranch = ex.indexOf('if (expiresIn === null || expiresIn >= LONG_LIVED_SECONDS) return { token, expiresIn, upgraded: false };');
  assert.ok(longBranch > 0 && longBranch < ex.indexOf("grant_type: 'fb_exchange_token'"), 'an undated (system-user) or long-lived token returns before the exchange');
  assert.match(shared, /const LONG_LIVED_SECONDS = 7 \* 86_400;/);
});

test('callback: signed state + one-time nonce on the caller\'s own row (tenant isolation)', () => {
  assert.match(fn, /const state = await verifyOAuthState\(url\.searchParams\.get\('state'\) \?\? ''\)/);
  assert.match(fn, /\.select\('id,oauth_nonce,status,last_checked_at'\)\.eq\('user_id', state\.uid\)\.maybeSingle\(\)/);
  assert.match(fn, /conn\.oauth_nonce !== state\.nonce/);
  assert.match(fn, /update\(\{ oauth_nonce: null \}\)\s*\.eq\('id', conn\.id\)\.eq\('oauth_nonce', state\.nonce\)/, 'the nonce is single-use, claimed atomically');
  assert.match(shared, /return verifyState\(metaAppSecret\(\), state\)/);
});

test('reconnect: the token is sealed first and replaces the old one on the same connection', () => {
  assert.ok(fn.indexOf('await sealToken(token)') < fn.indexOf("status: 'CONNECTED'"));
  assert.match(fn, /from\('meta_tokens'\)\.upsert\(\{\s*connection_id: conn\.id, access_token: sealed/);
  assert.match(api, /oauth_nonce: nonce, oauth_started_at/, 'oauth_start rotates the nonce on every connect/reconnect');
});

test('deauthorize callback is preserved: verified signed_request → REVOKED, token deleted', () => {
  const dea = fn.slice(fn.indexOf('async function deauthorize'), fn.indexOf('async function deleteMetaData'));
  assert.match(dea, /const conns = await connectionsFor\(sb, ids\)/);
  assert.match(dea, /from\('meta_tokens'\)\.delete\(\)/);
  assert.match(dea, /status: 'REVOKED', last_error: 'DEAUTHORIZED_BY_USER'/);
  assert.match(fn, /if \(!parsed\) return new Response\('bad signed_request', \{ status: 400 \}\)/);
  assert.match(fn, /await deauthorize\(sb, signedRequestIdentities\(parsed\)\)/);
});

test('data deletion: verified, recorded, executed, answered with url + confirmation_code', () => {
  const post = fn.slice(fn.indexOf("if (req.method === 'POST')"), fn.indexOf('await deauthorize(sb, parsed.user_id)'));
  assert.ok(post.indexOf('parseSignedRequest') < post.indexOf("action') === 'data_deletion'"), 'verified before anything else');
  assert.match(post, /from\('meta_data_deletion_requests'\)\s*\.insert\(\{ confirmation_code: code, meta_user_hash: userHash/);
  assert.match(post, /await deleteMetaData\(sb, signedRequestIdentities\(parsed\)\)/);
  assert.match(post, /: \{ status: 'UNMATCHED' \}/, 'nothing linked is never reported as completed');
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

test('callbacks act on exactly the connections that identity made (tenant isolation)', () => {
  const find = fn.slice(fn.indexOf('async function connectionsFor'), fn.indexOf('async function deauthorize'));
  assert.match(find, /from\('meta_connection_identities'\)\.select\('connection_id'\)\.in\('external_id', ids\)/);
  assert.match(find, /from\('meta_connections'\)\.select\('id'\)\.in\('meta_user_external_id', ids\)/);
  assert.match(find, /if \(ids\.length === 0\) return \[\]/, 'no id, no match — never a table-wide action');
  const del = fn.slice(fn.indexOf('async function deleteMetaData'), fn.indexOf('function statusPage'));
  assert.match(del, /from\('meta_assets'\)\.delete\(\{ count: 'exact' \}\)\.eq\('user_id', c\.user_id\)/, 'assets of the matched tenant only');
  assert.match(del, /from\('meta_connection_identities'\)\.delete\(\)\.eq\('connection_id', c\.id\)/);
});

test('a connection records every Meta identity it was made with; reconnect replaces them', () => {
  const cb = fn.slice(fn.indexOf('await exchangeCodeForToken(code)'));
  assert.match(cb, /graph\(`\/debug_token\?input_token=\$\{encodeURIComponent\(token\)\}`/);
  assert.match(cb, /from\('meta_connection_identities'\)\.delete\(\)\.eq\('connection_id', conn\.id\)/);
  assert.match(cb, /connectionIdentities\(meRes\.id, debug, typeof debug\?\.type === 'string' \? debug\.type === 'SYSTEM_USER' : !!metaLoginConfigId\(\)\)/);
  const m = read('supabase/migrations/20261001130000_meta_data_deletion_requests.sql');
  assert.match(m, /references public\.meta_connections\(id\) on delete cascade/);
  assert.match(m, /revoke all on public\.meta_connection_identities from anon, authenticated/);
});

test('least privilege: the base set is the five configured permissions; Instant Forms are goal-scoped', () => {
  assert.match(shared, /BASE_SCOPES = \['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'\]/);
  assert.match(shared, /INSTANT_FORM_SCOPES = \['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'\]/);
  assert.match(shared, /LEADS_ON_META: \[\.\.\.BASE_SCOPES, \.\.\.INSTANT_FORM_SCOPES\]/);
  for (const g of ['LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'PROMOTE', 'ENGAGEMENT', 'MESSAGES']) {
    assert.match(shared, new RegExp(`${g}: BASE_SCOPES`));
  }
  assert.doesNotMatch(shared + api, /instagram_basic'|instagram_business_account/, 'instagram_basic is not used');
  assert.match(api, /const missingScopes = BASE_SCOPES\.filter/, 'health asks for the base set only');
  assert.match(api, /INSTANT_FORMS_PERMISSION_REQUIRED/);
  assert.match(api, /\/instagram_accounts\?fields=id,username/);
  assert.match(api, /kind === 'PAGE' && mode === 'REAL' && hasScopes\(scopeConn\?\.granted_scopes, INSTANT_FORM_SCOPES\)/, 'no subscribed_apps call without pages_manage_metadata');
});

test('a malformed token key is never used and never exposed: base64/32-byte check + round trip, booleans only', () => {
  const key = shared.slice(shared.indexOf('async function tokenKey'), shared.indexOf('const b64 = '));
  assert.match(key, /try \{ bytes = Uint8Array\.from\(atob\(raw\)/, 'invalid base64 must not throw');
  assert.match(key, /if \(bytes\.length < 32\) return null/);
  assert.match(key, /export async function tokenKeyStatus\(\): Promise<\{ present: boolean; valid: boolean; roundTrip: boolean \}>/);
  assert.match(api, /if \(!\(await tokenKeyStatus\(\)\)\.roundTrip\)/, 'Connect refuses before the dialog when the key cannot seal');
  assert.match(api, /const tokenKeyCheck = \{ valid: keyStatus\.valid, roundTrip: keyStatus\.roundTrip \}/);
  assert.doesNotMatch(api, /META_TOKEN_ENCRYPTION_KEY'\)(?!\s*\??\)?)[^;\n]*json\(/, 'no path returns the key');
});

test('a test-mode connection is never presented as Connected once Meta is live', () => {
  const open = shared.slice(shared.indexOf('export async function openToken'), shared.indexOf('export async function openToken') + 400);
  assert.match(open, /if \(stored\.startsWith\('mock_'\) && metaMode\(\) === 'REAL'\) return null;/);
  assert.match(api, /tokenUsable/, 'health reads token usability through openToken');
});

test('a system-user token that cannot answer /me/permissions still connects, and TEST assets are retired', () => {
  const cb = fn.slice(fn.indexOf('await exchangeCodeForToken(code)'));
  assert.match(cb, /granted = Array\.isArray\(debug\?\.scopes\)/, 'debug_token scopes are the fallback');
  assert.ok(cb.indexOf('await sealToken(token)') < cb.indexOf("status: 'CONNECTED'"), 'sealed before CONNECTED');
  assert.match(cb, /contains\('capabilities', \{ mock: true \}\)/);
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /settle\('\/me\/businesses/, 'each asset list is read on its own');
  assert.match(api, /client_business_id/);
  assert.match(api, /filter\(\(k\) => readKinds\.has\(k\)\)/, 'a refused list never retires its assets');
  // After the callback: one shared refresh (assets + permissions + lead check), then the status.
  assert.match(read('src/components/metaAds/builder/useMetaConnect.ts'), /await refreshMetaAssets\(\)\.catch\(\(\) => undefined\);\s*await reload\(\);/);
  assert.match(read('src/pages/outreach/MetaAdsPage.tsx'), /useConnectReturn\(boot, !builderReturn\)/);
});
