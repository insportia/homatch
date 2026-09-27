// SEVEN SOURCES, ELEVEN THAT ARE NOT, AND ONE MODEL FOR ALL OF THEM.
//
// The audit in docs/NATIVE_INTENT_SOURCE_MAP.md found what actually exists. This holds
// the two halves of that finding in place:
//
//   EVERY SOURCE THAT CAN EXPRESS INTENT IS RECONCILED. Not "most of them" and not "the
//   four that were easy" — a surface left disconnected is a customer repeating themselves
//   to a system that already heard.
//
//   NOTHING ELSE BECOMES INTENT. `activity_events` holds MORTGAGE_PAGE_OPENED and
//   INVESTMENT_PAGE_OPENED; `pwa_events` holds 1,175 rows of app telemetry. A page open is
//   not a buyer, and the pressure to treat it as one grows every time somebody wants more
//   matches.
//
// THE FAILURE THIS PREVENTS is the one the product would never notice: an owner told that
// a person is interested in their flat because that person scrolled past it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const code = (text) => text
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const sourceMap = read('docs', 'NATIVE_INTENT_SOURCE_MAP.md');

/** Every edge function, as code with its explanations stripped. */
function edgeSources() {
  const dir = join(root, 'supabase', 'functions');
  const out = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      out.set(entry.name, code(read('supabase', 'functions', entry.name, 'index.ts')));
    } catch { /* a directory with no index is not a function */ }
  }
  return out;
}

const FUNCTIONS = edgeSources();
const allEdgeCode = [...FUNCTIONS.values()].join('\n');

/* ────────────────────────────────────────────────────────────────────────
 * Every source is reconciled
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The surfaces the schema says can carry intent, and where each is wired.
 *
 * DETERMINISTIC means the surface knows the answer from a column and asks nothing: a
 * viewing request is an actor, a property and an action, and there is nothing to read.
 */
const RECONCILED = [
  {
    surface: 'SEARCH_PLAN',
    where: 'find-property-plan',
    how: 'DETERMINISTIC',
    why: 'the customer was shown the plan and confirmed it; there is nothing to interpret',
  },
  {
    surface: 'VIEWING_REQUEST',
    where: 'viewing-request',
    how: 'DETERMINISTIC',
    why: 'the actor, the property and the action are columns',
  },
  {
    surface: 'PRIVATE_MESSAGE',
    where: 'send-message',
    how: 'DETERMINISTIC_CONTEXT_SEMANTIC_MEANING',
    why: 'conversations.property_id says which property; the sentence says what about it',
  },
  {
    surface: 'LIVE_CHAT',
    where: 'ingest-live-chat',
    how: 'DETERMINISTIC_CONTEXT_SEMANTIC_MEANING',
    why: 'the room knows the author and the reply; the constraints need reading',
  },
];

