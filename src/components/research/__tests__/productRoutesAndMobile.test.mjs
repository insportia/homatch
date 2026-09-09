import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * ROUTE EXISTENCE + MOBILE LAYOUT.
 *
 * The recovery audit found that the Deal Room and Renovation engines existed
 * and worked, but NO route referenced them and nothing imported them — which
 * is precisely why the features were invisible in production while appearing
 * "done" in the codebase. These tests fail if that regresses.
 *
 * The product has since been consolidated: Renovation is removed, and Deal
 * Room is no longer a destination of its own — it is the Verification Case
 * that opens from the Verification Center at /verify. The assertions below
 * now hold that shape: ONE verification product, with the old /deal-rooms
 * URLs redirecting into it rather than serving a second parallel UI.
 *
 * They read source text rather than rendering React, matching the existing
 * verifyMobileLayout.test.mjs approach: no jsdom in this project, and the
 * properties being asserted (a route exists, a class is not used) are
 * statically true or false.
 */

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const ROUTES = read('src/routes.tsx');
const PAGES = {
  'src/pages/VerifyPage.tsx': read('src/pages/VerifyPage.tsx'),
  'src/pages/VerificationCasePage.tsx': read('src/pages/VerificationCasePage.tsx'),
};
const COMPONENTS = {
  'src/components/dealroom/SynthesisSummary.tsx': read('src/components/dealroom/SynthesisSummary.tsx'),
  'src/components/dealroom/ActionPlanPanel.tsx': read('src/components/dealroom/ActionPlanPanel.tsx'),
  'src/components/dealroom/AskHomatchPanel.tsx': read('src/components/dealroom/AskHomatchPanel.tsx'),
  'src/components/dealroom/DocumentsPanel.tsx': read('src/components/dealroom/DocumentsPanel.tsx'),
  'src/components/dealroom/VerdictBanner.tsx': read('src/components/dealroom/VerdictBanner.tsx'),
  'src/components/research/HumanVerificationHandoff.tsx': read('src/components/research/HumanVerificationHandoff.tsx'),
  'src/components/verify/VerificationCaseList.tsx': read('src/components/verify/VerificationCaseList.tsx'),
  'src/components/verify/StartFromDocument.tsx': read('src/components/verify/StartFromDocument.tsx'),
};

/* ---------------------------------------------------------------- *
 * Routes exist and are wired                                        *
 * ---------------------------------------------------------------- */

test('the verification routes exist and are the canonical ones', () => {
  for (const p of ["path: '/verify'", "path: '/verify/:id'"]) {
    assert.ok(ROUTES.includes(p), `route ${p} is not registered`);
  }
});

test('each new route resolves to a real page component, not a placeholder', () => {
  for (const c of ['VerifyPage', 'VerificationCasePage']) {
    assert.ok(ROUTES.includes(`import ${c} from`), `${c} is not imported`);
    assert.ok(ROUTES.includes(`<${c} />`) || ROUTES.includes(`<${c} />)`), `${c} is not rendered`);
  }
});

test('a verification case is NOT public — it is private due-diligence work', () => {
  const line = ROUTES.split('\n').find((l) => l.includes("path: '/verify/:id'"));
  assert.ok(line && !line.includes('public: true'), 'the case route must require auth');
});

test('verification is reachable from both desktop and mobile navigation', () => {
  assert.ok(read('src/components/layouts/AppHeader.tsx').includes("path: '/verify'"));
  assert.ok(read('src/components/layouts/MobileBottomNav.tsx').includes("path: '/verify'"));
});

test('the mobile bottom bar stays at six items or fewer', () => {
  // Seven items overflow at 320px and the bar must never scroll horizontally.
  const src = read('src/components/layouts/MobileBottomNav.tsx');
  const items = src.slice(src.indexOf('const items = ['), src.indexOf('];', src.indexOf('const items = [')));
  assert.ok(items.split("key: '").length - 1 <= 6, 'too many bottom-nav items for a 320px viewport');
});

/* ---------------------------------------------------------------- *
 * The pages are real, not placeholders                              *
 * ---------------------------------------------------------------- */

