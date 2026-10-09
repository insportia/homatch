// Shared 2Captcha service + its two integrations (NAPR/MyGov Service176,
// RS.ge). Every test uses a fake solver: no paid solve, no network to 2Captcha.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptchaService, parseCaptchaPolicy, DEFAULT_CAPTCHA_POLICY } from '../.tstest-build/captcha/captchaService.js';
import { detectChallengeInHtml, discoverSiteKey } from '../.tstest-build/captcha/detect.js';
import { runMyGovApiWorkflow, runMyGovApiStep } from '../.tstest-build/workflows/mygov/MyGovApiWorkflow.js';

const KEY = 'k'.repeat(32);
const SITEKEY = '6L' + 'A'.repeat(38);
const ON = parseCaptchaPolicy({ enabled: true, providers: { mygov: true, rstax: true }, maxAttemptsPerProvider: 2, maxSolvesPerJob: 3 });

function fakeSolver(tokens, { delayMs = 0, fail = null } = {}) {
  const calls = { recaptcha: [], good: [], bad: [] };
  let n = 0;
  return {
    calls,
    factory: () => ({
      async recaptcha(params) {
        calls.recaptcha.push(params);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (fail) {
          const { APIError } = await import('@2captcha/captcha-solver');
          throw new APIError(fail);
        }
        n++;
        return { data: tokens[(n - 1) % tokens.length], id: `solve-${n}` };
      },
      async goodReport(id) { calls.good.push(id); },
      async badReport(id) { calls.bad.push(id); },
      async balance() { return 12.5; },
    }),
  };
}
const service = (solver, env = {}) => new CaptchaService({ env: { TWOCAPTCHA_API_KEY: KEY, ...env }, solverFactory: solver.factory, timeoutMs: 200 });
const req = (over = {}) => ({ provider: 'rstax', jobId: 'job-1', pageUrl: 'https://www.rs.ge/TaxpayersRegistry', siteKey: SITEKEY, ...over });

// ── policy & gates ──
test('policy: on by default; explicit off is off; caps are clamped', () => {
  assert.equal(parseCaptchaPolicy(null).enabled, true);
  assert.equal(DEFAULT_CAPTCHA_POLICY.enabled, true);
  assert.equal(parseCaptchaPolicy({ enabled: false }).enabled, false);
  assert.equal(parseCaptchaPolicy({ maxAttemptsPerProvider: 99, maxSolvesPerJob: -4 }).maxAttemptsPerProvider, 3);
  assert.equal(parseCaptchaPolicy({ maxSolvesPerJob: -4 }).maxSolvesPerJob, 1);
  assert.equal(parseCaptchaPolicy({ providers: { rstax: false } }).providers.rstax, false);
});

test('no key, kill switch, disabled provider: no solver call, no spend', async () => {
  const s = fakeSolver(['t']);
  assert.equal((await new CaptchaService({ env: {}, solverFactory: s.factory }).solveRecaptchaV2(req(), ON)).outcome, 'NOT_CONFIGURED');
  assert.equal((await service(s, { CAPTCHA_AUTO_SOLVE: 'off' }).solveRecaptchaV2(req(), ON)).outcome, 'DISABLED');
  assert.equal((await service(s).solveRecaptchaV2(req(), parseCaptchaPolicy({ providers: { rstax: false } }))).outcome, 'DISABLED');
  assert.equal(s.calls.recaptcha.length, 0);
});

test('status reports the variable NAME only — never the key', () => {
  const st = service(fakeSolver(['t'])).status();
  assert.equal(st.configured, true);
  assert.equal(st.keyVariable, 'TWOCAPTCHA_API_KEY');
  assert.ok(!JSON.stringify(st).includes(KEY));
});

test('budgets: per provider, per job and per day', async () => {
  const s = fakeSolver(['t1', 't2', 't3', 't4']);
  const svc = service(s, { CAPTCHA_DAILY_CAP: '3' });
  assert.equal((await svc.solveRecaptchaV2(req(), ON)).ok, true);
  assert.equal((await svc.solveRecaptchaV2(req({ pageUrl: 'https://www.rs.ge/TaxpayersRegistry?2' }), ON)).ok, true);
  assert.equal((await svc.solveRecaptchaV2(req({ pageUrl: 'https://www.rs.ge/TaxpayersRegistry?3' }), ON)).outcome, 'BUDGET_EXHAUSTED');
  assert.equal((await svc.solveRecaptchaV2(req({ jobId: 'job-2' }), ON)).ok, true);
  assert.equal((await svc.solveRecaptchaV2(req({ jobId: 'job-3' }), ON)).outcome, 'BUDGET_EXHAUSTED'); // daily cap 3
  assert.equal(s.calls.recaptcha.length, 3);
});

