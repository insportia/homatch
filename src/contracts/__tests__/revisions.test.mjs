// Contract revisions: nothing changes unless the signer chose it, nothing is placed by guesswork,
// and the Word export is a valid package carrying exactly the chosen text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  applyDecisions, analysisIdentity, draftStorageKey, hash53, isQuoteTruncated, isStaleRevision, locate, quoteKey,
  replacementFor, reviewItems, QUOTE_CAP,
} from '../revisions.ts';
import { buildDocx, runText } from '../docx.ts';

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

// Decision keys are hashes of the clause's own quote; these name them by label for readability.
const K = Object.fromEntries(reviewItems(ANALYSIS).map((i) => [i.label, i.key]));

test('only flagged items with a proposal are offered for review', () => {
  const items = reviewItems(ANALYSIS);
  assert.deepEqual(items.map((i) => i.label), ['Lock-in', 'Penalty', 'Ghost', 'Late handover penalty']);
  assert.deepEqual(items.map((i) => i.key.slice(0, 2)), ['c:', 'c:', 'c:', 'm:']);
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
    { key: K['Lock-in'], status: 'ACCEPTED' },
    { key: K.Penalty, status: 'EDITED', text: 'If the Buyer delays payment by more than 10 days, a penalty applies.' },
    { key: K['Late handover penalty'], status: 'REJECTED' },
  ], 'Added clauses');
  assert.ok(r.text.includes('The Buyer may terminate this agreement if the handover is late.'));
  assert.ok(!r.text.includes('may not terminate'));
  assert.ok(r.text.includes('by more than 10 days'));
  assert.ok(r.text.includes('The Seller shall hand over the apartment by 31 December 2027.'), 'untouched wording stays');
  assert.ok(!r.text.includes('Added clauses'), 'a rejected new clause is not added');
  assert.deepEqual(r.changes.map((c) => c.key), [K['Lock-in'], K.Penalty]);
  assert.equal(r.changes[0].before, ANALYSIS.clauses[0].quote);
});

test('a proposal whose wording is not in the text is reported, never guessed into place', () => {
  const r = applyDecisions(TEXT, reviewItems(ANALYSIS), [{ key: K.Ghost, status: 'ACCEPTED' }], 'Added clauses');
  assert.equal(r.text, TEXT);
  assert.deepEqual(r.unplaced, [K.Ghost]);
  assert.equal(r.unplacedReasons[K.Ghost], 'NOT_FOUND');
});

test('an accepted new clause goes at the end under its own heading', () => {
  const r = applyDecisions(TEXT, reviewItems(ANALYSIS), [{ key: K['Late handover penalty'], status: 'ACCEPTED' }], 'Added clauses');
  assert.ok(r.text.startsWith(TEXT));
  assert.ok(r.text.endsWith('Added clauses\n1. The Seller pays 0.1% per day for late handover.'));
});

test('an empty edit changes nothing', () => {
  const item = reviewItems(ANALYSIS)[0];
  assert.equal(replacementFor(item, { key: item.key, status: 'EDITED', text: '   ' }), null);
});

test('quotes are found across line breaks and spacing the PDF introduced', () => {
  const at = locate('The Buyer may not\nterminate   this agreement.', 'The Buyer may not terminate this agreement.');
  assert.ok(at);
  assert.equal(locate('abc', 'xyz'), null);
});

