// The publishing browser worker in REAL Chromium against LOCAL fixture pages that
// reproduce the controls recorded in the owner's MCP exploration of MyHome.ge and
// SS.ge. Every request is fulfilled locally — these tests never reach a portal.
// They prove the adapters' behaviour on the recorded controls; they are NOT
// evidence that the live portals still look like this (level FIXTURE_TESTED).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { myhome } from '../.tstest-build/publishing/adapters/myhome.js';
import { ssge } from '../.tstest-build/publishing/adapters/ssge.js';
import { PublishingRunner } from '../.tstest-build/publishing/runner.js';
import { CAPABILITIES } from '../.tstest-build/publishing/capabilities.js';
import { BROWSER_CAPABILITIES } from '../../supabase/functions/publishing-engine/automation.ts';

const CANDIDATES = [process.env.PLAYWRIGHT_CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
async function launch() {
  try { return await chromium.launch({ headless: true }); } catch {
    const path = CANDIDATES.find((p) => existsSync(p));
    if (!path) throw new Error('NO_CHROMIUM');
    return chromium.launch({ headless: true, executablePath: path });
  }
}
let available = true;
try { const b = await launch(); await b.close(); } catch { available = false; }
const opts = available ? {} : { skip: 'no local Chromium binary available' };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAHUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const FOOTER = 'საკონტაქტო ინფორმაცია\nქონების მფლობელი: Nino\nტელეფონი: +995 599 11 12 22\nგანცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.';
const task = (over = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', leaseToken: '00000000-0000-4000-8000-000000000002', kind: 'CREATE', portalId: 'myhome', attempt: 1,
  submitAlreadyStarted: false, session: { cookies: [{ name: 'sid', value: 'S1', domain: '.myhome.ge', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] },
  account: { contactPhone: '+995322000111', liveSubmitApproved: false },
  portal: { createUrl: 'https://statements.myhome.ge/ka/statement/create?referrer=myhome', domains: ['myhome.ge'], maxPhotos: 16 },
  listing: { version: 3, propertyType: 'APARTMENT', dealType: 'SALE', price: 150000, currency: 'USD', area: 90, rooms: 3, bedrooms: 2, bathrooms: null, floor: 4, totalFloors: 9, condition: '', city: 'თბილისი', district: '', street: 'Chavchavadze', streetNumber: '12', amenities: [], title: 'ბინა', ownerName: 'Nino' },
  copies: { ka: { title: 'ბინა', description: `სამოთახიანი ბინა.\n\n${FOOTER}`, footer: FOOTER, contactPhone: '+995322000111' } },
  photos: [], publication: null,
  ...over,
});

/* The MyHome statement form, rebuilt from the recorded controls. */
const myhomeForm = ({ login = false, verifiedPhone = true, free = true, duplicateArea = false } = {}) => `<!doctype html><html lang="ka"><body>
${login ? '<a href="#">შესვლა</a>' : ''}
<div role="group"><button type="button" class="t" aria-pressed="false">ბინა</button><button type="button" class="t" aria-pressed="false">სახლი</button></div>
<div role="group"><button type="button" class="d" aria-pressed="false">იყიდება</button><button type="button" class="d" aria-pressed="false">ქირავდება</button><button type="button" class="d" aria-pressed="false">ქირავდება დღიურად</button></div>
<label>მდებარეობა<input id="city" autocomplete="off"></label><ul id="city-o"></ul>
<label>ქუჩა<input id="street" autocomplete="off"></label><ul id="street-o"></ul>
<label>ქუჩის ნომერი<input></label>
<label>ფართი<input></label>${duplicateArea ? '<label>ფართი<input></label>' : ''}
<label>სართული<input></label><label>სართულები სულ<input></label><label>ოთახები<input></label><label>საძინებლები<input></label>
<label>ფასი<input name="total_price"></label><select name="currency"><option value="USD">USD</option><option value="GEL">GEL</option></select>
<label>სახელი<input></label>
<div class="phone"><label>ტელეფონის ნომერი<input></label>${verifiedPhone ? '<span>დადასტურებულია</span>' : ''}</div>
<textarea></textarea>
<label><input type="checkbox" checked> Livo.ge-ზეც განთავსება</label>
<input type="file" multiple accept="image/*" style="display:none"><div id="uploads"></div>
<section><p>${free ? 'უფასო განცხადება' : 'VIP — 5 ₾'}</p><button type="button" id="publish">გამოქვეყნება</button></section>
<script>
 window.__submits = 0;
 for (const g of ['.t', '.d']) document.querySelectorAll(g).forEach((b) => b.onclick = () => { document.querySelectorAll(g).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); });
 const ac = (id, options) => { const i = document.getElementById(id), ul = document.getElementById(id + '-o'); i.oninput = () => { ul.innerHTML = ''; for (const o of options) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = o; li.onclick = () => { i.value = o; ul.innerHTML = ''; }; ul.append(li); } }; };
 ac('city', ['თბილისი', 'თბილისი ზღვა']); ac('street', ['Chavchavadze, თბილისი', 'Chavchavadze, ბათუმი']);
 document.querySelector('input[type=file]').onchange = (e) => { for (const f of e.target.files) { const d = document.createElement('div'); d.dataset.testid = 'uploaded-photo'; d.textContent = f.name; document.getElementById('uploads').append(d); } };
 document.getElementById('publish').onclick = () => { window.__submits++; location.href = 'https://www.myhome.ge/ka/pr/23456789/'; };
</script></body></html>`;

const ssgeForm = ({ form = true } = {}) => `<!doctype html><html lang="ka"><body>
${form ? `<div><button type="button" class="t" aria-pressed="false">ბინა</button><button type="button" class="t" aria-pressed="false">კერძო სახლი</button></div>
<div><button type="button" class="d" aria-pressed="false">იყიდება</button><button type="button" class="d" aria-pressed="false">ქირავდება</button></div>
<div><button type="button" class="c" aria-pressed="false">ახალი გარემონტებული</button><button type="button" class="c" aria-pressed="false">სარემონტო</button></div>
<input name="city" autocomplete="off"><ul id="city-o"></ul><input name="street" autocomplete="off"><ul id="street-o"></ul>
<input name="totalArea"><input name="floor"><input name="floors"><input name="house-number"><input name="rooms"><input name="bedrooms"><input name="price">
<div><button type="button" class="cur" aria-pressed="false">$ გამოჩნდეს საიტზე</button><button type="button" class="cur" aria-pressed="false">₾ გამოჩნდეს საიტზე</button></div>
<input name="contactName"><input name="phone"><textarea placeholder="ჩაწერე აქ..."></textarea><input type="file" multiple>
<button type="button" id="place">განცხადების დამატება</button>
<script>
 window.__submits = 0; document.getElementById('place').onclick = () => window.__submits++;
 for (const g of ['.t', '.d', '.c', '.cur']) document.querySelectorAll(g).forEach((b) => b.onclick = () => { document.querySelectorAll(g).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); });
 for (const [n, opts] of [['city', ['თბილისი']], ['street', ['Chavchavadze']]]) { const i = document.querySelector('input[name=' + n + ']'), ul = document.getElementById(n + '-o'); i.oninput = () => { ul.innerHTML = ''; for (const o of opts) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = o; li.onclick = () => { i.value = o; ul.innerHTML = ''; }; ul.append(li); } }; }
