// META CONNECT — one button, one attempt, back to the same draft and step,
// a cancel that keeps the work, and a callback that cannot be replayed into
// a second exchange.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextConnect, CONNECT_BUSY, connectResultOf, browserKind } from '../connectFlow.ts';
import { safeReturnPath, withConnectResult, dialogErrorResult, signState, verifyState } from '../oauth.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const SECRET = 'test-app-secret-not-real';

test('state machine: one attempt — a second tap while preparing or redirecting does nothing', () => {
  let s = nextConnect('IDLE', { type: 'TAP' });
  assert.equal(s, 'PREPARING');
  assert.equal(nextConnect(s, { type: 'TAP' }), 'PREPARING', 'double tap');
  s = nextConnect(s, { type: 'URL' });
  assert.equal(s, 'REDIRECTING');
  assert.equal(nextConnect(s, { type: 'TAP' }), 'REDIRECTING');
  assert.ok(CONNECT_BUSY.has('PREPARING') && CONNECT_BUSY.has('REDIRECTING'));
  assert.equal(nextConnect(s, { type: 'PAGE_RESTORED' }), 'IDLE', 'back button from Meta unlocks');
  assert.equal(nextConnect('PREPARING', { type: 'ERROR' }), 'FAILED');
  assert.equal(nextConnect('FAILED', { type: 'TAP' }), 'PREPARING', 'retry is one tap');
});

test('state machine: the return decides the outcome — ok, cancelled, failed', () => {
  assert.equal(nextConnect('IDLE', { type: 'RETURNED', result: 'ok' }), 'CONNECTED');
  assert.equal(nextConnect('IDLE', { type: 'RETURNED', result: 'denied' }), 'CANCELLED');
  assert.equal(nextConnect('IDLE', { type: 'RETURNED', result: 'bad_state' }), 'FAILED');
  assert.equal(connectResultOf('ok'), 'ok');
  assert.equal(connectResultOf('something_raw'), 'error', 'an unknown value is a plain failure, never shown raw');
  assert.equal(connectResultOf(null), null);
});

test('return path: only a HOMATCH Meta Ads path — never another site', () => {
  assert.equal(safeReturnPath('/outreach/meta/create?draft=5d12b8dc-1&step=account&from=destination'), '/outreach/meta/create?draft=5d12b8dc-1&step=account&from=destination');
  assert.equal(safeReturnPath('/outreach/meta'), '/outreach/meta');
  for (const bad of ['https://evil.example/', '//evil.example/outreach/meta', '/outreach/meta/../admin', '/outreach/meta/create?x=<script>',
    '/\\evil.example', '/outreach/meta/create?next=https://x', '/dashboard', '', null, '/outreach/meta%2F%2Fevil', `/outreach/meta/create?d=${'a'.repeat(300)}`]) {
    assert.equal(safeReturnPath(bad), null, String(bad));
  }
  assert.equal(withConnectResult('/outreach/meta/create?draft=d1&step=account&connect=denied', 'ok'), '/outreach/meta/create?draft=d1&step=account&connect=ok');
});

test('cancel is a cancel, not an error', () => {
  assert.equal(dialogErrorResult('access_denied', 'user_denied'), 'denied');
  assert.equal(dialogErrorResult('access_denied', null), 'denied');
  assert.equal(dialogErrorResult('server_error', null), 'error');
});

test('signed state carries the return path; a forged path cannot be signed in or read out', async () => {
  const now = 1_800_000_000_000;
  const st = await signState(SECRET, { uid: 'u1', nonce: 'n1', ret: '/outreach/meta/create?draft=d1&step=account' }, now);
  assert.deepEqual(await verifyState(SECRET, st, now + 1), { uid: 'u1', nonce: 'n1', ret: '/outreach/meta/create?draft=d1&step=account' });
  const evil = await signState(SECRET, { uid: 'u1', nonce: 'n1', ret: 'https://evil.example' }, now);
  assert.equal((await verifyState(SECRET, evil, now + 1)).ret, null, 'an unsafe path is never signed in');
  const tampered = `${Buffer.from(JSON.stringify({ uid: 'u1', nonce: 'n1', ret: '/outreach/meta', exp: now + 9e5 })).toString('base64url')}.${st.split('.')[1]}`;
  assert.equal(await verifyState(SECRET, tampered, now + 1), null, 'changing the path breaks the signature');
});

