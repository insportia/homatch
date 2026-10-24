// Contracts audit: the review page and the waiting game, checked at the source.
//   · the Snake beside a running analysis is behind an error boundary, takes keys only while focused,
//     and keeps its setState updaters pure;
//   · unsaved decisions survive a trip to Ask HOMI (sessionStorage, keyed by document and analysis);
//   · a stale revision is never applied; the PDF button promises the browser's print dialog, nothing more.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const snake = code('src/components/contracts/SnakeGame.tsx');
const progress = code('src/components/contracts/ContractProgress.tsx');
const review = code('src/components/contracts/ContractReview.tsx');

test('the contract Snake cannot take the analysis page down with it', () => {
  assert.match(progress, /class SnakeBoundary extends React\.Component/);
  assert.match(progress, /<SnakeBoundary onFailed=\{\(\) => setPlaying\(false\)\}>\s*<Suspense fallback=\{null\}>\s*<SnakeGame /);
});

test('arrow keys reach the Snake only while it has focus', () => {
  assert.doesNotMatch(snake, /window\.addEventListener\(\s*'keydown'/, 'no page-wide key listener');
  assert.match(snake, /tabIndex=\{0\} onKeyDown=\{onKeyDown\}/);
  assert.match(snake, /INPUT\|TEXTAREA\|SELECT/);
});

test('no side effects inside a setState updater', () => {
  // The old game-over path called setBest and sessionStorage from inside setScore((sc) => ...).
  assert.doesNotMatch(snake, /set[A-Z]\w*\(\([^)]*\)\s*=>\s*\{[^}]*set[A-Z]/);
  assert.doesNotMatch(snake, /set[A-Z]\w*\(\([^)]*\)\s*=>\s*\{[^}]*sessionStorage/);
});

test('the draft is kept per document and analysis, and stale revisions are not restorable', () => {
  assert.match(review, /draftStorageKey\(documentId, analysisId\)/);
  assert.match(review, /sessionStorage\.setItem\(key, JSON\.stringify\(d\)\)/);
  assert.match(review, /isStaleRevision\(h\.analysisSha, analysis\)/);
  assert.match(review, /saveRevision\(\{ documentId, analysisSha: analysisId,/);
});

test('the print button names the browser print dialog, and the truncation warning reaches exports', () => {
  assert.match(review, /t\('ct_rev_print_pdf'\)/);
  assert.match(review, /t\('ct_rev_print_hint'\)/);
  assert.doesNotMatch(review, /t\('ct_rev_pdf'\)/, 'the old "Save as PDF" label promised a file');
  assert.match(review, /notes: exportNotes/);
  assert.match(review, /isRTL \? 'rtl' : 'ltr', exportNotes\)/);
});
