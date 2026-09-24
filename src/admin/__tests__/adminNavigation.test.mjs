// HOMATCH Admin — can a beginner find what they came for.
//
// The redesign's whole claim is discoverability, and discoverability is
// exactly the property that rots quietly: a page gets added, nobody puts
// it in the registry, and it is reachable only by typing its URL. Six
// months later somebody says the Admin is confusing again.
//
// So the registry is checked against the router in both directions.
// Every admin route must be reachable from the navigation or be a
// deliberate, named exception; every navigation destination must be a
// real route. Neither list is allowed to drift.
//
// WHAT THESE DO NOT TEST
//
// Whether the pages look right, and whether the voice actually saves.
// The first is tests/mobile/adminScreens.test.mjs, which opens them in a
// browser at seven widths; the second is adminVoiceSetting.test.mjs,
// which has traced that setting from the box to the edge function since
// before this redesign existed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

const NAV = read('src/admin/navigation.ts');
const ROUTES = read('src/routes.tsx');
const LAYOUT = read('src/components/layouts/AdminLayout.tsx');
const I18N = read('src/i18n/translations.ts');

/** Every `path: '/admin...'` the router declares. */
function routePaths() {
  return [...ROUTES.matchAll(/path: '(\/admin[^']*)'/g)].map((m) => m[1]);
}

/** Every destination path in the registry. */
function navPaths() {
  return [...NAV.matchAll(/path: '(\/admin[^']*)'/g)].map((m) => m[1]);
}

/** Every redirect the registry declares, as [from, to]. */
function redirects() {
  const block = NAV.slice(NAV.indexOf('ADMIN_REDIRECTS'), NAV.indexOf('export function groupForPath'));
  return [...block.matchAll(/'(\/admin[^']*)':\s*'(\/admin[^']*)'/g)].map((m) => [m[1], m[2]]);
}

/*
 * Routes that are deliberately not in the sidebar.
 *
 * Each one is a destination somebody arrives at rather than browses to,
 * and each is named here so that "it is missing from the navigation"
 * cannot be the accident it was for /admin/risk before this.
 */
const NOT_IN_SIDEBAR = new Set([
  /* Reached from the control centre, from Usage & cost and from the
     sidebar's Overview group under its own name. */
  '/admin/metrics',
  /* The communication sub-pages ARE in the sidebar; these are the old
     URLs kept alive as redirects. */
  ...[
    '/admin/voice-ai', '/admin/overview', '/admin/comms', '/admin/communications',
    '/admin/ai', '/admin/voice', '/admin/email', '/admin/whatsapp', '/admin/call-center',
  ],
]);

test('every admin route is reachable from the navigation', () => {
  const nav = new Set(navPaths());
  const redirectFrom = new Set(redirects().map(([from]) => from));
  const orphans = routePaths().filter((p) => (
    !nav.has(p) && !redirectFrom.has(p) && !NOT_IN_SIDEBAR.has(p)
  ));
  assert.deepEqual(orphans, [], `admin route(s) nothing links to:\n  ${orphans.join('\n  ')}`);
});

test('every navigation destination is a real route', () => {
  const routes = new Set(routePaths());
  const dead = navPaths().filter((p) => !routes.has(p));
  assert.deepEqual(dead, [], `navigation points at path(s) with no route:\n  ${dead.join('\n  ')}`);
});

test('every redirect lands on a route that exists', () => {
  const routes = new Set(routePaths());
  const broken = redirects().filter(([, to]) => !routes.has(to));
  assert.deepEqual(broken, [], `redirect(s) to nowhere:\n  ${broken.map((r) => r.join(' -> ')).join('\n  ')}`);
});

test('the old Voice AI bookmark still resolves', () => {
  /*
   * /admin/voice-ai was a top-level sidebar entry for months. Somebody
   * has it bookmarked, and a 404 is not an acceptable answer to a link
   * that used to work.
   */
  assert.ok(redirects().some(([from, to]) => from === '/admin/voice-ai' && to.startsWith('/admin/communication')));
  assert.match(ROUTES, /path: '\/admin\/voice-ai',\s*element: <Navigate to="\/admin\/communication\/advanced" replace \/>/);
});

