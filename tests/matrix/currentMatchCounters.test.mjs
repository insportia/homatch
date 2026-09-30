// ONE definition of "current matches". Every screen that counts matches reads
// them through matching/currentDemand.ts, so a property's header, its card, the
// Matches page and the insights page can never disagree (property 244486 showed
// 55 / 38 / 10 in its header and 14 / 0 / 9 in its Matches section because the
// header counted history as current).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

const COUNTERS = [
  'src/services/propertyManagement.ts',
  'src/pages/outreach/OutreachInsightsPage.tsx',
  'src/services/matchingProgress.ts',
];

for (const file of COUNTERS) {
  test(`${file} counts only current demand`, () => {
    const src = read(file);
    assert.match(src, /from '@\/matching\/currentDemand'/, 'imports the canonical rule');
    assert.match(src, /isHistoryMatch\(/, 'skips history');
    assert.match(src, /selectWithDemandDate/, 'reads the demand date');
  });
}

test('portfolioIntelligence skips history before counting total, new and strong', () => {
  const src = read('src/services/propertyManagement.ts');
  const body = src.slice(src.indexOf('export async function portfolioIntelligence'));
  const skip = body.indexOf('if (isHistoryMatch(row)) continue;');
  assert.ok(skip > 0 && skip < body.indexOf('entry.total += 1'), 'history is skipped before any count');
  assert.doesNotMatch(body.slice(0, 2000), /244486/, 'no property-specific rule');
});
