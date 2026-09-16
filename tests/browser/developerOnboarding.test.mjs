// THE FIRST DEVELOPER, ARRIVING THE WAY A STRANGER ARRIVES.
//
// developerAcceptance.test.mjs drives a workspace that already has twelve
// apartments in it. That is the second day. This is the first: an account and
// nothing else — no workspace, no membership, no project, no inventory, no
// buyers — which is exactly the state production is in.
//
// Two things can only be seen from here. One is whether the public Developer
// page has any route into the Developer product at all; until this test was
// written it did not, and /developers/start was unreachable from anywhere a
// visitor could click. The other is the first-run experience: with a seeded
// workspace, every empty state in the product is unreachable, so "0 0 0 0
// with no explanation" is invisible to every other gate.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT
//
// It proves the interface, the same as its sibling: the control exists, it is
// reachable, it sends what it should, and what comes back survives a reload.
// It does NOT prove the database. dev_create_workspace is re-implemented in
// devBackend.mjs; the real one is SECURITY DEFINER and takes the user from the
// verified token rather than from anything the client sends, and that half is
// proven against production, not here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeBackend } from './devBackend.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = 4186;
const BASE = `http://127.0.0.1:${PORT}`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  return require('playwright-core');
}

function haveDeps() {
  try { resolvePlaywright(); } catch { return 'playwright-core is not installed'; }
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    return 'dist/ is missing — run the build first';
  }
  if (!findChrome()) return 'Google Chrome not found';
  return null;
}

const skipReason = haveDeps();

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp,
    email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const verdicts = [];
const record = (name, ok, why) => {
  verdicts.push({ name, ok, why: why ?? null });
  return ok;
};

