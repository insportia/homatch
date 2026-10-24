// Contract revisions: nothing changes unless the signer chose it, nothing is placed by guesswork,
// and the Word export is a valid package carrying exactly the chosen text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { applyDecisions, locate, replacementFor, reviewItems } from '../revisions.ts';
import { buildDocx } from '../docx.ts';

const TEXT = [
  'SALE AND PURCHASE AGREEMENT',
  'The Buyer may not terminate this agreement after the second instalment.',
  'If the Buyer delays payment, a penalty of 0.1% per day applies.',
  'The Seller shall hand over the apartment by 31 December 2027.',
].join('\n');

const review = (suggestion) => ({ risk: 'r', why: 'w', favours: 'SELLER', suggestion, tradeoffs: null });
const ANALYSIS = {
  clauses: [
    { label: 'Lock-in', plain: 'p', quote: 'The Buyer may not terminate this agreement after the second instalment.', page: 1, attention: 'ONE_SIDED', review: review('The Buyer may terminate this agreement if the handover is late.') },
    { label: 'Penalty', plain: 'p', quote: 'If the Buyer delays payment, a penalty of 0.1% per day applies.', page: 1, attention: 'UNUSUAL', review: review('If either party delays, a penalty of 0.1% per day applies.') },
    { label: 'Handover', plain: 'p', quote: 'The Seller shall hand over the apartment by 31 December 2027.', page: 1, attention: 'NORMAL' },
    { label: 'Ghost', plain: 'p', quote: 'This sentence is not in the text at all.', page: 2, attention: 'AMBIGUOUS', review: review('Replacement.') },
  ],
  missingProtections: [{ label: 'Late handover penalty', plain: 'p', review: review('The Seller pays 0.1% per day for late handover.') }],
};

test('only flagged items with a proposal are offered for review', () => {
  const items = reviewItems(ANALYSIS);
  assert.deepEqual(items.map((i) => i.key), ['c:0', 'c:1', 'c:3', 'm:0']);
  assert.equal(items[3].original, null);
});

test('no decision, no change: the text is returned byte for byte', () => {
  const r = applyDecisions(TEXT, reviewItems(ANALYSIS), [], 'Added clauses');
  assert.equal(r.text, TEXT);
  assert.deepEqual(r.changes, []);
});

test('accepted and edited proposals replace exactly their own wording, rejected ones nothing', () => {
  const items = reviewItems(ANALYSIS);
  const r = applyDecisions(TEXT, items, [
    { key: 'c:0', status: 'ACCEPTED' },
    { key: 'c:1', status: 'EDITED', text: 'If the Buyer delays payment by more than 10 days, a penalty applies.' },
    { key: 'm:0', status: 'REJECTED' },
  ], 'Added clauses');
  assert.ok(r.text.includes('The Buyer may terminate this agreement if the handover is late.'));
  assert.ok(!r.text.includes('may not terminate'));
  assert.ok(r.text.includes('by more than 10 days'));
  assert.ok(r.text.includes('The Seller shall hand over the apartment by 31 December 2027.'), 'untouched wording stays');
  assert.ok(!r.text.includes('Added clauses'), 'a rejected new clause is not added');
  assert.deepEqual(r.changes.map((c) => c.key), ['c:0', 'c:1']);
  assert.equal(r.changes[0].before, ANALYSIS.clauses[0].quote);
});

test('a proposal whose wording is not in the text is reported, never guessed into place', () => {
  const r = applyDecisions(TEXT, reviewItems(ANALYSIS), [{ key: 'c:3', status: 'ACCEPTED' }], 'Added clauses');
  assert.equal(r.text, TEXT);
  assert.deepEqual(r.unplaced, ['c:3']);
});

test('an accepted new clause goes at the end under its own heading', () => {
  const r = applyDecisions(TEXT, reviewItems(ANALYSIS), [{ key: 'm:0', status: 'ACCEPTED' }], 'Added clauses');
  assert.ok(r.text.startsWith(TEXT));
  assert.ok(r.text.endsWith('Added clauses\n1. The Seller pays 0.1% per day for late handover.'));
});

test('an empty edit changes nothing', () => {
  const item = reviewItems(ANALYSIS)[0];
  assert.equal(replacementFor(item, { key: 'c:0', status: 'EDITED', text: '   ' }), null);
});

test('quotes are found across line breaks and spacing the PDF introduced', () => {
  const at = locate('The Buyer may not\nterminate   this agreement.', 'The Buyer may not terminate this agreement.');
  assert.ok(at);
  assert.equal(locate('abc', 'xyz'), null);
});

test('the .docx is a valid package with the chosen text, and the tracked variant marks the change', () => {
  const items = reviewItems(ANALYSIS);
  const r = applyDecisions(TEXT, items, [{ key: 'c:0', status: 'ACCEPTED' }, { key: 'm:0', status: 'ACCEPTED' }], 'Added clauses');
  const clean = unzipSync(buildDocx({ title: 'Revised <contract> & co', text: r.text }));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(clean[part], part);
  const xml = strFromU8(clean['word/document.xml']);
  assert.ok(xml.includes('The Buyer may terminate this agreement if the handover is late.'));
  assert.ok(xml.includes('Revised &lt;contract&gt; &amp; co'), 'text is escaped');
  assert.ok(!xml.includes('<w:del '), 'the clean copy has no tracked changes');

  const tracked = strFromU8(unzipSync(buildDocx({ title: 'T', text: r.text, tracked: { original: TEXT, changes: r.changes, author: 'HOMATCH', addedHeading: 'Added clauses' } }))['word/document.xml']);
  assert.match(tracked, /<w:del [^>]*><w:r><w:delText xml:space="preserve">The Buyer may not terminate/);
  assert.match(tracked, /<w:ins [^>]*><w:r><w:t xml:space="preserve">The Buyer may terminate this agreement if the handover is late\./);
  assert.ok(tracked.includes('1. The Seller pays 0.1% per day for late handover.'));
});

test('Georgian text survives the round trip', () => {
  const ka = 'მყიდველს უფლება აქვს შეწყვიტოს ხელშეკრულება.';
  const xml = strFromU8(unzipSync(buildDocx({ title: 'ხელშეკრულება', text: ka }))['word/document.xml']);
  assert.ok(xml.includes(ka));
});
