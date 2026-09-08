import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * ORCHESTRATOR-SIDE DEDUPLICATION (research-agent Edge Function).
 *
 * The worker refuses duplicate executions as defense in depth, but the
 * orchestrator must not PROPOSE them in the first place — a proposal costs a
 * browser job launch and can raise a CAPTCHA for the customer before the
 * worker's own guard ever sees it.
 *
 * Reproduced from production job 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92: after
 * enreg had already completed for idCodes 404670272 and 405068386 (both named
 * "შპს მილენიო გრუპი"), the orchestrator proposed a THIRD enreg execution for
 * the Latin candidate "Millennio Group" with no idCode, because its name
 * compare could not match across scripts. That execution never finished — it
 * is still status START.
 *
 * The Edge Function is Deno source that cannot be imported here, so the rule
 * is extracted from the file and executed directly. That keeps this a real
 * behavioural test of the shipped code rather than a restatement of it.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const EDGE = `${here}../../../supabase/functions/research-agent/index.ts`;
const source = readFileSync(EDGE, 'utf8');

/** Extracts alreadyHasResultFor() from the Edge source and makes it callable,
 * together with the normalizeLoose() it depends on. */
function loadGuard() {
  const fnStart = source.indexOf('function alreadyHasResultFor(');
  assert.notEqual(fnStart, -1, 'alreadyHasResultFor must exist in the Edge Function');
  // Balance braces from the function's opening brace to its close.
  const open = source.indexOf('{', fnStart);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = source
    .slice(fnStart, end)
    .replace(/:\s*'enreg'\s*\|\s*'rstax'\s*\|\s*'debtor'/g, '')
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/:\s*any/g, '')
    .replace(/:\s*boolean/g, '');
  const normalizeLoose = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-new-func
  return new Function('normalizeLoose', `${body}; return alreadyHasResultFor;`)(normalizeLoose);
}

const alreadyHasResultFor = loadGuard();

const GEO = 'შპს მილენიო გრუპი';
const PRODUCTION = {
  results: [
    { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', forEntity: null },
    { source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: { idCode: '404670272', name: GEO } },
    { source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION', forEntity: { idCode: '404670272', name: GEO } },
    { source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: { idCode: '405068386', name: GEO } },
  ],
};

test('PRODUCTION ROW 10: a name-only candidate is refused once an identified execution exists', () => {
  assert.equal(alreadyHasResultFor(PRODUCTION, 'enreg', null, 'Millennio Group'), true);
});

test('the rule is script-independent — no transliteration guess is required', () => {
  for (const name of ['Millennio Group', 'Millenio Group', 'მილენიო გრუპი', 'MILLENNIO GROUP', '']) {
    assert.equal(alreadyHasResultFor(PRODUCTION, 'enreg', null, name), true, JSON.stringify(name));
  }
});

test('an already-checked idCode is refused', () => {
  assert.equal(alreadyHasResultFor(PRODUCTION, 'enreg', '404670272', GEO), true);
  assert.equal(alreadyHasResultFor(PRODUCTION, 'rstax', '404670272', GEO), true);
});

test('TWO DIFFERENT REGISTRY IDS ARE NEVER MERGED on name similarity', () => {
  // 405068386 has an enreg result, but NOT an rstax one — it must still be
  // researchable. Merging it into 404670272 because the names match would
  // silently drop real work.
  assert.equal(alreadyHasResultFor(PRODUCTION, 'rstax', '405068386', GEO), false);
  // And a genuinely new company is unaffected.
  assert.equal(alreadyHasResultFor(PRODUCTION, 'enreg', '999999999', 'სხვა კომპანია'), false);
});

test('a source that has never run is not blocked', () => {
  assert.equal(alreadyHasResultFor(PRODUCTION, 'debtor', '404670272', GEO), false);
  assert.equal(alreadyHasResultFor(PRODUCTION, 'debtor', null, 'Millennio Group'), false);
});

test('a primary result with no forEntity never covers a discovered company', () => {
  const primaryOnly = { results: [{ source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: null }] };
  assert.equal(alreadyHasResultFor(primaryOnly, 'enreg', '404670272', GEO), false);
  assert.equal(alreadyHasResultFor(primaryOnly, 'enreg', null, 'Millennio Group'), false);
});

test('an empty history blocks nothing', () => {
  for (const empty of [{ results: [] }, {}, null, undefined]) {
    assert.equal(alreadyHasResultFor(empty, 'enreg', '404670272', GEO), false);
  }
});

test('the fix is documented against the production job it came from', () => {
  const fn = source.slice(source.indexOf('function alreadyHasResultFor('));
  assert.match(fn.slice(0, 2600), /3aa36828/, 'the defect must be traceable to its production job');
  assert.match(fn.slice(0, 2600), /never merged on name similarity|never merged|distinct registry ids/i);
});
