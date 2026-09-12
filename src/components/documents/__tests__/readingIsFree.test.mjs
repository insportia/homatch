import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * READING A DOCUMENT MUST NEVER BUY AN ANALYSIS.
 *
 * Contract analysis is a metered, billed execution: it holds credits, calls
 * a provider and settles against the wallet. Opening a finished document to
 * re-read a clause is not that, and a customer who opens the same contract
 * three times must not be charged three times.
 *
 * The workspace redesign makes this easier to get wrong, not harder. The
 * reader used to mount only when someone deliberately opened a drawer; it is
 * now the centre pane, mounted whenever a document is selected, and
 * selecting happens on a single click. So a stray analysis call in the
 * reader's mount path would fire on every click through the library.
 *
 * These are source-level assertions on purpose. The property is "this call
 * does not appear on this path", which is exactly what a reader of the file
 * checks, and it holds without a database, a wallet or a provider.
 */

const reader = readFileSync('src/components/documents/DocumentReader.tsx', 'utf8');
const workspace = readFileSync('src/components/documents/DocumentWorkspace.tsx', 'utf8');
const card = readFileSync('src/components/documents/DocumentCard.tsx', 'utf8');
const dropZone = readFileSync('src/components/documents/DropZone.tsx', 'utf8');

/** The calls that cost money, by the names the services export. */
const BILLED = ['analyzeDocument', 'beginExecution', 'settleExecution', 'reserveCredits'];

test('the reader never calls anything billed', () => {
  for (const call of BILLED) {
    assert.equal(
      reader.includes(call), false,
      `DocumentReader references ${call}; reading must not be a billed path`,
    );
  }
});

test('the workspace never calls anything billed', () => {
  for (const call of BILLED) {
    assert.equal(
      workspace.includes(call), false,
      `DocumentWorkspace references ${call}; selecting a document must not bill`,
    );
  }
});

test('the reader only READS on mount', () => {
  // Its effect fetches the extracted text and the event log. Both already
  // exist by the time a document can be opened.
  assert.match(reader, /getExtractedText\(/);
  assert.match(reader, /listDocumentEvents\(/);
});

test('reanalysis stays an explicit, deliberate action', () => {
  // Reachable only from the card's menu — never from mounting or selecting.
  assert.match(card, /onReanalyze/);
  assert.match(card, /DropdownMenuItem[^>]*onClick=\{\(\) => void run\(\(\) => actions\.onReanalyze\(doc\)\)\}/);
  // And it is not something the reader can invoke at all.
  assert.equal(reader.includes('onReanalyze'), false);
});

test('selecting a document in the library only changes selection', () => {
  // The desktop wrapper's click handler calls onSelectDoc and nothing else.
  const match = workspace.match(/onClick=\{\(\) => onSelectDoc\(d\)\}/);
  assert.ok(match, 'the library row should select and do nothing more');
});

test('the inline reader is given no way to close, and no way to re-run', () => {
  // onOpenChange is a deliberate no-op inline: there is no drawer to close,
  // and wiring it to anything stateful would be a second source of truth.
  assert.match(workspace, /variant="inline"/);
  assert.match(workspace, /inline: there is nothing to close/);
});

test('choosing a file is not the same event as paying for an analysis', () => {
  // The upload control became a drop zone, which means a contract can now
  // arrive by being let go of rather than by a deliberate trip through a
  // file picker. That makes it MORE important, not less, that this
  // component hands the file onward and does nothing else: a drop is easy
  // to do by accident.
  for (const call of BILLED) {
    assert.equal(
      dropZone.includes(call), false,
      `DropZone references ${call}; choosing a file must not bill`,
    );
  }
  // It has one output, and validation is not its job either.
  assert.match(dropZone, /onFile: \(file: File\) => void;/);
  assert.equal(dropZone.includes('validateUpload'), false);
  assert.equal(dropZone.includes('supabase'), false);
});

test('a missed drop cannot navigate the page away', () => {
  // Drop a PDF anywhere outside the zone and the browser opens it,
  // discarding whatever the customer was in the middle of.
  assert.match(dropZone, /window\.addEventListener\('drop', swallow\)/);
  assert.match(dropZone, /window\.addEventListener\('dragover', swallow\)/);
});

test('the drag highlight does not flicker over child elements', () => {
  // dragleave fires on every crossing into a child, so a boolean flag
  // blinks as the pointer moves across the icon and the text inside.
  assert.match(dropZone, /depth\.current \+= 1/);
  assert.match(dropZone, /depth\.current = Math\.max\(0, depth\.current - 1\)/);
  assert.match(dropZone, /if \(depth\.current === 0\) setOver\(false\)/);
});
