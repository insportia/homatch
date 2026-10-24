// ADMIN → MORTGAGE RULES — rule activation and bank products, in a real browser.
//
// Every control on the screen is driven the way an admin would use it, against a stubbed
// Supabase that keeps state, and the test reads back what was written: the product is created
// as a draft, verified with a source and a date, then retired; a CANDIDATE rule is activated
// through the audited RPC. A write that matches nothing must show an error, not a success.
//
//   npm run build:harness && node --test tests/mobile/adminMortgageBankProducts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core')]) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Chrome not found — set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}
const skipReason = haveDeps();
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 600000 };

function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated' })}.stub`;
  return { access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test', app_metadata: {}, user_metadata: {} } };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'admin@example.test', is_admin: true, role: 'admin', preferred_language: 'en',
  full_name: 'Admin User', plan: 'FREE', created_at: new Date().toISOString() };

const CANDIDATE = { id: 'r-2027', type: 'PTI_LIMIT', title: 'PTI GEL below 2,000 GEL (from 2027-02-01)', status: 'CANDIDATE', currency: 'GEL',
  effective_from: '2027-02-01', effective_to: null, last_verified_at: '2026-10-24', official_source_url: 'https://civil.ge/archives/753059', source_authority: 'civil.ge' };
const ACTIVE = { id: 'r-now', type: 'LTV_LIMIT', title: 'LTV GEL', status: 'ACTIVE', currency: 'GEL', effective_from: null, effective_to: null,
  last_verified_at: '2026-09-19', official_source_url: 'https://nbg.gov.ge/page/pti-da-ltv-motkhovnebi', source_authority: 'National Bank of Georgia' };