test('the same challenge in flight is solved once (duplicate prevention)', async () => {
  const s = fakeSolver(['t'], { delayMs: 30 });
  const svc = service(s);
  const [a, b] = await Promise.all([svc.solveRecaptchaV2(req(), ON), svc.solveRecaptchaV2(req(), ON)]);
  assert.equal(a.token, b.token);
  assert.equal(s.calls.recaptcha.length, 1);
});

test('timeout is bounded; a bad key opens the breaker and stops further spend', async () => {
  const slow = service(fakeSolver(['t'], { delayMs: 1000 }));
  const t0 = Date.now();
  const r = await slow.solveRecaptchaV2(req(), ON);
  assert.equal(r.outcome, 'TIMEOUT');
  assert.ok(Date.now() - t0 < 900);
  const bad = fakeSolver(['t'], { fail: 'ERROR_ZERO_BALANCE' });
  const svc = service(bad);
  assert.equal((await svc.solveRecaptchaV2(req(), ON)).outcome, 'PROVIDER_ERROR');
  assert.equal((await svc.solveRecaptchaV2(req({ jobId: 'other' }), ON)).outcome, 'PROVIDER_ERROR');
  assert.equal(bad.calls.recaptcha.length, 1);
  assert.equal(svc.status().breakerCode, 'ERROR_ZERO_BALANCE');
});

test('acceptance is reported to 2Captcha only from the SOURCE outcome; ledger holds no token', async () => {
  const s = fakeSolver(['SECRET-TOKEN']);
  const svc = service(s);
  const r = await svc.solveRecaptchaV2(req(), ON);
  await svc.reportAcceptance(req(), r, false);
  assert.deepEqual(s.calls.bad, ['solve-1']);
  assert.equal(svc.ledgerFor('job-1').at(-1).outcome, 'REJECTED');
  assert.ok(!JSON.stringify(svc.status()).includes('SECRET-TOKEN'));
});

// ── detection ──
test('detection: absent, v2, invisible, v3, hCaptcha, Turnstile', () => {
  assert.equal(detectChallengeInHtml('<html><body><form>no challenge</form></body></html>').present, false);
  const v2 = detectChallengeInHtml(`<div class="g-recaptcha" data-sitekey="${SITEKEY}"></div><script src="https://www.google.com/recaptcha/api.js"></script>`);
  assert.deepEqual([v2.type, v2.siteKey, v2.supported], ['RECAPTCHA_V2', SITEKEY, true]);
  assert.equal(detectChallengeInHtml(`<div class="g-recaptcha" data-size="invisible" data-sitekey="${SITEKEY}"></div>`).type, 'RECAPTCHA_V2_INVISIBLE');
  const v3 = detectChallengeInHtml(`<script src="https://www.google.com/recaptcha/api.js?render=${SITEKEY}"></script><script>grecaptcha.execute('${SITEKEY}',{action:'x'})</script>`);
  assert.deepEqual([v3.type, v3.supported], ['RECAPTCHA_V3', false]);
  assert.equal(detectChallengeInHtml('<div class="h-captcha" data-sitekey="x"></div><script src="https://hcaptcha.com/1/api.js"></script>').supported, false);
  assert.equal(detectChallengeInHtml('<div class="cf-turnstile"></div>').type, 'TURNSTILE');
});

test('site key discovery reads same-origin scripts only; override wins', async () => {
  const pages = {
    'https://naprweb.reestri.gov.ge/_dea/': '<html><script src="/_dea/main.js"></script><script src="https://cdn.example/x.js"></script></html>',
    'https://naprweb.reestri.gov.ge/_dea/main.js': `var cfg={recaptcha:{sitekey:"${SITEKEY}"}};grecaptcha.render(el,{sitekey:cfg.recaptcha.sitekey});`,
  };
  const seen = [];
  const fetcher = async (u) => { seen.push(String(u)); return new Response(pages[String(u)] ?? '', { status: pages[String(u)] ? 200 : 404 }); };
  const d = await discoverSiteKey('https://naprweb.reestri.gov.ge/_dea/#/view/1', fetcher);
  assert.equal(d.siteKey, SITEKEY);
  assert.ok(!seen.some((u) => u.includes('cdn.example')));
  assert.equal((await discoverSiteKey('https://naprweb.reestri.gov.ge/_dea/#/view/1', fetcher, SITEKEY.replace('A', 'B'))).siteKey, SITEKEY.replace('A', 'B'));
});

