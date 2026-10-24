// Contracts audit: what the analyser tells the page about what it could NOT do.
//   · a document cut at MAX_DOCUMENT_CHARS is flagged, so the page and exports can warn;
//   · a quote cut at MAX_QUOTE is flagged, so its replacement is never auto-placed;
//   · the prompt says a suggestion replaces exactly the quoted text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_DOCUMENT_CHARS, MAX_QUOTE, buildAnalysisPrompt, documentTextWasTruncated, normalizeDocumentText, parseAnalysis,
} from '../../dealroom/domain/documentExtract.ts';
import { QUOTE_CAP } from '../revisions.ts';

test('the client cap mirrors the analyser cap', () => {
  assert.equal(QUOTE_CAP, MAX_QUOTE);
});

test('a document longer than the analysis window is reported as truncated; a short one is not', () => {
  assert.equal(documentTextWasTruncated('A short contract.'), false);
  const long = 'word '.repeat(Math.ceil(MAX_DOCUMENT_CHARS / 5) + 100);
  assert.equal(documentTextWasTruncated(long), true);
  assert.equal(normalizeDocumentText(long).length, MAX_DOCUMENT_CHARS, 'normalizing still caps the text');
  // Whitespace that normalizing removes does not count as length.
  assert.equal(documentTextWasTruncated(`${'x'.repeat(MAX_DOCUMENT_CHARS)}${' '.repeat(5000)}`), false);
});

test('a clause quote longer than the cap is kept cut and flagged; a short one carries no flag', () => {
  const clause = 'The Buyer shall pay. '.repeat(40).trim(); // over 600 characters
  assert.ok(clause.length > MAX_QUOTE);
  const doc = `${clause}\nThe Seller shall hand over the keys.`;
  const out = parseAnalysis(JSON.stringify({
    clauses: [
      { label: 'Long', plain: 'You pay.', quote: clause, page: 1, attention: 'UNUSUAL', review: { risk: 'r', why: 'w', favours: 'SELLER', suggestion: 's', tradeoffs: null } },
      { label: 'Keys', plain: 'Keys are handed over.', quote: 'The Seller shall hand over the keys.', page: 1, attention: 'NORMAL' },
    ],
  }), doc);
  const long = out.clauses.find((c) => c.label === 'Long');
  const keys = out.clauses.find((c) => c.label === 'Keys');
  assert.equal(long.quote.length, MAX_QUOTE);
  assert.equal(long.quoteTruncated, true);
  assert.equal('quoteTruncated' in keys, false);
});

test('the prompt states that a suggestion replaces exactly the quoted text, within the cap', () => {
  const { system } = buildAnalysisPrompt('A contract.', { interestingFactTypes: [] });
  assert.match(system, /REPLACES EXACTLY the text in that clause's `quote`/);
  assert.match(system, new RegExp(`under ${MAX_QUOTE} characters`));
});

test('the edge function stores textTruncated and an analysis identity with every analysis', () => {
  const fn = readFileSync(new URL('../../../supabase/functions/deal-room-document-analyze/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /textTruncated,/);
  assert.match(fn, /documentTextWasTruncated\(raw\)/);
  assert.match(fn, /analysis: \{ \.\.\.stored, analysisSha \}/);
});

test('revisions carry their analysis identity and are purged with the contract text', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261201094000_contract_revisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /analysis_sha text not null/);
  assert.match(sql, /after update of extracted_text on public\.deal_room_documents/);
  assert.match(sql, /when \(old\.extracted_text is not null and new\.extracted_text is null\)/);
  assert.match(sql, /delete from public\.contract_revisions where document_id = new\.id/);
});
