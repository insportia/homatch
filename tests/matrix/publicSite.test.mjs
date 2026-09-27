/*
 * THE PUBLIC SITE: WHERE EVERY LINK GOES, WHAT THE COPY MAY CLAIM, AND HOW
 * THE MENU BEHAVES.
 *
 * Source-level guards for the 2026-09 public redesign (docs/PUBLIC_ROUTE_MAP.md).
 * They read files rather than render them, so they run in the unit suite on
 * every commit; the rendered checks live in tests/mobile/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_SITE_STRINGS } from '../../scripts/public-site-i18n-data.mjs';

const read = (p) => readFileSync(p, 'utf8');
const ROUTES = read('src/routes.tsx');
const NAV = read('src/site/publicNav.ts');
const HEADER = read('src/components/home/PublicHeader.tsx');
const ENTRY = read('src/site/productEntry.ts');
const REGISTRY = read('src/site/registry.ts');

/** Every route declaration: path -> is it public. */
function routeTable() {
  const table = new Map();
  for (const line of ROUTES.split('\n')) {
    const m = line.match(/path:\s*'([^']+)'/);
    if (!m) continue;
    table.set(m[1], /public:\s*true/.test(line));
  }
  return table;
}
const TABLE = routeTable();

/** An EXACT route match: '/verify/abc' does not count as '/verify'. */
function resolve(path) {
  if (TABLE.has(path)) return { path, public: TABLE.get(path) };
  for (const [route, isPublic] of TABLE) {
    const rs = route.split('/');
    const ps = path.split('/');
    if (rs.length !== ps.length) continue;
    if (rs.every((seg, i) => seg.startsWith(':') || seg === ps[i])) return { path: route, public: isPublic };
  }
  return null;
}

function navTargets(field) {
  return [...NAV.matchAll(new RegExp(`\\b${field}: '(\\/[^']*)'`, 'g'))].map((m) => m[1]);
}

test('public site 1: every public navigation target is a real, PUBLIC route — no prefix fallback', () => {
  const targets = navTargets('target');
  assert.ok(targets.length >= 12, `only ${targets.length} targets found — did the file move?`);
  for (const target of targets) {
    const path = target.split('#')[0] || '/';
    const route = resolve(path);
    assert.ok(route, `${target} is not a route`);
    assert.equal(route.public, true, `${target} is linked for signed-out visitors but is not a public route`);
  }
});

test('public site 2: every signed-in target is a real route', () => {
  const targets = navTargets('signedInTarget');
  assert.deepEqual(targets.sort(), ['/find-property', '/property'].sort());
  for (const target of targets) assert.ok(resolve(target), `${target} is not a route`);
});

test('public site 3: the two products are never an authenticated dead end for a signed-out visitor', () => {
  /*
   * find_property used to open /ai (an anonymous chat that is not Find
   * Property) and find_client /property/add (a login bounce). Neither may
   * come back as the public target.
   */
  const block = (key) => NAV.slice(NAV.indexOf(`key: '${key}'`), NAV.indexOf('}', NAV.indexOf(`key: '${key}'`)));
  assert.match(block('find_property'), /target: '\/for-buyers'/);
  assert.match(block('find_property'), /signedInTarget: '\/find-property'/);
  assert.match(block('find_client'), /target: '\/for-owners'/);
  assert.match(block('find_client'), /signedInTarget: '\/property'/);
  assert.ok(!/target: '\/ai'/.test(NAV) && !/target: '\/property\/add'/.test(NAV),
    'an authenticated path is back as a public navigation target');

  // The entry pages are public; the products behind them are not.
  assert.equal(resolve('/for-buyers')?.public, true);
  assert.equal(resolve('/for-owners')?.public, true);
  assert.equal(resolve('/find-property')?.public, false);
  assert.equal(resolve('/property/add')?.public, false);

  // And the header actually picks between the two by auth state.
  assert.match(HEADER, /signedIn && link\.signedInTarget \? link\.signedInTarget : link\.target/);
});

test('public site 4: sign-up from an entry page comes back to the product, not the dashboard', () => {
  assert.match(ENTRY, /find_property: \{ publicPath: '\/for-buyers', appPath: '\/find-property' \}/);
  assert.match(ENTRY, /find_client: \{ publicPath: '\/for-owners', appPath: '\/property\/add' \}/);
  assert.match(ENTRY, /rememberPendingPath\(then\)/, 'the return path is not remembered across sign-up');
  // Both auth screens consume it before falling back to the dashboard.
  for (const page of ['src/pages/auth/LoginPage.tsx', 'src/pages/auth/SignupPage.tsx']) {
    assert.match(read(page), /takePendingPath\(\)/, `${page} ignores the return path`);
  }
  const entry = read('src/pages/ProductEntryPage.tsx');
  assert.match(entry, /startAuth\('signup', then\)/);
  assert.match(entry, /startAuth\('login', then\)/);
  assert.match(entry, /openProduct\(product\)/, 'a signed-in visitor must be sent to the product, not asked to sign up');
});

