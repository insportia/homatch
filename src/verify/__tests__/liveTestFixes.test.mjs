// liveTestFixes.test.mjs — what V2 live test 1ff4b786 (2026-10-24) exposed: an invalid code ran and was
// charged, the notification preceded the report, and the V2 audit was lost on completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkCadastralInput, parentCadastral } from '../cadastralInput.ts';
import { settlementOutcome } from '../pauseResume.ts';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

test('a code is searched exactly as typed (the registries are the authority); only a non-code is refused', () => {
  // MyGov has many records for "88.20.21.767.117.2" as typed: padding it would search another string.
  assert.deepEqual(checkCadastralInput('88.20.21.767.117.2'), { ok: true, code: '88.20.21.767.117.2', normalized: false, suggestion: null });
  assert.deepEqual(checkCadastralInput('01.18.06.014.080'), { ok: true, code: '01.18.06.014.080', normalized: false, suggestion: null });
  assert.deepEqual(checkCadastralInput(' 01.18.06.014.080 '), { ok: true, code: '01.18.06.014.080', normalized: false, suggestion: null }, 'surrounding spaces are not a change worth showing');
  assert.equal(checkCadastralInput('01.18.06.014,080').code, '01.18.06.014.080', 'a stray comma is a dot');
  for (const bad of ['01.18.06', 'abc', '01.18.06.1234567.080', '']) assert.equal(checkCadastralInput(bad).ok, false, bad);
  assert.equal(checkCadastralInput('01.18.06.014.080.x').suggestion, '01.18.06.014.080');
  assert.equal(parentCadastral('88.20.21.767.117.2'), '88.20.21.767.117');
  assert.equal(parentCadastral('01.18.06.019.055.03.01.601'), '01.18.06.019.055');
  assert.equal(parentCadastral('01.18.06.014.080'), null);
});

test('the server searches the cleaned code; the page says so; only a non-code is refused', () => {
  const page = code('src/pages/VerifyPage.tsx');
  assert.match(page, /const cadastralCheck=checkCadastralInput\(query\);const valid=mode==='cadastral'\?cadastralCheck\.ok:/);
  assert.match(page, /t\('verify_code_normalized',\{code:cadastralCheck\.code\}\)/);
  assert.match(page, /t\('verify_code_did_you_mean',\{code:cadastralCheck\.suggestion\}\)/);
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /const check = mode === 'cadastral' \? checkCadastralInput\(typed\) : null;\n\s+if \(check && !check\.ok\) return json\(\{ error: 'Invalid cadastral code', code: 'INVALID_CADASTRAL', suggestion: check\.suggestion \}, 400\);\n\s+const q = check \? check\.code : typed;/);
});

test('a report no official source could back is not charged; one with official evidence is', () => {
  const done = { status: 'COMPLETE', synthesis_state: 'READY', completed_at: new Date().toISOString() };
  const opts = { maxSynthesisAttempts: 4, synthesisGraceMs: 7_200_000 };
  assert.equal(settlementOutcome(done, { ...opts, officialFound: 0 }), 'SYSTEM_FAILED');
  assert.equal(settlementOutcome(done, { ...opts, officialFound: 2 }), 'COMPLETE');
  assert.equal(settlementOutcome(done, opts), 'COMPLETE', 'unknown keeps the old rule');
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /official_found:result_json->officialSourcesConfirmedFound/);
  assert.match(ra, /officialFound: Array\.isArray\(job\.official_found\) \? job\.official_found\.length : null/);
});

test('the customer is told when the report exists, not when research ends', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.doesNotMatch(ra, /notifyVerificationReady|type: 'VERIFY_COMPLETE'/);
  const vs = code('supabase/functions/verify-synthesis/index.ts');
  const at = vs.indexOf('await persist(writer, jobId, payload);');
  const n = vs.indexOf("type: 'VERIFY_COMPLETE'", at);
  assert.ok(at > 0 && n > at, 'notified after the report is saved');
  assert.match(vs, /if \(!opts\.autoUpgrade && !opts\.forced && job\.user_id\) \{/);
});

test('the V2 audit survives completion, internally only', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /_v2Decisions: prior\._v2Decisions \?\? null,\n\s+_searchLog: prior\._searchLog \?\? null,\n\s+_escalations: prior\._escalations \?\? null,/);
  assert.match(ra, /delete r\._v2Decisions;\n\s+delete r\._searchLog;\n\s+delete r\._escalations;/);
});

