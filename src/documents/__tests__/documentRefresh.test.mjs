import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { documentStatus } from '../documentModel.ts';

/*
 * "რიგშია წასაკითხად", FOREVER — measured, not guessed.
 *
 * Live case 36f05c8f, document d4a86b9c, a 25 KB DOCX:
 *
 *   14:51:21.869  uploaded
 *   14:51:21.948  row created                            (+79ms)
 *   14:51:22.607  background job created                 (+659ms)
 *   14:51:45.033  job committed (15s cancel window)      (+22.4s)
 *   14:51:49.828  analysis_state DONE, analysis persisted (+27.9s)
 *   14:52:15.230  job COMPLETED (worker mirror tick)      (+53.4s)
 *
 * Nothing was slow enough to explain what the customer saw, and nothing
 * failed. The page had loaded the document row at 14:51:21 — when
 * analysis_state was still QUEUED — and `reload()` depends on [id] alone, so
 * it never ran again. documentStatus() faithfully reported QUEUED from a
 * snapshot minutes out of date.
 *
 * The mapping was never the bug. These tests prove that, and then prove the
 * page re-reads the row, which is the actual repair.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.resolve(here, '../../pages/VerificationCasePage.tsx'), 'utf8');
const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------------------------------------------ *
 * The mapping is correct — given a CURRENT row.                       *
 * ------------------------------------------------------------------ */

test('a finished analysis reads as ready, whatever the job row says', () => {
  // Exactly the production row at 14:51:49.
  assert.equal(
    documentStatus({ analysisState: 'DONE', hasAnalysis: true, jobState: 'PROCESSING' }),
    'READY',
    'the document row is the authority once the work is done'
  );
  assert.equal(documentStatus({ analysisState: 'DONE', hasAnalysis: true, jobState: 'COMPLETED' }), 'READY');
});

test('the stale snapshot is what produced the endless queue', () => {
  // The row as the page held it, with the job already finished. This is the
  // exact combination the customer was looking at.
  assert.equal(
    documentStatus({ analysisState: 'QUEUED', hasAnalysis: false, jobState: 'COMPLETED' }),
    'QUEUED',
    'a stale row cannot report anything but QUEUED — hence the fix is to re-read it'
  );
});

test('a live job still drives the stage while the row is behind', () => {
  assert.equal(documentStatus({ analysisState: 'QUEUED', jobState: 'COMMITTED' }), 'COMMITTED');
  assert.equal(documentStatus({ analysisState: 'RUNNING', jobState: 'PROCESSING', jobStage: 'ANALYZING' }), 'ANALYZING');
  assert.equal(documentStatus({ analysisState: 'RUNNING', jobState: 'PROCESSING', jobStage: 'EXTRACTING' }), 'EXTRACTING');
});

test('a stranded RUNNING row with no analysis is not reported as progress', () => {
  assert.equal(documentStatus({ analysisState: 'RUNNING', hasAnalysis: false }), 'FAILED');
  assert.equal(documentStatus({ analysisState: 'RUNNING', hasAnalysis: true }), 'READY');
});

/* ------------------------------------------------------------------ *
 * The repair: the page must re-read the row.                          *
 * ------------------------------------------------------------------ */

test('the case page re-reads its documents when a document job finishes', () => {
  assert.match(code, /const reloadDocuments = useCallback\(/, 'a documents-only refresh must exist');
  assert.match(code, /listWorkspaceDocuments\(id\)/);

  // Triggered by a document job reaching a terminal state — the fastest
  // signal available, since the job list already polls every four seconds.
  assert.match(code, /terminalDocumentJobs/, 'terminal document jobs must be observed');
  assert.match(code, /isTerminal\(j\.state\)/);
  assert.match(
    code,
    /useEffect\(\(\) => \{\s*if \(!terminalDocumentJobs\) return;\s*void reloadDocuments\(\);/,
    'a finished document job must trigger a re-read'
  );
});

test('the page keeps polling while any document is still in flight', () => {
  assert.match(code, /documentsInFlight/, 'in-flight documents must be tracked');
  assert.match(
    code,
    /d\.analysisState === 'QUEUED' \|\| d\.analysisState === 'RUNNING'/,
    'in-flight is read from the row, not from a timer'
  );
  assert.match(
    code,
    /setInterval\(\(\) => \{ void reloadDocuments\(\); \}, 4000\)/,
    'and it polls while something is genuinely unfinished'
  );
  assert.match(code, /clearInterval\(timer\)/, 'the poll must stop when nothing is in flight');
});

test('the refresh never blanks the list on a failed read', () => {
  const fn = code.slice(code.indexOf('const reloadDocuments'), code.indexOf('const documentsInFlight'));
  assert.match(fn, /catch \{/, 'a failed refresh keeps what the customer already has');
  assert.equal(
    /setDocuments\(\[\]\)/.test(fn), false,
    'an error must never clear the document list'
  );
});

/* ------------------------------------------------------------------ *
 * And the original one-shot load must not come back.                  *
 * ------------------------------------------------------------------ */

test('documents are not left as a single load-time snapshot', () => {
  // The defect in one line: reload() depends on [id] and runs once. That is
  // still true and still correct for the rest of the case — what must exist
  // alongside it is a document-specific refresh.
  const reloadOnly = code.match(/const reload = useCallback\([\s\S]*?\}, \[id\]\);/);
  assert.ok(reloadOnly, 'reload() still exists for the rest of the case');
  assert.ok(
    code.indexOf('reloadDocuments') > -1,
    'but documents must have their own refresh path'
  );
});