test('admin mortgage rules: activate a candidate, create, verify and retire a bank product', opts, async (t) => {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', 'en'); },
    ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();

  const products = [];
  const rules = [structuredClone(CANDIDATE), structuredClone(ACTIVE)];
  const writes = { insert: [], update: [], rpc: [] };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    if (url.includes('/rest/v1/rpc/mortgage_rule_admin_set_status')) {
      const body = JSON.parse(req.postData() || '{}');
      writes.rpc.push(body);
      const rule = rules.find((x) => x.id === body.p_rule_id);
      if (!rule || rule.status !== 'CANDIDATE') return r.fulfill(json({ message: 'RULE_NOT_CANDIDATE' }, 400));
      rule.status = body.p_status;
      return r.fulfill(json({ id: rule.id, status: rule.status }));
    }
    if (url.includes('/rest/v1/mortgage_rules')) return r.fulfill(json(rules));
    if (url.includes('/rest/v1/mortgage_bank_products')) {
      const m = req.method();
      if (m === 'GET') return r.fulfill(json(products));
      if (m === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const row = Array.isArray(body) ? body[0] : body;
        writes.insert.push(row);
        const created = { id: `p${products.length + 1}`, review_status: 'DRAFT', verified_at: null, review_due_days: 45, effective_from: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
        products.push(created);
        return r.fulfill(json({ id: created.id }, 201));
      }
      if (m === 'PATCH') {
        const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '');
        const patch = JSON.parse(req.postData() || '{}');
        writes.update.push({ id, patch });
        const row = products.find((p) => p.id === id);
        if (!row) return r.fulfill(json(null));
        Object.assign(row, patch);
        return r.fulfill(json({ id }));
      }
    }
    if (url.includes('/rest/v1/rpc/')) return r.fulfill(json(null));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    if (url.includes('/functions/v1/')) return r.fulfill(json({}));
    return r.fulfill(json({}));
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/admin/mortgage-rules`, { waitUntil: 'domcontentloaded' });
  await page.getByText(CANDIDATE.title).waitFor({ timeout: 30000 });

  /* 1 · activate the CANDIDATE rule through the audited RPC */
  const row = page.locator('tr', { hasText: CANDIDATE.title });
  await row.getByRole('button', { name: 'Activate', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByText(`"${CANDIDATE.title}" is now in force`).first().waitFor({ timeout: 10000 });
  assert.equal(writes.rpc.length, 1);
  assert.equal(writes.rpc[0].p_status, 'ACTIVE');
  assert.match(writes.rpc[0].p_official_source_url, /^https:\/\//, 'the source the admin confirmed is sent');
  assert.equal(await page.locator('tr', { hasText: ACTIVE.title }).getByRole('button', { name: 'Activate' }).count(), 0, 'an ACTIVE rule offers no move');

  /* 2 · create a product: it is a draft, hidden from customers */
  const section = page.getByTestId('admin-mortgage-bank-products');
  await section.getByRole('button', { name: 'New bank product' }).click();
  const form = section.getByRole('form', { name: 'New bank product' });
  await form.getByLabel('Bank', { exact: true }).fill('TBC Bank');
  await form.getByLabel('Product', { exact: true }).fill('Mortgage GEL');
  await form.getByLabel('Rate from, %', { exact: true }).fill('11.5');
  await form.getByLabel('Source page (https)', { exact: true }).fill('http://not-secure.ge');
  await form.getByRole('button', { name: 'Save' }).click();
  await form.getByText('Enter a full https:// address').waitFor({ timeout: 5000 });
  assert.equal(writes.insert.length, 0, 'an invalid source is never written');
  await form.getByLabel('Source page (https)', { exact: true }).fill('https://tbcbank.ge/mortgage');
  await form.getByRole('button', { name: 'Save' }).click();
  await section.getByText('TBC Bank').first().waitFor({ timeout: 10000 });
  assert.equal(writes.insert.length, 1);
  assert.equal(writes.insert[0].bank_name, 'TBC Bank');
  assert.ok(!('review_status' in writes.insert[0]) || writes.insert[0].review_status === 'DRAFT', 'a new product is a draft');
  await section.getByText('Hidden: not verified').first().waitFor({ timeout: 5000 });

  /* 3 · verify it: a dated, sourced check makes it visible */
  await section.locator('tr', { hasText: 'TBC Bank' }).getByRole('button', { name: 'Mark verified' }).click();
  const vd = page.getByRole('alertdialog');
  await vd.getByRole('button', { name: 'Mark verified' }).click();
  await section.getByText('Shown').first().waitFor({ timeout: 10000 });
  const v = writes.update.at(-1);
  assert.equal(v.patch.review_status, 'VERIFIED');
  assert.match(String(v.patch.verified_at), /^\d{4}-\d{2}-\d{2}$/);

  /* 4 · retire it: kept, hidden, never deleted */
  await section.locator('tr', { hasText: 'TBC Bank' }).getByRole('button', { name: 'Retire' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Retire' }).click();
  await section.getByText('Hidden: retired').first().waitFor({ timeout: 10000 });
  assert.equal(writes.update.at(-1).patch.review_status, 'RETIRED');
  assert.equal(products.length, 1, 'retired, not deleted');

  /* 5 · a write that matches nothing is reported, not celebrated */
  products.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(CANDIDATE.title).waitFor({ timeout: 30000 });
  products.push({ id: 'ghost', bank_name: 'Ghost Bank', product_name: 'X', currency: 'GEL', review_status: 'DRAFT', verified_at: null, review_due_days: 45,
    effective_from: null, source_url: 'https://ghost.ge', rate_from_percent: 10, rate_to_percent: null, rate_type: null, effective_rate_from_percent: null,
    min_down_payment_percent: null, min_term_months: null, max_term_months: null, notes: null });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await section.getByText('Ghost Bank').first().waitFor({ timeout: 30000 });
  products.length = 0;
  await section.locator('tr', { hasText: 'Ghost Bank' }).getByRole('button', { name: 'Mark verified' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark verified' }).click();
  await page.getByText(/Nothing was saved|Not saved/).first().waitFor({ timeout: 10000 });

  assert.deepEqual(errors, [], 'no page errors');
});
