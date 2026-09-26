// A PROPERTY HAS A LIFE AFTER UPLOAD.
//
// Measured against production before any of this was built: `properties` held ONE row,
// `property_photos` held ZERO, the only source_type in use was URL_IMPORT, and the only
// matching_status in use was PAUSED. The schema was already rich — forty columns of
// facts, a photo table with display_order and is_cover, RLS keyed on get_user_id() and
// user_owns_property() — and almost none of it was reachable from the product. There was
// no route that answered "what have I got?".
//
// These tests hold the four decisions that are easiest to undo by accident.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * FROM THE PURE MODULE, not from propertyManagement.ts. That file imports the Supabase
 * client, so importing it here fails to resolve the '@/db' alias under node --test --
 * which is exactly why these two rules were moved out of it.
 */
import {
  intelligenceActionFor,
  isImported,
} from '../../src/property/rules.ts';
import { SURFACES, statusOf } from '../../src/surfaces/classification.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

const service = read('src', 'services', 'propertyManagement.ts');
const shell = read('src', 'components', 'layouts', 'HomatchShell.tsx');
const portfolio = read('src', 'pages', 'property', 'MyPropertiesPage.tsx');
const editor = read('src', 'pages', 'property', 'EditPropertyPage.tsx');
const migration = read(
  'supabase', 'migrations', '20260926280000_property_archive.sql',
);

/* Comments stripped, so a scan for a forbidden token cannot match the prose that
   explains why it is forbidden. This has caught itself three times already. */
const code = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/* ────────────────────────────────────────────────────────────────────────
 * 1. No impossible action is ever offered
 * ──────────────────────────────────────────────────────────────────────── */

test('a property offers exactly the one matching action its transaction supports', () => {
  assert.equal(intelligenceActionFor('SALE'), 'FIND_BUYERS');
  assert.equal(intelligenceActionFor('RENT'), 'FIND_TENANTS');
  assert.equal(intelligenceActionFor('INVESTMENT'), 'FIND_INVESTORS');
  /* Case and whitespace are what a database column actually hands over. */
  assert.equal(intelligenceActionFor(' sale '), 'FIND_BUYERS');
});

test('an unknown transaction type offers NOTHING rather than a guess', () => {
  /*
   * A half-finished import has no transaction type. Guessing SALE would put "Find
   * buyers" on a flat that might be a rental, and the customer would discover that by
   * running a campaign for the wrong side of the market.
   */
  for (const value of [null, undefined, '', 'LEASE', 'SOMETHING', 'sale/rent']) {
    assert.equal(intelligenceActionFor(value), null, `${JSON.stringify(value)} produced an action`);
  }
});