// ── NAPR / MyGov Service176 ──
const code = '41.42.043.044';
const id = 'runtime-record';
const registration = 'runtime-registration';
const json = (v) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const searchData = { applist: [{ appID: id, regNumber: registration, status: 'public' }], page: 1, lastpage: 1, total: 1 };
const recordData = { appinfo: { r_info: [{ APP_ID: id, CADCODE: code, REG_NUMBER: registration }] }, edocuments: [{ DOC_NAME: 'source-document', ICON: 'signed-pdf', BLOB_URI: 'https://bs.napr.gov.ge/GetBlob?pid=p&bid=b' }], statuses: [], letters: [] };
function napr({ status = '10', acceptToken = 'GOOD', challengePage = true } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, body: init.body ?? null });
      if (u.endsWith('/api/search')) return json(searchData);
      if (u.includes('/api/appstatus/')) return json({ status });
      if (u.includes('/api/app/')) {
        const token = JSON.parse(init.body || '{}').recaptcha;
        return token === acceptToken ? json(recordData) : json({ error: 'captcha invalid' });
      }
      if (u === 'https://naprweb.reestri.gov.ge/_dea/') return new Response(challengePage ? `<div class="g-recaptcha" data-sitekey="${SITEKEY}"></div>` : '<html></html>');
      return new Response('%PDF-1.7 fixture', { headers: { 'Content-Type': 'application/pdf' } });
    },
  };
}
const parser = async () => ({ text: 'Public official document text read across every page.', numpages: 1 });
const ctx = (svc, jobId = 'napr-job') => ({ service: svc, policy: ON, jobId });

test('Service176: CAPTCHA detected → solved → source opens the record → evidence read, good report', async () => {
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const http = napr();
  const r = await runMyGovApiWorkflow(code, undefined, { fetch: http.fetch, parsePdf: parser, captcha: ctx(svc) });
  assert.equal(r.status, 'SEARCH_CONFIRMED');
  assert.equal(r.documents.filter((d) => d.complete).length, 1);
  assert.equal(r.captchaResolution[0].outcome, 'ACCEPTED');
  assert.equal(s.calls.recaptcha[0].googlekey, SITEKEY);
  assert.deepEqual(s.calls.good, ['solve-1']);
  // The token travels only in the source's own continuation request, never in the result.
  assert.ok(!JSON.stringify(r).includes('"GOOD"'));
});

test('Service176: rejected tokens are bad-reported, bounded, and leave a non-blocking gated result', async () => {
  const s = fakeSolver(['BAD1', 'BAD2', 'BAD3']);
  const svc = service(s);
  const step = await runMyGovApiStep(code, undefined, { fetch: napr().fetch, parsePdf: parser, captcha: ctx(svc, 'napr-reject') });
  assert.equal(step.keep, false);
  assert.equal(step.result.status, 'BLOCKED');
  assert.equal(step.result.captchaResolution[0].outcome, 'REJECTED');
  assert.equal(s.calls.recaptcha.length, 2); // maxAttemptsPerProvider
  assert.deepEqual(s.calls.bad, ['solve-1', 'solve-2']);
});

test('Service176: no CAPTCHA → the solver is never called', async () => {
  const s = fakeSolver(['GOOD']);
  const r = await runMyGovApiWorkflow(code, undefined, { fetch: napr({ status: '20', acceptToken: '' }).fetch, parsePdf: parser, captcha: ctx(service(s), 'napr-none') });
  assert.equal(r.status, 'SEARCH_CONFIRMED');
  assert.equal(s.calls.recaptcha.length, 0);
  assert.deepEqual(r.captchaResolution, []);
});

test('Service176: gate without a discoverable site key spends nothing', async () => {
  const s = fakeSolver(['GOOD']);
  const r = await runMyGovApiWorkflow(code, undefined, { fetch: napr({ challengePage: false }).fetch, parsePdf: parser, captcha: ctx(service(s), 'napr-nokey') });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.captchaResolution[0].outcome, 'SITEKEY_NOT_FOUND');
  assert.equal(s.calls.recaptcha.length, 0);
});

