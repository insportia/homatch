// RS.ge — the verdict comes from RS.ge's OWN answer to the search
// (GrdSearchTaxPayers), never from the stale warning text Search #1 left on
// screen. Production 2026-10-10..11 (18/18): token solved and accepted, the
// search XHR answered 200, and the worker still said NO_CHANGE because it read
// the old warning. Fake solver only: no paid solve, no network to 2Captcha or
// rs.ge (every rs.ge request is answered by a local route).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptchaService, parseCaptchaPolicy } from '../.tstest-build/captcha/captchaService.js';
import {
  classifyRsGridResponse,
  mapRsRow,
  pickRsRow,
  redactRsRaw,
  maskTin,
  rsStatusForOutcome,
  buildRsVerificationRecord,
  rsRecordLogFields,
  rsValueText,
  RS_RAW_MAX_BYTES,
} from '../.tstest-build/workflows/financial/RsTaxpayerResponse.js';

const KEY = 'k'.repeat(32);
const SITEKEY = '6L' + 'A'.repeat(38);
const TIN = '404670272';
const ON = parseCaptchaPolicy({ enabled: true, providers: { mygov: true, rstax: true }, maxAttemptsPerProvider: 2, maxSolvesPerJob: 3 });

function fakeSolver(tokens) {
  const calls = { recaptcha: [], good: [], bad: [] };
  let n = 0;
  return {
    calls,
    factory: () => ({
      async recaptcha(params) {
        calls.recaptcha.push(params);
        n++;
        return { data: tokens[(n - 1) % tokens.length], id: `solve-${n}` };
      },
      async goodReport(id) { calls.good.push(id); },
      async badReport(id) { calls.bad.push(id); },
      async balance() { return 1; },
    }),
  };
}
const service = (solver) => new CaptchaService({ env: { TWOCAPTCHA_API_KEY: KEY }, solverFactory: solver.factory, timeoutMs: 200 });

const KENDO_ROW = {
  TaxPayerID: TIN,
  Name: 'შპს მილენიო გრუპი',
  LegalForm: 'შეზღუდული პასუხისმგებლობის საზოგადოება',
  Status: 'აქტიური',
  RegDate: '/Date(1679961600000)/',
  IsVatPayer: true,
  Address: 'თბილისი, ვაჟა-ფშაველას გამზ. 1',
  TaxPayerType: 'იურიდიული პირი',
  __rowNum: 1,
};

/* ───────────── pure: classification ───────────── */

test('JSON (Kendo DataSourceResult): rows → ACCEPTED; known columns mapped, every other column kept, labelled', () => {
  const c = classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ Data: [KENDO_ROW], Total: 1, AggregateResults: null, Errors: null }) });
  assert.equal(c.outcome, 'ACCEPTED');
  assert.equal(c.format, 'JSON');
  assert.equal(c.total, 1);
  assert.deepEqual(c.columns, ['TaxPayerID', 'Name', 'LegalForm', 'Status', 'RegDate', 'IsVatPayer', 'Address', 'TaxPayerType']);
  const d = mapRsRow(pickRsRow(c.rows, TIN), TIN);
  assert.equal(d.identificationCode, TIN);
  assert.equal(d.taxpayerName, 'შპს მილენიო გრუპი');
  assert.equal(d.legalForm, 'შეზღუდული პასუხისმგებლობის საზოგადოება');
  assert.equal(d.status, 'აქტიური');
  assert.equal(d.registrationDate, '2023-03-28');
  assert.equal(d.vatStatus, 'true');
  assert.equal(d.address, 'თბილისი, ვაჟა-ფშაველას გამზ. 1');
  assert.deepEqual(d.otherPublicFields, { TaxPayerType: 'იურიდიული პირი' }, 'nothing is lost; technical row numbers are not taxpayer data');
});

