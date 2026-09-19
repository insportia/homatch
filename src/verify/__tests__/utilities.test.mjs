// UTILITIES AS EVIDENCE, NOT AS TICKS.
//
// For a flat "is there electricity" is nearly rhetorical. For LAND it is the
// question, and the difference between a parcel with a live electricity
// account and one with nothing is most of the development cost. The report
// used to reduce all of it to three states and a grey note.
//
// What is tested here is the part that can go wrong in a way nobody notices:
// a readiness state claimed higher than the evidence supports, an UNKNOWN
// quietly rendered as a NO, or one connection implying another.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeUtilities, readinessFromLegacy, isLandReport,
  strongestFinding, establishedCount, READINESS_ORDER,
} from '../utilities.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const byKind = (fs) => Object.fromEntries(fs.map((f) => [f.kind, f]));

/* ── LAND WITH VERIFIED EVIDENCE ──────────────────────────────────────── */

test('LAND with a live electricity account keeps that as the strong finding it is', () => {
  const report = {
    landProfile: { landCategory: 'agricultural', permittedUse: 'residential' },
    utilitiesMatrix: {
      electricity: { status: 'CONFIRMED_CONNECTED', note: 'Provider lists an active subscription for this address.' },
      water: { status: 'CONFIRMED_NOT_CONNECTED', note: 'No mains connection recorded.' },
      gas: { status: 'NOT_MENTIONED' },
    },
  };
  const f = byKind(normalizeUtilities(report));

  // "Active subscription" is a statement that somebody is supplied TODAY —
  // a stronger claim than a physical connection, and the one a buyer wants.
  assert.equal(f.ELECTRICITY.readiness, 'ACTIVE_OR_SUBSCRIBED');
  assert.equal(f.ELECTRICITY.verified, true);
  // A confirmed absence is a finding, not an unknown.
  assert.equal(f.WATER.readiness, 'NOT_CONNECTED');
  assert.equal(f.WATER.verified, true);
  // And a source that never mentioned gas has told us nothing about gas.
  assert.equal(f.GAS.readiness, 'UNKNOWN');
  assert.equal(f.GAS.verified, false);

  assert.equal(isLandReport(report), true);
  assert.equal(strongestFinding(Object.values(f)).kind, 'ELECTRICITY');
});

test('a connection is not upgraded to a subscription without the source saying so', () => {
  // The exact line between the two states. Both are CONFIRMED_CONNECTED in
  // the legacy vocabulary; only one of them claims a live account.
  assert.equal(readinessFromLegacy('CONFIRMED_CONNECTED', 'Physically connected to the grid.'), 'CONNECTED');
  assert.equal(readinessFromLegacy('CONFIRMED_CONNECTED', 'Active subscription on file.'), 'ACTIVE_OR_SUBSCRIBED');
  // In the languages the sources actually answer in.
  assert.equal(readinessFromLegacy('CONFIRMED_CONNECTED', 'აქტიური აბონენტი'), 'ACTIVE_OR_SUBSCRIBED');
  assert.equal(readinessFromLegacy('CONFIRMED_CONNECTED', 'активный абонент'), 'ACTIVE_OR_SUBSCRIBED');
});

/* ── PARTIAL, AND NONE ────────────────────────────────────────────────── */

test('LAND with partial evidence reports exactly what was established', () => {
  const report = {
    landProfile: { buildabilityNote: 'x' },
    utilitiesMatrix: {
      electricity: { status: 'CONFIRMED_CONNECTED', note: 'Connected.' },
      water: { status: 'NOT_MENTIONED' },
      sewage: { status: 'NOT_MENTIONED' },
      gas: { status: 'NOT_MENTIONED' },
      internet: { status: 'NOT_MENTIONED' },
    },
  };
  const findings = normalizeUtilities(report);
  assert.equal(findings.length, 5);
  assert.equal(establishedCount(findings), 1, 'one of five, and the count says so');
  // The other four are PRESENT and UNKNOWN. Dropping them would render as
  // "not applicable", which is a different and unearned claim.
  assert.equal(findings.filter((f) => f.readiness === 'UNKNOWN').length, 4);
});

test('UTILITY_UNKNOWN_NOT_INVENTED: no evidence yields UNKNOWN and nothing else', () => {
  const report = {
    landProfile: { landCategory: 'agricultural' },
    utilitiesMatrix: {
      electricity: {}, water: {}, sewage: {}, gas: {}, internet: {},
    },
  };
  const findings = normalizeUtilities(report);
  assert.equal(findings.length, 5);
  for (const f of findings) {
    assert.equal(f.readiness, 'UNKNOWN', `${f.kind} must stay unknown`);
    assert.equal(f.verified, false);
    assert.equal(f.provider, null, 'a provider must never be invented');
    assert.deepEqual(f.evidence, []);
  }
  assert.equal(establishedCount(findings), 0);
  // No finding means no headline. A strongest-of-nothing is null, not a
  // cheerful default.
  assert.equal(strongestFinding(findings), null);
});

