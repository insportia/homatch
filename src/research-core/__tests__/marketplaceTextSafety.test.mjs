// FIND PROPERTY — results are never lost to a split emoji (production 2026-10-16: evidence
// snippets clipped mid-surrogate made Postgres reject whole 500-row result batches with
// "invalid input syntax for type json"; customers saw only the tail of the ranking).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipText, wellFormed, wellFormedDeep } from '../marketplace/text-safety.ts';
import { descriptionSignals } from '../marketplace/description-signals.ts';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('clipText never splits a surrogate pair at either edge', () => {
  const s = 'ab😀cd🏠ef';
  for (let a = 0; a <= s.length; a++) for (let b = a; b <= s.length; b++) {
    const c = clipText(s, a, b);
    assert.ok(!LONE.test(c), `${a}..${b} → ${JSON.stringify(c)}`);
  }
  assert.equal(clipText('x😀y', 0, 2), 'x', 'an edge inside the emoji drops the half');
  assert.equal(clipText('x😀y', 0, 3), 'x😀');
});

test('wellFormed repairs lone surrogates and NULs; jsonb-safe JSON', () => {
  const bad = 'ok \uD83D and \uDE00 and \u0000 end';
  const fixed = wellFormed(bad);
  assert.ok(!LONE.test(fixed));
  assert.ok(!fixed.includes('\u0000'));
  assert.ok(!/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(JSON.stringify(fixed)), 'no lone escape in the JSON');
  assert.equal(wellFormed('ბინა 🏡 კრწანისში'), 'ბინა 🏡 კრწანისში', 'valid text is untouched');
  const deep = wellFormedDeep({ a: ['\uD83D'], b: { c: 'x\uDE00' }, n: 1, z: null });
  assert.deepEqual(deep, { a: ['�'], b: { c: 'x�' }, n: 1, z: null });
});

test('description evidence never ends inside an emoji', () => {
  /* the evidence window ends 45 code units after "ლიფტი": put an emoji exactly there */
  for (let pad = 0; pad < 50; pad++) {
    const text = 'ბინა ' + 'x'.repeat(40) + ' ლიფტი ' + 'y'.repeat(pad) + '🏡🏡🏡 ფართი ' + '😀'.repeat(20);
    for (const sig of descriptionSignals(text)) assert.ok(!LONE.test(sig.evidence), `pad ${pad}: ${JSON.stringify(sig.evidence)}`);
  }
});
