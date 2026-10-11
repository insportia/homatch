// RS.ge taxpayer registry, end to end on the research-agent / report side:
// the four states, the legal matrix, the queue view, the finance view, the
// card model and the CAPTCHA cost row. A missing or failed check never reads
// positive, and nothing ever says "no tax debt".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  rsStatusFromTaskError, rsVerificationStatusOf, rsTaxpayerLegalStatus, rsRecordFound, rsStatusTone, rsTaxCardModel, withoutRsRaw,
} from '../rsTaxpayer.ts';
import { taskResult, queueWorkerView, singleTaskView } from '../queueOfficial.ts';
import { companyFinanceFrom } from '../intelligence/reportGaps.ts';
import { captchaCostEventRow } from '../../../supabase/functions/_shared/captchaCost.ts';

const DEV = '404670272';
const SHA = 'a'.repeat(64);
const record = (over = {}) => ({
  source: 'rstax', status: 'SEARCH_CONFIRMED', forEntity: { idCode: DEV, name: 'შპს მილენიო გრუპი' }, documents: [], retrievedAt: '2026-10-11T09:00:00.000Z',
  taxpayerData: { identificationCode: DEV, taxpayerName: 'შპს მილენიო გრუპი', legalForm: 'შპს', status: 'აქტიური', registrationDate: '2023-03-28', vatStatus: 'true', address: 'თბილისი', otherPublicFields: { TaxPayerType: 'იურიდიული პირი' } },
  rsVerification: { status: 'VERIFIED', serverOutcome: 'ACCEPTED', httpStatus: 200, checkedAt: '2026-10-11T09:00:00.000Z' },
  ...over,
});

test('task errors map to the four states (tagged first, legacy prefixes after)', () => {
  assert.equal(rsStatusFromTaskError(`RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=REJECTED http=200 evidence=${SHA}`), 'VERIFICATION_FAILED');
  assert.equal(rsStatusFromTaskError('RS_TEMPORARILY_UNAVAILABLE rs=TEMPORARILY_UNAVAILABLE outcome=HTTP_ERROR http=503'), 'TEMPORARILY_UNAVAILABLE');
  assert.equal(rsStatusFromTaskError('HUMAN_VERIFICATION_REQUIRED:DISABLED rs=PENDING_VERIFICATION outcome=NOT_SEARCHED http=-'), 'PENDING_VERIFICATION');
  assert.equal(rsStatusFromTaskError('HUMAN_VERIFICATION_REQUIRED:REJECTED'), 'VERIFICATION_FAILED');
  assert.equal(rsStatusFromTaskError('HUMAN_VERIFICATION_REQUIRED:NO_CHANGE'), 'PENDING_VERIFICATION');
  assert.equal(rsStatusFromTaskError('LEASE_EXPIRED'), 'TEMPORARILY_UNAVAILABLE');
});

