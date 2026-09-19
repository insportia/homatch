import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * THE REPORT INTRODUCED ITSELF THREE TIMES.
 *
 * Measured on the live Villion report. Before a reader reached one detail:
 *
 *   1. "მოკლე დასკვნა მყიდველისთვის" — verdict, statement, six highlight
 *      cards
 *   2. "რა აღმოაჩინა Homatch-მა"     — seven key findings restating them
 *   3. "დღევანდელი სურათი"           — a SNAPSHOT section restating the
 *      property facts the structured snapshot had just rendered as rows
 *
 * Each block was individually defensible. Together they meant the same facts
 * arrived three times in three shapes, and the detailed report began roughly
 * a screen and a half down.
 *
 * ONE introduction now: the verdict and statement, continued by the findings
 * without a second heading. The highlight grid is gone because the findings
 * say the same things and each carries WHY it matters. The SNAPSHOT section's
 * prose is dropped only when the structured snapshot is present to carry
 * those facts, and its metrics are moved rather than lost.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(here, '../VerifyReport.tsx'), 'utf8');
const code = SRC.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the report has exactly one introduction heading', () => {
  // The summary eyebrow is the one opening. The findings heading was the
  // second, and must not return.
  assert.equal(
    (code.match(/verify_ir_summary_title/g) ?? []).length, 1,
    'the summary title must appear exactly once'
  );
  assert.equal(
    code.includes('verify_ir_findings_title'), false,
    'the findings heading was the second introduction and must not come back'
  );
});

test('the findings are the continuation of that introduction, not a new section', () => {
  const findings = code.slice(code.indexOf('const KeyFindings'), code.indexOf('const Snapshot'));
  assert.ok(findings.length > 0, 'KeyFindings must still exist');
  assert.equal(
    /<h2/.test(findings), false,
    'KeyFindings must not open with its own heading'
  );
  // It still renders the findings themselves, at the agreed ceiling.
  assert.match(findings, /findings\.slice\(0, 7\)/);
});

test('the verdict block no longer restates the findings as cards', () => {
  const hero = code.slice(code.indexOf('const SummaryHero'), code.indexOf('const KeyFindings'));
  assert.ok(hero.length > 0);
  assert.equal(
    /highlights\.map\(/.test(hero), false,
    'the highlight grid duplicated the findings and must not return'
  );
  // The verdict and the statement — the actual introduction — remain.
  assert.match(hero, /OVERALL_KEY\[label\]/);
  assert.match(hero, /summary\.statement/);
});

test('the duplicate snapshot section is dropped, but only when the snapshot exists', () => {
  assert.match(
    code,
    /synthesis\.snapshot\s*\?\s*allSections\.filter\(\(s\) => s\.key !== 'SNAPSHOT'\)\s*:\s*allSections/,
    'the SNAPSHOT section may only be dropped when the structured snapshot can carry it'
  );
});

test('the dropped section keeps its figures', () => {
  assert.match(code, /snapshotSection\?\.metrics \?\? \[\]/, 'its metrics must be preserved');
  assert.match(code, /snapshotMetrics\.length \? <Metrics metrics=\{snapshotMetrics\}/,
    'and rendered with the snapshot');
});

test('no other top-level introduction is introduced', () => {
  // Every <h2> in the report body, so a future edit cannot quietly add a
  // fourth opening above the detail sections.
  const headings = [...code.matchAll(/<h2[^>]*>\s*\{t\('([a-z_]+)'\)\}/g)].map((m) => m[1]);
  const introLike = headings.filter((k) =>
    /summary|findings|overview|snapshot|picture/.test(k)
  );
  assert.deepEqual(
    introLike, [],
    `no heading may read as a second overview, found: ${introLike.join(', ')}`
  );
});
