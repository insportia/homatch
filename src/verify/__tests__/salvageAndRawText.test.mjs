// Owner, 2026-10-11 (jobs eeefada9, dbf04e48): one weak item made the gate
// reject the whole model report, and the no-model template then showed raw
// record lists ("2013-07-17, გადაწყვეტილება:." and "Cadastral code: …").

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isDateList, isRawRecord, RAW_FINDING_WHY } from '../intelligence/rawText.ts';
import { salvageReport, validateReport } from '../intelligence/report.ts';

test('date lists and raw record lines are recognised; prose is not', () => {
  assert.equal(isDateList('2013-07-17, გადაწყვეტილება:. 2023-08-09, გადაწყვეტილება:. 2024-02-13, გადაწყვეტილება:. 2024-04-05, გადაწყვეტილება:.'), true);
  assert.equal(isDateList('2012-12-13, ნებართვა:. 2023-08-10, შეთანხმება:. 2024-07-29, შეთანხმება:.'), true);
  assert.equal(isDateList('2024 წელს პროექტმა რამდენიმე ადმინისტრაციული ეტაპი გაიარა. 29 ივლისს შეთანხმდა პროექტი, ხოლო 2 სექტემბერს გაიცა მშენებლობის ნებართვა.'), false);
  assert.equal(isDateList('2024-07-29 შეთანხმდა პროექტი, რომელიც შემდეგ რამდენჯერმე დაზუსტდა; 2025-04-03 დამტკიცდა კორექტირებული ვერსია, ხოლო 2025-12-30 კიდევ ერთი ცვლილება შევიდა და მას ფართობების გადაანგარიშება მოჰყვა.'), false);
  assert.equal(isRawRecord('Cadastral code: 01.72.14.040.030.01.01.004'), true);
  assert.equal(isRawRecord('Application registration: 882026515135'), true);
  assert.equal(isRawRecord('ბინა რეგისტრირებულია კერძო პირის სახელზე.'), false);
  assert.ok(RAW_FINDING_WHY.length > 0);
});

test('an uncited item is removed; the rest of the model report survives the gate', () => {
  const pkg = { items: [{ id: 'e1', claim: 'x', category: 'PROPERTY', tier: 1 }], tas: null };
  const candidate = {
    summary: { label: 'BALANCED', statement: 'შეჯამება.', highlights: [{ dimension: 'LEGAL_CONTEXT', headline: 'სათაური', detail: 'დეტალი', cites: ['e1'] }] },
    keyFindings: [{ finding: 'მიგნება', whyItMatters: 'რატომ', sentiment: 'BALANCED', cites: ['e1'] }],
    sections: [
      { key: 'SNAPSHOT', title: 'ქონება', body: 'მოკლე ტექსტი.', metrics: [], cites: ['e1'] },
      { key: 'MARKET', title: 'ბაზარი', body: 'ძალიან გრძელი ბაზრის ტექსტი წყაროს გარეშე. '.repeat(10), metrics: [], cites: [] },
    ],
    currentStatus: { statement: 'სტატუსი.', items: [{ label: 'a', value: 'b', date: '', cites: [] }, { label: 'c', value: 'd', date: '', cites: ['e1'] }] },
    nextSteps: [], attentionPoints: [], finalView: 'ბოლო.',
  };
  const before = validateReport(pkg, candidate);
  assert.equal(before.ok, false, 'the old gate rejected the whole report');
  const { report, pruned } = salvageReport(pkg, candidate);
  assert.deepEqual(report.sections.map((s) => s.key), ['SNAPSHOT']);
  assert.equal(report.currentStatus.items.length, 1);
  assert.ok(pruned.length >= 2);
  assert.equal(validateReport(pkg, report).ok, true);
});

test('wiring: finalize salvages first; no raw findings; stored reports are filtered on render', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const rep = readFileSync(join(root, 'src/verify/intelligence/report.ts'), 'utf8');
  assert.match(rep, /const salvaged = salvageReport\(pkg, parseReport\(raw\), \{ thorough: opts\.fieldOwnership === 'CODE' \}\)/);
  assert.match(rep, /const keyFindings: KeyFinding\[\] = \[\];/);
  assert.match(rep, /if \(isDateList\(lines\.join\(' '\)\)\) continue;/);
  const vr = readFileSync(join(root, 'src/components/verify/VerifyReport.tsx'), 'utf8');
  assert.match(vr, /f\.whyItMatters !== RAW_FINDING_WHY && !isRawRecord\(f\.finding\)/);
  const oi = readFileSync(join(root, 'src/components/verify/OfficialIntelligence.tsx'), 'utf8');
  assert.match(oi, /!isDateList\(c\.body\)/);
});