test('stored results map to the four states; the "gave up waiting" placeholder is unavailable, never a finding', () => {
  assert.equal(rsVerificationStatusOf(record()), 'VERIFIED');
  assert.equal(rsVerificationStatusOf({ source: 'rstax', status: 'NO_RESULT_CONFIRMED' }), 'VERIFIED');
  assert.equal(rsVerificationStatusOf({ source: 'rstax', status: 'TIMEOUT', unavailable: true }), 'TEMPORARILY_UNAVAILABLE');
  assert.equal(rsVerificationStatusOf({ source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION' }), 'PENDING_VERIFICATION');
  assert.equal(rsVerificationStatusOf({ source: 'rstax', status: 'SUBMITTED_UNPARSED' }), 'VERIFICATION_FAILED');
  assert.equal(rsVerificationStatusOf(null), null);
  assert.equal(rsRecordFound(record()), true);
  assert.equal(rsRecordFound({ source: 'rstax', status: 'NO_RESULT_CONFIRMED' }), false);
  assert.equal(rsRecordFound({ source: 'rstax', status: 'TIMEOUT', unavailable: true }), null);
});

test('legal matrix: a record is positive (attention when liquidated/suspended); nothing else ever is', () => {
  assert.equal(rsTaxpayerLegalStatus([record()]), 'CONFIRMED_POSITIVE');
  assert.equal(rsTaxpayerLegalStatus([record({ taxpayerData: { ...record().taxpayerData, status: 'ლიკვიდირებული' } })]), 'CONFIRMED_ATTENTION');
  assert.equal(rsTaxpayerLegalStatus([record({ taxpayerData: { ...record().taxpayerData, status: 'Suspended' } })]), 'CONFIRMED_ATTENTION');
  assert.equal(rsTaxpayerLegalStatus([{ source: 'rstax', status: 'NO_RESULT_CONFIRMED' }]), 'NOT_CONFIRMED', 'no record is not a clean bill');
  assert.equal(rsTaxpayerLegalStatus([{ source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION' }]), 'HUMAN_VERIFICATION_REQUIRED');
  assert.equal(rsTaxpayerLegalStatus([{ source: 'rstax', status: 'TEMPORARILY_UNAVAILABLE', rsVerification: { status: 'TEMPORARILY_UNAVAILABLE' } }]), 'NOT_CONFIRMED');
  assert.equal(rsTaxpayerLegalStatus([{ source: 'rstax', status: 'VERIFICATION_FAILED', rsVerification: { status: 'VERIFICATION_FAILED' } }]), 'NOT_CONFIRMED');
  assert.equal(rsTaxpayerLegalStatus([]), 'NOT_CONFIRMED');
  assert.equal(rsStatusTone('აქტიური'), 'confirmed');
  assert.equal(rsStatusTone('შეჩერებული'), 'caution');
});

test('research-agent uses the shared mapping for the taxpayer category and waits ≥ 7 min for RS.ge', () => {
  const agent = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  assert.match(agent, /taxpayerStatus: rsTaxpayerLegalStatus\(prior\.browserOfficial\?\.results\)/);
  const m = /const QUEUE_RSTAX_MAX_WAIT_MS = (\d+) \* 60 \* 1000;/.exec(agent);
  assert.ok(m && Number(m[1]) >= 7, 'RS.ge runs take up to ~7 minutes');
});

test('queue: a failed rstax task carries its state and evidence ref; a succeeded one never carries the raw answer', () => {
  const failed = taskResult({ id: 't1', source: 'rstax', dedupe_key: `rstax:${DEV}`, state: 'FAILED', input: { idCode: DEV, name: 'M' }, error: `RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=REJECTED http=200 evidence=${SHA}` });
  assert.equal(failed.status, 'VERIFICATION_FAILED');
  assert.deepEqual(failed.rsVerification, { status: 'VERIFICATION_FAILED', rawResponseRef: { sha256: SHA } });
  assert.equal(failed.error, 'SOURCE_UNAVAILABLE');
  const pending = taskResult({ id: 't2', source: 'rstax', dedupe_key: `rstax:${DEV}`, state: 'FAILED', input: { idCode: DEV }, error: 'HUMAN_VERIFICATION_REQUIRED:DISABLED rs=PENDING_VERIFICATION outcome=NOT_SEARCHED http=-' });
  assert.equal(pending.status, 'SKIPPED_HUMAN_VERIFICATION');
  const down = taskResult({ id: 't3', source: 'rstax', dedupe_key: `rstax:${DEV}`, state: 'DEAD', input: { idCode: DEV }, error: 'RS_TEMPORARILY_UNAVAILABLE rs=TEMPORARILY_UNAVAILABLE outcome=NETWORK_ERROR http=-' });
  assert.equal(down.status, 'TEMPORARILY_UNAVAILABLE');
  const ok = taskResult({ id: 't4', source: 'rstax', dedupe_key: `rstax:${DEV}`, state: 'SUCCEEDED', input: { idCode: DEV }, result: record({ rsVerification: { status: 'VERIFIED', rawResponse: `{"TaxPayerID":"${DEV}"}` } }) });
  assert.equal(ok.rsVerification.rawResponse, undefined);
  assert.equal(withoutRsRaw({ a: 1 }).a, 1);
  assert.equal(singleTaskView({ id: 't3', source: 'rstax', dedupe_key: 'x', state: 'DEAD', error: 'RS_TEMPORARILY_UNAVAILABLE rs=TEMPORARILY_UNAVAILABLE' }).status, 'COMPLETE');
});

test('queue: RS.ge never holds the official stage open; a finished RS.ge result is included', () => {
  const done = (source, dedupe) => ({ id: dedupe, source, dedupe_key: dedupe, state: 'SUCCEEDED', created_at: '2026-10-11T10:00:00Z', started_at: '2026-10-11T10:00:01Z', finished_at: '2026-10-11T10:02:00Z', result: { source, status: 'SEARCH_CONFIRMED', documents: [] } });
  const running = { id: 'rs', source: 'rstax', dedupe_key: `rstax:${DEV}`, state: 'RUNNING', attempts: 1, created_at: '2026-10-11T10:01:00Z', started_at: '2026-10-11T10:01:05Z', input: { idCode: DEV } };
  const v = queueWorkerView([done('TAS_MAP', 'TAS_MAP'), done('tas', 'tas'), done('mygov', 'mygov'), running]);
  assert.equal(v.status, 'COMPLETE');
  assert.ok(!v.results.some((r) => r.source === 'rstax'));
  const withRs = queueWorkerView([done('tas', 'tas'), done('mygov', 'mygov'), { ...running, state: 'SUCCEEDED', finished_at: '2026-10-11T10:03:00Z', result: record() }]);
  assert.equal(withRs.status, 'COMPLETE');
  assert.equal(withRs.results.find((r) => r.source === 'rstax').taxpayerData.taxpayerName, 'შპს მილენიო გრუპი');
  // Other sources still gate it.
  assert.equal(queueWorkerView([{ ...done('tas', 'tas'), state: 'RUNNING' }, running]).status, 'RUNNING');
});

const company = { idCode: DEV, legalName: 'შპს მილენიო გრუპი', encumbrances: [], liquidationRegistered: null, extractPreparedAt: null };

test('finance view: every parsed field, the check date, the source link and a status-aware tone', () => {
  const f = companyFinanceFrom({ browserOfficial: { results: [record()] } }, company);
  assert.equal(f.taxStatus.state, 'CHECKED');
  assert.equal(f.taxStatus.verification, 'VERIFIED');
  assert.equal(f.taxStatus.recordFound, true);
  assert.equal(f.taxStatus.checkedOn, '2026-10-11');
  assert.equal(f.taxStatus.tone, 'confirmed');
  assert.equal(f.taxStatus.taxpayerName, 'შპს მილენიო გრუპი');
  assert.equal(f.taxStatus.legalForm, 'შპს');
  assert.equal(f.taxStatus.address, 'თბილისი');
  assert.deepEqual(f.taxStatus.extra, [{ label: 'TaxPayerType', value: 'იურიდიული პირი' }]);
  assert.equal(f.taxStatus.sourceUrl, 'https://www.rs.ge/TaxpayersRegistry');
  const liq = companyFinanceFrom({ browserOfficial: { results: [record({ taxpayerData: { ...record().taxpayerData, status: 'ლიკვიდირებული' } })] } }, company);
  assert.equal(liq.taxStatus.tone, 'caution');
  const none = companyFinanceFrom({ browserOfficial: { results: [{ source: 'rstax', status: 'NO_RESULT_CONFIRMED', forEntity: { idCode: DEV }, retrievedAt: '2026-10-11T09:00:00.000Z' }] } }, company);
  assert.deepEqual([none.taxStatus.state, none.taxStatus.recordFound, none.taxStatus.status], ['CHECKED', false, undefined]);
  for (const [r, v] of [
    [{ source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION', forEntity: { idCode: DEV } }, 'PENDING_VERIFICATION'],
    [{ source: 'rstax', status: 'TEMPORARILY_UNAVAILABLE', forEntity: { idCode: DEV }, rsVerification: { status: 'TEMPORARILY_UNAVAILABLE' } }, 'TEMPORARILY_UNAVAILABLE'],
    [{ source: 'rstax', status: 'VERIFICATION_FAILED', forEntity: { idCode: DEV }, rsVerification: { status: 'VERIFICATION_FAILED' } }, 'VERIFICATION_FAILED'],
    // "VERIFIED" with nothing readable is not a check the report can show.
    [{ source: 'rstax', status: 'SEARCH_CONFIRMED', forEntity: { idCode: DEV }, documents: [], taxpayerData: null }, 'VERIFICATION_FAILED'],
  ]) {
    const x = companyFinanceFrom({ browserOfficial: { results: [r] } }, company);
    assert.deepEqual(x.taxStatus, { state: 'NOT_CHECKED', checkedOn: null, verification: v });
  }
  assert.deepEqual(companyFinanceFrom({ browserOfficial: { results: [] } }, company).taxStatus, { state: 'NOT_CHECKED', checkedOn: null, verification: null });
});

test('card model: all fields labelled, booleans as yes/no, pill tone from RS.ge status, neutral copy otherwise', () => {
  const f = companyFinanceFrom({ browserOfficial: { results: [record()] } }, company);
  const m = rsTaxCardModel(f.taxStatus, DEV);
  assert.equal(m.kind, 'RECORD');
  assert.deepEqual(m.pill, { tone: 'confirmed', text: 'აქტიური' });
  assert.deepEqual(m.rows.map((r) => r.labelKey ?? r.label), ['vbi_rs_name', 'vbi_rs_id', 'vbi_rs_legal_form', 'vbi_rs_registered', 'vbi_rs_vat', 'vbi_rs_address', 'TaxPayerType']);
  assert.equal(m.rows.find((r) => r.labelKey === 'vbi_rs_vat').yesNo, true);
  assert.equal(m.rows.find((r) => r.labelKey === 'vbi_rs_registered').isDate, true);
  assert.equal(m.explainKey, 'vbi_fin_tax_explain');
  assert.equal(m.cautionKey, undefined);
  assert.equal(m.sourceUrl, 'https://www.rs.ge/TaxpayersRegistry');
  assert.equal(m.checkedOn, '2026-10-11');
  const liq = rsTaxCardModel({ ...f.taxStatus, status: 'ლიკვიდირებული', tone: 'caution' }, DEV);
  assert.deepEqual([liq.pill.tone, liq.cautionKey], ['attention', 'vbi_rs_status_caution']);
  const none = rsTaxCardModel({ state: 'CHECKED', checkedOn: '2026-10-11', verification: 'VERIFIED', recordFound: false }, DEV);
  assert.deepEqual([none.kind, none.pill.tone, none.pill.key, none.explainVars.id], ['NO_RECORD', 'quiet', 'vbi_rs_no_record', DEV]);
  for (const [v, key] of [['PENDING_VERIFICATION', 'vbi_rs_state_pending'], ['TEMPORARILY_UNAVAILABLE', 'vbi_rs_state_unavailable'], ['VERIFICATION_FAILED', 'vbi_rs_state_failed']]) {
    const s = rsTaxCardModel({ state: 'NOT_CHECKED', checkedOn: null, verification: v }, DEV);
    assert.deepEqual([s.kind, s.pill.tone, s.pill.key, s.explainKey], ['STATE', 'quiet', key, `${key}_explain`]);
  }
  assert.equal(rsTaxCardModel({ state: 'NOT_CHECKED', checkedOn: null, verification: null }, DEV), null, 'never ran → nothing written');
});

test('copy: the explanation states only what RS.ge returned — never "good standing" or "no tax debt"', () => {
  const tr = readFileSync(new URL('../../i18n/translations.ts', import.meta.url), 'utf8');
  const lines = tr.split('\n').filter((l) => /^\s+vbi_fin_tax_explain: /.test(l));
  assert.equal(lines.length, 6);
  assert.ok(lines.every((l) => !/good standing|სწორად ჩართული|корректно включённый/.test(l)));
  assert.match(lines[0], /does not show whether the company has tax arrears/);
  for (const k of ['vbi_rs_state_pending_explain', 'vbi_rs_state_unavailable_explain', 'vbi_rs_state_failed_explain', 'vbi_rs_no_record_explain']) {
    const ls = tr.split('\n').filter((l) => new RegExp(`^\\s+${k}: `).test(l));
    assert.equal(ls.length, 6, k);
    assert.ok(ls.every((l) => l.includes('{{id}}')), `${k} keeps {{id}} in every locale`);
  }
});

test('CAPTCHA spend reaches cost_events: one ESTIMATED row per paid solve, never attached to the job (no double billing)', () => {
  const base = { idempotencyKey: 'task:1:rstax:2026', source: 'rstax', kind: 'recaptcha_v2', provider: '2captcha', jobId: '11111111-1111-4111-8111-111111111111', taskId: '22222222-2222-4222-8222-222222222222' };
  const ok = captchaCostEventRow({ ...base, outcome: 'ACCEPTED', costUsd: 0.003 });
  assert.equal(ok.provider, 'OTHER');
  assert.equal(ok.operation_type, 'CAPTCHA_SOLVE');
  assert.ok(!ok.operation_type.startsWith('VERIFY'), 'VERIFY% rows are the OpenAI stage meter');
  assert.equal(ok.cost_usd, 0.003);
  assert.equal(ok.pricing_state, 'ESTIMATED');
  assert.equal(ok.job_id, null, 'verify_job_cost already prices CAPTCHA from verify_captcha_events');
  assert.match(ok.source, /vendor=2captcha;kind=recaptcha_v2;source=rstax;outcome=ACCEPTED;job=1111/);
  assert.equal(ok.request_id, base.idempotencyKey);
  assert.equal(captchaCostEventRow({ ...base, outcome: 'NO_CHANGE', costUsd: 0.003 }).success, false);
  assert.equal(captchaCostEventRow({ ...base, source: 'mygov', outcome: 'ACCEPTED', costUsd: 0.003 }).units, 1);
  assert.equal(captchaCostEventRow({ ...base, outcome: 'REJECTED', costUsd: 0 }), null, 'a bad-reported solve is refunded');
  assert.equal(captchaCostEventRow({ ...base, outcome: 'DISABLED', costUsd: 0 }), null);
  const unknown = captchaCostEventRow({ ...base, outcome: 'ACCEPTED', costUsd: null });
  assert.deepEqual([unknown.cost_usd, unknown.pricing_state], [0, 'UNPRICED'], 'unknown is UNPRICED, never a silent 0');
  const vq = readFileSync(new URL('../../../supabase/functions/verify-queue/index.ts', import.meta.url), 'utf8');
  assert.match(vq, /captchaCostEventRow\(/);
  assert.match(vq, /from\('cost_events'\)\.insert\(\[row\]\)/);
});