test('the sidebar is dramatically shorter than it was', () => {
  /*
   * It used to be twenty-six sibling links in one column. The number
   * that matters is the TOP level: how many things a reader has to
   * choose between before they have found anything.
   */
  const groups = [...NAV.matchAll(/^  \{\n    id: '/gm)].length;
  assert.ok(groups >= 5 && groups <= 8, `${groups} top-level groups; the target was six to eight`);
  assert.ok(LAYOUT.includes('ADMIN_GROUPS'), 'the layout is not rendering the registry');
  /* And the flat list is genuinely gone, not merely unused. */
  assert.ok(!/const NAV = \[/.test(LAYOUT), 'the old flat NAV array is still in the layout');
});

test('nothing that used to be in the sidebar became unreachable', () => {
  /*
   * The twenty-six destinations the flat sidebar carried, listed as they
   * were. Regrouping is allowed; losing one is not.
   */
  const BEFORE = [
    '/admin', '/admin/users', '/admin/user360', '/admin/properties', '/admin/campaigns',
    '/admin/outreach', '/admin/markets', '/admin/sources', '/admin/signals', '/admin/matches',
    '/admin/credits', '/admin/payments', '/admin/finance', '/admin/live-chat-reports',
    '/admin/providers', '/admin/voice-ai', '/admin/verify-cogs', '/admin/pricing',
    '/admin/spend-caps', '/admin/diagnostics', '/admin/sponsored', '/admin/settings',
    '/admin/health', '/admin/storage', '/admin/site-studio', '/admin/app-content',
    '/admin/engagement',
  ];
  const nav = new Set(navPaths());
  const redirectFrom = new Map(redirects());
  const lost = BEFORE.filter((p) => !nav.has(p) && !(redirectFrom.has(p) && nav.has(redirectFrom.get(p))));
  assert.deepEqual(lost, [], `destination(s) that left the product:\n  ${lost.join('\n  ')}`);
});

test('the AI TALK voice is two clicks from the sidebar', () => {
  /*
   * The task the whole redesign was measured against. It must be a
   * destination in the communication group, not a panel inside a page.
   */
  const comms = NAV.slice(NAV.indexOf("id: 'comms'"), NAV.indexOf("id: 'money'"));
  assert.match(comms, /path: '\/admin\/communication\/voice'/);
  assert.match(comms, /labelKey: 'admin_nav_voice'/);
});

test('provider jargon finds the page without appearing in the navigation', () => {
  /*
   * Knowing the word must not be REQUIRED; knowing it must still WORK.
   * "Cartesia" is nowhere in a label and must still reach Voice.
   */
  for (const [word, path] of [
    ['cartesia', '/admin/communication/voice'],
    ['tts', '/admin/communication/voice'],
    ['vapi', '/admin/communication/call-center'],
    ['resend', '/admin/communication/email'],
    ['meta', '/admin/communication/whatsapp'],
    ['stt', '/admin/communication/advanced'],
  ]) {
    const entry = NAV.slice(NAV.indexOf(`path: '${path}'`));
    const keywords = entry.slice(0, entry.indexOf('},'));
    assert.ok(keywords.includes(`'${word}'`), `searching "${word}" would not reach ${path}`);
  }
  /* And none of those words is a navigation LABEL. */
  for (const key of ['admin_nav_voice', 'admin_nav_call_center', 'admin_nav_email', 'admin_nav_whatsapp']) {
    const line = I18N.match(new RegExp(`^  ${key}: '(.*)',$`, 'm'));
    assert.ok(line, `${key} has no English value`);
    assert.doesNotMatch(line[1], /cartesia|vapi|resend|tts|stt/i, `${key} exposes provider jargon`);
  }
});

test('every navigation label exists in all six languages', () => {
  const keys = [...NAV.matchAll(/labelKey: '([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 25, `only ${keys.length} labels found`);
  const missing = [];
  for (const key of [...new Set(keys)]) {
    const rows = I18N.match(new RegExp(`^  ${key}: ['"]`, 'gm')) ?? [];
    if (rows.length !== 6) missing.push(`${key} (${rows.length}/6)`);
  }
  assert.deepEqual(missing, [], `navigation label(s) not in six languages:\n  ${missing.join('\n  ')}`);
});

test('the admin shell still refuses a non-admin', () => {
  /*
   * The redesign moved every page. None of it may weaken the gate, and
   * hiding a link is not a gate: the layout redirects, and each route is
   * declared adminOnly so the router refuses it too.
   */
  assert.match(LAYOUT, /if \(!loading && !homatchUser\?\.is_admin\) navigate\('\/dashboard'/);
  assert.match(LAYOUT, /if \(loading \|\| !homatchUser\?\.is_admin\) return null;/);
  /* One line per route in this file, so a route and its guard are on the
     same line and can be read together. */
  const lines = ROUTES.split('\n').filter((l) => /path: '\/admin/.test(l));
  assert.ok(lines.length > 30, `the admin route block did not parse (${lines.length} lines)`);
  const unguarded = lines
    .filter((l) => !l.includes('adminOnly: true'))
    .map((l) => (l.match(/path: '(\/admin[^']*)'/) ?? [])[1] ?? l.trim());
  assert.deepEqual(unguarded, [], `admin route(s) not declared adminOnly:\n  ${unguarded.join('\n  ')}`);
});

test('no secret value is rendered anywhere in the new admin', () => {
  /*
   * The status pages show credentials as a name and a boolean, which is
   * what comm-provider-status returns. Nothing may render a value, and
   * nothing may reach for one.
   */
  for (const f of [
    'src/pages/admin/communication/status.tsx',
    'src/pages/admin/communication/CommunicationEmailPage.tsx',
    'src/pages/admin/communication/CommunicationWhatsAppPage.tsx',
    'src/pages/admin/AdminHomePage.tsx',
  ]) {
    const body = read(f);
    /*
     * A credential NAME is fine and is the point — the reader has to be
     * told that RESEND_API_KEY is the thing to set. What must never
     * appear is a read of its VALUE, so the check is on the access and
     * not on the word. `credentials` carries `{ name, present }` and
     * these pages may only ever touch those two.
     */
    assert.doesNotMatch(body, /\.secret\b|secretValue|credentialValue/i, `${f} reaches for a secret value`);
  }

  /*
   * And in the one file that actually renders a credential, the only two
   * fields it may reach for. Scoped to `credentials.` on purpose: a
   * blanket search for `c.something` also catches the spend-cap rows on
   * the home page, which are a different `c` entirely.
   */
  const STATUS = read('src/pages/admin/communication/status.tsx');
  for (const chunk of [...STATUS.matchAll(/credentials[\s\S]{0,400}?\)\)/g)].map((m) => m[0])) {
    const fields = [...chunk.matchAll(/\bc\.([a-zA-Z]+)/g)].map((m) => m[1]);
    const illegal = [...new Set(fields)].filter((u) => !['name', 'present'].includes(u));
    assert.deepEqual(illegal, [], `a credential field other than name/present is used: ${illegal.join(', ')}`);
  }
});

test("the provider's own sentence is marked LTR wherever it is shown", () => {
  /*
   * comm-provider-status writes in English and names environment
   * variables inside the sentence. Rendered into an RTL page without a
   * direction of its own, the bidi algorithm takes that sentence's full
   * stop for the surrounding paragraph's own and throws it to the far
   * end: Arabic /admin at 390px read ".never reach the inbox".
   *
   * So every element that renders a provider `detail` must carry a
   * direction, and our OWN translated sentences must not -- those take
   * the page's.
   */
  const HOME = read('src/pages/admin/AdminHomePage.tsx');
  assert.match(HOME, /<p dir=\{detailDir\}/, 'the status row renders a provider sentence without a direction');
  assert.match(HOME, /<p dir="ltr"[^>]*>\{a\.detail\}/, 'the attention list renders a provider sentence without a direction');

  for (const [file, marker] of [
    ['src/pages/admin/communication/CommunicationEmailPage.tsx', '{resend.detail}'],
    ['src/pages/admin/communication/CommunicationWhatsAppPage.tsx', '{meta.detail}'],
    ['src/pages/admin/communication/CommunicationCallCenterPage.tsx', '{vapi.detail}'],
  ]) {
    const body = read(file);
    const at = body.indexOf(marker);
    assert.ok(at > 0, `${file} no longer shows the provider sentence`);
    /* The direction belongs to the element that holds the sentence, so
       look back only as far as its own opening tag. */
    const tag = body.slice(body.lastIndexOf('<p', at), at);
    assert.ok(tag.includes('dir="ltr"'), `${file} renders the provider sentence without a direction`);
  }

  /* And the translated fallback is deliberately NOT marked: on the voice
     row the sentence is ours when the probe did not answer, and theirs
     when it did. */
  assert.match(
    HOME,
    /detailDir: providers === null \? undefined : 'ltr' as const,/,
    'the translated Unknown explanation is being forced to LTR',
  );
});
