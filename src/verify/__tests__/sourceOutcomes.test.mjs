// Task-state honesty on the job side (Verify V1 audit F2/F3). Fixtures are
// the shapes of production job 61c1c38c (2026-10-22), personal data removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskResult, queueWorkerView, failedTaskOutcome, singleTaskView } from '../queueOfficial.ts';
import { rsVerificationStatusOf, rsRecordFound, rsTaxpayerLegalStatus, rsDomOnlyNoResult } from '../rsTaxpayer.ts';
import { providerOutcomes } from '../providerOutcomes.ts';

let n = 0;
const row = (o) => ({ id: `s${++n}`, created_at: `2026-10-22T11:5${n % 10}:00Z`, finished_at: `2026-10-22T12:0${n % 10}:00Z`, attempts: 1, input: { cadastral: '01.14.07.001.044' }, ...o });
const doc = (i) => ({ id: `d${i}`, url: `https://bs.napr.gov.ge/GetBlob?pid=101&bid=X${i}`, complete: true, rawText: 'ამონაწერი საჯარო რეესტრიდან [redacted]' });

const mygovPartial = {
  source: 'mygov', status: 'BLOCKED', blocked: true, captcha: true, error: 'CAPTCHA_REQUIRED: automatic verification BUDGET_EXHAUSTED',
  documents: [doc(1), doc(2)], documentsExtracted: 65, documentsDiscovered: 164, sourceOutcome: 'PARTIAL', outcomeReason: 'CAPTCHA_BUDGET_EXHAUSTED',
  captchaResolution: [{ outcome: 'ACCEPTED', attempts: 1 }, { outcome: 'BUDGET_EXHAUSTED', attempts: 0 }],
};
// The stored rstax record of task cabca14f (company 405456359): a page read over an unreadable answer.
const rsDomOnly = {
  source: 'rstax', status: 'NO_RESULT_CONFIRMED', noResultConfirmed: true, resultConfirmed: false, taxpayerData: null,
  forEntity: { name: 'შპს ტესტი', idCode: '405000000' },
  rsVerification: { reason: 'PAGE_READ_UNPARSEABLE', status: 'VERIFIED', columns: [], rowCount: 0, httpStatus: 200, serverOutcome: 'NO_RESULT', responseFormat: 'JSON', rawResponseRef: { sha256: 'f'.repeat(64) } },
  captchaResolution: [{ type: 'RECAPTCHA_V2', outcome: 'ACCEPTED', attempts: 1 }],
};

test('a PARTIAL MyGov task keeps what it read, its BLOCKED status and its precise outcome', () => {
  const r = taskResult(row({ source: 'mygov', dedupe_key: 'mygov', state: 'SUCCEEDED', result: mygovPartial }));
  assert.equal(r.status, 'BLOCKED', 'still disclosed as not verified by the report');
  assert.equal(r.sourceOutcome, 'PARTIAL');
  assert.equal(r.documents.length, 2);
  const outs = providerOutcomes({ browserOfficial: { results: [r] } });
  assert.deepEqual(outs.find((o) => o.provider === 'mygov'), { provider: 'mygov', state: 'PARTIAL', reason: 'CAPTCHA_BUDGET_EXHAUSTED', evidenceCount: 2 });
});

test('a cached / pre-fix RS.ge "no record" read off the page is a failed check, never a confirmed absence', () => {
  assert.equal(rsDomOnlyNoResult(rsDomOnly.rsVerification), true);
  assert.equal(rsVerificationStatusOf(rsDomOnly), 'VERIFICATION_FAILED');
  assert.equal(rsRecordFound(rsDomOnly), null);
  assert.equal(rsTaxpayerLegalStatus([rsDomOnly]), 'NOT_CONFIRMED');
  const r = taskResult(row({ source: 'rstax', dedupe_key: 'rstax:405000000', state: 'SUCCEEDED', reused: 'CACHE', result: rsDomOnly, input: { idCode: '405000000', name: 'შპს ტესტი' } }));
  assert.equal(r.status, 'VERIFICATION_FAILED');
  assert.equal(r.noResultConfirmed, false);
  assert.equal(r.sourceOutcome, 'UNPARSEABLE');
  assert.equal(r.rsVerification.status, 'VERIFICATION_FAILED');
  assert.equal(singleTaskView(row({ source: 'rstax', dedupe_key: 'rstax:405000000', state: 'SUCCEEDED', result: rsDomOnly })).results[0].status, 'VERIFICATION_FAILED');
  // RS.ge's own empty grid stays a validated no-record.
  const real = { ...rsDomOnly, rsVerification: { ...rsDomOnly.rsVerification, reason: null } };
  assert.equal(rsVerificationStatusOf(real), 'VERIFIED');
  assert.equal(rsRecordFound(real), false);
  assert.equal(taskResult(row({ source: 'rstax', dedupe_key: 'rstax:405000000', state: 'SUCCEEDED', result: real })).status, 'NO_RESULT_CONFIRMED');
});