test('Service176: a hung solver cannot hold the provider past its deadline', async () => {
  const svc = new CaptchaService({ env: { TWOCAPTCHA_API_KEY: KEY }, solverFactory: fakeSolver(['GOOD'], { delayMs: 5000 }).factory, timeoutMs: 10_000 });
  const t0 = Date.now();
  const step = await runMyGovApiStep(code, undefined, { fetch: napr().fetch, parsePdf: parser, budgetMs: 300, captcha: ctx(svc, 'napr-hang') });
  assert.equal(step.result.status, 'TIMEOUT');
  assert.ok(Date.now() - t0 < 2000);
});

// ── RS.ge in a real browser, against a stand-in registry page ──
const RS_PAGE = (sitekey) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <input id="tin"><button id="btnSearch1" type="button">ძიება</button>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
  <textarea name="g-recaptcha-response" style="display:none"></textarea>
  <div id="out"></div>
  <script>
    document.getElementById('btnSearch1').onclick = () => {
      const t = document.querySelector('textarea[name="g-recaptcha-response"]').value;
      const tin = document.getElementById('tin').value;
      document.getElementById('out').innerText = t === 'GOOD'
        ? 'საიდენტიფიკაციო კოდი: ' + tin + '\\nდასახელება: შპს ტესტი\\nსტატუსი: აქტიური'
        : 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი';
    };
  </script></body></html>`;

// The Playwright workers are excluded from the plain test build (they need DOM
// types); load the real TypeScript source through tsx, a worker dependency.
async function loadRsWorker() {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport('../src/workflows/financial/RsTaxpayerWorker.ts', import.meta.url);
}

// Stand-in for a registry page that validates in JS through the widget API
// (grecaptcha.getResponse()) and its render() callback — NOT the textarea.
// The fake widget answers '' like the real one does when nobody clicked it.
const RS_PAGE_API = (sitekey) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <input id="tin"><button id="btnSearch1" type="button">ძიება</button>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
  <textarea name="g-recaptcha-response" style="display:none"></textarea>
  <div id="out"></div>
  <script>
    let cbToken = null;
    window.grecaptcha = { getResponse: () => '', render: () => 0, reset() {} };
    window.___grecaptcha_cfg = { clients: { 0: { Xy: { Ab: { sitekey: '${sitekey}', callback: function onRsVerified(t) { cbToken = t; } } } } } };
    document.getElementById('btnSearch1').onclick = function rsSearch() {
      const t = grecaptcha.getResponse();
      const tin = document.getElementById('tin').value;
      document.getElementById('out').innerText = t === 'GOOD' && cbToken === 'GOOD'
        ? 'საიდენტიფიკაციო კოდი: ' + tin + '\\nდასახელება: შპს ტესტი\\nსტატუსი: აქტიური'
        : 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი';
    };
  </script></body></html>`;