</script>` : '<h1>უძრავი ქონება</h1><a href="#">შესვლა</a>'}</body></html>`;

async function harness(t, routes) {
  const browser = await launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const seen = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    seen.push(url);
    for (const [pattern, respond] of routes) if (pattern.test(url)) return route.fulfill(respond(url));
    return route.fulfill({ status: 404, body: 'not here' });
  });
  const page = await context.newPage();
  const calls = { stages: [], submitting: 0, shots: [] };
  const ctx = (tk, { door = true, photos = [] } = {}) => ({
    page, task: tk, photos,
    stage: async (s) => { calls.stages.push(s); },
    screenshot: async (s) => { calls.shots.push(s); },
    markSubmitting: async () => { calls.submitting++; return door; },
    pause: async () => {},
  });
  return { page, ctx, calls, seen };
}
const html = (body, status = 200) => () => ({ status, contentType: 'text/html; charset=utf-8', body });

test('the worker capability table matches the edge one exactly', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CAPABILITIES)), JSON.parse(JSON.stringify(BROWSER_CAPABILITIES)));
  for (const id of ['placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']) assert.ok(Object.values(CAPABILITIES[id]).every((l) => l === 'NOT_EXPLORED'), id);
  for (const id of ['myhome', 'ssge']) for (const k of ['UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE']) assert.equal(CAPABILITIES[id][k], 'NOT_EXPLORED', `${id}.${k} was never recorded`);
});

