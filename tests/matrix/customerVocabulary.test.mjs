// WHAT A CUSTOMER SHOULD NEVER HAVE TO READ.
//
// Homatch's intelligence is the product; its plumbing is not. A customer
// watching their own search should learn how many people were found and how
// many matched — not which supplier was queried, not what the step cost us,
// and not the name of a queue event.
//
// THE LEAK THIS EXISTS TO PREVENT, found on 2026-09-26 in
// MatchingJobProgress, which MatchesPage and PropertyDetailPage both mount
// on customer routes:
//
//   • job.provider_results rendered as "DATAFORSEO: LIVE" / "APIFY: FAILED"
//     in monospace — supplier names, two of them retired providers.
//   • job.cost_usd_total printed to four decimals — HOMATCH'S internal cost
//     of running the search, not the customer's charge, which is in Credits.
//   • ev.event_type printed raw — DFSEO_TASK_COMPLETE, CLASSIFY_BATCH_START.
//   • payload.provider and payload.actualCostUsd concatenated into the
//     detail line of every event row.
//   • failure_reason and error_message printed verbatim, so an internal enum
//     like NO_INTERNAL_MATCHES_EXTERNAL_LOCKED reached the screen.
//   • a counter grid labelled "Query packs", "Queries run" and "Tiers run" —
//     how the search is BUILT rather than what it FOUND.
//
// Admin keeps every one of these. This file is about the customer's side.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Customer-facing trees. src/pages/admin is deliberately excluded. */
const ROOTS = ['src/pages', 'src/components'];
const ADMIN = /[\\/]admin[\\/]/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((root) => walk(root))
  .filter((f) => !ADMIN.test(f))
  .filter((f) => !/AdminLayout\.tsx$/.test(f));

/**
 * Comments are not UI.
 *
 * Several of these files explain IN A COMMENT that they deliberately show no
 * provider and no COGS, and a naive grep would fail on exactly the files that
 * got it right — the same self-matching trap a source-reading test always has.
 */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

const SOURCES = FILES.map((file) => ({ file, body: code(readFileSync(file, 'utf8')) }));

test('no retired provider name is referenced on a customer surface', () => {
  const offenders = SOURCES
    .filter(({ body }) => /dataforseo|apify|\bDFSEO\b/i.test(body))
    .map(({ file }) => file);
  assert.deepEqual(offenders, [],
    `retired provider names on customer surfaces:\n${offenders.join('\n')}`);
});

test("Homatch's internal cost is never rendered to a customer", () => {
  /*
   * cost_usd_total, actualCostUsd, estimated_cogs_usd: all are what a search
   * cost US. The customer's number is unlock_price_credits, and it is shown
   * where they unlock.
   */
  const offenders = SOURCES
    .filter(({ body }) => /cost_usd_total|actualCostUsd|estimated_cogs_usd|cogs_usd/i.test(body))
    .map(({ file }) => file);
  assert.deepEqual(offenders, [],
    `internal cost referenced on customer surfaces:\n${offenders.join('\n')}`);
});

test('a raw queue event type is never printed to a customer', () => {
  /*
   * Rendering `{ev.event_type}` puts our own vocabulary on their screen.
   * The panel maps it onto the mjp_status_* phrases that already exist in
   * all six languages, so this asserts the raw interpolation is gone rather
   * than that some particular wording is present.
   */
  const offenders = SOURCES
    .filter(({ body }) => /\{\s*(?:ev|event)\.event_type\s*\}/.test(body))
    .map(({ file }) => file);
  assert.deepEqual(offenders, [],
    `raw event_type rendered on customer surfaces:\n${offenders.join('\n')}`);
});

test('the progress panel speaks of findings rather than crawler stages', () => {
  const panel = readFileSync('src/components/matching/MatchingJobProgress.tsx', 'utf8');
  const body = code(panel);
  for (const internal of ['mjp_counter_query_packs', 'mjp_counter_tiers_run', 'mjp_cost_so_far']) {
    assert.equal(body.includes(internal), false,
      `${internal} is a build-stage label and is back on the customer panel`);
  }
  // What it found, which is what they asked.
  assert.match(body, /mjp_counter_matches/);
  assert.match(body, /mjp_counter_candidates/);
});

test('an internal failure enum is not shown as the error a customer reads', () => {
  const body = code(readFileSync('src/components/matching/MatchingJobProgress.tsx', 'utf8'));
  assert.equal(/\{\s*job\.failure_reason/.test(body), false,
    'the raw failure_reason enum is rendered again');
  assert.equal(/\{\s*job\.error_message\s*\}/.test(body), false,
    'the raw worker error message is rendered again');
  assert.match(body, /mjp_error_fallback/);
});

test('the guard is actually looking at customer files', () => {
  /* A filter bug that emptied this list would make every test above pass
     while asserting nothing. */
  assert.ok(FILES.length > 50, `only ${FILES.length} customer components scanned`);
  assert.ok(FILES.some((f) => /MatchingJobProgress/.test(f)), 'the panel under test was filtered out');
  assert.equal(FILES.some((f) => ADMIN.test(f)), false, 'an admin file leaked into the customer set');
});
