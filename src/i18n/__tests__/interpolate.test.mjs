// NO CUSTOMER EVER READS `{{monthly}}`.
//
// On 19 September 2026 the Georgian Mortgage page said:
//
//   "ამ პირობებით თვეში დაახლოებით {{monthly}} გადაიხდი 8 წლის განმავლობაში."
//
// The call site passes `amount` and `years`. An administrator had
// replaced that string through App Content and spelled the hole
// {{monthly}}. `String.replace` returned the match unchanged and six
// literal braces went to a customer in the sentence that was supposed
// to state the price of their house.
//
// Every other gate had an excuse. The bundle placeholder test reads
// translations.ts and the offending value was a database row.
// validateOverride() rejects exactly this and the row was not written
// through the editor. app_content_set() cannot check it, because the
// shipped string lives in a JavaScript bundle and not in Postgres.
//
// Rendering is the only layer that sees both the replacement and the
// variables the call site actually passes, so the guarantee lives
// there, and these are the tests of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnfilledHole,
  interpolate,
  resolveCopy,
  stripUnfilledHoles,
} from '../interpolate.ts';

test('a hole the call site supplies is filled', () => {
  assert.equal(interpolate('about {{amount}} a month', { amount: '$1,765' }), 'about $1,765 a month');
});

test('a hole the call site does not supply survives, so the caller can tell', () => {
  const filled = interpolate('about {{monthly}} a month', { amount: '$1,765' });
  assert.equal(filled, 'about {{monthly}} a month');
  assert.equal(hasUnfilledHole(filled), true);
});

test('inner spaces are tolerated, the way the editor writes them', () => {
  assert.equal(interpolate('{{ amount }} a month', { amount: '9' }), '9 a month');
});

test('hasUnfilledHole does not carry state between calls', () => {
  // A /g/ regex reused with .test() advances lastIndex and answers false
  // on the next string. That bug would make the guarantee intermittent.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(hasUnfilledHole('{{a}} {{b}} {{c}}'), true, `call ${i}`);
  }
  assert.equal(hasUnfilledHole('nothing here'), false);
});

test('THE INCIDENT: an override naming an unknown hole loses to the shipped string', () => {
  const override = 'ამ პირობებით თვეში დაახლოებით {{monthly}} გადაიხდი {{years}} წლის განმავლობაში.';
  const shipped = 'ამ პირობებით თვეში დაახლოებით {{amount}} გადაიხდი {{years}} წლის განმავლობაში.';

  const rendered = resolveCopy([override, shipped, 'english'], { amount: '$1,765', years: 8 });

  assert.ok(!/\{\{/.test(rendered), `braces reached the customer: ${rendered}`);
  assert.ok(rendered.includes('$1,765'));
  assert.ok(rendered.includes('8'));
});

test('an override that CAN be completed still wins, which is the point of overrides', () => {
  const rendered = resolveCopy(
    ['admin wrote {{amount}} here', 'shipped {{amount}}'],
    { amount: '5' },
  );
  assert.equal(rendered, 'admin wrote 5 here');
});

test('an override with no holes at all wins over a shipped string that has them', () => {
  assert.equal(resolveCopy(['flat text', 'shipped {{amount}}'], { amount: '5' }), 'flat text');
});

test('English is the third chance, not the first', () => {
  const rendered = resolveCopy([undefined, 'ka {{wrong}}', 'en {{amount}}'], { amount: '5' });
  assert.equal(rendered, 'en 5');
});

test('when nothing can be completed the braces are removed rather than printed', () => {
  const rendered = resolveCopy(['a {{wrong}} b', 'c {{alsowrong}} d'], { amount: '5' });
  assert.ok(!/\{\{/.test(rendered), rendered);
  assert.equal(rendered, 'a b');
});

test('stripping collapses the gap it leaves rather than leaving double spaces', () => {
  assert.equal(stripUnfilledHoles('pay {{x}} now'), 'pay now');
  assert.equal(stripUnfilledHoles('total is {{x}}.'), 'total is.');
});

test('empty and missing candidates are skipped, not rendered', () => {
  assert.equal(resolveCopy([undefined, '', 'real'], undefined), 'real');
  assert.equal(resolveCopy([undefined, ''], undefined), undefined);
});

test('no vars at all leaves a bundled string untouched rather than stripping it', () => {
  // t('key') with no vars is the overwhelmingly common call. A string
  // with no holes must come back byte for byte.
  assert.equal(resolveCopy(['plain sentence'], undefined), 'plain sentence');
});