test('MyHome: session check reads the real page — the form means signed in, a login link means not', opts, async (t) => {
  const h = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm())]]);
  assert.equal(await myhome.checkSession(h.page, task()), 'VALID');
  const h2 = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm({ login: true }))]]);
  assert.equal(await myhome.checkSession(h2.page, task()), 'AUTH_REQUIRED');
});

test('MyHome CREATE without live-submit approval: every field filled and read back, photos uploaded, NOTHING submitted', opts, async (t) => {
  const h = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm())]]);
  const photos = [{ name: 'homatch-01.png', mimeType: 'image/png', buffer: PNG }, { name: 'homatch-02.png', mimeType: 'image/png', buffer: PNG }];
  const r = await myhome.run('CREATE', h.ctx(task(), { photos }));
  assert.equal(r.outcome, 'PREPARED');
  assert.equal(h.calls.submitting, 0, 'the submit door was never asked');
  assert.equal(await h.page.evaluate(() => window.__submits), 0);
  const v = await h.page.evaluate(() => ({
    price: document.querySelector('[name=total_price]').value, city: document.getElementById('city').value, street: document.getElementById('street').value,
    phone: [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('ტელეფონის ნომერი')).querySelector('input').value,
    name: [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'სახელი').querySelector('input').value,
    desc: document.querySelector('textarea').value, livo: document.querySelector('input[type=checkbox]').checked, uploads: document.querySelectorAll('[data-testid=uploaded-photo]').length,
    type: document.querySelector('.t[aria-pressed=true]')?.textContent, deal: document.querySelector('.d[aria-pressed=true]')?.textContent,
  }));
  assert.deepEqual(v, { price: '150000', city: 'თბილისი', street: 'Chavchavadze, თბილისი', phone: '322000111', name: 'HOMATCH', desc: `სამოთახიანი ბინა.\n\n${FOOTER}`, livo: false, uploads: 2, type: 'ბინა', deal: 'იყიდება' });
  assert.equal(v.desc.split('ქონების მფლობელი').length - 1, 1, 'the owner footer exactly once, at the end');
  assert.ok(!v.desc.includes('322000111'), 'the HOMATCH number is in the contact field, never in the owner footer');
  assert.ok(r.result.fields.includes('livo_crosspost_unchecked'));
  assert.deepEqual(h.calls.stages, ['OPENING', 'FILLING', 'UPLOADING', 'VERIFYING']);
  assert.ok(h.calls.shots.includes('READY_TO_SUBMIT'));
});

test('MyHome CREATE with approval: passes the submit door once, clicks once, captures the real listing URL and id', opts, async (t) => {
  const h = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm())], [/www\.myhome\.ge\/ka\/pr\/23456789/, html('<h1>ID 23456789</h1>')]]);
  const r = await myhome.run('CREATE', h.ctx(task({ account: { contactPhone: '+995322000111', liveSubmitApproved: true } })));
  assert.equal(r.outcome, 'SUCCEEDED');
  assert.equal(r.result.externalId, '23456789');
  assert.equal(r.result.externalUrl, 'https://www.myhome.ge/ka/pr/23456789/');
  assert.equal(h.calls.submitting, 1);
});