test('JSON: ASP.NET {d: "<json>"} and a bare array are read the same way; Georgian column names map too', () => {
  const inner = JSON.stringify({ rows: [{ 'საიდენტიფიკაციო კოდი': TIN, 'დასახელება': 'შპს ტესტი', 'სტატუსი': 'ლიკვიდირებული', 'დღგ სტატუსი': 'არა', 'რეგისტრაციის თარიღი': '2010-05-12T00:00:00' }] });
  for (const body of [JSON.stringify({ d: inner }), JSON.stringify(JSON.parse(inner).rows)]) {
    const c = classifyRsGridResponse({ status: 200, contentType: 'application/json', body });
    assert.equal(c.outcome, 'ACCEPTED');
    const d = mapRsRow(c.rows[0], TIN);
    assert.equal(d.identificationCode, TIN);
    assert.equal(d.taxpayerName, 'შპს ტესტი');
    assert.equal(d.status, 'ლიკვიდირებული');
    assert.equal(d.vatStatus, 'არა');
    assert.equal(d.registrationDate, '2010-05-12');
  }
});

test('JSON: an empty grid is a valid NO_RESULT; a refusal in the body is REJECTED; an error field alone is UNPARSEABLE', () => {
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: '{"Data":[],"Total":0,"Errors":null}' }).outcome, 'NO_RESULT');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი' }) }).outcome, 'REJECTED');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ Errors: { captcha: { errors: ['Invalid captcha'] } }, Data: null }) }).outcome, 'REJECTED');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ Errors: { x: ['boom'] } }) }).outcome, 'UNPARSEABLE');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: '{"foo":1}' }).outcome, 'UNPARSEABLE');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'text/html', body: '' }).outcome, 'UNPARSEABLE');
});

test('HTML fragment: a header table → ACCEPTED; a "no records" row → NO_RESULT; the warning → REJECTED', () => {
  const html = `<table class="k-grid"><thead><tr><th>საიდენტიფიკაციო კოდი</th><th>დასახელება</th><th>სამართლებრივი ფორმა</th><th>სტატუსი</th><th>მისამართი</th><th>დღგ</th><th>შენიშვნა</th></tr></thead>
    <tbody><tr><td>${TIN}</td><td>შპს &quot;მილენიო&quot; გრუპი</td><td>შპს</td><td>აქტიური</td><td>თბილისი</td><td>კი</td><td>&nbsp;—</td></tr></tbody></table>`;
  const c = classifyRsGridResponse({ status: 200, contentType: 'text/html', body: html });
  assert.equal(c.outcome, 'ACCEPTED');
  assert.equal(c.format, 'HTML');
  const d = mapRsRow(c.rows[0], TIN);
  assert.equal(d.taxpayerName, 'შპს "მილენიო" გრუპი');
  assert.equal(d.legalForm, 'შპს');
  assert.equal(d.vatStatus, 'კი');
  assert.deepEqual(d.otherPublicFields, { 'შენიშვნა': '—' });
  const empty = '<table><tr><th>კოდი</th><th>დასახელება</th></tr><tr><td colspan="2">ჩანაწერი ვერ მოიძებნა</td></tr></table>';
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'text/html', body: empty }).outcome, 'NO_RESULT');
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'text/html', body: '<div class="err">გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი</div>' }).outcome, 'REJECTED');
  // A vertical label | value table is one record.
  const vertical = `<table><tr><td>დასახელება:</td><td>შპს ტესტი</td></tr><tr><td>სტატუსი</td><td>აქტიური</td></tr></table>`;
  const v = classifyRsGridResponse({ status: 200, contentType: 'text/html', body: vertical });
  assert.equal(v.outcome, 'ACCEPTED');
  assert.equal(mapRsRow(v.rows[0], TIN).status, 'აქტიური');
});

