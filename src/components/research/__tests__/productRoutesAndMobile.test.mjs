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
 * They read source text rather than rendering React, matching the existing
 * verifyMobileLayout.test.mjs approach: no jsdom in this project, and the
 * properties being asserted (a route exists, a class is not used) are
 * statically true or false.
 */

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const ROUTES = read('src/routes.tsx');
const PAGES = {
  'src/pages/DealRoomsPage.tsx': read('src/pages/DealRoomsPage.tsx'),
  'src/pages/DealRoomPage.tsx': read('src/pages/DealRoomPage.tsx'),
  'src/pages/RenovationPage.tsx': read('src/pages/RenovationPage.tsx'),
  'src/pages/admin/AdminPriceBookPage.tsx': read('src/pages/admin/AdminPriceBookPage.tsx'),
};
const COMPONENTS = {
  'src/components/dealroom/SynthesisSummary.tsx': read('src/components/dealroom/SynthesisSummary.tsx'),
  'src/components/dealroom/ActionPlanPanel.tsx': read('src/components/dealroom/ActionPlanPanel.tsx'),
  'src/components/dealroom/AskHomatchPanel.tsx': read('src/components/dealroom/AskHomatchPanel.tsx'),
  'src/components/dealroom/DocumentsPanel.tsx': read('src/components/dealroom/DocumentsPanel.tsx'),
  'src/components/dealroom/VerdictBanner.tsx': read('src/components/dealroom/VerdictBanner.tsx'),
  'src/components/research/HumanVerificationHandoff.tsx': read('src/components/research/HumanVerificationHandoff.tsx'),
};

/* ---------------------------------------------------------------- *
 * Routes exist and are wired                                        *
 * ---------------------------------------------------------------- */

test('the product routes the recovery audit found missing now exist', () => {
  for (const p of ["path: '/deal-rooms'", "path: '/deal-rooms/:id'", "path: '/renovation'", "path: '/admin/pricebook'"]) {
    assert.ok(ROUTES.includes(p), `route ${p} is not registered`);
  }
});

test('each new route resolves to a real page component, not a placeholder', () => {
  for (const c of ['DealRoomsPage', 'DealRoomPage', 'RenovationPage', 'AdminPriceBookPage']) {
    assert.ok(ROUTES.includes(`import ${c} from`), `${c} is not imported`);
    assert.ok(ROUTES.includes(`<${c} />`) || ROUTES.includes(`<${c} />)`), `${c} is not rendered`);
  }
});

test('the deal room routes are NOT public — a deal room is private work', () => {
  const lines = ROUTES.split('\n').filter((l) => l.includes("path: '/deal-rooms"));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(!l.includes('public: true'), `deal room route must require auth: ${l}`);
});

test('the admin price book is admin-only', () => {
  const line = ROUTES.split('\n').find((l) => l.includes("path: '/admin/pricebook'"));
  assert.ok(line.includes('adminOnly: true'));
});

test('deal rooms appear in both desktop and mobile navigation', () => {
  assert.ok(read('src/components/layouts/AppHeader.tsx').includes("path: '/deal-rooms'"));
  assert.ok(read('src/components/layouts/MobileBottomNav.tsx').includes("path: '/deal-rooms'"));
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
    'src/pages/DealRoomsPage.tsx',
    'src/pages/DealRoomPage.tsx',
    'src/components/dealroom/SynthesisSummary.tsx',
    'src/components/dealroom/DocumentsPanel.tsx',
  ]) {
    assert.ok(ALL[file].includes('break-words'), `${file} does not wrap long values`);
  }
});

test('primary actions are full-width on mobile and inline from sm upward', () => {
  for (const file of [
    'src/pages/RenovationPage.tsx',
    'src/components/dealroom/DocumentsPanel.tsx',
    'src/components/research/HumanVerificationHandoff.tsx',
  ]) {
    assert.ok(/w-full sm:w-auto/.test(ALL[file]), `${file} has no responsive primary action`);
  }
});

test('the deal room tab strip scrolls instead of wrapping to a second row', () => {
  assert.ok(/overflow-x-auto/.test(PAGES['src/pages/DealRoomPage.tsx']));
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

test('the renovation page cannot show a price without verified data', () => {
  const src = PAGES['src/pages/RenovationPage.tsx'];
  assert.ok(src.includes("pricing?.state !== 'PRICED'"), 'estimate must be gated on PRICED');
  assert.ok(src.includes('reno_insufficient_body'), 'the gate must explain itself to the customer');
});