test('MyHome: a closed submit door or an earlier submit means reconciliation — never a second click', opts, async (t) => {
  const h = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm())]]);
  const approved = { account: { contactPhone: '+995322000111', liveSubmitApproved: true } };
  assert.deepEqual(await myhome.run('CREATE', h.ctx(task(approved), { door: false })), { outcome: 'RECONCILIATION_REQUIRED', error: 'SUBMIT_DOOR_CLOSED' });
  assert.equal(await h.page.evaluate(() => window.__submits), 0);
  assert.deepEqual(await myhome.run('CREATE', h.ctx(task({ ...approved, submitAlreadyStarted: true }))), { outcome: 'RECONCILIATION_REQUIRED', error: 'SUBMIT_ALREADY_STARTED' });
});

test('MyHome stops instead of guessing: ambiguous field, paid publication, unverified phone, unrecorded type, signed out', opts, async (t) => {
  const cases = [
    [{ duplicateArea: true }, {}, /AMBIGUOUS_FIELD:area/],
    [{ free: false }, {}, /FREE_PUBLICATION_NOT_VERIFIED/],
    [{ verifiedPhone: false }, {}, /PHONE_VERIFICATION_REQUIRED/],
    [{}, { listing: { ...task().listing, propertyType: 'LAND' } }, /PROPERTY_TYPE_NOT_RECORDED/],
    [{}, { listing: { ...task().listing, currency: 'GEL' } }, /CURRENCY_CONTROL_NOT_RECORDED/],
    [{ login: true }, {}, /AUTH_REQUIRED/],
  ];
  for (const [form, over, code] of cases) {
    const h = await harness(t, [[/statements\.myhome\.ge/, html(myhomeForm(form))]]);
    await assert.rejects(myhome.run('CREATE', h.ctx(task({ ...over, account: { contactPhone: '+995322000111', liveSubmitApproved: true } }))), code);
    assert.equal(await h.page.evaluate(() => window.__submits ?? 0), 0, String(code));
  }
});

test('MyHome / SS.ge management operations were never recorded: refused, not attempted', opts, async (t) => {
  const h = await harness(t, []);
  for (const kind of ['UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE']) {
    assert.deepEqual(await myhome.run(kind, h.ctx(task({ kind }))), { outcome: 'BLOCKED', error: 'OPERATION_NOT_EXPLORED' });
    assert.deepEqual(await ssge.run(kind, h.ctx(task({ kind }))), { outcome: 'BLOCKED', error: 'OPERATION_NOT_EXPLORED' });
  }
  assert.equal(h.seen.length, 0, 'no page was opened');
});

test('STATUS: the public page in a real browser — the id in the page is live, 404 is gone', opts, async (t) => {
  const h = await harness(t, [[/pr\/23456789/, html('<p>23456789</p>')], [/pr\/11111111/, html('gone', 404)]]);
  assert.deepEqual(await myhome.run('STATUS', h.ctx(task({ kind: 'STATUS', publication: { externalId: '23456789', externalUrl: 'https://www.myhome.ge/ka/pr/23456789/', status: 'PUBLISHED' } }))), { outcome: 'SUCCEEDED', result: { state: 'LIVE' } });
  assert.deepEqual(await myhome.run('STATUS', h.ctx(task({ kind: 'STATUS', publication: { externalId: '11111111', externalUrl: 'https://www.myhome.ge/ka/pr/11111111/', status: 'PUBLISHED' } }))), { outcome: 'SUCCEEDED', result: { state: 'GONE' } });
  assert.deepEqual(await myhome.run('STATUS', h.ctx(task({ kind: 'STATUS', publication: { externalId: '1', externalUrl: 'https://evil.example/pr/1', status: 'PUBLISHED' } }))), { outcome: 'BLOCKED', error: 'URL_NOT_ON_PORTAL' });
});