test('transport: network failure and 5xx are TEMPORARILY_UNAVAILABLE; 403 and a refusal are VERIFICATION_FAILED', () => {
  const net = classifyRsGridResponse({ status: 0, contentType: null, body: null, networkError: 'net::ERR_FAILED' });
  assert.equal(net.outcome, 'NETWORK_ERROR');
  assert.equal(rsStatusForOutcome(net.outcome), 'TEMPORARILY_UNAVAILABLE');
  const five = classifyRsGridResponse({ status: 503, contentType: 'text/html', body: 'down' });
  assert.equal(five.outcome, 'HTTP_ERROR');
  assert.equal(rsStatusForOutcome(five.outcome, 503), 'TEMPORARILY_UNAVAILABLE');
  assert.equal(rsStatusForOutcome('HTTP_ERROR', 403), 'VERIFICATION_FAILED');
  assert.equal(rsStatusForOutcome('REJECTED'), 'VERIFICATION_FAILED');
  assert.equal(rsStatusForOutcome('UNPARSEABLE'), 'VERIFICATION_FAILED');
  assert.equal(rsStatusForOutcome('ACCEPTED'), 'VERIFIED');
  assert.equal(rsStatusForOutcome('NO_RESULT'), 'VERIFIED');
  assert.equal(rsValueText('/Date(1679961600000)/'), '2023-03-28');
});

/* ───────────── pure: redaction ───────────── */

test('redaction: the TIN and any 11-digit personal number are masked, tokens dropped, bounded to 20 KB; logs carry names only', () => {
  const body = JSON.stringify({ Data: [{ TaxPayerID: TIN, Director: '01001012345', Name: 'შპს ტესტი', Token: 'x'.repeat(300) }] }) + 'ა'.repeat(30_000);
  const r = redactRsRaw(body, TIN);
  assert.ok(!r.text.includes(TIN));
  assert.ok(r.text.includes(maskTin(TIN)));
  assert.ok(!r.text.includes('01001012345'));
  assert.ok(!r.text.includes('x'.repeat(130)));
  assert.equal(r.truncated, true);
  assert.ok(new TextEncoder().encode(r.text).length <= RS_RAW_MAX_BYTES);
  const cls = classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ Data: [{ TaxPayerID: TIN, Name: 'შპს ტესტი' }] }) });
  const rec = buildRsVerificationRecord({ capture: { status: 200, contentType: 'application/json', body: JSON.stringify({ Data: [{ TaxPayerID: TIN, Name: 'შპს ტესტი' }] }) }, classification: cls, tin: TIN, sourceUrl: 'https://www.rs.ge/TaxpayersRegistry' });
  assert.equal(rec.status, 'VERIFIED');
  assert.equal(rec.httpStatus, 200);
  assert.ok(!JSON.stringify(rec).includes(TIN), 'the stored record never carries the TIN');
  const log = JSON.stringify(rsRecordLogFields(rec));
  assert.ok(!log.includes(TIN) && !log.includes('შპს ტესტი'), 'logs carry field names and counts, never values');
  assert.match(log, /"columns":\["TaxPayerID","Name"\]/);
});

/* ───────────── browser: stand-in registry page with the real XHR ───────────── */

const GRID_URL = /\/RsGe\.Module\/TaxpayersRegistry\/GrdSearchTaxPayers/;