// Stand-in for a stale screen: Search #1 shows the warning, later clicks
// change nothing at all (no fresh render).
const RS_PAGE_STALE = (sitekey) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <input id="tin"><button id="btnSearch1" type="button">ძიება</button>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
  <textarea name="g-recaptcha-response" style="display:none"></textarea>
  <div id="out"></div>
  <script>
    let clicks = 0;
    document.getElementById('btnSearch1').onclick = () => {
      if (++clicks > 1) return;
      document.getElementById('out').innerText = 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი';
    };
  </script></body></html>`;

async function withRsPage(fn, body = RS_PAGE(SITEKEY)) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return 'skip';
  }
  // The worker pins its own Playwright; fall back to the sandbox's Chromium when its revision is absent.
  const browser =
    (await chromium.launch({ headless: true }).catch(() => null)) ??
    (await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => null));
  if (!browser) return 'skip';
  try {
    const page = await browser.newPage();
    await page.route('https://www.rs.ge/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
    await page.route(/google\.com|gstatic\.com/, (route) => route.abort());
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test('RS.ge: CAPTCHA solved, token accepted by the page, taxpayer parsed, good report; heartbeat at every phase', { timeout: 90_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const phases = [];
  const outcome = await withRsPage(async (page) => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: '404000000' }, undefined, { captcha: { service: service(s), policy: ON, jobId: 'rs-ok' }, onProgress: (p) => phases.push(p) }));
  if (outcome === 'skip') return t.skip('Chromium unavailable');
  assert.equal(outcome.status, 'SEARCH_CONFIRMED');
  assert.equal(outcome.taxpayerData.taxpayerName, 'შპს ტესტი');
  assert.equal(outcome.captchaResolution[0].outcome, 'ACCEPTED');
  assert.deepEqual(s.calls.good, ['solve-1']);
  assert.equal(s.calls.recaptcha[0].googlekey, SITEKEY);
  assert.deepEqual(phases, ['NAVIGATED', 'SEARCH1', 'SOLVING_ATTEMPT_1', 'SEARCH2_ATTEMPT_1']);
});

test('RS.ge: a page validating via grecaptcha.getResponse() + its render() callback receives the token', { timeout: 90_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const outcome = await withRsPage(
    async (page) => {
      const r = await runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: '404000000' }, undefined, { captcha: { service: service(s), policy: ON, jobId: 'rs-api' } });
      return { r, viaApi: await page.evaluate(() => grecaptcha.getResponse()) };
    },
    RS_PAGE_API(SITEKEY),
  );
  if (outcome === 'skip') return t.skip('Chromium unavailable');
  assert.equal(outcome.r.status, 'SEARCH_CONFIRMED');
  assert.equal(outcome.r.captchaResolution[0].outcome, 'ACCEPTED');
  assert.equal(outcome.viaApi, 'GOOD');
  assert.equal(s.calls.recaptcha.length, 1);
  assert.deepEqual(s.calls.good, ['solve-1']);
  assert.ok(!JSON.stringify(outcome.r).includes('"GOOD"'));
});

test('RS.ge: warning re-rendered after the post-solve search → REJECTED, bad report, NO second paid solve', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['BAD']);
  const svc = service(s);
  const outcome = await withRsPage(async (page) => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: '404000000' }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-bad' }, postSolveWaitMs: 3000 }));
  if (outcome === 'skip') return t.skip('Chromium unavailable');
  assert.equal(outcome.status, 'WAITING_HUMAN');
  assert.equal(outcome.captchaResolution[0].outcome, 'REJECTED');
  // A fresh token through the same integration would be refused the same way.
  assert.equal(s.calls.recaptcha.length, 1);
  assert.deepEqual(s.calls.bad, ['solve-1']);
  assert.equal(outcome.captchaResolution[0].attempts, 1);
  assert.deepEqual(svc.ledgerFor('rs-bad').map((e) => e.outcome), ['REJECTED']);
});

test('RS.ge: no fresh render after the post-solve search → NO_CHANGE (never REJECTED), retried within the cap', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const svc = service(s);
  const phases = [];
  const outcome = await withRsPage(
    async (page) => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: '404000000' }, undefined, { captcha: { service: svc, policy: ON, jobId: 'rs-stale' }, postSolveWaitMs: 2500, onProgress: (p) => phases.push(p) }),
    RS_PAGE_STALE(SITEKEY),
  );
  if (outcome === 'skip') return t.skip('Chromium unavailable');
  assert.equal(outcome.status, 'WAITING_HUMAN');
  assert.equal(outcome.captchaResolution[0].outcome, 'NO_CHANGE');
  assert.equal(s.calls.recaptcha.length, 2); // retry allowed after NO_CHANGE, bounded by maxAttemptsPerProvider
  assert.deepEqual(s.calls.bad, []); // a stale screen is no evidence against the token
  assert.deepEqual(svc.ledgerFor('rs-stale').map((e) => e.outcome), ['NO_CHANGE', 'NO_CHANGE']);
  assert.deepEqual(phases, ['NAVIGATED', 'SEARCH1', 'SOLVING_ATTEMPT_1', 'SEARCH2_ATTEMPT_1', 'SOLVING_ATTEMPT_2', 'SEARCH2_ATTEMPT_2']);
});

test('RS.ge: read-only page diagnostic names the search handler and reCAPTCHA config, bounded, no token', { timeout: 60_000 }, async (t) => {
  const { collectRsDiagnostic } = await loadRsWorker();
  const d = await withRsPage(async (page) => {
    await page.goto('https://www.rs.ge/TaxpayersRegistry', { waitUntil: 'domcontentloaded' });
    return collectRsDiagnostic(page);
  }, RS_PAGE_API(SITEKEY));
  if (d === 'skip') return t.skip('Chromium unavailable');
  assert.equal(d.btnFound, true);
  assert.match(d.btnOnclickProp, /grecaptcha\.getResponse/);
  assert.equal(d.recaptcha.sitekeyAttrPresent, true);
  assert.equal(d.recaptcha.grecaptchaPresent, true);
  assert.equal(d.recaptcha.enterprise, false);
  assert.deepEqual(d.recaptcha.callbackPaths, ['clients.0.Xy.Ab.callback=fn:onRsVerified']);
  assert.ok(JSON.stringify(d).length < 4096);
});

// ── isolation: one provider's CAPTCHA never blocks the others ──
test('a provider stuck in CAPTCHA settles itself; the next provider still runs', async () => {
  const s = fakeSolver(['BAD']);
  const svc = service(s);
  const order = [];
  const providers = [
    async () => { order.push('mygov'); return runMyGovApiStep(code, undefined, { fetch: napr().fetch, parsePdf: parser, captcha: ctx(svc, 'iso') }); },
    async () => { order.push('tas'); return { result: { source: 'tas', status: 'SEARCH_CONFIRMED' }, keep: false }; },
  ];
  const settled = await Promise.allSettled(providers.map((p) => p()));
  assert.deepEqual(order, ['mygov', 'tas']);
  assert.equal(settled[0].value.result.status, 'BLOCKED');
  assert.equal(settled[0].value.keep, false);
  assert.equal(settled[1].value.result.status, 'SEARCH_CONFIRMED');
});

test('the key may live under any accepted name, or one named by CAPTCHA_KEY_VAR — reported by name only', () => {
  const mk = (env) => new CaptchaService({ env, solverFactory: fakeSolver(['t']).factory }).status();
  assert.equal(mk({ CAPTCHA_KEY: KEY }).keyVariable, 'CAPTCHA_KEY');
  assert.equal(mk({ CAPTCHA_KEY_VAR: 'MY_SOLVER_SECRET', MY_SOLVER_SECRET: KEY }).keyVariable, 'MY_SOLVER_SECRET');
  assert.equal(mk({ TWOCAPTCHA_API_KEY: 'short' }).configured, false);
});

// Stand-in for the real failure: Search #1 opens reCAPTCHA's image challenge —
// a full-screen backdrop plus the bframe iframe attached to <body> — and it
// stays open after the token is delivered, so a pointer click on the button
// lands on the backdrop. Production job e02d4f16: zero DOM change after two
// solved tokens.
const RS_PAGE_OVERLAY = (sitekey) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <input id="tin"><button id="btnSearch1" type="button">ძიება</button>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
  <textarea name="g-recaptcha-response" style="display:none"></textarea>
  <div id="out"></div>
  <script>
    document.getElementById('btnSearch1').onclick = () => {
      const t = document.querySelector('textarea[name="g-recaptcha-response"]').value;
      const tin = document.getElementById('tin').value;
      if (t !== 'GOOD') {
        const c = document.createElement('div');
        c.style.cssText = 'position:absolute;top:0;left:0;z-index:2000000000;visibility:visible';
        c.innerHTML = '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#fff;opacity:0.05"></div>' +
          '<div><iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/api2/bframe?k=x" width="400" height="580"></iframe></div>';
        document.body.appendChild(c);
        document.getElementById('out').innerText = 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი';
        return;
      }
      document.getElementById('out').innerText = 'საიდენტიფიკაციო კოდი: ' + tin + '\\nდასახელება: შპს ტესტი\\nსტატუსი: აქტიური';
    };
  </script></body></html>`;

test('RS.ge: the open challenge overlay does not swallow Search #2 after a solve', { timeout: 120_000 }, async (t) => {
  const { runRsTaxpayerWorker } = await loadRsWorker();
  const s = fakeSolver(['GOOD']);
  const t0 = Date.now();
  const outcome = await withRsPage(
    async (page) => runRsTaxpayerWorker(page, { name: 'ტესტი', idCode: '404000000' }, undefined, { captcha: { service: service(s), policy: ON, jobId: 'rs-overlay' }, postSolveWaitMs: 5000 }),
    RS_PAGE_OVERLAY(SITEKEY),
  );
  if (outcome === 'skip') return t.skip('Chromium unavailable');
  assert.equal(outcome.status, 'SEARCH_CONFIRMED');
  assert.equal(outcome.taxpayerData.taxpayerName, 'შპს ტესტი');
  assert.equal(outcome.captchaResolution[0].outcome, 'ACCEPTED');
  assert.ok(Date.now() - t0 < 25_000, 'no 30 s click timeout behind the overlay');
});