test('no new page is a placeholder', () => {
  for (const [file, src] of Object.entries(PAGES)) {
    assert.ok(src.length > 1500, `${file} is too small to be a real page`);
    // `placeholder=` is a real HTML attribute, so match stub PROSE only.
    assert.ok(!/coming soon|not implemented|TODO:|FIXME:|<p>Placeholder/i.test(src),
      `${file} contains placeholder text`);
    assert.ok(src.includes('export default'), `${file} has no default export`);
  }
});

/* ---------------------------------------------------------------- *
 * Mobile layout rules (320 / 360 / 375 / 390 / 430)                 *
 * ---------------------------------------------------------------- */

const ALL = { ...PAGES, ...COMPONENTS };

test('no fixed pixel widths that would overflow a 320px viewport', () => {
  for (const [file, src] of Object.entries(ALL)) {
    const bad = src.match(/\b(?:w|min-w)-\[(\d+)px\]/g) ?? [];
    for (const m of bad) {
      const px = Number(m.match(/(\d+)px/)[1]);
      assert.ok(px <= 320, `${file}: ${m} overflows the narrowest supported viewport`);
    }
  }
});

test('no negative-margin, translate or z-index layout hacks', () => {
  for (const [file, src] of Object.entries(ALL)) {
    // -ml-2 on a ghost button is optical alignment, not a layout hack, so the
    // check targets the patterns that actually break narrow viewports.
    assert.ok(!/-m[trbl]?-(?:1[0-9]|[2-9][0-9])\b/.test(src), `${file}: large negative margin`);
    assert.ok(!/translate-[xy]-\[/.test(src), `${file}: translate hack`);
    assert.ok(!/\bz-\[?\d{3,}/.test(src), `${file}: improbable z-index`);
  }
});

test('long values are allowed to wrap rather than forcing horizontal scroll', () => {
  // Cadastral codes, Georgian company names and file names are all long and
  // unbreakable; without break-words they push the page sideways at 320px.
  for (const file of [
    'src/components/verify/VerificationCaseList.tsx',
    'src/pages/VerificationCasePage.tsx',
    'src/components/dealroom/SynthesisSummary.tsx',
    'src/components/dealroom/DocumentsPanel.tsx',
  ]) {
    assert.ok(ALL[file].includes('break-words'), `${file} does not wrap long values`);
  }
});

test('primary actions are full-width on mobile and inline from sm upward', () => {
  for (const file of [
    'src/components/dealroom/DocumentsPanel.tsx',
    'src/components/research/HumanVerificationHandoff.tsx',
    'src/components/verify/StartFromDocument.tsx',
  ]) {
    assert.ok(/w-full sm:w-auto/.test(ALL[file]), `${file} has no responsive primary action`);
  }
});

test('the verification case tab strip scrolls instead of wrapping to a second row', () => {
  assert.ok(/overflow-x-auto/.test(PAGES['src/pages/VerificationCasePage.tsx']));
});

/* ---------------------------------------------------------------- *
 * Product invariants visible in the UI                              *
 * ---------------------------------------------------------------- */

test('the summary tells the customer that a failed check is not a property defect', () => {
  assert.ok(COMPONENTS['src/components/dealroom/SynthesisSummary.tsx'].includes('dr_unverified_note'));
});

test('the assistant labels ungrounded answers rather than presenting them as facts', () => {
  const src = COMPONENTS['src/components/dealroom/AskHomatchPanel.tsx'];
  assert.ok(src.includes('dr_ask_grounded') && src.includes('dr_ask_general'));
  assert.ok(src.includes('m.grounded.length'), 'the label must be driven by actual grounding');
});

test('the handoff always offers a way out', () => {
  const src = COMPONENTS['src/components/research/HumanVerificationHandoff.tsx'];
  assert.ok(src.includes('handoff_cancel'));
  assert.ok(src.includes('rel="noopener noreferrer"'), 'the official site must not get a window handle');
});

test('the verdict component supports exactly the three permitted values', () => {
  const src = COMPONENTS['src/components/dealroom/VerdictBanner.tsx'];
  for (const v of ['POSITIVE', 'MODERATELY_POSITIVE', 'NEGATIVE']) assert.ok(src.includes(v));
  assert.ok(!/PARTIAL|DEGRADED|UNKNOWN_VERDICT/.test(src), 'coverage is not a verdict');
});

/* ---------------------------------------------------------------- *
 * Renovation is removed from the active product                     *
 * ---------------------------------------------------------------- */

test('no active renovation route, page, navigation entry or service remains', () => {
  for (const p of ['src/pages/RenovationPage.tsx', 'src/pages/admin/AdminPriceBookPage.tsx',
                   'src/services/renovationPricing.ts', 'src/renovation', 'src/components/renovation']) {
    assert.ok(!fs.existsSync(path.join(process.cwd(), p)), `${p} still exists`);
  }
  for (const marker of ["path: '/renovation'", "path: '/admin/pricebook'", 'RenovationPage', 'AdminPriceBookPage']) {
    assert.ok(!ROUTES.includes(marker), `routes.tsx still references ${marker}`);
  }
  for (const nav of ['src/components/layouts/AppHeader.tsx', 'src/components/layouts/MobileBottomNav.tsx']) {
    assert.ok(!/renovation/i.test(read(nav)), `${nav} still offers renovation`);
  }
});

test('no renovation product strings survive in any language bundle', () => {
  const src = read('src/i18n/translations.ts');
  for (const prefix of ['reno_', 'pb_', 'nav_renovation:', 'dr_tab_renovation:']) {
    assert.ok(!src.includes(`  ${prefix}`), `translation key ${prefix}* is still shipped`);
  }
  // The listing CONDITION "needs renovation" describes a property, not the
  // removed product, and is deliberately kept.
  assert.ok(src.includes('prop_condition_needs_renovation'));
});

/* ---------------------------------------------------------------- *
 * ONE product: Deal Room is absorbed, not offered alongside Verify  *
 * ---------------------------------------------------------------- */

test('there is no separate Deal Room destination in the product', () => {
  assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/pages/DealRoomsPage.tsx')),
    'the standalone Deal Rooms list page is back');
  assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/pages/DealRoomPage.tsx')),
    'the standalone Deal Room page is back');
  for (const nav of ['src/components/layouts/AppHeader.tsx', 'src/components/layouts/MobileBottomNav.tsx']) {
    assert.ok(!read(nav).includes("'/deal-rooms'"), `${nav} still offers Deal Room as its own destination`);
  }
});

