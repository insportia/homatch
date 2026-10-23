// Purchased leads → the EXISTING Email Campaigns and Contacts screens, in a real browser.
//
// Harness build; the list audience, the language split, the campaign create edge function
// and the contacts query answered by fixtures shaped like the SQL / edge functions
// (20261127090000_curated_leads_marketplace.sql §12, outreach-campaign-preview):
//
//   * /outreach/email?new=1&list=<id> opens the create dialog on that list, and the
//     launch params leave the URL (a refresh does not reopen it);
//   * the audience shows total vs eligible (the rule outreach-send applies) and says why
//     not everyone receives the campaign;
//   * "one campaign per language" with a CHOSEN fallback language creates one DRAFT per
//     language through outreach-campaign-preview — never a send;
//   * /outreach/contacts?source=CURATED_LEAD filters server-side and badges the source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4397;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 300000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const LIST_ID = '6f1c2a54-1a2b-4c3d-8e9f-0123456789ab';
const audience = (total, eligible, byLanguage) => ({ total, withEmail: total, consented: eligible, eligible, byLanguage, bySource: { CURATED_LEAD: total } });

async function boot(t) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', 'en'); },
    ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  const state = { splitCalls: [], creates: [], contactQueries: [], sends: 0 };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? profile : [profile]));
    if (url.includes('/rest/v1/outreach_contact_lists')) {
      return r.fulfill(json([{ id: LIST_ID, name: 'HOMATCH Curated Leads', valid_rows: 0, total_rows: 5, total: 5, import_status: 'COMPLETED', source_kind: 'CURATED_LEAD' }]));
    }
    if (url.includes('/rpc/outreach_list_audience')) {
      return r.fulfill(json(audience(5, 2, { ka: { total: 2, eligible: 1 }, en: { total: 1, eligible: 1 }, unknown: { total: 2, eligible: 0 } })));
    }
    if (url.includes('/rpc/outreach_list_split_by_language')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.splitCalls.push(body);
      return r.fulfill(json([
        { language: 'en', listId: 'list-en', audience: audience(1, 1, { en: { total: 1, eligible: 1 } }) },
        { language: 'ka', listId: 'list-ka', audience: audience(4, 1, { ka: { total: 4, eligible: 1 } }) },
      ]));
    }
    if (url.includes('/rpc/email_studio_my_properties')) return r.fulfill(json([]));
    if (url.includes('/functions/v1/outreach-campaign-preview')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.creates.push(body);
      return r.fulfill(json({ campaign: { id: `camp-${state.creates.length}`, status: 'DRAFT' }, execution_blocked: true }));
    }
    if (url.includes('/functions/v1/outreach-send')) { state.sends += 1; return r.fulfill(json({ ok: false })); }
    if (url.includes('/rest/v1/outreach_contacts')) {
      state.contactQueries.push(decodeURIComponent(url));
      const rows = [
        { id: 'ct-1', list_id: LIST_ID, owner_id: 'u1', full_name: 'Nino', email: 'nino@example.test', phone: null, language: 'ka', country: 'GE', tags: [], consent_status: 'UNKNOWN', source_kind: 'CURATED_LEAD' },
        { id: 'ct-2', list_id: LIST_ID, owner_id: 'u1', full_name: 'Ann', email: 'ann@example.test', phone: null, language: 'en', country: 'GB', tags: [], consent_status: 'CONSENTED', source_kind: null },
      ];
      const pick = url.includes('source_kind=eq.CURATED_LEAD') ? rows.slice(0, 1) : rows;
      return r.fulfill({ ...json(pick), headers: { 'access-control-allow-origin': '*', 'content-range': `0-${pick.length - 1}/${pick.length}`, 'access-control-expose-headers': 'content-range' } });
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state };
}

test('?new=1&list= opens the dialog on the list; audience; one DRAFT per language with the chosen fallback', opts, async (t) => {
  const { page, state } = await boot(t);
  await page.goto(`${BASE}/outreach/email?new=1&list=${LIST_ID}`, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 30000 });
  /* consumed: the launch params leave the URL */
  await page.waitForFunction(() => !window.location.search.includes('new=1'));
  assert.match(await dialog.locator('[data-testid="email-list-create"]').textContent(), /HOMATCH Curated Leads/);

  const aud = dialog.locator('[data-testid="email-audience"]');
  await aud.waitFor();
  assert.equal((await aud.locator('[data-testid="aud-total"]').textContent()).trim(), '5');
  assert.equal((await aud.locator('[data-testid="aud-eligible"]').textContent()).trim(), '2');
  assert.match(await aud.textContent(), /3 contacts will not receive this campaign/);
  assert.equal(await aud.locator('[data-lang]').count(), 3, 'ka, en and unknown');

  await dialog.locator('input').first().fill('Vake offer');
  await dialog.locator('[data-testid="email-split"]').check();
  /* Unknown-language contacts present: nothing is created until the owner chooses. */
  assert.equal(await dialog.locator('[data-testid="email-create"]').isDisabled(), true);
  await dialog.locator('[data-testid="email-split-fallback"]').click();
  await page.getByRole('option', { name: 'KA', exact: true }).click();
  await dialog.locator('[data-testid="email-create"]').click();

  await page.locator('[data-testid="email-language-drafts"]').waitFor();
  assert.deepEqual(state.splitCalls, [{ p_list_id: LIST_ID, p_fallback_language: 'ka' }]);
  assert.deepEqual(state.creates.map((c) => [c.name, c.language, c.contact_list_id, c.campaign_type]), [
    ['Vake offer · EN', 'en', 'list-en', 'EMAIL'], ['Vake offer · KA', 'ka', 'list-ka', 'EMAIL'],
  ]);
  assert.equal(state.sends, 0, 'nothing is sent');
});

test('/outreach/contacts?source=CURATED_LEAD filters server-side and badges each row', opts, async (t) => {
  const { page, state } = await boot(t);
  await page.goto(`${BASE}/outreach/contacts?source=CURATED_LEAD`, { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  assert.ok(state.contactQueries.some((q) => q.includes('source_kind=eq.CURATED_LEAD')), 'source filter reaches the query');
  assert.equal(await page.locator('[data-source="CURATED_LEAD"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('table tbody').textContent(), /HOMATCH Curated Leads/);

  await page.locator('[data-source="UPLOADED"]').click();
  await page.waitForFunction(() => window.location.search.includes('source=UPLOADED'));
  for (let i = 0; i < 40 && !state.contactQueries.some((q) => q.includes('source_kind.in.(IMPORT,MANUAL)')); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(state.contactQueries.some((q) => q.includes('or=(source_kind.is.null,source_kind.in.(IMPORT,MANUAL))')), 'uploaded = IMPORT, MANUAL or none');
});