test('nothing found for the code → MyGov is asked once for the parent parcel; found or failed → never', async () => {
  const { followUpTasks, parentRoundTask, officialCodeNotFound } = await import('../queueOfficial.ts');
  const c = '88.20.21.767.117.2';
  const row = (k, state, status) => ({ id: k, source: k === 'mygov_parent' ? 'mygov' : k, dedupe_key: k, state, input: { cadastral: k === 'mygov_parent' ? '88.20.21.767.117' : c }, result: status ? { status, resultConfirmed: status === 'SEARCH_CONFIRMED' } : null });
  const absent = [row('TAS_MAP', 'SUCCEEDED', 'NO_RESULT_CONFIRMED'), row('tas', 'SUCCEEDED', 'NO_RESULT_CONFIRMED'), row('mygov', 'SUCCEEDED', 'NO_RESULT_CONFIRMED')];
  const t = followUpTasks(absent).find((x) => x.dedupeKey === 'mygov_parent');
  assert.equal(t.scopeKey, 'mygov:88.20.21.767.117');
  assert.deepEqual([t.input.cadastral, t.input.parentOf], ['88.20.21.767.117', c]);
  assert.equal(officialCodeNotFound(absent), false, 'not before the parent was asked');
  assert.equal(officialCodeNotFound([...absent, row('mygov_parent', 'SUCCEEDED', 'NO_RESULT_CONFIRMED')]), true);
  assert.equal(officialCodeNotFound([...absent, row('mygov_parent', 'SUCCEEDED', 'SEARCH_CONFIRMED')]), false);
  assert.equal(officialCodeNotFound([...absent, row('mygov_parent', 'FAILED')]), false, 'a failed source is "unavailable", never "does not exist"');
  assert.equal(parentRoundTask([...absent.slice(0, 2), row('mygov', 'FAILED')]), null, 'MyGov failing is no reason to call the code absent');
  assert.equal(parentRoundTask([absent[0], absent[1], row('mygov', 'SUCCEEDED', 'SEARCH_CONFIRMED')]), null);
  assert.equal(parentRoundTask([...absent, row('mygov_parent', 'QUEUED')]), null, 'asked once');
  assert.equal(parentRoundTask([absent[0], row('tas', 'RUNNING'), absent[2]]), null, 'waits for every primary');
  const parcel = absent.map((r) => ({ ...r, input: { cadastral: '01.18.06.014.080' } }));
  assert.equal(parentRoundTask(parcel), null, 'a parcel has no parent');
  assert.equal(officialCodeNotFound(parcel), true);
});

test('code-not-found ends the run before any AI stage, uncharged, with its own customer message', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /if \(w\.status === 'COMPLETE' && officialCodeNotFound\(rows\)\) \{\n\s+return sb\.from\('research_jobs'\)\.update\(\{\n\s+status: 'FAILED',\n\s+stage: 'FAILED',\n\s+error: 'CADASTRAL_CODE_NOT_FOUND',/);
  assert.match(ra, /marker === 'CADASTRAL_CODE_NOT_FOUND' \? 'CODE_NOT_FOUND'/);
  assert.equal(settlementOutcome({ status: 'FAILED' }, { maxSynthesisAttempts: 4, synthesisGraceMs: 1 }), 'SYSTEM_FAILED');
  assert.match(code('src/pages/VerifyPage.tsx'), /data\?\.terminalReason==='CODE_NOT_FOUND'\?'verify_err_code_not_found'/);
  assert.equal((code('src/i18n/translations.ts').match(/verify_err_code_not_found:/g) || []).length, 6);
});

test('eacaf5a0: no official task outlives its job, and a failed cancel is seen', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /const \{ error \} = await sb\.rpc\('verify_job_cancel_tasks'/);
  assert.match(ra, /event: 'cancel_tasks_failed'/);
  const at = ra.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE', stage: 'COMPLETE'");
  assert.ok(at > 0);
  const after = ra.slice(at, at + 1500);
  assert.ok(after.indexOf('await cancelJobTasks(sb, j.id);') > after.indexOf('if (finished?.error) {'), 'only once the write succeeded');
});
