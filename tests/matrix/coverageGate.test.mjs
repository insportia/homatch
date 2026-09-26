// THE GATE THAT DECIDES WHETHER A CAMPAIGN GOES OUTSIDE.
//
// supply-discovery's own header calls campaign-to-campaign reuse "the entire
// economic argument for a discovery network over a per-campaign scraper". That
// reuse was real, and it happened AFTER the fetch: the sweep read eight portals,
// persist() found the rows already present, and `reused` counted them. The money
// was already spent by then.
//
// assessCoverage() asks first. These tests pin the four things that make it
// trustworthy rather than merely present:
//
//   it runs BEFORE any source is read, or it saves nothing
//   an OPERATOR sweep is never gated, or the store stays as thin as it is now
//   a skipped sweep still records what the campaign used, or reuse is unauditable
//   the sweep is narrowed by a separate value, not by editing the envelope
//
// Source-reading, so every assertion anchors on a call site or an identifier,
// never on a phrase from a comment that could be reworded.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(root, 'supabase', 'functions', 'supply-discovery', 'index.ts');
const source = readFileSync(FILE, 'utf8');

/** The file with every comment removed, so no assertion can match prose. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the coverage decision is reached before any adapter is asked for listings', () => {
  const decide = code.indexOf('decideSweep(');
  const runtime = code.indexOf('createPortalRuntime()');
  const loop = code.indexOf('for (const adapter of adapters)');

  assert.ok(decide > 0, 'the gate must exist in the code, not only in a comment');
  assert.ok(runtime > 0 && loop > 0, 'guard: the fetch path is still here');
  assert.ok(
    decide < runtime && decide < loop,
    'a gate that runs after createPortalRuntime() and the adapter loop has saved '
      + 'nothing -- the network calls it exists to avoid have already happened',
  );
});

test('the held-evidence query runs before the registry is even consulted', () => {
  const held = code.indexOf("from('supply_observations')");
  const registry = code.indexOf("from('source_registry')");

  assert.ok(held > 0 && registry > 0);
  assert.ok(
    held < registry,
    'reading what we hold is the cheap question and belongs first',
  );
});

test('the city filter carries every known spelling, never one string', () => {
  assert.match(
    code,
    /\.in\('city', placeNamesFor\(city\)\)/,
    "city = 'Tbilisi' matched 11 of 20 Tbilisi rows in production, because the "
      + "others are written 'tbilisi' and 'თბილისი'",
  );
  assert.doesNotMatch(
    code,
    /\.eq\('city', city\)/,
    'an equality filter on an unnormalised column silently halves the store',
  );
});

test('an operator sweep is never told it already has enough', () => {
  // The decision must be conditional on campaignId. An operator sweep exists to
  // fill the store so the first campaign in a city is not the one that pays for
  // it; gating it would freeze the store at its current size.
  assert.match(
    code,
    /campaignId\s*\n?\s*\?\s*decideSweep\(coverage\)/,
    'decideSweep must be reached only when there is a campaign to answer',
  );

  const gateBlock = code.slice(code.indexOf('const sweep ='), code.indexOf('if (!sweep.sweep)'));
  assert.match(
    gateBlock,
    /sweep:\s*true/,
    'the no-campaign branch must resolve to sweeping, explicitly',
  );
});

test('a skipped sweep still records which evidence answered the campaign', () => {
  const skip = code.indexOf('if (!sweep.sweep)');
  const end = code.indexOf('const sweepLanguages =');
  assert.ok(skip > 0 && end > skip, 'guard: the skip branch is where expected');
  const branch = code.slice(skip, end);

  assert.match(
    branch,
    /from\('campaign_supply_references'\)/,
    'without these rows the campaign has no record of the intelligence it reused, '
      + 'and unauditable reuse is worse than a duplicate fetch',
  );
  assert.match(branch, /origin: 'REUSED_EXISTING'/, 'which is what actually happened');
  assert.match(
    branch,
    /coverage\.countedRefs/,
    'the references must be the rows the verdict actually rested on',
  );
  assert.match(branch, /reusedExistingIntelligence: true/);
  assert.match(
    branch,
    /networkFetches: 0/,
    'the saving has to be stated, or a skip reads like a sweep that found nothing',
  );
});

test('the narrowed language list never overwrites the envelope', () => {
  assert.doesNotMatch(
    code,
    /scope\.languages\s*=/,
    'the envelope records what the CAMPAIGN asked for; narrowing it in place would '
      + 'make a two-language campaign that reused Georgian indistinguishable from a '
      + 'campaign that only ever wanted Russian',
  );
  assert.match(code, /const sweepLanguages =/);
});

test('the fetch uses the narrowed list and the echoed envelope reports both', () => {
  const query = code.slice(code.indexOf('const query = {'), code.indexOf('const query = {') + 1200);
  assert.match(
    query,
    /languages: sweepLanguages/,
    'a PARTIAL campaign must not re-buy the languages it already holds',
  );

  // Anchored on the envelope's own closing `rationale:` rather than on
  // `sourcesPermitted:`, which also appears in an EARLIER early-return and made
  // this slice empty -- an empty string matches nothing and the failure looked
  // like a missing field rather than a bad anchor.
  const envStart = code.indexOf('envelope: {');
  const envelope = code.slice(envStart, code.indexOf('rationale: scope.rationale', envStart));
  assert.ok(envelope.length > 0, 'guard: the envelope block was actually located');
  assert.match(envelope, /languages: scope\.languages/, 'what was asked for');
  assert.match(envelope, /languagesSwept: sweepLanguages/, 'what was actually read');
});

test('both outcomes report the coverage verdict, so a skip and a sweep are comparable', () => {
  const verdicts = code.match(/verdict: coverage\.verdict/g) ?? [];
  assert.equal(
    verdicts.length,
    2,
    'the skipped path and the swept path must both say why, or only one of the two '
      + 'decisions is ever explainable',
  );
});

test('the per-language floor is a named constant at the call site', () => {
  // A product judgement, deliberately not buried in the coverage module.
  assert.match(code, /const COVERAGE_FLOOR_PER_LANGUAGE = \d+;/);
  assert.match(code, /minPerLanguage: COVERAGE_FLOOR_PER_LANGUAGE/);
});

test('the sweep decision weighs how old the LISTING is, not only how old our look was', () => {
  // The first live Telegram sync stored seven posts from 2022 and, because a second
  // sync had just confirmed them, judgeDelivery() called all seven FRESH. Without a
  // publication ceiling one archive would report a market as covered and stop the
  // campaign paying to find out what is actually for sale.
  assert.match(
    code,
    /const MAX_LISTING_AGE_MS = /,
    'the ceiling has to exist as a named constant at the call site',
  );
  assert.match(
    code,
    /maxPublishedAgeMs: MAX_LISTING_AGE_MS/,
    'and it has to actually be passed, or it is documentation rather than a gate',
  );
  assert.match(
    code,
    /publishedAt: \(row\.published_at as string \| null\) \?\? null/,
    'the module cannot weigh a date the query never selected',
  );
  assert.match(
    code,
    /published_at/,
    'published_at must be in the select list',
  );
});