test('failed tasks carry their outcome: tagged by the worker, derived for older rows, RETRY_EXHAUSTED when DEAD', () => {
  assert.deepEqual(failedTaskOutcome('FAILED', 'RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=UNPARSEABLE http=200 evidence=' + 'a'.repeat(64) + ' sourceOutcome=UNPARSEABLE reason=NO_ROW_ARRAY solves=1'), { sourceOutcome: 'UNPARSEABLE', outcomeReason: 'NO_ROW_ARRAY' });
  assert.deepEqual(failedTaskOutcome('FAILED', 'RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=UNPARSEABLE http=200 evidence=' + 'a'.repeat(64)), { sourceOutcome: 'UNPARSEABLE', outcomeReason: null }, 'the production row, untagged');
  assert.deepEqual(failedTaskOutcome('FAILED', 'HUMAN_VERIFICATION_REQUIRED:NO_CHANGE'), { sourceOutcome: 'CAPTCHA_BLOCKED', outcomeReason: null });
  assert.deepEqual(failedTaskOutcome('DEAD', 'LEASE_EXPIRED after 3 attempts'), { sourceOutcome: 'RETRY_EXHAUSTED', outcomeReason: 'PROVIDER_UNAVAILABLE' });
  const r = taskResult(row({ source: 'rstax', dedupe_key: 'rstax:405000001', state: 'FAILED', input: { idCode: '405000001', name: 'X' }, error: 'RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=UNPARSEABLE http=200 sourceOutcome=UNPARSEABLE reason=NO_ROW_ARRAY' }));
  assert.equal(r.status, 'VERIFICATION_FAILED');
  assert.equal(r.sourceOutcome, 'UNPARSEABLE');
  assert.equal(r.error, 'SOURCE_UNAVAILABLE', 'internal error text never travels');
  const outs = providerOutcomes({ browserOfficial: { results: [r] } }, []);
  assert.equal(outs.find((o) => o.provider === 'rstax').state, 'SOURCE_CHANGED');
});

test('the queue view never counts a failed or partial source as confirmed', () => {
  const view = queueWorkerView([
    row({ source: 'TAS_MAP', dedupe_key: 'TAS_MAP', state: 'SUCCEEDED', result: { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', documents: [doc(9)] } }),
    row({ source: 'mygov', dedupe_key: 'mygov', state: 'SUCCEEDED', result: mygovPartial }),
    row({ source: 'rstax', dedupe_key: 'rstax:405000000', state: 'SUCCEEDED', result: rsDomOnly }),
  ]);
  const confirmed = view.results.filter((r) => r.status === 'SEARCH_CONFIRMED' || r.status === 'NO_RESULT_CONFIRMED').map((r) => r.source);
  assert.deepEqual(confirmed, ['TAS_MAP']);
});

test('research-agent: officialVerificationComplete needs every source verified in full; RS.ge failure states are technical failures', () => {
  const src = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  const summary = src.slice(src.indexOf('function officialVerificationSummary('), src.indexOf('const COVERAGE_NOTE_I18N'));
  assert.match(summary, /notVerified\.length === 0 && skipped\.length === 0 && !results\.some\(\(r: any\) => r\.sourceOutcome === 'PARTIAL'\)/);
  const status = src.slice(src.indexOf('function customerSourceStatus('), src.indexOf('// One row per adapter'));
  for (const s of ['VERIFICATION_FAILED', 'TEMPORARILY_UNAVAILABLE', 'SUBMITTED_UNPARSED']) assert.ok(status.indexOf(`case '${s}'`) > 0 && status.indexOf(`case '${s}'`) < status.indexOf("return 'TECHNICAL_FAILED'"), s);
});