test('the .docx is a valid package with the chosen text, and the tracked variant marks the change', () => {
  const items = reviewItems(ANALYSIS);
  const r = applyDecisions(TEXT, items, [{ key: K['Lock-in'], status: 'ACCEPTED' }, { key: K['Late handover penalty'], status: 'ACCEPTED' }], 'Added clauses');
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

/* ---- audit fixes: quote-hash keys, analysis identity, unplaced detection, DOCX line breaks ---- */

test('keys come from the quote, not the position: reordering clauses keeps every decision on its clause', () => {
  const reordered = { ...ANALYSIS, clauses: [...ANALYSIS.clauses].reverse() };
  const a = Object.fromEntries(reviewItems(ANALYSIS).map((i) => [i.label, i.key]));
  const b = Object.fromEntries(reviewItems(reordered).map((i) => [i.label, i.key]));
  assert.deepEqual(a, b);
  assert.equal(a['Lock-in'], quoteKey('CLAUSE', ANALYSIS.clauses[0].quote));
  // Re-wrapped whitespace is the same quote; different wording is a different key.
  assert.equal(quoteKey('CLAUSE', 'The Buyer may\n not   terminate'), quoteKey('CLAUSE', 'The Buyer may not terminate'));
  assert.notEqual(quoteKey('CLAUSE', 'The Buyer may terminate'), quoteKey('CLAUSE', 'The Buyer may not terminate'));
  assert.equal(hash53('abc'), hash53('abc'));
  assert.notEqual(hash53('abc'), hash53('abd'));
});

test('the same wording flagged twice gets two distinct, stable keys', () => {
  const dup = { clauses: [ANALYSIS.clauses[0], { ...ANALYSIS.clauses[0], label: 'Lock-in again' }], missingProtections: [] };
  const keys = reviewItems(dup).map((i) => i.key);
  assert.equal(new Set(keys).size, 2);
  assert.equal(keys[1], `${keys[0]}~2`);
});

test('a revision saved against another analysis is stale; the same analysis is not', () => {
  const current = { ...ANALYSIS, analysisSha: 'sha-new', analysedAt: '2026-10-24T10:00:00Z' };
  assert.equal(analysisIdentity(current), 'sha-new');
  assert.equal(isStaleRevision('sha-new', current), false);
  assert.equal(isStaleRevision('sha-old', current), true);
  assert.equal(isStaleRevision(null, current), true, 'a revision with no identity is never applied');
  // Older analyses without a hash still get a stable identity that changes with time or content.
  const legacy = { ...ANALYSIS, analysedAt: '2026-10-01T00:00:00Z' };
  assert.equal(analysisIdentity(legacy), analysisIdentity({ ...legacy }));
  assert.notEqual(analysisIdentity(legacy), analysisIdentity({ ...legacy, analysedAt: '2026-10-02T00:00:00Z' }));
  assert.equal(draftStorageKey('doc1', 'sha-new'), 'hm.contract.draft.doc1.sha-new');
});

test('a quote cut at the cap is unplaced, shown but never inserted', () => {
  const long = 'A'.repeat(QUOTE_CAP);
  const text = `${long} and the rest of the clause.`;
  assert.equal(isQuoteTruncated({ quote: long }), true, 'an older analysis at the cap is treated as cut');
  assert.equal(isQuoteTruncated({ quote: 'short', quoteTruncated: true }), true);
  assert.equal(isQuoteTruncated({ quote: 'short' }), false);
  const analysis = { clauses: [{ label: 'Long', plain: 'p', quote: long, page: 1, attention: 'UNUSUAL', review: review('Replacement.'), quoteTruncated: true }], missingProtections: [] };
  const items = reviewItems(analysis);
  assert.equal(items[0].quoteTruncated, true);
  const r = applyDecisions(text, items, [{ key: items[0].key, status: 'ACCEPTED' }], 'Added');
  assert.equal(r.text, text, 'the text is untouched');
  assert.deepEqual(r.unplaced, [items[0].key]);
  assert.equal(r.unplacedReasons[items[0].key], 'TRUNCATED');
  assert.deepEqual(r.changes, []);
});

test('only verbatim wording is placed: whitespace may differ, case and words may not', () => {
  assert.ok(locate('The Buyer may not\nterminate.', 'The Buyer may not terminate.'));
  assert.equal(locate('the buyer may not terminate.', 'The Buyer may not terminate.'), null);
  assert.equal(locate('The Buyer may never terminate.', 'The Buyer may not terminate.'), null);
});

test('DOCX: line breaks inside inserted and replaced text become real w:br breaks', () => {
  assert.equal(runText('one\ntwo'), '<w:t xml:space="preserve">one</w:t><w:br/><w:t xml:space="preserve">two</w:t>');
  assert.equal(runText('a\r\nb', 'w:delText'), '<w:delText xml:space="preserve">a</w:delText><w:br/><w:delText xml:space="preserve">b</w:delText>');
  const items = reviewItems(ANALYSIS);
  const r = applyDecisions(TEXT, items, [
    { key: K['Lock-in'], status: 'EDITED', text: 'First line of the new clause.\nSecond line of the new clause.' },
    { key: K['Late handover penalty'], status: 'EDITED', text: 'Added line one.\nAdded line two.' },
  ], 'Added clauses');
  const xml = strFromU8(unzipSync(buildDocx({ title: 'T', text: r.text, tracked: { original: TEXT, changes: r.changes, author: 'HOMATCH', addedHeading: 'Added clauses' } }))['word/document.xml']);
  assert.match(xml, /<w:ins [^>]*><w:r><w:t xml:space="preserve">First line of the new clause\.<\/w:t><w:br\/><w:t xml:space="preserve">Second line of the new clause\.<\/w:t><\/w:r><\/w:ins>/);
  assert.match(xml, /Added line one\.<\/w:t><w:br\/><w:t xml:space="preserve">Added line two\./);
  assert.ok(!/<w:t[^>]*>[^<]*\n/.test(xml), 'no raw newline is left inside a text node');
});

test('DOCX: export notes (a partly reviewed contract) are printed under the title', () => {
  const xml = strFromU8(unzipSync(buildDocx({ title: 'T', text: 'Body', notes: ['Only the first part was reviewed.'] }))['word/document.xml']);
  assert.match(xml, /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">Only the first part was reviewed\.<\/w:t>/);
  assert.ok(xml.indexOf('Only the first part') < xml.indexOf('Body'));
});