test('an unrecognised status is UNKNOWN rather than anything more flattering', () => {
  for (const s of ['MAYBE', '', null, undefined, 'PROBABLY_CONNECTED']) {
    assert.equal(readinessFromLegacy(s, 'active subscription'), 'UNKNOWN',
      'a status we cannot read must not borrow confidence from a note');
  }
});

/* ── PROVENANCE ───────────────────────────────────────────────────────── */

test('UTILITY_EVIDENCE_PROVENANCE: provider, linkage, date and source survive', () => {
  const report = {
    utilities: [{
      kind: 'ELECTRICITY',
      readiness: 'ACTIVE_OR_SUBSCRIBED',
      provider: 'Some Regional Utility',
      confirms: 'Active metered account at this cadastral code.',
      linkage: '01.18.06.019.055',
      asOf: '2026-08-14',
      confidence: 'HIGH',
      verified: true,
      evidence: [{ url: 'https://example.gov/x', label: 'Provider account record', asOf: '2026-08-14' }],
    }],
  };
  const [f] = normalizeUtilities(report);
  assert.equal(f.provider, 'Some Regional Utility');
  assert.equal(f.linkage, '01.18.06.019.055');
  assert.equal(f.asOf, '2026-08-14');
  assert.equal(f.confidence, 'HIGH');
  assert.equal(f.verified, true);
  assert.equal(f.evidence[0].url, 'https://example.gov/x');
});

test('the richer shape wins over the legacy one for the same utility', () => {
  // Forward compatibility: when Research Core carries provenance, the report
  // gains it without a UI change, and the two shapes never double up.
  const report = {
    utilitiesMatrix: { electricity: { status: 'NOT_MENTIONED' } },
    utilities: [{ kind: 'ELECTRICITY', readiness: 'CONNECTED', verified: true }],
  };
  const findings = normalizeUtilities(report);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].readiness, 'CONNECTED');
});

test('no provider is hardcoded anywhere in the model', () => {
  const src = read('src', 'verify', 'utilities.ts');
  for (const name of ['TELASI', 'Telasi', 'GWP', 'Socar', 'SOCAR', 'Energo-Pro']) {
    assert.ok(!src.includes(name), `${name} must not be assumed; providers come from evidence`);
  }
});

test('nothing aggregates one utility into a verdict about the site', () => {
  const src = read('src', 'verify', 'utilities.ts');
  assert.ok(!/siteReady|allUtilities|readinessScore|overallReadiness/i.test(src),
    'a single site-readiness verdict would imply one utility speaks for the others');
  // The ladder is ordered, and UNKNOWN is at the bottom of it.
  assert.equal(READINESS_ORDER[0], 'UNKNOWN');
  assert.equal(READINESS_ORDER[READINESS_ORDER.length - 1], 'ACTIVE_OR_SUBSCRIBED');
});

/* ── THE CARD ─────────────────────────────────────────────────────────── */