/** Every element whose box leaves the viewport — the phone check's whole point. */
const OVERFLOW_PROBE = () => {
  const over = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
      over.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 40)}`);
    }
  }
  return {
    scrollW: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    over: over.slice(0, 4),
  };
};

const opts = { timeout: 600000 };

test('a developer with no workspace can get one, from the public page', opts, async (t) => {
  if (skipReason) assert.fail(`developer onboarding gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const backend = makeBackend({ empty: true });

  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });

  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const thrown = [];
  const json = (b, status = 200, extra = {}) => ({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-range',
      ...extra,
    },
    body: JSON.stringify(b),
  });

  /* The same PostgREST-shaped routing the sibling gate uses. Written out here
     rather than shared, because a change made for one journey must not be able
     to quietly alter the other's evidence. */
  const wire = async (page) => {
    page.on('pageerror', (e) => thrown.push(String(e).slice(0, 300)));
    page.on('console', (m) => {
      const txt = m.text();
      const noise = /favicon|Failed to load resource|realtime\/v1\/websocket|ERR_NAME_NOT_RESOLVED|WebSocket connection/i
        .test(txt);
      if (m.type() === 'error' && !noise) thrown.push(`console: ${txt.slice(0, 200)}`);
    });

    await page.route('**', async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith(BASE)) return route.continue();

      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
            'access-control-expose-headers': 'content-range',
          },
        });
      }

      if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
      if (url.includes('/storage/v1/')) {
        return route.fulfill(json({ Key: 'stub/path', path: 'stub/path' }));
      }
      if (url.includes('/functions/v1/')) return route.fulfill(json({ state: 'EXTRACTED' }));

      const rpc = url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
      if (rpc) {
        let args = {};
        try { args = JSON.parse(req.postData() || '{}'); } catch { /* no body */ }
        const handler = backend.RPC[rpc[1]];
        if (!handler) return route.fulfill(json(null));
        const out = handler(args);
        if (out && out.__error) {
          return route.fulfill(json({ message: out.__error, code: 'P0001' }, 400));
        }
        return route.fulfill(json(out ?? null));
      }

      const rest = url.match(/\/rest\/v1\/([a-z0-9_]+)/i);
      if (!rest) return route.fulfill(json({}));
      const table = rest[1];
      const params = new URL(url).searchParams;
      const wantsOne = (req.headers().accept || '').includes('vnd.pgrst.object');

      if (req.method() === 'GET' || req.method() === 'HEAD') {
        let rows = backend.select(table, params);
        const total = rows.length;
        const limit = Number(params.get('limit') ?? 0);
        const offset = Number(params.get('offset') ?? 0);
        if (limit) rows = rows.slice(offset, offset + limit);
        rows = backend.withEmbeds(rows, params.get('select'));
        const to = Math.max(offset + rows.length - 1, offset);
        if (wantsOne) {
          return rows.length
            ? route.fulfill(json(rows[0]))
            : route.fulfill(json({ message: 'no rows', code: 'PGRST116' }, 406));
        }
        return route.fulfill(json(rows, 200, { 'content-range': `${offset}-${to}/${total}` }));
      }

      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        const items = Array.isArray(body) ? body : [body];
        const made = items.map((item) => {
          const row = {
            id: backend.uuid(), created_at: backend.now(), updated_at: backend.now(), ...item,
          };
          backend.db[table] = backend.db[table] ?? [];
          backend.db[table].push(row);
          return row;
        });
        return route.fulfill(wantsOne ? json(made[0], 201) : json(made, 201));
      }

      if (req.method() === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        const rows = backend.select(table, params);
        for (const row of rows) Object.assign(row, patch, { updated_at: backend.now() });
        return route.fulfill(wantsOne ? json(rows[0] ?? null) : json(rows));
      }

      return route.fulfill(json([]));
    });
  };

  const bodyText = (page) => page.evaluate(() => document.body.innerText);

  // PART ONE: SIGNED OUT, on the page a stranger lands on.
  const anon = await browser.newContext({ viewport: DESKTOP });
  await anon.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const out = await anon.newPage();
  await wire(out);

  await out.goto(`${BASE}/developers`, { waitUntil: 'domcontentloaded' });
  await out.waitForTimeout(2500);
  const publicText = await bodyText(out);
  record('DEVELOPERS_PUBLIC_PAGE', publicText.length > 400 && /developer/i.test(publicText),
    `${publicText.length} chars rendered`);

  const startBtn = out.locator('button', { hasText: /set up your workspace/i }).first();
  const haveStart = await startBtn.count();
  record('DEVELOPER_PRIMARY_CTA_EXISTS', haveStart > 0,
    haveStart > 0
      ? 'the hero offers a button that starts onboarding'
      : 'no onboarding CTA on /developers');

  if (haveStart) {
    await startBtn.click();
    await out.waitForTimeout(2000);
    const landed = new URL(out.url()).pathname;
    const remembered = await out.evaluate(() => {
      try { return window.sessionStorage.getItem('homatch_return_to'); } catch { return null; }
    });
    record('AUTH_FLOW_SIGNED_OUT',
      landed === '/auth/signup' && remembered === '/developers/start',
      `signed out the CTA goes to ${landed}, remembering ${remembered ?? 'nothing'}`);
  } else {
    record('AUTH_FLOW_SIGNED_OUT', false, 'no CTA to click');
  }
  await anon.close();

  // PART TWO: SIGNED IN, no workspace at all.
  const ctx = await browser.newContext({ viewport: DESKTOP });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  await wire(page);

  await page.goto(`${BASE}/developers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const inBtn = page.locator('button', { hasText: /set up your workspace/i }).first();
  if (await inBtn.count()) {
    await inBtn.click();
    await page.waitForTimeout(2000);
  }
  record('DEVELOPER_PRIMARY_CTA', new URL(page.url()).pathname === '/developers/start',
    `signed in the CTA lands on ${new URL(page.url()).pathname}`);

  // Any developer route, with no membership, must arrive at onboarding too.
  await page.goto(`${BASE}/developers/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  record('WORKSPACE_MEMBERSHIP_GATE', new URL(page.url()).pathname === '/developers/start',
    `an account with no membership on /developers/home ends at ${new URL(page.url()).pathname}`);

  // The form itself.
  const startText = await bodyText(page);
  const fields = await page.evaluate(() => ({
    name: Boolean(document.querySelector('#dev-ws-name')),
    country: Boolean(document.querySelector('#dev-ws-country')),
    city: Boolean(document.querySelector('#dev-ws-city')),
    currency: Boolean(document.querySelector('#dev-ws-currency')),
    inputs: document.querySelectorAll('input, textarea').length,
  }));
  record('FIRST_WORKSPACE_UI',
    fields.name && fields.country && fields.city && fields.currency,
    `company, country, city and currency present; ${fields.inputs} text inputs on the screen`);
  record('FIRST_WORKSPACE_IS_SHORT', fields.inputs <= 5,
    `${fields.inputs} inputs — a form, not a wizard`);
  record('FIRST_WORKSPACE_EXPLAINED',
    /workspace/i.test(startText) && startText.length > 80,
    'the screen says what it is asking for and why');

  await page.fill('#dev-ws-name', 'Riverside Development');
  await page.fill('#dev-ws-country', 'Georgia');
  await page.fill('#dev-ws-city', 'Batumi');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);

  const created = backend.db.dev_workspaces.find((w) => w.name === 'Riverside Development');
  const member = created && backend.db.dev_members.find(
    (m) => m.workspace_id === created.id && m.user_id === 'u1');
  record('WORKSPACE_CREATION', Boolean(created),
    created
      ? `created "${created.name}" (${created.city}, ${created.default_currency})`
      : 'no workspace was written');
  record('DEVELOPER_ROLE',
    Boolean(member) && member.role === 'OWNER' && member.status === 'ACTIVE',
    member
      ? `the creator is ${member.role}/${member.status} of their own workspace`
      : 'no membership row');
  record('WORKSPACE_AUDITED', backend.db.dev_audit_log.some(
    (r) => r.entity_type === 'workspace' && r.action === 'CREATED'),
    'workspace creation leaves an audit row');

  const afterCreate = new URL(page.url()).pathname;
  record('ONBOARDING_LANDS_INSIDE',
    afterCreate.startsWith('/developers/') && afterCreate !== '/developers/start',
    `after creating, the browser is on ${afterCreate}`);

  // The empty workspace, which is all production has.
  await page.goto(`${BASE}/developers/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const homeText = await bodyText(page);
  const homeControls = await page.evaluate(() => Array.from(
    document.querySelectorAll('button, a'), (el) => el.innerText.trim()).filter(Boolean));
  record('EMPTY_DEVELOPER_HOME', /no apartments yet/i.test(homeText),
    /no apartments yet/i.test(homeText)
      ? 'the empty workspace explains itself instead of printing zeroes'
      : `first-run Home reads: "${homeText.replace(/\s+/g, ' ').slice(0, 160)}"`);
  const hasNextAction = homeControls.some((b) => /add project|new project|import/i.test(b));
  record('EMPTY_HOME_NEXT_ACTION', hasNextAction,
    hasNextAction ? 'there is a next action on the empty Home' : 'nothing to click on an empty Home');

  // The first project.
  const addProject = page.locator('button', { hasText: /add project/i }).first();
  record('CREATE_PROJECT_UI', await addProject.count() > 0,
    'the empty state offers to create a project');
  if (await addProject.count()) {
    await addProject.click();
    await page.waitForTimeout(2500);
  }
  const dialogOpen = await page.locator('[role="dialog"]').count();
  record('CREATE_PROJECT_DIALOG', dialogOpen > 0,
    dialogOpen > 0 ? 'the create-project form opens' : 'the CTA opened nothing');

  if (dialogOpen) {
    await page.locator('[role="dialog"] input').first().fill('Riverside Block One');
    await page.locator('[role="dialog"] button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
  }
  const project = backend.db.dev_projects.find((p) => p.name === 'Riverside Block One');
  record('PROJECT_PERSISTENCE', Boolean(project),
    project ? `"${project.name}" was saved` : 'no project row');
  record('PROJECT_TENANT_SCOPED',
    Boolean(project) && Boolean(created) && project.workspace_id === created.id,
    'the project belongs to the workspace just created and to no other');

  // Buildings, floors and apartments.
  if (project) {
    await page.goto(`${BASE}/developers/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
  }
  const projectText = project ? await bodyText(page) : '';
  const importBtn = page.locator('button', { hasText: /import/i }).first();
  const haveImport = project ? await importBtn.count() : 0;
  record('UNIT_SETUP_UI',
    haveImport > 0 && /no apartments in this project/i.test(projectText),
    haveImport > 0
      ? 'an empty project explains itself and offers the inventory import'
      : 'an empty project offers no way to add apartments');

  if (haveImport) {
    /* Driven with a real file, because the wizard's first screen is a file
       picker and everything worth checking is behind it: whether a developer's
       own column headings are understood, and whether the building and the
       floor in their spreadsheet become a building and a floor here. Three
       apartments, two floors, one block — the smallest sheet that can show
       all three levels being created. */
    await importBtn.click();
    await page.waitForTimeout(2000);
    await page.setInputFiles('input[type="file"]', {
      name: 'riverside.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([
        'Unit,Building,Floor,Bedrooms,Area,Price',
        'R-101,Block A,1,2,64.5,118000',
        'R-102,Block A,1,3,88,164000',
        'R-201,Block A,2,2,64.5,121000',
        '',
      ].join('\n')),
    });
    await page.waitForTimeout(2500);
    const mapText = await bodyText(page);

    await page.locator('[role="dialog"] button', { hasText: /^Preview$/ }).first().click();
    await page.waitForTimeout(2000);
    await page.locator('[role="dialog"] button', { hasText: /^Import$/ }).first().click();
    await page.waitForTimeout(3500);

    const buildings = backend.db.dev_buildings.filter((b) => b.project_id === project.id);
    const floors = backend.db.dev_floors.filter((f) => f.project_id === project.id);
    const units = backend.db.dev_units.filter((u) => u.project_id === project.id);

    record('BUILDING_SETUP_UI', buildings.length === 1 && buildings[0].name === 'Block A',
      buildings.length
        ? `the sheet's building column created "${buildings[0].name}"`
        : 'no building was created from the import');
    record('FLOOR_SETUP_UI', floors.length === 2,
      `${floors.length} floors created from the sheet's floor column`);
    record('UNIT_IMPORT', units.length === 3,
      units.length === 3
        ? `three apartments imported (${units.map((u) => u.unit_number).join(', ')})`
        : `${units.length} apartments imported`);
    record('IMPORT_UNDERSTOOD_HEADERS', /unit|building|floor/i.test(mapText),
      'the mapping step names the columns it recognised before anything was written');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const afterImport = await bodyText(page);
    record('UNIT_SETUP_PERSISTENCE', /R-101/.test(afterImport),
      /R-101/.test(afterImport)
        ? 'the imported apartments are on the project page after a reload'
        : 'the imported apartments are not shown after a reload');
  } else {
    for (const id of ['BUILDING_SETUP_UI', 'FLOOR_SETUP_UI', 'UNIT_IMPORT',
      'IMPORT_UNDERSTOOD_HEADERS', 'UNIT_SETUP_PERSISTENCE']) {
      record(id, false, 'no import to open');
    }
  }

  // The first buyer, and whether it survives a reload.
  await page.goto(`${BASE}/developers/contacts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const addLead = page.locator('button', { hasText: /add (contact|buyer|lead)/i }).first();
  record('FIRST_CONTACT_UI', await addLead.count() > 0, 'the empty CRM offers to add a buyer');
  if (await addLead.count()) {
    await addLead.click();
    await page.waitForTimeout(2500);
    const boxes = page.locator('[role="dialog"] input');
    const n = await boxes.count();
    await boxes.nth(0).fill('Nino Beridze');
    if (n > 1) await boxes.nth(1).fill('+995 555 010 203');
    if (n > 2) await boxes.nth(2).fill('nino@example.test');
    await page.locator('[role="dialog"] button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const crmText = await bodyText(page);
  record('CRM_PERSISTENCE', /Nino Beridze/.test(crmText),
    /Nino Beridze/.test(crmText)
      ? 'the buyer typed into the form is still listed after a reload'
      : 'the buyer did not survive the reload');

  // Nothing this session wrote may name another workspace.
  const foreign = Boolean(created) && (
    backend.db.dev_projects.some((p) => p.workspace_id !== created.id)
    || backend.db.dev_leads.some((l) => l.workspace_id !== created.id));
  record('TENANT_ISOLATION_CLIENT', !foreign,
    'everything this session wrote carries the workspace it created and no other');

  await ctx.close();

  // PART THREE: THE SAME FORM ON A PHONE.
  const phoneCtx = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await phoneCtx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);
  const phone = await phoneCtx.newPage();
  await wire(phone);

  for (const [id, url] of [
    ['PHONE_DEVELOPERS', '/developers'],
    ['PHONE_START', '/developers/start'],
    ['PHONE_HOME', '/developers/home'],
    ['PHONE_PROJECTS', '/developers/projects?new=1'],
  ]) {
    await phone.goto(BASE + url, { waitUntil: 'domcontentloaded' });
    await phone.waitForTimeout(3000);
    const m = await phone.evaluate(OVERFLOW_PROBE);
    record(id, m.scrollW <= m.inner + 1 && m.over.length === 0,
      `scrollWidth ${m.scrollW} vs ${m.inner}${m.over.length ? ` · ${m.over.join(', ')}` : ''}`);
  }

  /* A submit button the on-screen keyboard covers is the classic mobile
     failure: the form is fillable and cannot be sent. Checked with the field
     filled, by asking whether the control is inside the viewport at all. */
  await phone.goto(`${BASE}/developers/start`, { waitUntil: 'domcontentloaded' });
  await phone.waitForTimeout(3000);
  await phone.locator('#dev-ws-name').fill('Phone Developments');
  const submitBox = await phone.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      h: window.innerHeight, height: Math.round(r.height),
    };
  });
  record('MOBILE_ONBOARDING_SUBMIT',
    Boolean(submitBox) && submitBox.bottom <= submitBox.h && submitBox.height >= 40,
    submitBox
      ? `submit sits at ${submitBox.top}-${submitBox.bottom} of ${submitBox.h}, ${submitBox.height}px tall`
      : 'no submit control found');

  await phone.locator('button[type="submit"]').first().click();
  await phone.waitForTimeout(3500);
  record('MOBILE_ONBOARDING',
    backend.db.dev_workspaces.some((w) => w.name === 'Phone Developments'),
    'a workspace can be created from a 390px screen');

  await phoneCtx.close();

  record('NO_CRITICAL_RUNTIME_ERRORS', thrown.length === 0,
    thrown.length ? thrown.slice(0, 3).join(' | ') : 'no page errors across the journey');

  // Report.
  const failed = verdicts.filter((v) => !v.ok);
  const lines = verdicts.map(
    (v) => `${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.why ? ` — ${v.why}` : ''}`);
  console.log(`\n${lines.join('\n')}\n${verdicts.length - failed.length}/${verdicts.length} verdicts passed`);
  assert.equal(failed.length, 0,
    `first-run journey failed:\n${failed.map((f) => `  ${f.name}: ${f.why}`).join('\n')}`);
});