test('the card renders the single action and never a menu of them', () => {
  const body = code(portfolio);
  assert.match(body, /intelligenceActionFor\(/,
    'the card decides the action itself instead of asking the one function that knows');
  /* Exactly one rendered action key, built from the resolved action. */
  assert.match(body, /prop_action_\$\{action\.toLowerCase\(\)\}/);
  /* And not all three hardcoded side by side. */
  for (const key of ['prop_action_find_buyers', 'prop_action_find_tenants', 'prop_action_find_investors']) {
    assert.ok(!body.includes(`'${key}'`),
      `${key} is hardcoded on the card, so it can appear on a property that cannot do it`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. Archive, pause and delete are three different things
 * ──────────────────────────────────────────────────────────────────────── */

test('archive is its own column, not another matching_status value', () => {
  assert.match(migration, /add column if not exists archived_at timestamptz/);
  /*
   * The enum is untouched. Adding ARCHIVED to matching_status would make "archived"
   * and "not currently being matched" the same state, and then un-archiving would
   * have to guess whether to resume a campaign -- a guess that costs the owner either
   * money they did not authorise or a silence they did not expect.
   */
  assert.ok(!/alter type\s+matching_status/i.test(migration),
    'the matching_status enum was extended instead of adding a column');
});

test('archiving pauses matching, and un-archiving deliberately does not resume it', () => {
  const body = code(service);

  const archive = body.slice(body.indexOf('export async function archiveProperty'));
  const archiveBody = archive.slice(0, archive.indexOf('\n}'));
  assert.match(archiveBody, /archived_at:/);
  assert.match(archiveBody, /matching_status: 'PAUSED'/,
    'archiving leaves a campaign running against a listing the owner put away');

  const unarchive = body.slice(body.indexOf('export async function unarchiveProperty'));
  const unarchiveBody = unarchive.slice(0, unarchive.indexOf('\n}'));
  assert.match(unarchiveBody, /archived_at: null/);
  assert.ok(!/matching_status/.test(unarchiveBody),
    'un-archiving restarts spending on a decision the owner has not made');
});

test('delete is the existing soft delete, so the billing record survives', () => {
  const body = code(service);
  const remove = body.slice(body.indexOf('export async function deleteProperty'));
  const removeBody = remove.slice(0, remove.indexOf('\n}'));
  assert.match(removeBody, /is_deleted: true/);
  assert.ok(!/\.delete\(\)/.test(removeBody),
    'a hard DELETE would take the audit trail of what was charged with it');
});

test('both destructive actions are confirmed, and say different things', () => {
  const body = code(portfolio);
  assert.match(body, /AlertDialog/);
  assert.match(body, /prop_confirm_delete_title/);
  assert.match(body, /prop_confirm_archive_title/);
  assert.match(body, /prop_confirm_delete_body/);
  assert.match(body, /prop_confirm_archive_body/);
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Provenance is evidence and is not overwritten
 * ──────────────────────────────────────────────────────────────────────── */

test('an edit never writes a source-provenance field', () => {
  /*
   * source_url, canonical_url, source_domain, external_listing_id,
   * original_description and original_title record what an EXTERNAL PAGE said.
   * Editing the Homatch copy does not edit that page, and writing over these would
   * erase the only evidence of where a fact came from.
   */
  const body = code(service);
  const save = body.slice(body.indexOf('export async function savePropertyEdits'));
  const saveBody = save.slice(0, save.indexOf('\n}\n'));
  for (const column of [
    'source_url', 'canonical_url', 'source_domain', 'external_listing_id',
    'original_description', 'original_title', 'source_listing_id', 'extraction_confidence',
  ]) {
    assert.ok(!saveBody.includes(column),
      `savePropertyEdits writes ${column}, which records what the source page said`);
  }
});

test('the edit screen shows provenance read-only and says the copy is a copy', () => {
  const body = code(editor);
  assert.match(body, /isImported\(/);
  assert.match(body, /prop_imported_note/,
    'nothing tells the owner that editing does not change the original listing');
  /* Shown, not hidden: the source is a link the owner can follow. */
  assert.match(body, /facts\?\.source_url/);
  /* And not editable: no input is bound to a provenance field. */
  assert.ok(!/value=\{[^}]*source_url/.test(body),
    'the source URL is bound to an input, so the record of the source can be rewritten');
  assert.ok(!/value=\{[^}]*original_description/.test(body),
    'the original imported text is editable, so the evidence can be overwritten');
});

test('isImported reads the real enum value and nothing else', () => {
  assert.equal(isImported('URL_IMPORT'), true);
  assert.equal(isImported('url_import'), true);
  assert.equal(isImported('PRIVATE_LISTING'), false);
  assert.equal(isImported(null), false);
  assert.equal(isImported('IMPORTED'), false);
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. Price per m² is derived, and has no field
 * ──────────────────────────────────────────────────────────────────────── */

test('price per square metre is computed, never typed', () => {
  /*
   * It appears on every card and in every comparison. A field for it is a way to
   * enter a third number that contradicts the other two, and nothing downstream could
   * tell which of the three was wrong.
   */
  const body = code(editor);
  assert.match(body, /derivedPerSqm/);
  assert.match(body, /prop_per_sqm_derived/);
  assert.ok(!/id="prop-per-sqm"/.test(body), 'there is an input for a derived value');
  assert.ok(!/setPricePerSqm/.test(body), 'the derived value is held as editable state');

  const service_body = code(service);
  assert.match(service_body, /row\.price_per_sqm = Number\(\(price \/ area\)\.toFixed\(2\)\)/,
    'the derived value is not computed from the two inputs on save');
});

/* ────────────────────────────────────────────────────────────────────────
 * 5. Navigation: order, and two icons that cannot be confused
 * ──────────────────────────────────────────────────────────────────────── */

test('My Properties comes before Find Property', () => {
  const body = code(shell);
  const mine = body.indexOf("path: '/property'");
  const find = body.indexOf("path: '/find-property'");
  assert.ok(mine > -1, 'My Properties is not in the navigation');
  assert.ok(find > -1, 'Find Property is not in the navigation');
  assert.ok(mine < find,
    'Find Property comes first, so an owner is sent to look for somebody else\'s flat '
    + 'before they can see their own');
});

test('Find Property no longer points at the chat, and no longer wears a magnifier', () => {
  const body = code(shell);
  /* The route it actually goes to. */
  assert.match(body, /\{ key: 'dnav_find_property', path: '\/find-property', icon: Telescope \}/);
  /*
   * A LOUPE MEANS "SEARCH THIS TEXT", which is the one thing this destination is not:
   * it reads a description, proposes a plan and runs deterministic matching. Search is
   * still imported and still used -- for the dashboard's actual text search box, which
   * is what a magnifier is for.
   */
  assert.ok(!/'dnav_find_property'[^}]*icon: Search/.test(body),
    'Find Property is back to a magnifying glass');
  assert.ok(!/'dnav_find_property'[^}]*path: '\/ai'/.test(body),
    'Find Property points at the chat assistant again');
});

test('the two property destinations do not share an icon', () => {
  const body = code(shell);
  const iconOf = (key) => {
    const match = body.match(new RegExp(`\\{ key: '${key}', path: '[^']+', icon: (\\w+) \\}`));
    return match?.[1] ?? null;
  };
  const mine = iconOf('nav_my_properties');
  const find = iconOf('dnav_find_property');
  assert.ok(mine, 'My Properties has no icon');
  assert.ok(find, 'Find Property has no icon');
  assert.notEqual(mine, find,
    'ownership and discovery are wearing the same icon at 20px on a phone');

  /* And neither collides with anything else in the list. */
  const icons = [...body.matchAll(/icon: (\w+) \}/g)].map((m) => m[1]);
  for (const icon of [mine, find]) {
    assert.equal(icons.filter((name) => name === icon).length, 1,
      `${icon} is used by more than one destination`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The surfaces are classified and measured
 * ──────────────────────────────────────────────────────────────────────── */

test('both new property surfaces are classified and customer-critical', () => {
  for (const path of ['/property', '/property/:id/edit']) {
    assert.equal(statusOf(path), 'APPROVED_CURRENT_DESIGN', `${path} is not classified`);
    const surface = SURFACES.find((s) => s.path === path);
    assert.equal(surface.customerCritical, true, `${path} is not customer-critical`);
  }
});

test('both are in the mobile/RTL matrix', () => {
  const matrix = read('tests', 'mobile', 'routeOverflow.test.mjs');
  assert.match(matrix, /path: '\/property', name: 'my properties', auth: true/);
  assert.match(matrix, /name: 'edit property', auth: true/);
});

test('the portfolio never renders a photo it does not have', () => {
  const body = code(portfolio);
  /* An honest placeholder, not a stock photograph of a building that is not theirs. */
  assert.match(body, /prop_no_photo/);
  assert.match(body, /ImageOff/);
  assert.ok(!/unsplash|placeholder\.com|via\.placeholder|picsum/i.test(body),
    'the portfolio falls back to a stock image of somebody else\'s property');
});
