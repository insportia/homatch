// The product half of anonymous ownership: what the visitor actually gets.
//
// anonymousClaim.test.mjs guards the database guarantees — the token is only
// ever stored as a hash, no role gets new access, every unusable token gives
// the same answer. Those say the mechanism is safe. They say nothing about
// whether it WORKS, and the promise being made here is specific:
//
//   talk to Homatch AI without signing up, then sign in and continue the SAME
//   conversation — not a copy of it, not a fresh thread, with nothing lost.
//
// Each test below is one way that promise silently breaks. They read source
// rather than drive a browser because the failures are structural: a limit
// counted in the wrong place, a conversation id nobody tells the client, a
// claim wired to a single page. A rendering test would pass through all of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const aiFn = () => read('supabase', 'functions', 'homatch-ai', 'index.ts');
const mintFn = () => read('supabase', 'functions', 'anon-session', 'index.ts');
const service = () => read('src', 'services', 'anonymousSession.ts');
const hook = () => read('src', 'hooks', 'useAIChat.ts');
const page = () => read('src', 'pages', 'AIPage.tsx');
const auth = () => read('src', 'contexts', 'AuthContext.tsx');

/* ── the secret ──────────────────────────────────────────────────────── */

test('the token is minted from a CSPRNG, not from anything guessable', () => {
  const src = mintFn();
  assert.ok(/crypto\.getRandomValues/.test(src), 'the token is not cryptographically random');
  // Matched as a CALL, not as a word: the file explains in prose why
  // Math.random is unusable here, and that comment is not the vulnerability.
  assert.ok(!/Math\.random\(/.test(src), 'Math.random is used to mint a security token');
});

test('the server stores the hash, not the token', () => {
  assert.ok(/token_sha256:/.test(mintFn()), 'the token is not stored as a hash');
});

test('minting is rate limited, so the table cannot be filled for free', () => {
  assert.ok(/MINTS_PER_IP_PER_DAY/.test(mintFn()), 'anyone can mint unlimited sessions');
});

test('the token never travels in a URL', () => {
  // research_jobs.id already appears in URLs; the token is what makes knowing
  // an id insufficient, so putting it in one would undo the whole design.
  const src = service();
  assert.ok(!/token=/.test(src), 'the anonymous token is placed in a query string');
  assert.ok(/body: JSON\.stringify/.test(src), 'the mint request does not use a request body');
});

test('every localStorage access is guarded, because private browsing throws', () => {
  // An anonymous visitor is exactly the kind of person with site data blocked.
  // localStorage THROWS there rather than returning null, so an unguarded read
  // takes down the page for precisely the audience this feature is for.
  const src = service();
  const accesses = src.match(/localStorage\.\w+\(/g) ?? [];
  assert.ok(accesses.length >= 3, 'expected reads, writes and a clear');
  const guarded = src.match(/try \{[\s\S]{0,200}?localStorage\.\w+\(/g) ?? [];
  assert.equal(guarded.length, accesses.length, 'a localStorage access is not inside try/catch');
});

/* ── the limit is the server's ───────────────────────────────────────── */

test('the message limit is counted in the database, not in the browser', () => {
  // A counter the client owns is not a limit, and this one exists because
  // every anonymous turn spends real model money.
  assert.ok(/ANON_USER_MESSAGE_LIMIT/.test(aiFn()), 'the server does not know the limit');
  assert.ok(/anonymous_sessions[\s\S]{0,200}user_messages/.test(aiFn()),
    'the count is not persisted server-side');
  assert.ok(!/ANON_USER_MESSAGE_LIMIT|anonMessageCount/.test(hook()),
    'the browser counts the anonymous messages itself');
});

test('the count rises only after a turn actually succeeded', () => {
  // A provider failure must not burn one of the two.
  const src = aiFn();
  const iSend = src.indexOf("fetch('https://api.openai.com");
  const iCount = src.indexOf('user_messages: anonSession.user_messages + 1');
  assert.ok(iSend > 0 && iCount > iSend, 'the anonymous turn is counted before the answer exists');
});

test('the gate appears only when the server says so', () => {
  assert.ok(/if \(!session && anonLimitReached\)/.test(page()),
    'the sign-up gate is not driven by the server refusal');
  assert.ok(/ANON_LIMIT_REACHED/.test(hook()), 'the hook does not recognise the refusal');
});

test('hitting the limit is not presented as an error', () => {
  // The next step is signing in, which keeps everything already written.
  const src = hook();
  const i = src.indexOf("data?.code === 'ANON_LIMIT_REACHED'");
  assert.ok(i > 0, 'the refusal is not recognised');
  const block = src.slice(i, i + 500);
  assert.ok(/return;/.test(block), 'the refusal falls through to the generic error path');
  assert.ok(!/toast\.error/.test(block), 'the visitor is shown an error for reaching the limit');
});

/* ── an anonymous caller is not a user with no id ────────────────────── */

test('an anonymous caller receives no Homatch internal data', () => {
  // "no user" must never be read as "every user": the internal block is
  // scoped by uid, and an anonymous caller has none.
  const src = aiFn();
  const i = src.indexOf('const internal: any = { properties: [], matches: [], intents: [] };');
  assert.ok(i > 0, 'the internal data block moved');
  assert.ok(/^\s*if \(uid\) \{/m.test(src.slice(i, i + 300)),
    'the internal data lookup is not gated on an account');
});

test('a lead row is never written for someone without an account', () => {
  // ai_chat_leads.user_id is NOT NULL, so this would fail silently anyway —
  // and an unverified anonymous claim has no business in the CRM.
  assert.ok(/if \(uid && shouldCaptureLead\(lead\)\)/.test(aiFn()),
    'lead capture is attempted for anonymous visitors');
});

test('a conversation is scoped by its owner, so knowing its id is not enough', () => {
  const src = aiFn();
  assert.ok(/\.eq\('anon_session_id', anonSession\.id\)/.test(src),
    'an anonymous conversation is not scoped to its session');
  assert.ok(/\.eq\('user_id', user!\.id\)/.test(src),
    'an account conversation is not scoped to its owner');
});

test('a claimed or expired session can no longer be used to talk', () => {
  const src = aiFn();
  const i = src.indexOf('async function anonSessionFor');
  const fn = src.slice(i, i + 900);
  // "Claimed" and "expired" are decided in one shared place now — exercised
  // directly in anonymousVerify.test.mjs — so what matters here is that this
  // endpoint asks it rather than restating it in its own words.
  assert.ok(/return anonSessionUsable\(data\) \? data : null;/.test(fn),
    'this endpoint judges a session by its own rule');
  assert.ok(/if \(!anonTokenPlausible\(token\)\) return null;/.test(fn),
    'a token of any shape is looked up');
});

/* ── the thread must not split ───────────────────────────────────────── */

test('the server tells the client which conversation it opened', () => {
  // The anonymous visitor cannot create one, so only the server knows its id.
  // Without returning it, message two opens a SECOND conversation and the
  // thread quietly splits in half.
  assert.ok(/return json\(\{\n\s*text,\n\s*conversationId,/.test(aiFn()),
    'the conversation id is not returned to the client');
  assert.ok(/onMeta:/.test(hook()), 'the client never reads it');
  assert.ok(/if \(typeof id === 'string' && id && !convId\)/.test(hook()),
    'the client adopts a server-sent conversation id unconditionally');
});

test('the client does not try to create a conversation it has no access to', () => {
  assert.ok(/if \(!convId && accessToken\) \{/.test(hook()),
    'an anonymous visitor still attempts a client-side conversation insert');
});

test('an anonymous conversation is named by the server', () => {
  // The browser titles its own conversation from the first message; an
  // anonymous one cannot, so it would land in History as "Homatch AI".
  assert.ok(/anonSession && anonSession\.user_messages === 0 && conversationId && last/.test(aiFn()),
    'an anonymous conversation keeps a placeholder title after being claimed');
});

/* ── signing in ──────────────────────────────────────────────────────── */

test('the claim runs on every route into an account, not on one page', () => {
  // Email, Google, a restored session in a second tab: all of them land in
  // onAuthStateChange, and a visitor who signed up from anywhere keeps their
  // work.
  const src = auth();
  const i = src.indexOf('onAuthStateChange');
  assert.ok(i > 0, 'the auth state listener moved');
  const listener = src.slice(i, src.indexOf('listener.subscription.unsubscribe'));
  assert.ok(/claimAnonymousWork\(\)/.test(listener),
    'the claim is not wired to the auth state change');
  assert.ok(/if \(s\?\.user\) \{[\s\S]*claimAnonymousWork/.test(listener),
    'the claim runs when there is no account to give the work to');
});

test('signing in never waits on the claim, and never fails because of it', () => {
  const src = auth();
  assert.ok(/void claimAnonymousWork\(\)/.test(src), 'the claim blocks the sign-in');
  assert.ok(/\.catch\(\(\) => \{/.test(src), 'a failed claim can break signing in');
});

test('a spent token is cleared in every terminal case', () => {
  // Keeping one means retrying an impossible claim on every future sign-in.
  const src = service();
  const i = src.indexOf('export async function claimAnonymousWork');
  const fn = src.slice(i);
  const clears = fn.match(/clearAnonymousSession\(\);/g) ?? [];
  assert.ok(clears.length >= 2, 'the token survives a refused claim');
  assert.ok(/if \(error\) \{[\s\S]{0,300}clearAnonymousSession/.test(fn),
    'a refused claim leaves the token in place');
});

test('a repeat claim is reported as success', () => {
  // The ordinary case is a browser refresh during the sign-in round trip.
  assert.ok(/already: data\?\.already === true/.test(service()),
    'the client cannot tell a repeat claim from a fresh one');
});

test('the claimed conversation stays open rather than restarting', () => {
  // activeConvId already points at the row; only the sidebar was listed while
  // this visitor owned nothing. Reloading MESSAGES here would be the bug —
  // it is the same thread, already on screen.
  const src = hook();
  const i = src.indexOf("'homatch:anon-claimed'");
  assert.ok(i > 0, 'nothing reacts to a claim');
  // Bounded to the listener itself: neighbouring code legitimately resets
  // the chat, and a window wide enough to catch it proves nothing.
  const handler = src.slice(src.lastIndexOf('const onClaimed', i), i);
  assert.ok(/loadConversations\(\)/.test(handler), 'the conversation list stays stale after a claim');
  assert.ok(!/resetChat|setMessages|setActiveConvId|loadConversation\(/.test(handler),
    'the claim disturbs the thread instead of leaving it open');
});