test('UTILITIES_MOBILE_LAYOUT: the label never shares a row it can be crushed in', () => {
  const src = read('src', 'components', 'verify', 'UtilitiesReadinessCard.tsx');
  // One block per utility, stacked. The name and its status sit in a WRAPPING
  // row, so the status drops to its own line rather than squeezing the name —
  // which is what crushed "ელექტროენერგია" to 65px across three lines.
  assert.match(src, /grid grid-cols-1 gap-3/);
  assert.match(src, /flex flex-wrap items-center gap-x-3 gap-y-2/);
  assert.match(src, /className="min-w-0 break-words font-display/);
  assert.ok(!/items-center justify-between/.test(src),
    'a justify-between row is the shape that crushed the label');

  // And a detail row gives its label a full line below sm, so at 320px there
  // is nothing beside it that could compete for width at all.
  const ui = read('src', 'components', 'verify', 'ui.tsx');
  assert.match(ui, /flex flex-wrap items-baseline gap-x-4 gap-y-1/);
  assert.match(ui, /basis-full break-words text-xs font-medium uppercase/);
  assert.match(ui, /sm:shrink-0/);
});

test('unknown utilities are stated once, not once per utility', () => {
  /*
   * The card read as a list of things Homatch had failed to find: six
   * equal-weight blocks, one finding and five absences. Established findings
   * lead now, and the unknowns are named ONCE, together, in a single quiet
   * line — still present, still truthful, no longer the loudest thing here.
   */
  const src = read('src', 'components', 'verify', 'UtilitiesReadinessCard.tsx');
  assert.match(src, /const established = findings\.filter/);
  assert.match(src, /const unknown = findings\.filter/);
  assert.match(src, /established\.map\(\(f\) => <Established/);
  assert.ok(!/unknown\.map\(\(f\) => <Established/.test(src),
    'an unknown utility must not get a block of its own');
  assert.match(src, /util_unknown_note/);
});

test('ACTIVE_SUBSCRIPTION_SIGNAL_PRESERVED and SEMANTIC_GREEN_PRESERVED', () => {
  const src = read('src', 'components', 'verify', 'UtilitiesReadinessCard.tsx');
  // Green is kept for states positively established ON THE GROUND, and is not
  // recoloured gold for the sake of the palette: gold means emphasis, green
  // means something was actually found.
  assert.match(src, /case 'ACTIVE_OR_SUBSCRIBED':[\s\S]{0,40}?case 'CONNECTED':[\s\S]{0,40}?return 'confirmed'/);
  assert.match(src, /case 'NOT_CONNECTED':[\s\S]{0,40}?return 'risk'/);
  assert.match(src, /default:[\s\S]{0,40}?return 'quiet'/);
  assert.match(src, /util_verified/);

  const ui = read('src', 'components', 'verify', 'ui.tsx');
  assert.match(ui, /confirmed: 'border-emerald-500\/40/);
  assert.match(ui, /risk: 'border-destructive/);
  assert.match(ui, /quiet: 'border-border bg-muted/);
});

test('an unestablished utility is still rendered', () => {
  const src = read('src', 'components', 'verify', 'UtilitiesReadinessCard.tsx');
  // The card returns null only when there is no utilities data at all — never
  // per-utility, which would hide the unknowns.
  assert.match(src, /if \(!findings\.length\) return null;/);
  assert.ok(!/filter\(\(f\) => f\.readiness !== 'UNKNOWN'\)\.map/.test(src));
  assert.match(src, /util_no_inference_note/);
});

/* ── NEXT STEPS, CONTROLS, PALETTE ────────────────────────────────────── */

test('INVESTMENT_CONSULTANT_CTA and MORTGAGE_CONSULTANT_CTA are real buttons', () => {
  const src = read('src', 'components', 'verify', 'NextStepsCard.tsx');
  assert.match(src, /to=\{`\/investment\$\{suffix\}`\}/);
  assert.match(src, /to=\{`\/mortgage\$\{suffix\}`\}/);
  // Buttons, and big ones — not subtle text links. They come from the shared
  // VerifyActionButton now, which is where the sizing rules live; the button
  // standard itself is pinned in verifyCta.test.mjs.
  assert.equal((src.match(/<VerifyActionButton/g) ?? []).length, 2);
  assert.match(src, /verify_next_investment/);
  assert.match(src, /verify_next_mortgage/);

  // The routes they point at exist and are the existing products.
  const routes = read('src', 'routes.tsx');
  assert.match(routes, /path: '\/investment'/);
  assert.match(routes, /path: '\/mortgage'/);

  // And the card is actually mounted at the end of a finished report.
  const page = read('src', 'pages', 'VerifyPage.tsx');
  assert.match(page, /<NextStepsCard cadastralCode=/);
});

test('VERIFY_CONTROLS_REDESIGNED: the stop action is a contained button', () => {
  const src = read('src', 'components', 'verify', 'ResearchStream.tsx');
  const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  // It was `variant="ghost" … className="… px-0"` — text with no padding,
  // no border and no background, which is indistinguishable from a caption.
  assert.ok(!/variant="ghost"[\s\S]{0,200}px-0/.test(code),
    'the borderless zero-padding text action must not come back');
  assert.match(code, /variant="outline"/);
  assert.match(code, /rounded-xl border border-border/);
  // Sized by content now rather than pinned to 36px — see verifyCta.test.mjs.
  assert.match(code, /min-h-11 shrink-0 whitespace-normal border-destructive\/40/);
  // Findable, but not the loudest thing on the screen: outline, not filled.
  assert.ok(!/variant="destructive"/.test(code));
});

test('PRIMARY_PALETTE_BLACK_WHITE_GOLD is scoped to the report', () => {
  const css = read('src', 'index.css');
  const block = css.slice(css.indexOf('.verify-report'), css.indexOf('/* ── DARK'));
  assert.ok(block.length > 0);
  // Cards get a visible border and a white ground inside the report...
  assert.match(css, /\.verify-report \[class\*='rounded-'\]\[class\*='border'\] \{\s*\n\s*background-color: hsl\(var\(--card\)\);/);
  assert.match(css, /border-color: hsl\(0 0% 7% \/ 0\.14\)/);
  // ...gold is a rule, never a text fill on white...
  assert.match(css, /\.verify-report \.premium-rule/);
  // ...and the shared surface tokens are NOT retuned, because
  // :root[data-surface='light'] is also Dashboard, auth and Developer.
  const verifyScoped = (css.match(/\.verify-report/g) ?? []).length;
  assert.ok(verifyScoped >= 6, 'the palette work must be scoped, not global');
});

test('RESEARCH_CORE_REGRESSION: the report reads research output, it does not steer it', () => {
  const src = read('src', 'verify', 'utilities.ts');
  // No fetching, no job starting, no second research engine.
  assert.ok(!/supabase|fetch\(|invoke\(|research-agent/i.test(src),
    'the utilities model must read what research produced, never go and look');
});
