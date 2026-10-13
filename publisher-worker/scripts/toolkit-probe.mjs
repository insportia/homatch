// Development-only probes. Installed toolkit is never a production worker dependency.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.HOMATCH_AUTOMATION_ROOT || 'C:/HOMATCH-Automation';
const mode = process.argv[2];
const artifacts = resolve('publisher-worker/artifacts/toolkit');
await mkdir(artifacts, { recursive: true });
const fixture = await readFile('publisher-worker/qa/toolkit-fixture.html', 'utf8');
const load = (path) => import(pathToFileURL(resolve(root, 'node_modules', path)).href);
const version = async (name) => JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
const start = performance.now();
let result;
if (mode === 'playwright') {
  const { chromium } = await load('playwright/index.mjs');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(fixture);
    await page.locator('[name=myhome]').check();
    await page.getByRole('button').click();
    assert.equal(await page.locator('output').innerText(), 'myhome');
    await page.evaluate(() => { const input=document.createElement('input');input.type='file';input.id='photo';document.body.append(input); });
    await page.locator('#photo').setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('QA upload only') });
    assert.equal(await page.locator('#photo').evaluate(e => e.files.length), 1);
    await context.addCookies([{name: 'isolation_canary', value: 'synthetic', domain: 'homatch.invalid', path: '/'}]);
    const other = await browser.newContext();
    assert.deepEqual(await other.cookies(), []);
    await other.close();
    await page.screenshot({ path: resolve(artifacts, 'playwright-fixture.png'), mask: [page.locator('.qa-private')] });
    result = { tool: 'Playwright', version: await version('playwright'), status: 'PASS', fixtureForm: true, upload: true, contextIsolation: true, externalPortals: 'NOT_VERIFIED' };
  } catch(error) { result = { tool: 'Playwright', version: await version('playwright'), status: 'FAIL', error: String(error.message).slice(0,800) }; }
  finally { await browser?.close(); }
} else if (mode === 'playwright-rrweb') {
  // Existing stable installation is also checked, so toolkit/engine compatibility is explicit.
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(fixture);
    await page.addScriptTag({ path: resolve(root, 'node_modules/@rrweb/record/dist/record.umd.cjs') });
    await page.evaluate(() => {
      window.qaEvents = [];
      window.qaStop = window.rrwebRecord.record({
        emit: event => window.qaEvents.push(event),
        maskAllInputs: true, maskTextSelector: '*', blockClass: 'qa-private',
        inlineStylesheet: false, recordCanvas: false, collectFonts: false,
      });
    });
    await page.locator('[name=otp]').fill('OTP_SECRET_CANARY');
    await page.locator('[name=password]').fill('PASSWORD_SECRET_CANARY');
    await page.locator('[name=myhome]').check();
    await page.getByRole('button').click();
    assert.equal(await page.locator('output').innerText(), 'myhome');
    await page.waitForTimeout(100); // Flush the recorder's mutation batch, not simulated job progress.
    const events = await page.evaluate(() => { window.qaStop(); return window.qaEvents; });
    const serialized = JSON.stringify(events);
    for (const secret of ['OTP_SECRET_CANARY', 'PASSWORD_SECRET_CANARY', 'PRIVATE_CONTACT_CANARY']) assert.ok(!serialized.includes(secret));
    assert.ok(events.some(e => e.type === 2));
    assert.ok(events.some(e => e.type === 3));
    await writeFile(resolve(artifacts, 'synthetic-replay.json'), serialized);
    const replay = await context.newPage();
    await replay.setContent('<!doctype html><html><body><main id="replay"></main></body></html>');
    await replay.addScriptTag({ path: resolve(root, 'node_modules/@rrweb/replay/dist/replay.umd.cjs') });
    await replay.addStyleTag({ path: resolve(root, 'node_modules/@rrweb/replay/dist/style.css') });
    await replay.evaluate(events => {
      window.qaReplay = new window.rrwebReplay.Replayer(events, { root: document.querySelector('#replay'), showWarning: false, showDebug: false });
      window.qaReplay.pause(events.at(-1).timestamp - events[0].timestamp + 1);
    }, events);
    await replay.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#publishing-form'));
    const restored = await replay.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('[name=otp]'));
    assert.equal(restored, null);
    assert.equal(await replay.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('[name=myhome]').checked), true);
    await replay.screenshot({ path: resolve(artifacts, 'synthetic-replay.png') });
    result = { tool: 'rrweb', version: await version('@rrweb/record'), status: 'PASS', events: events.length, redactionCanaries: 3, replayRestored: true, engine: 'repository playwright-core', installedPlaywright: await version('playwright') };
  } finally { await browser.close(); }
} else if (mode === 'stagehand') {
  const { localBrowser, Stagehand } = await load('@browserbasehq/stagehand/dist/index.mjs');
  let browser, stagehand;
  try {
    browser = await localBrowser.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', userDataDir: resolve(artifacts, 'stagehand-profile'), preserveUserDataDir: false });
    stagehand = await Stagehand.create({ browser, model: { generate: async () => { throw new Error('LOCAL_MODEL_NOT_INSTALLED'); } } });
    const pages = await browser.context.pages();
    const page = pages[0];
    await page.goto('data:text/html,' + encodeURIComponent(fixture));
    result = { tool: 'Stagehand', version: await version('@browserbasehq/stagehand'), status: 'PARTIAL', initialized: true, fixtureTitle: await page.title(), inference: 'NOT_RUN_NO_MODEL', cloud: false };
  } catch (error) {
    result = { tool: 'Stagehand', version: await version('@browserbasehq/stagehand'), status: 'FAIL', error: String(error.message).slice(0, 800), causes: (error.errors || [error.cause]).filter(Boolean).map(e => String(e.message).slice(0, 500)), cloud: false };
  } finally { await stagehand?.close().catch(() => {}); await browser?.close().catch(() => {}); }
} else if (mode === 'ollama') {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok);
  const { models } = await response.json();
  result = { tool: 'Ollama', status: models.length ? 'PARTIAL' : 'PARTIAL', service: 'PASS', models: models.map(m => m.name), inference: 'NOT_RUN_REQUIRES_AVAILABLE_MODEL' };
} else throw new Error('Choose playwright-rrweb, stagehand or ollama');
result.durationMs = Math.round(performance.now() - start);
await writeFile(resolve(artifacts, `${mode}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (result.status === 'FAIL') process.exitCode = 1;
