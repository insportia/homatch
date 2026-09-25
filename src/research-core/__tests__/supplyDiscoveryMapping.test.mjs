// A COLUMN SELECTED AND NOT MAPPED IS A FIELD THAT IS ALWAYS UNDEFINED.
//
// resolveMarket asks PostgREST for entity_id and builds a ResolvableObservation
// from the row. It asked for entity_id and never mapped it, so applyMerges'
// "reuse the entity that already exists" lookup read undefined on every run
// and INSERTED a new entity instead.
//
// Production ended up with three rows for one Saburtalo flat — identical city,
// district, area and price range, each claiming observation_count 2, two of
// them holding no observations at all. Nothing failed, no test broke, and any
// count of "properties known" grew by one per merged pair per run.
//
// The cast is what let it survive: ResolvableObservation did not declare
// entityId, so `(m as any).entityId` compiled into undefined forever.
//
// So this checks the data flow that a type cannot: every column the query
// asks for is read somewhere in the function that asked for it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';

const source = stripComments(
  readFileSync('supabase/functions/supply-discovery/index.ts', 'utf8'),
);

/** camelCase, as the mapping would spell a snake_case column. */
const camel = (column) => column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

test('every column resolveMarket selects is actually read', () => {
  /*
   * The select is one long string of column names. Each one is there because
   * somebody wanted it, and a name in that list that appears nowhere else in
   * the file is a field that silently does not exist at runtime.
   */
  /*
   * Scoped to resolveMarket. The first version searched the whole file and
   * matched persist()'s three-column existence check instead — a test that
   * measures the wrong query passes for the wrong reason.
   */
  const fn = source.slice(source.indexOf('async function resolveMarket'));
  assert.ok(fn.length > 0, 'resolveMarket is gone');
  const select = fn.match(/\.select\('([^']+)'\)/);
  assert.ok(select, 'resolveMarket no longer selects from supply_observations');

  const columns = select[1].split(',').map((c) => c.trim()).filter(Boolean);
  assert.ok(columns.length > 10, `only ${columns.length} columns selected`);

  const unread = columns.filter((column) => {
    /* Either the snake_case name is used (r.entity_id) or its camelCase
       counterpart appears as a mapped key (entityId:). */
    const snake = new RegExp(`\\br\\.${column}\\b`);
    const mapped = new RegExp(`\\b${camel(column)}\\s*:`);
    return !snake.test(source) && !mapped.test(source);
  });

  assert.deepEqual(
    unread, [],
    `selected and never read: ${unread.join(', ')} — the field is undefined at runtime`,
  );
});

test('the entity lookup reads a declared field, not a cast', () => {
  /*
   * `(m as any).entityId` is what made a dropped mapping compile. With the
   * field on ResolvableObservation, forgetting it is a type error instead.
   */
  const lookup = source.match(/const existingId = [^;]+;/);
  assert.ok(lookup, 'applyMerges no longer looks for an existing entity');
  assert.match(lookup[0], /entityId/);
  assert.doesNotMatch(
    lookup[0],
    /as any/,
    'the entity lookup went back to a cast, which is how this broke',
  );
});

test('a merge updates the entity it found rather than always inserting', () => {
  /*
   * The shape that matters: an update when an id was found, an insert only
   * when none was. An insert-only path is what produced the orphans.
   */
  const applyMerges = source.slice(source.indexOf('async function applyMerges'));
  assert.match(applyMerges, /if \(entityId\) \{[\s\S]{0,200}?\.update\(payload\)/);
  assert.match(applyMerges, /else \{[\s\S]{0,200}?\.insert\(payload\)/);
});