test('callback: back to the same draft and step; cancel retires the nonce; a replay never exchanges twice', () => {
  const fn = read('supabase/functions/meta-oauth/index.ts');
  assert.match(fn, /safeReturnPath\(state\.ret\)/, 'the path is re-validated at the callback');
  assert.match(fn, /\$\{ORIGIN\}\$\{withConnectResult\(ret, result\)\}/, 'only the configured HOMATCH origin');
  assert.match(fn, /dialogErrorResult\(dialogError, url\.searchParams\.get\('error_reason'\)\)/);
  assert.match(fn, /update\(\{ oauth_nonce: null \}\)\.eq\('user_id', state\.uid\)\.eq\('oauth_nonce', state\.nonce\)/, 'a cancelled attempt can never be redeemed');
  assert.match(fn, /\.eq\('id', conn\.id\)\.eq\('oauth_nonce', state\.nonce\)\.select\('id'\)/, 'atomic one-use claim');
  const replay = fn.slice(fn.indexOf('callback_replay') - 600, fn.indexOf('callback_replay'));
  assert.doesNotMatch(replay, /exchangeCodeForToken|meta_tokens/, 'a replay writes nothing');
  assert.doesNotMatch(fn, /access_token=|token=\$\{token\}/, 'no token ever travels in a redirect');
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /const ret = safeReturnPath\(body\.returnTo\);/);
});

test('client: one shared flow, same-tab navigation to Meta, one refresh after return, no polling', () => {
  const hook = read('src/components/metaAds/builder/useMetaConnect.ts');
  assert.match(hook, /if \(CONNECT_BUSY\.has\(shared\)\) return null;/, 'one attempt at a time across panels');
  assert.match(hook, /window\.location\.assign\(r\.url\)/, 'same tab — no popup to race');
  assert.doesNotMatch(hook, /setTimeout|setInterval|window\.open\(/, 'no timer fallback, no polling');
  assert.match(hook, /refreshFor !== key/, 'one refresh per return');
  assert.doesNotMatch(hook, /fb:\/\/|fbauth|intent:\/\/|fb-messenger:/, 'no undocumented app scheme');
  const panel = read('src/components/metaAds/builder/AccountPanel.tsx');
  assert.match(panel, /useMetaConnect\(\{ returnTo/);
  assert.match(panel, /aria-busy=\{flow\.busy \|\| undefined\}/);
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /useConnectReturn\(reloadStatus\)/);
  assert.match(page, /&from=\$\{fromStep\}/, 'the step that sent the owner is carried');
  assert.match(read('src/components/metaAds/builder/DestinationStep.tsx'), /step=account&from=destination/);
});

test('browser kind is diagnostic only: Meta in-app, other in-app, browser', () => {
  assert.equal(browserKind('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0]'), 'META_IN_APP');
  assert.equal(browserKind('Mozilla/5.0 (Linux; Android 14; wv) Instagram 300'), 'META_IN_APP');
  assert.equal(browserKind('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/120 Mobile'), 'OTHER_IN_APP');
  assert.equal(browserKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604.1'), 'BROWSER');
});

test('creative AI jobs: customers can read their own rows and write none', () => {
  const m = read('supabase/migrations/20261007100000_meta_creative_ai_jobs_grants.sql');
  assert.match(m, /revoke insert, update, delete, truncate, references, trigger on public\.meta_creative_ai_jobs from authenticated/);
  assert.match(m, /grant select on public\.meta_creative_ai_jobs to authenticated/);
});

test('mobile: the builder button grows with its label; summary rows reflow instead of squeezing', () => {
  const btn = read('src/components/metaAds/builder/MetaButton.tsx');
  assert.match(btn, /h-auto min-h-11 whitespace-normal/);
  assert.match(btn, /\[word-break:normal\]/);
  const ui = read('src/components/metaAds/builder/ui.tsx');
  const row = ui.slice(ui.indexOf('export function SummaryRow'));
  assert.match(row, /grid-cols-\[minmax\(0,1fr\)_auto\]/, 'label above; value | edit');
  assert.match(ui, /export function keepWordsWhole/, 'a short joined token is never split');
  assert.doesNotMatch(row, /w-24 shrink-0/, 'no fixed-width label column on a phone');
  const review = read('src/components/metaAds/builder/ReviewStep.tsx');
  assert.doesNotMatch(review, /<dt className="w-24 shrink-0/);
  assert.match(review, /<span className="whitespace-nowrap" dir="ltr">\{`\$\{money\(daily\)\} × /, '$5.00 × 7 stays together');
  for (const f of ['ReviewStep', 'LeadFormBuilder', 'CreativeStep', 'DestinationStep', 'CreativeAiPanel', 'VideoCreative', 'AccountPanel']) {
    assert.doesNotMatch(read(`src/components/metaAds/builder/${f}.tsx`), /from '@\/components\/ui\/button'/, `${f} uses the growing builder button`);
  }
});