test('public site 5: the home launcher no longer sends public tools through sign-up', () => {
  /*
   * ActionLauncherSection had `gated()` send every signed-out click to
   * /auth/signup — including Verify, which is public.
   */
  const launcher = read('src/components/home/sections/ActionLauncherSection.tsx');
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/auth\/signup/.test(code(launcher)), 'the launcher routes to sign-up directly again');
  assert.match(launcher, /to: '\/verify'/);
  const verify = read('src/components/home/sections/VerifyShowcaseSection.tsx');
  assert.ok(!/auth\/signup/.test(code(verify)), 'Verify is public and must not ask for an account');
  const contract = read('src/components/home/sections/ContractIntelligenceSection.tsx');
  assert.match(contract, /gated\('\/contracts'\)/, 'Contracts should go to /contracts, through sign-up when signed out');
});

test('public site 6: PUBLIC_ROUTES lists only routes a visitor with no account can open', () => {
  const block = REGISTRY.slice(REGISTRY.indexOf('export const PUBLIC_ROUTES'), REGISTRY.indexOf('export const SIGNED_IN_ROUTES'));
  const listed = [...block.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 10);
  for (const path of listed) {
    const route = resolve(path);
    assert.ok(route, `${path} is not a route`);
    assert.equal(route.public, true, `${path} is in PUBLIC_ROUTES but is behind the login`);
  }
});

/* ── The copy ─────────────────────────────────────────────────────── */

/** English values of every public-site key, plus the fallbacks the home
    sections render from the registry. */