test('the old /deal-rooms URLs redirect into the case rather than rendering a second UI', () => {
  const lines = ROUTES.split('\n').filter((l) => l.includes("path: '/deal-rooms"));
  assert.equal(lines.length, 2, 'both legacy paths must stay addressable');
  for (const l of lines) {
    assert.ok(l.includes('LegacyDealRoomRedirect'), `legacy path still renders a page: ${l}`);
  }
  const redirect = read('src/pages/LegacyDealRoomRedirect.tsx');
  assert.ok(redirect.includes('/verify/'), 'the redirect does not target the canonical case route');
  assert.ok(redirect.includes('replace'), 'the stale URL must not stay in the history stack');
});

test('no customer-facing string calls a verification a deal room', () => {
  const bundles = read('src/i18n/translations.ts');
  assert.ok(!/Deal Room/i.test(bundles), 'a language bundle still says "Deal Room" to the customer');
  assert.ok(!bundles.includes('nav_deal_rooms'), 'Deal Room is still a navigation entry');
  for (const [file, src] of Object.entries(PAGES)) {
    assert.ok(!/Deal Room/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
      `${file} shows "Deal Room" outside a comment`);
  }
});

test('a completed verification persists itself instead of asking for a second product', () => {
  const src = PAGES['src/pages/VerifyPage.tsx'];
  assert.ok(src.includes('void saveCase('), 'a finished report must save itself');
  assert.ok(src.includes("t('verify_continue_case')"), 'the CTA must continue the verification, not create something new');
  assert.ok(!src.includes("t('verify_create_deal_room')"), 'the create-a-deal-room CTA is back');
});

test('the Verification Center offers both ways in and lists what already exists', () => {
  const src = PAGES['src/pages/VerifyPage.tsx'];
  assert.ok(src.includes('<StartFromDocument/>'), 'contract upload is not offered from the Center');
  assert.ok(src.includes('<VerificationCaseList/>'), 'existing verifications are not listed in the Center');
});