test('SS.ge CREATE: recorded fields filled and verified, then PREPARED — the publish control was never recorded, so nothing is clicked', opts, async (t) => {
  const tk = task({ portalId: 'ssge', portal: { createUrl: 'https://home.ss.ge/ka/udzravi-qoneba/create', domains: ['ss.ge'], maxPhotos: null }, listing: { ...task().listing, condition: 'NEW' }, account: { contactPhone: '+995322000111', liveSubmitApproved: true } });
  const h = await harness(t, [[/home\.ss\.ge/, html(ssgeForm())]]);
  const r = await ssge.run('CREATE', h.ctx(tk));
  assert.equal(r.outcome, 'PREPARED');
  assert.equal(r.error, 'PUBLISH_CONTROL_NOT_RECORDED');
  assert.equal(h.calls.submitting, 0);
  assert.equal(await h.page.evaluate(() => window.__submits), 0);
  const v = await h.page.evaluate(() => ({ area: document.querySelector('[name=totalArea]').value, floors: document.querySelector('[name=floors]').value, phone: document.querySelector('[name=phone]').value, name: document.querySelector('[name=contactName]').value, cur: document.querySelector('.cur[aria-pressed=true]')?.textContent, cond: document.querySelector('.c[aria-pressed=true]')?.textContent, desc: document.querySelector('textarea').value }));
  assert.deepEqual(v, { area: '90', floors: '9', phone: '322000111', name: 'HOMATCH', cur: '$ გამოჩნდეს საიტზე', cond: 'ახალი გარემონტებული', desc: `სამოთახიანი ბინა.\n\n${FOOTER}` });
  const h2 = await harness(t, [[/home\.ss\.ge/, html(ssgeForm({ form: false }))]]);
  await assert.rejects(ssge.run('CREATE', h2.ctx(tk)), /CREATE_NAVIGATION_NOT_RECORDED/);
});

test('runner: claims, restores the session in an isolated context, reports progress and the outcome, closes the context', opts, async (t) => {
  const calls = [];
  let cookieSeen = null;
  const tk = task();
  const gateway = { call: async (action, body) => {
    calls.push([action, body]);
    if (action === 'claim') return { tasks: calls.filter((c) => c[0] === 'claim').length === 1 ? [tk] : [] };
    if (action === 'heartbeat') return { ok: true };
    if (action === 'artifact') return { uploadUrl: 'https://upload.test/x' };
    return { ok: true };
  } };
  let browser;
  const runner = new PublishingRunner({
    gateway, workerId: 'test', pacingMs: 0,
    fetcher: async (url) => ({ ok: true, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) }),
    launch: async () => {
      browser = await launch();
      const original = browser.newContext.bind(browser);
      browser.newContext = async (o) => {
        const c = await original(o);
        await c.route('**/*', (route) => {
          if (/statements\.myhome\.ge/.test(route.request().url())) { cookieSeen = route.request().headers().cookie ?? null; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: myhomeForm() }); }
          return route.fulfill({ status: 200, body: '' });
        });
        return c;
      };
      return browser;
    },
    log: () => {},
  });
  t.after(() => runner.stop());
  await runner.poll();
  assert.equal(cookieSeen, 'sid=S1', 'the account session was restored into the context');
  const finish = calls.find((c) => c[0] === 'finish')[1];
  assert.equal(finish.outcome, 'PREPARED');
  assert.ok(calls.some((c) => c[0] === 'heartbeat' && c[1].stage === 'FILLING'), 'progress is reported');
  assert.ok(calls.some((c) => c[0] === 'session.save'), 'refreshed cookies are sent back to be re-sealed');
  assert.equal(calls.some((c) => c[0] === 'submitting'), false);
  assert.equal(browser.contexts().length, 0, 'the context is closed after the operation');
  assert.equal(runner.status().prepared, 1);
  const logged = JSON.stringify(calls.filter((c) => c[0] !== 'session.save'));
  assert.equal(logged.includes('S1') && !logged.includes('"session"'), false, 'the session value travels only in session.save');
});

test('runner: an operation for a portal without a recorded adapter is refused without opening a browser', async () => {
  const calls = [];
  let launched = false;
  const runner = new PublishingRunner({ gateway: { call: async (a, b) => { calls.push([a, b]); return a === 'claim' ? { tasks: [task({ portalId: 'placege' })] } : { ok: true }; } }, workerId: 't', launch: async () => { launched = true; throw new Error('no'); }, log: () => {} });
  await runner.poll();
  assert.equal(launched, false);
  assert.deepEqual(calls.find((c) => c[0] === 'finish')[1].error, 'NO_ADAPTER');
});
