// Every error code the publishing server can send to the Publishing screens has its
// own sentence in all six languages. useErrorText() falls back to the generic
// "Something went wrong (CODE)" for an unknown code — that fallback is for codes
// nobody anticipated, not for codes this repository raises itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const SOURCES = [
  'supabase/functions/publishing-engine/index.ts',
  'supabase/functions/publishing-engine/domain.ts',
  'supabase/functions/publishing-engine/providers.ts',
  'supabase/functions/publishing-engine/central.ts',
  'supabase/functions/publishing-engine/vault.ts',
  'supabase/migrations/20261103090000_publishing_workspace.sql',
  'supabase/migrations/20261106090000_publishing_providers.sql',
  'supabase/migrations/20261107090000_publishing_central_accounts.sql',
].map(read).join('\n');

/* Not errors a person reads on a Publishing screen: transport refusals the browser
   never triggers from the app, listing field problems (shown via pubw_problem_*),
   and history event kinds (shown via pubw_event_*). */
const NOT_SCREEN_ERRORS = new Set([
  'ORIGIN_DENIED', 'METHOD_DENIED', 'INVALID_JSON', 'UNKNOWN_ACTION',
  'REQUIRED', 'POSITIVE_REQUIRED', 'VALID_PHONE_REQUIRED', 'INVALID_PHONE', 'INVALID_INTEGER',
  'EXCEEDS_TOTAL_FLOORS', 'EXCEEDS_ROOMS', 'REQUIRED_BY_PORTAL', 'TOO_MANY_PHOTOS', 'DESCRIPTION_TOO_LONG',
  'PORTAL_COPY_UPDATED', 'LISTING_SAVED',
]);

test('every publishing error code a screen can show has its own text in all six languages', () => {
  const codes = new Set();
  for (const m of SOURCES.matchAll(/(?:fail\('|error: '|code: '|raise exception '|\{ error: ')([A-Z][A-Z_]{3,})'/g)) codes.add(m[1]);
  for (const m of SOURCES.matchAll(/'((?:PORTAL|ROBOTS|LISTING|REDIRECTED)_[A-Z_]+)'/g)) codes.add(m[1]);
  assert.ok(codes.size > 40, `only ${codes.size} codes parsed — the extraction broke`);
  const bundle = read('src/i18n/translations.ts');
  const missing = [...codes].filter((c) => !NOT_SCREEN_ERRORS.has(c))
    .filter((c) => (bundle.match(new RegExp(`^\\s+pubw_err_${c.toLowerCase()}:`, 'gm')) ?? []).length !== 6);
  assert.deepEqual(missing, [], `codes without their own pubw_err_* sentence in all six languages: ${missing.join(', ')}`);
});