test('every surface that writes intent writes it through the one door', () => {
  for (const { surface, where } of RECONCILED) {
    const source = FUNCTIONS.get(where);
    assert.ok(source, `${where} is gone, so ${surface} reaches nothing`);
    assert.match(source, /recordIntent\(/,
      `${where} no longer records intent, so ${surface} is disconnected`);
    assert.ok(source.includes(`'${surface}'`),
      `${where} does not name ${surface} as its source surface`);
  }
});

test('nothing writes the intent table except through that door', () => {
  /*
   * A second writer is a second opinion about what counts as a signal, and the generous
   * one always wins in practice. recordIntent() is where validate() runs.
   *
   * WRITES, NOT TOUCHES. Reading the table is legitimate and necessary — the projection
   * step resolves a person's effective state out of their own signals, and keeping the
   * evidence is the whole reason it exists. What has to go through the door is the WRITE.
   *
   * The pattern is a literal rather than an interpolated one on purpose: inside an
   * untagged template literal `\\s` is the letter s, so building this by interpolation
   * produces a regex that matches nothing and a test that is green for the worst reason.
   */
  const WRITES = [
    /from\(\s*['"]intent_signals['"]\s*\)[\s\S]{0,160}?\.insert\(/,
    /from\(\s*['"]intent_signals['"]\s*\)[\s\S]{0,160}?\.upsert\(/,
    /from\(\s*['"]intent_signals['"]\s*\)[\s\S]{0,160}?\.update\(/,
    /from\(\s*['"]intent_signals['"]\s*\)[\s\S]{0,160}?\.delete\(/,
  ];
  /* The pattern finds a real write when there is one. */
  assert.ok(
    WRITES[1].test("from('intent_signals').upsert({ a: 1 })"),
    'the write pattern does not match a write, so this test proves nothing',
  );

  for (const [name, source] of FUNCTIONS) {
    for (const pattern of WRITES) {
      assert.ok(!pattern.test(source),
        `${name} writes intent_signals directly and skips the validation gate`);
    }
  }
});

test('the door validates before it writes', () => {
  const door = code(read('supabase', 'functions', '_shared', 'intent.ts'));
  assert.match(door, /validate\(/, 'the gate is gone');
  assert.match(door, /if \(!intent\) return/,
    'a candidate that failed validation is still written');
  /* And the identity is the source event, so reprocessing is harmless. */
  assert.match(door, /onConflict: 'source_surface,source_event_id,side,act,dimension'/,
    'the write has no conflict target, so reprocessing a message duplicates it');
});

test('no source event body reaches the intent layer', () => {
  /*
   * THE PRIVACY RULE, HELD WHERE IT COULD BE BROKEN. A match explanation assembled from
   * somebody's private sentence is a leak with a rationale's manners, and the first step
   * towards one is a body column that seemed harmless.
   */
  const door = code(read('supabase', 'functions', '_shared', 'intent.ts'));
  for (const column of ['body:', 'text:', 'content:', 'message_body:', 'original_text:']) {
    assert.ok(!door.includes(column),
      `the intent writer carries ${column}, which copies what somebody wrote`);
  }
  const migration = read('supabase', 'migrations', '20260927160000_intent_signals.sql');
  assert.ok(!/^\s+(body|content|message_text)\s+text/m.test(migration),
    'intent_signals grew a column for the text of what somebody said');
});

/* ────────────────────────────────────────────────────────────────────────
 * Nothing else becomes intent
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The tables that hold product telemetry.
 *
 * Read from the audit rather than invented here: every one was confirmed against
 * information_schema, and `activity_events` in particular holds MORTGAGE_PAGE_OPENED and
 * INVESTMENT_PAGE_OPENED — somebody opening a calculator.
 */
const TELEMETRY = [
  'activity_events', 'pwa_events', 'usage_events', 'promotion_funnel_events',
  'rate_limit_events', 'dt_events', 'matching_job_events', 'cost_events',
  'voice_usage_events', 'source_lifecycle_events', 'dev_share_events',
];

test('no telemetry table is read by anything that records intent', () => {
  /*
   * A page open is not a buyer. The pressure to treat it as one grows every time
   * somebody wants more matches, and the result would be an owner told that a person is
   * interested in their flat because they scrolled past it.
   */
  for (const { where } of RECONCILED) {
    const source = FUNCTIONS.get(where);
    for (const table of TELEMETRY) {
      assert.ok(!source.includes(`'${table}'`),
        `${where} reads ${table} and also records intent`);
    }
  }
});

test('the schema still has nowhere to record who looked at a property', () => {
  /*
   * WORTH ASSERTING BECAUSE IT IS AN ABSENCE. There is no PROPERTY_VIEWED event and no
   * viewer identity anywhere, so "User X looked at your property" has no data to be
   * built from. If somebody adds the column, this test is where they find out that the
   * absence was the design.
   */
  const activityTypes = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read('supabase', 'migrations', f))
    .join('\n');
  for (const invented of ['PROPERTY_VIEWED', 'PROPERTY_IMPRESSION', 'LISTING_VIEWED']) {
    assert.ok(!activityTypes.includes(invented),
      `${invented} was added; a page view is now recordable as interest`);
  }
});

test('no favourites feature was invented to satisfy the architecture', () => {
  /*
   * The audit searched for favorite, favourite, saved, bookmark, shortlist, wishlist and
   * watch, and found no table. The honest status is NOT PRESENT — building one so that a
   * listed source could be ticked off would be inventing a product feature to satisfy a
   * document.
   */
  const migrations = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'));
  for (const file of migrations) {
    assert.ok(!/create table[^;]*\b(favou?rites|bookmarks|shortlists|wishlists)\b/i.test(read('supabase', 'migrations', file)),
      `${file} creates a favourites table that the product does not have`);
  }
  assert.match(sourceMap, /No favourites exist/,
    'the source map no longer records that favourites are absent');
});

/* ────────────────────────────────────────────────────────────────────────
 * Deterministic context is not sent to a model
 * ──────────────────────────────────────────────────────────────────────── */

test('nothing asks a model what a column already says', () => {
  /*
   * conversations.property_id, viewing_requests.property_id and the confirmed plan's own
   * fields are facts. Sending them to be rediscovered costs money to become less certain.
   */
  const message = FUNCTIONS.get('send-message');
  assert.match(message, /conversationRow\?\.property_id/,
    'the property is no longer read from the conversation');
  assert.ok(!/functions\.invoke\(\s*['"]find-property-plan/.test(message),
    'send-message asks a model to read a property it already has');

  const viewing = FUNCTIONS.get('viewing-request');
  assert.ok(!/functions\.invoke\(\s*['"]find-property-plan/.test(viewing),
    'a viewing request is being interpreted rather than recorded');

  const plan = FUNCTIONS.get('find-property-plan');
  const confirm = plan.slice(plan.indexOf("mode === 'confirm'"));
  assert.match(confirm, /sourceSurface: 'SEARCH_PLAN'/,
    'a confirmed plan no longer becomes canonical intent');
});

test('the expensive step is gated and incremental', () => {
  const worker = FUNCTIONS.get('ingest-live-chat');
  /* A cursor, so a popular room is not re-read from the beginning every tick. */
  assert.match(worker, /\.gt\('seq', cursor\)/,
    'the worker re-reads the whole room on every message');
  /* And a gate, so "good morning" is not sent to a model to be told it is not a flat. */
  assert.match(worker, /statesRequirements\(text\)/,
    'every message reaches the model regardless of whether it states anything');
  assert.match(worker, /effective !== 'SELF'/,
    'somebody else words are sent to the model as though they were the author own');
});

test('an edited or deleted message withdraws what was derived from it', () => {
  const worker = FUNCTIONS.get('ingest-live-chat');
  assert.match(worker, /withdrawIntentFor\(/, 'edits and deletions leave stale intent standing');
  assert.match(worker, /'SOURCE_DELETED'/, 'a deletion is not distinguished');
  assert.match(worker, /'SOURCE_EDITED'/, 'an edit is not distinguished');

  const door = code(read('supabase', 'functions', '_shared', 'intent.ts'));
  /* Withdrawn, not removed: the evidence that somebody once said something is not made
     false by their changing it. */
  assert.match(door, /withdrawn_at:/, 'the withdrawal does not record when');
  assert.ok(!/\.delete\(\)/.test(door), 'withdrawal deletes the evidence');
});

/* ────────────────────────────────────────────────────────────────────────
 * The audit is kept honest
 * ──────────────────────────────────────────────────────────────────────── */

test('the source map names every reconciled surface', () => {
  for (const { surface } of RECONCILED) {
    assert.ok(sourceMap.includes(surface.replace('_', ' ').toLowerCase())
      || sourceMap.includes(surface),
      `${surface} is wired but the audit does not mention it`);
  }
});

test('every surface the model allows is one something writes', () => {
  /*
   * The database's own list of surfaces and the set of things that write them must
   * agree. A surface in the check constraint that nothing produces is a promise the
   * product does not keep; one that writes without being listed cannot be stored.
   */
  const migration = read('supabase', 'migrations', '20260927160000_intent_signals.sql');
  const declared = [...migration.matchAll(/'(LIVE_CHAT|PRIVATE_MESSAGE|VIEWING_REQUEST|SEARCH_PLAN|AI_CHAT)'/g)]
    .map((m) => m[1]);
  const unique = [...new Set(declared)];
  assert.equal(unique.length, 5, 'the surface vocabulary changed without this test knowing');

  const wired = new Set(RECONCILED.map((r) => r.surface));
  const unwired = unique.filter((surface) => !wired.has(surface));
  /*
   * AI_CHAT IS DECLARED AND NOT YET WIRED, and that is recorded here rather than hidden:
   * ai_chat_leads holds 28 rows of real extraction whose attribution and scope were never
   * captured, so they cannot be mapped without inventing the fields that decide whether a
   * signal is safe. The surface is reserved; the backfill is a separate, careful job.
   */
  assert.deepEqual(unwired, ['AI_CHAT'],
    `these surfaces are declared but nothing writes them: ${unwired.join(', ')}`);
  assert.ok(allEdgeCode.includes("'SEARCH_PLAN'"), 'sanity: the wired surfaces are real');
});