// Search #1 (no token) shows the warning without calling the server; with a
// token the page POSTs to GrdSearchTaxPayers. The page renders NOTHING new —
// the warning from Search #1 stays in the DOM. Only the server's answer can
// tell the outcome (exactly the production situation).
const GRID_PAGE = (sitekey) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <input id="tin"><button id="btnSearch1" type="button">ძიება</button>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
  <textarea name="g-recaptcha-response" style="display:none"></textarea>
  <div id="out"></div>
  <script>
    document.getElementById('btnSearch1').onclick = () => {
      const t = document.querySelector('textarea[name="g-recaptcha-response"]').value;
      const tin = document.getElementById('tin').value;
      if (!t) { document.getElementById('out').innerText = 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი'; return; }
      fetch('/RsGe.Module/TaxpayersRegistry/GrdSearchTaxPayers', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tin=' + tin + '&g-recaptcha-response=' + t }).catch(() => {});
    };
  </script></body></html>`;

async function withGridPage(grid, fn, html = GRID_PAGE(SITEKEY)) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return 'skip';
  }
  const browser =
    (await chromium.launch({ headless: true }).catch(() => null)) ??
    (await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => null));
  if (!browser) return 'skip';
  try {
    const page = await browser.newPage();
    await page.route('https://www.rs.ge/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.route(GRID_URL, grid);
    await page.route(/google\.com|gstatic\.com/, (route) => route.abort());
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function loadRsWorker() {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport('../src/workflows/financial/RsTaxpayerWorker.ts', import.meta.url);
}

/** Run the worker while capturing its log lines. */
async function runCapturingLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try {
    return { out: await fn(), lines };
  } finally {
    console.log = orig;
  }
}

const json = (obj, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(obj) });

test('RS.ge (browser): old warning stays in the DOM, the grid XHR returns a row → ACCEPTED, parsed, ONE solve, good report', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const r = await withGridPage(json({ Data: [KENDO_ROW], Total: 1, Errors: null }), (page) =>
    runCapturingLogs(() => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-grid-ok' }, postSolveWaitMs: 8000 })),
  );
  if (r === 'skip') return t.skip('Chromium unavailable');
  const { out, lines } = r;
  assert.equal(out.status, 'SEARCH_CONFIRMED');
  assert.equal(out.captchaResolution[0].outcome, 'ACCEPTED');
  assert.equal(out.taxpayerData.taxpayerName, 'შპს მილენიო გრუპი');
  assert.equal(out.taxpayerData.registrationDate, '2023-03-28');
  assert.deepEqual(out.taxpayerData.otherPublicFields, { TaxPayerType: 'იურიდიული პირი' });
  assert.equal(out.rsVerification.status, 'VERIFIED');
  assert.equal(out.rsVerification.serverOutcome, 'ACCEPTED');
  assert.equal(out.rsVerification.httpStatus, 200);
  assert.equal(out.rsVerification.requestHadTin, true);
  assert.ok(out.rsVerification.rawResponse.includes('მილენიო'), 'the answer is stored');
  assert.ok(!out.rsVerification.rawResponse.includes(TIN), 'TIN masked in the stored answer');
  assert.equal(s.calls.recaptcha.length, 1, 'never solved again once RS.ge answered');
  assert.deepEqual(s.calls.good, ['solve-1']);
  assert.deepEqual(svc.ledgerFor('rs-grid-ok').map((e) => e.outcome), ['ACCEPTED']);
  const rs = lines.filter((l) => l.includes('"scope":"rstax_captcha"'));
  assert.ok(rs.some((l) => l.includes('"event":"search_answer"') && l.includes('"serverOutcome":"ACCEPTED"')));
  assert.ok(rs.every((l) => !l.includes(TIN) && !l.includes('GOOD') && !l.includes('მილენიო')), 'logs carry no TIN, token or values');
});

test('RS.ge (browser): empty grid → NO_RESULT_CONFIRMED (VERIFIED), no second solve', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const out = await withGridPage(json({ Data: [], Total: 0, Errors: null }), (page) =>
    runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-grid-empty' }, postSolveWaitMs: 8000 }),
  );
  if (out === 'skip') return t.skip('Chromium unavailable');
  assert.equal(out.status, 'NO_RESULT_CONFIRMED');
  assert.equal(out.taxpayerData, null);
  assert.equal(out.rsVerification.status, 'VERIFIED');
  assert.equal(out.rsVerification.serverOutcome, 'NO_RESULT');
  assert.equal(out.captchaResolution[0].outcome, 'ACCEPTED');
  assert.equal(s.calls.recaptcha.length, 1);
});

test('RS.ge (browser): a server rejection in the body → REJECTED, bad report, no second paid solve, answer stored', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['BAD']);
  const svc = service(s);
  const out = await withGridPage(json({ success: false, message: 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი' }), (page) =>
    runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-grid-rej' }, postSolveWaitMs: 8000 }),
  );
  if (out === 'skip') return t.skip('Chromium unavailable');
  assert.equal(out.status, 'WAITING_HUMAN');
  assert.equal(out.captchaResolution[0].outcome, 'REJECTED');
  assert.equal(out.rsVerification.status, 'VERIFICATION_FAILED');
  assert.equal(out.rsVerification.serverOutcome, 'REJECTED');
  assert.ok(out.rsVerification.rawResponse.includes('უსაფრთხოების'));
  assert.equal(s.calls.recaptcha.length, 1);
  assert.deepEqual(s.calls.bad, ['solve-1']);
});

test('RS.ge (browser): the grid request fails on the network → TEMPORARILY_UNAVAILABLE, no bad report, no re-solve', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const out = await withGridPage((route) => route.abort('failed'), (page) =>
    runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-grid-net' }, postSolveWaitMs: 8000 }),
  );
  if (out === 'skip') return t.skip('Chromium unavailable');
  assert.equal(out.status, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(out.rsVerification.status, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(out.rsVerification.serverOutcome, 'NETWORK_ERROR');
  assert.equal(s.calls.recaptcha.length, 1);
  assert.deepEqual(s.calls.bad, []);
});

test('RS.ge (browser): 503 from the grid → TEMPORARILY_UNAVAILABLE; an HTML grid answer is parsed', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const down = await withGridPage((route) => route.fulfill({ status: 503, contentType: 'text/html', body: 'Service Unavailable' }), (page) =>
    runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: service(fakeSolver(['GOOD'])), policy: ON, jobId: 'rs-grid-503' }, postSolveWaitMs: 8000 }),
  );
  if (down === 'skip') return t.skip('Chromium unavailable');
  assert.equal(down.status, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(down.rsVerification.httpStatus, 503);
  const html = `<table><tr><th>საიდენტიფიკაციო კოდი</th><th>დასახელება</th><th>სტატუსი</th></tr><tr><td>${TIN}</td><td>შპს ტესტი</td><td>აქტიური</td></tr></table>`;
  const ok = await withGridPage((route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }), (page) =>
    runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: service(fakeSolver(['GOOD'])), policy: ON, jobId: 'rs-grid-html' }, postSolveWaitMs: 8000 }),
  );
  assert.equal(ok.status, 'SEARCH_CONFIRMED');
  assert.equal(ok.rsVerification.responseFormat, 'HTML');
  assert.equal(ok.taxpayerData.taxpayerName, 'შპს ტესტი');
  assert.equal(ok.taxpayerData.status, 'აქტიური');
});

// Production 2026-10-22 (company 405456359, a registered LLC): RS.ge answered
// 200 with a small JSON holding no grid, then the page showed its empty-grid
// text ("Not found", 0 rows) — stored as a confirmed no-record. The page may
// not overrule RS.ge's own unreadable answer.
const EMPTY_GRID_PAGE = GRID_PAGE(SITEKEY).replace(
  '.catch(() => {});',
  ".then(() => { document.getElementById('out').innerText = 'Not found  ჩანაწერი: 0'; }).catch(() => {});",
);

test('RS.ge (browser): an unreadable answer + the empty grid on the page → VERIFICATION_FAILED/UNPARSEABLE, never NO_RESULT_CONFIRMED', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const out = await withGridPage(
    json({ Total: 0, AggregateResults: null, Message: null, Extra: { Rows: null } }),
    (page) => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: TIN }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-grid-domonly' }, postSolveWaitMs: 8000 }),
    EMPTY_GRID_PAGE,
  );
  if (out === 'skip') return t.skip('Chromium unavailable');
  assert.equal(out.status, 'VERIFICATION_FAILED');
  assert.equal(out.noResultConfirmed, false);
  assert.equal(out.rsVerification.status, 'VERIFICATION_FAILED');
  assert.equal(out.rsVerification.serverOutcome, 'UNPARSEABLE');
  assert.equal(out.captchaResolution[0].outcome, 'NO_CHANGE', 'no acceptance is claimed for an unreadable answer');
  assert.equal(s.calls.recaptcha.length, 1, 'no second paid solve in the same attempt');
});