function homeCopy() {
  const lines = Object.values(PUBLIC_SITE_STRINGS).map((v) => v[0]);
  const translations = read('src/i18n/translations.ts');
  const en = translations.slice(translations.indexOf('const en = {'), translations.indexOf('\n};', translations.indexOf('const en = {')));
  const homeTypes = ['hero', 'action_launcher', 'intelligence_layers', 'verify', 'contract_intelligence',
    'matching', 'mortgage', 'developers', 'closing_cta', 'site_header', 'site_footer'];
  for (const type of homeTypes) {
    const at = REGISTRY.indexOf(`type: '${type}',`);
    const body = REGISTRY.slice(at, REGISTRY.indexOf('media:', at));
    for (const m of body.matchAll(/f\('[a-z0-9_]+', '[a-z0-9_]+', '([a-z0-9_]+)'/g)) {
      const value = en.match(new RegExp(`^\\s{2}${m[1]}: '((?:[^'\\\\]|\\\\.)*)'`, 'm'));
      if (value) lines.push(value[1]);
    }
  }
  return lines;
}

test('public site 7: the home page states no figure Homatch cannot stand behind', () => {
  const copy = homeCopy();
  assert.ok(copy.length > 150, `only ${copy.length} strings collected`);
  const FAKE = [
    [/\b\d[\d,.]*\s*\+?\s*(k\b|thousand|million)?\s*(users|customers|clients|buyers|owners|properties|listings|matches|agents|brokers|deals|partners|reviews)\b/i, 'a count of people or things'],
    [/\b\d+(\.\d+)?\s*%/, 'a percentage'],
    [/\btrusted by\b|\bloved by\b|\baward/i, 'social proof'],
    [/★|\b\d(\.\d)?\s*\/\s*5\b|\brated\b/i, 'a rating'],
    [/\btestimonial|“[^”]+”\s*[—-]\s*[A-Z]/i, 'a testimonial'],
    [/\blive now\b|\bjust (listed|matched|joined)\b|\bright now\b/i, 'live activity'],
    [/\bguarantee/i, 'a guarantee'],
  ];
  const offenders = [];
  for (const line of copy) {
    for (const [pattern, what] of FAKE) if (pattern.test(line)) offenders.push(`${what}: ${line}`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('public site 8: a match is potential interest, never a confirmed buyer', () => {
  for (const [key, [en, ka]] of Object.entries(PUBLIC_SITE_STRINGS)) {
    if (/confirmed (buyer|tenant)/i.test(en)) {
      assert.match(en, /\bnot\b[^.]*confirmed (buyer|tenant)/i, `${key} presents a match as a confirmed buyer`);
    }
    assert.ok(!ka.includes('შესატყვის'), `${key}: a match is დამთხვევა, never შესატყვისი`);
    assert.ok(!/Tbilisi/.test(ka), `${key}: Georgian copy writes თბილისი`);
  }
});

test('public site 9: every public-site string exists in all six bundles, as the data file says', () => {
  const translations = read('src/i18n/translations.ts');
  const langs = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
  for (const lang of langs) {
    const opener = lang === 'en' ? 'const en = {' : `const ${lang}: Partial<Record<TranslationKey, string>> = {`;
    const start = translations.indexOf(opener);
    const body = translations.slice(start, translations.indexOf('\n};', start));
    for (const key of Object.keys(PUBLIC_SITE_STRINGS)) {
      assert.match(body, new RegExp(`^\\s{2}${key}:`, 'm'), `${key} is missing from ${lang} — run scripts/public-site-i18n-apply.mjs`);
    }
  }
});

/* ── The mobile menu ──────────────────────────────────────────────── */

test('public site 10: the mobile menu is a real modal dialog', () => {
  assert.match(HEADER, /role="dialog"/);
  assert.match(HEADER, /aria-modal="true"/);
  assert.match(HEADER, /aria-labelledby=\{titleId\}/);
  // The control that opens it says what it opens and whether it is open.
  assert.match(HEADER, /aria-haspopup="dialog"/);
  assert.match(HEADER, /aria-expanded=\{open\}/);
  assert.match(HEADER, /data-hm-menu-toggle/);
  // Initial focus, Escape, the trap, and focus returned to the toggle.
  assert.match(HEADER, /closeButton\.current\?\.focus\(\)/);
  assert.match(HEADER, /e\.key === 'Escape'/);
  assert.match(HEADER, /e\.key !== 'Tab'/);
  assert.match(HEADER, /toggle\.current\?\.focus\(\)/);
  // The page behind does not scroll, and a tap outside closes it.
  assert.match(HEADER, /doc\.body\.style\.overflow = 'hidden'/);
  assert.match(HEADER, /hm-pub-scrim[\s\S]{0,120}onClick=\{\(\) => onClose\(true\)\}/);
  // Portalled: the header's backdrop blur would otherwise contain it.
  assert.match(HEADER, /createPortal\(/);
});

test('public site 11: the menu respects safe areas, thumbs and both reading directions', () => {
  const css = read('src/index.css');
  const sheet = css.slice(css.indexOf('.hm-pub-sheet {'), css.indexOf('}', css.indexOf('.hm-pub-sheet {')));
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    assert.match(sheet, new RegExp(`env\\(safe-area-inset-${edge}\\)`), `the sheet ignores the ${edge} safe area`);
  }
  // 44px controls: the toggle, the close button, every row.
  assert.match(HEADER, /h-11 w-11/);
  assert.match(css, /\.hm-pub-btn \{[\s\S]*?min-height: 2\.75rem;/);
  // The sheet opens from the END side, which is the left in Arabic and Hebrew.
  assert.match(HEADER, /absolute inset-y-0 end-0/);
  assert.match(css, /\[dir='rtl'\] \.hm-pub-arrow \{\s*transform: scaleX\(-1\);/);
  // Signed out: log in and sign up; signed in: account and dashboard. Never both.
  assert.match(HEADER, /status === 'UNAUTHENTICATED' && \(/);
  assert.match(HEADER, /\{signedIn && \(/);
});

test('public site 12: the public components use logical, direction-safe spacing', () => {
  const files = [
    'src/components/home/PublicHeader.tsx',
    'src/components/home/publicUi.tsx',
    'src/pages/ProductEntryPage.tsx',
    'src/components/home/sections/HeroSection.tsx',
    'src/components/home/sections/ActionLauncherSection.tsx',
    'src/components/home/sections/IntelligenceLayersSection.tsx',
    'src/components/home/sections/MatchingShowcaseSection.tsx',
    'src/components/home/sections/MortgageSection.tsx',
    'src/components/home/sections/DeveloperB2BSection.tsx',
    'src/components/home/sections/ClosingCTASection.tsx',
    'src/components/home/sections/SiteFooter.tsx',
  ];
  const physical = /(?<![\w-])(ml|mr|pl|pr|left|right)-(\d|\[|px|auto)|\btext-(left|right)\b/;
  for (const file of files) {
    const src = read(file);
    const hit = src.split('\n').find((line) => physical.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//'));
    assert.equal(hit, undefined, `${file} uses a physical direction class: ${hit?.trim()}`);
  }
});

test('public site 13: the public scope is its own, not a customer-app scope', () => {
  const home = read('src/pages/HomePage.tsx');
  assert.match(home, /className="hm-public /);
  for (const scope of ['hm-customer', 'hm-owner', 'hm-discovery']) {
    assert.ok(!home.includes(scope), `the home page borrows ${scope}`);
    assert.ok(!HEADER.includes(scope), `the public header borrows ${scope}`);
  }
  assert.match(read('src/index.css'), /\.hm-public \{/);
});

test('public site 14: every header label an admin can rewrite is read under the key Studio stores it', () => {
  /*
   * The header used to read a link's override under its TRANSLATION key
   * (dnav_find_property) while Site Studio stored it under nav_find_property,
   * so a saved rewrite never showed. Field key and registry key are now the
   * same string, for every link.
   */
  const fields = HEADER.slice(HEADER.indexOf('const NAV_FIELDS'), HEADER.indexOf('/** The icons'));
  const keys = [...fields.matchAll(/^\s{2}([a-z_]+): '/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 14);
  assert.match(HEADER, /sf\(`nav_\$\{link\.key\}`, fallback\)/);
  for (const key of keys) {
    assert.ok(REGISTRY.includes(`f('nav_${key}'`), `nav_${key} is read by the header but not offered in Site Studio`);
  }
  for (const cta of ['cta_login', 'cta_signup', 'cta_dashboard', 'nav_more']) {
    assert.ok(HEADER.includes(`sf('${cta}'`), `${cta} is offered in Site Studio but the header ignores it`);
  }
});
