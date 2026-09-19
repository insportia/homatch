// THE GUEST HEADER THAT FLASHED ON EVERY REFRESH.
//
// An authenticated customer, refreshing on a phone, was shown HOMATCH /
// language / Login / Register — and then, a moment later, their real header.
// They had not been signed out. supabase-js restores the session from storage
// asynchronously, so for the first frames `session` is null, and every
// consumer asking `session ? authed : guest` answered "guest" about a
// question that had no answer yet.
//
// What is tested here is the shape of the answer: three states, and the rule
// that decides between them without a timer and without ever claiming
// somebody is signed in before it is known.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveAuthStatus, hasPersistedSession, isAuthUnresolved } from '../authStatus.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
/** Source with comments stripped: a rule must not be satisfied by prose. */
const code = (...p) => read(...p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** A Storage stand-in, because node has no localStorage. */
const storage = (entries) => {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (k in entries ? entries[k] : null),
  };
};

/* ── THE THREE STATES ─────────────────────────────────────────────────── */

test('UNKNOWN is never collapsed into UNAUTHENTICATED', () => {
  // The exact moment the bug lived in: restoration in flight, a token on the
  // device, no session in hand yet.
  assert.equal(
    deriveAuthStatus({ loading: true, session: null, persisted: true }),
    'UNKNOWN',
  );
  assert.equal(isAuthUnresolved('UNKNOWN'), true);
  assert.equal(isAuthUnresolved('UNAUTHENTICATED'), false);
});

test('a visitor with nothing to restore is a guest immediately, not a wait', () => {
  // No token means there is nothing to wait FOR. Making a real guest sit
  // behind a skeleton would fix the flash by making everyone slower.
  assert.equal(
    deriveAuthStatus({ loading: true, session: null, persisted: false }),
    'UNAUTHENTICATED',
  );
});

test('a resolved session is authenticated, a resolved absence is a guest', () => {
  assert.equal(deriveAuthStatus({ loading: false, session: { user: {} }, persisted: true }), 'AUTHENTICATED');
  assert.equal(deriveAuthStatus({ loading: false, session: null, persisted: true }), 'UNAUTHENTICATED');
  // An expired or tampered token resolves to no session, and that answer is
  // taken from supabase-js rather than guessed from the token's presence.
  assert.equal(deriveAuthStatus({ loading: false, session: null, persisted: true }), 'UNAUTHENTICATED');
});

test('a session already in hand needs no further wait', () => {
  assert.equal(deriveAuthStatus({ loading: true, session: { user: {} }, persisted: true }), 'AUTHENTICATED');
});

/* ── WHAT IS KNOWABLE SYNCHRONOUSLY ──────────────────────────────────── */

test('a persisted session is recognised whatever the project ref is', () => {
  assert.equal(hasPersistedSession(storage({ 'sb-abcdef-auth-token': '{"access_token":"x"}' })), true);
  assert.equal(hasPersistedSession(storage({ 'sb-other-project-auth-token': '{"access_token":"y"}' })), true);
});

test('leftovers from a sign-out are not a session', () => {
  // A cleared key is what a sign-out leaves behind. Reading it as a session
  // would put a signed-out visitor behind a skeleton for ever.
  for (const v of ['', 'null', '{}', ' ']) {
    assert.equal(hasPersistedSession(storage({ 'sb-x-auth-token': v })), false, JSON.stringify(v));
  }
  assert.equal(hasPersistedSession(storage({})), false);
  assert.equal(hasPersistedSession(storage({ 'some-other-key': 'value' })), false);
});

test('a browser that refuses storage is treated as a guest, not crashed into', () => {
  const hostile = { get length() { throw new Error('denied'); }, key: () => null, getItem: () => null };
  assert.equal(hasPersistedSession(hostile), false);
  assert.equal(hasPersistedSession(null), false);
});

/* ── NO TIMERS ────────────────────────────────────────────────────────── */

test('AUTH_HYDRATION_USES_TIMEOUT_HACK = NO', () => {
  const src = code('src', 'auth', 'authStatus.ts');
  for (const banned of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'Date.now()']) {
    assert.ok(!src.includes(banned), `${banned} has no business deciding who is signed in`);
  }
  // And the layout's hydrating branch is a render, not a delay.
  const layout = code('src', 'components', 'layouts', 'AppLayout.tsx');
  const branch = layout.slice(layout.indexOf("if (status === 'UNKNOWN')"), layout.indexOf("if (status === 'AUTHENTICATED')"));
  assert.ok(branch.length > 0, 'the hydrating branch must exist');
  assert.ok(!/setTimeout|useEffect/.test(branch), 'the neutral shell must not be timed');
});

/* ── THE CONSUMERS ────────────────────────────────────────────────────── */

test('the layout has three branches, and the unknown one commits to nothing', () => {
  const src = code('src', 'components', 'layouts', 'AppLayout.tsx');
  assert.match(src, /const \{ session, status \} = useAuth\(\)/);
  assert.match(src, /if \(status === 'UNKNOWN'\)/);
  assert.match(src, /if \(status === 'AUTHENTICATED'\)/);
  // It must not branch the shell on `session` any more — that is the bug.
  assert.ok(!/^\s*if \(session\) \{/m.test(src), 'the shell must not be chosen by session alone');

  const branch = src.slice(src.indexOf("if (status === 'UNKNOWN')"), src.indexOf("if (status === 'AUTHENTICATED')"));
  // Neither navigation is rendered while the answer is unknown.
  assert.ok(!/AppHeader|HomatchShell/.test(branch), 'the neutral shell must render neither navigation');
  // And it holds the same geometry, so nothing moves when the answer lands.
  assert.match(branch, /h-16 items-center/);
  assert.match(branch, /md:h-20/);
  assert.match(branch, /lg:ps-\[18rem\]/);
});

test('GENUINE_GUEST_LOGIN_UI_PRESERVED = YES', () => {
  // The guest branch is still reached — for people who really are guests.
  const layout = code('src', 'components', 'layouts', 'AppLayout.tsx');
  assert.match(layout, /<AppHeader \/>/);

  const header = code('src', 'components', 'home', 'PublicHeader.tsx');
  assert.match(header, /nav_login/);
  assert.match(header, /nav_signup/);
  // But only once the answer is known.
  assert.match(header, /const authResolved = status !== 'UNKNOWN'/);
  assert.match(header, /\{authResolved && status === 'UNAUTHENTICATED' && \(/);
  assert.ok(!/\{!session && \(/.test(header), 'the two-state guard must not come back');
  assert.match(header, /\) : !authResolved \? \(/);
});

test('AuthContext publishes the status rather than leaving it to be derived', () => {
  const src = code('src', 'contexts', 'AuthContext.tsx');
  assert.match(src, /status: AuthStatus;/);
  assert.match(src, /const \[persistedAtStartup\] = useState\(\(\) => hasPersistedSession\(\)\)/);
  assert.match(src, /deriveAuthStatus\(\{ loading, session, persisted: persistedAtStartup \}\)/);
  // Sampled once. Re-reading after a sign-out would turn an ordinary
  // signed-out state back into "still hydrating".
  assert.equal((src.match(/hasPersistedSession\(\)/g) ?? []).length, 1);
});
