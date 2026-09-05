// Plain-node test (no test framework dependency — none is installed in
// this environment; `node official-worker/test/cadastral.test.mjs` runs it
// directly and exits non-zero on any failure).
import assert from 'node:assert/strict';
import { isCadastralCode, cadastralPrefixes, recommendedParentCode, candidateSequence } from '../src/lib/cadastral.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok - ${name}`); }

t('isCadastralCode: rejects non-cadastral text', () => {
  assert.equal(isCadastralCode('hello world'), false);
  assert.equal(isCadastralCode(''), false);
  assert.equal(isCadastralCode(null), false);
  assert.equal(isCadastralCode('01.18.06'), true);
  assert.equal(isCadastralCode('01.18'), true);
  assert.equal(isCadastralCode('01'), false); // single segment, not a code
});

t('recommendedParentCode: strips to 5 segments for the demonstrated example', () => {
  assert.equal(recommendedParentCode('01.18.06.019.055.03.01.603'), '01.18.06.019.055');
  assert.equal(recommendedParentCode('01.18.06.019.055.03.01.501'), '01.18.06.019.055');
});

t('recommendedParentCode: null when code is already <=5 segments (nothing shorter to try)', () => {
  assert.equal(recommendedParentCode('01.18.06.019.055'), null);
  assert.equal(recommendedParentCode('01.18.06'), null);
});

t('recommendedParentCode: null for non-cadastral input', () => {
  assert.equal(recommendedParentCode('not a code'), null);
});

t('cadastralPrefixes: progressively shorter, longest first, floor at minSegments', () => {
  const p = cadastralPrefixes('01.18.06.019.055.03.01.603');
  assert.deepEqual(p[0], '01.18.06.019.055.03.01.603');
  assert.ok(p.includes('01.18.06.019.055'));
  assert.ok(p.includes('01.18.06'));
  assert.equal(p.every(x => x.split('.').length >= 3), true);
});

t('cadastralPrefixes: empty for non-cadastral input', () => {
  assert.deepEqual(cadastralPrefixes('abc'), []);
});

t('candidateSequence: original first, never skipped, parent second, no duplicates', () => {
  const seq = candidateSequence('01.18.06.019.055.03.01.603');
  assert.equal(seq[0], '01.18.06.019.055.03.01.603');
  assert.equal(seq[1], '01.18.06.019.055'); // recommended parent tried right after the original
  assert.equal(new Set(seq).size, seq.length); // no duplicates
});

t('candidateSequence: a short code that has no shorter parent still returns itself', () => {
  const seq = candidateSequence('01.18.06');
  assert.deepEqual(seq, ['01.18.06']);
});

t('candidateSequence: passes through a non-cadastral query untouched (never mangles free text)', () => {
  assert.deepEqual(candidateSequence('some free-text query'), ['some free-text query']);
});

console.log(`\n${n} passed`);
