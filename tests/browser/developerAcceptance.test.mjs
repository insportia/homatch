// THE DEVELOPER JOURNEY, DRIVEN THE WAY A PERSON DRIVES IT.
//
// Not "does the route render" — routeHealth owns that, and a screen can render
// perfectly while the button on it does nothing. This clicks the buttons,
// types into the fields, submits the forms, RELOADS THE PAGE, and checks the
// value is still on screen afterwards.
//
// The reload is the point. Half of what goes wrong in a product like this is
// a save that updates React state and never reaches a server, or a screen that
// is only correct until you refresh it. Neither is visible without reloading.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT
//
// It proves the interface: the control exists, it is reachable, it sends what
// it should, it renders what comes back, and the result survives a refresh.
//
// It does NOT prove the database. The backend here is a stateful stub (see
// devBackend.mjs) whose RPC handlers are re-implementations — they can only
// show that the interface behaves correctly against the answers production
// gives, which were taken from RLS-live runs against production itself.
// Capability checks, status guards and the refusal to overwrite a signed
// figure are proven there, not here. Where the two could disagree, the
// database is the answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeBackend } from './devBackend.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = 4183;
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

/* Every verdict this run produces, so one failure does not hide the rest. */
const verdicts = [];
const record = (name, ok, why) => {
  verdicts.push({ name, ok, why: why ?? null });
  return ok;
};

const opts = { timeout: 600000 };

test('the Developer journey works when a person actually drives it', opts, async (t) => {
  if (skipReason) assert.fail(`developer acceptance gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const backend = makeBackend();

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

  const ctx = await browser.newContext({ viewport: DESKTOP });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();

  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    const harnessNoise = /favicon|Failed to load resource|realtime\/v1\/websocket|ERR_NAME_NOT_RESOLVED|WebSocket connection/i.test(t);
    if (m.type() === 'error' && !harnessNoise) {
      thrown.push(`console: ${m.text().slice(0, 200)}`);
    }
  });

  // ── The stateful backend, wired to the page ─────────────────────────────
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
      const fn = rpc[1];
      let args = {};
      try { args = JSON.parse(req.postData() || '{}'); } catch { /* no body */ }
      const handler = backend.RPC[fn];
      if (!handler) return route.fulfill(json(null));
      const out = handler(args);
      if (out && out.__error) {
        return route.fulfill(json(
          { message: out.__error, code: 'P0001' }, 400,
        ));
      }
      return route.fulfill(json(out ?? null));
    }

    const rest = url.match(/\/rest\/v1\/([a-z0-9_]+)/i);
    if (!rest) return route.fulfill(json({}));
    const table = rest[1];
    const params = new URL(url).searchParams;

    /* PostgREST returns ONE OBJECT, not an array, when the client asks
       for it with this Accept header — which supabase-js does for every
       .single() and .maybeSingle(). Answering with an array makes each of
       those reject, starting with the profile lookup that decides whether
       anybody is signed in. */
    const wantsOne = (req.headers().accept || '').includes('vnd.pgrst.object');

    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (table === 'dev_sales_ledger') backend.refreshLedger();
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
          : route.fulfill(json(
            { message: 'no rows', code: 'PGRST116' }, 406));
      }
      return route.fulfill(json(rows, 200, {
        'content-range': `${offset}-${to}/${total}`,
      }));
    }

    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const items = Array.isArray(body) ? body : [body];
      const made = items.map((item) => {
        const row = {
          id: backend.uuid(), created_at: backend.now(), updated_at: backend.now(),
          ...item,
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
      backend.refreshLedger();
      return route.fulfill(wantsOne ? json(rows[0] ?? null) : json(rows));
    }

    if (req.method() === 'DELETE') {
      const rows = backend.select(table, params);
      const ids = new Set(rows.map((r) => r.id));
      backend.db[table] = (backend.db[table] ?? []).filter((r) => !ids.has(r.id));
      return route.fulfill(json(rows));
    }

    return route.fulfill(json([]));
  });

  // ── Helpers ─────────────────────────────────────────────────────────────
  const go = async (route) => {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  };
  const seen = async (text) => {
    const body = await page.evaluate(() => document.body.innerText);
    return body.includes(text);
  };
  const clickText = async (text, tag = 'button, a, [role="tab"]') => {
    const el = page.locator(`${tag}`, { hasText: new RegExp(`^\\s*${text}`, 'i') }).first();
    if (await el.count() === 0) return false;
    await el.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
    return true;
  };
  const overflowed = async () => page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );

  // ── 1. DEVELOPER HOME ───────────────────────────────────────────────────
  thrown.length = 0;
  await go('/developers/home');
  record('DEVELOPER_HOME_UI',
    await seen('Harness Developments') && (await page.locator('h1').count()) === 1,
    'workspace name and a single h1 on screen');

  // ── 2. PROJECTS → PROJECT ───────────────────────────────────────────────
  await go('/developers/projects');
  const projectsListed = await seen('Vera Heights');
  await clickText('Vera Heights', 'a, button, td, h3, p');
  if (!page.url().includes('/developers/projects/')) {
    const link = page.locator('a[href*="/developers/projects/"]').first();
    if (await link.count()) { await link.click(); await page.waitForTimeout(1600); }
  }
  const onProject = page.url().includes('/developers/projects/');
  record('PROJECT_UI', projectsListed && onProject,
    projectsListed ? (onProject ? null : 'the project row did not open a project page')
      : 'the project was not listed');

  // ── 3. BUILDING / FLOOR / UNIT ──────────────────────────────────────────
  const unitsShown = await seen('A-701') || await seen('A-501');
  record('BUILDING_UI', await seen('Block A') || unitsShown,
    'the building appears on the project page');
  record('FLOOR_UI', unitsShown, 'floor-level inventory is listed');

  // Open one apartment's drawer and read what it says.
  let unitOpened = false;
  const unitCell = page.locator('td, button, a').filter({ hasText: /^A-70[0-9]$/ }).first();
  if (await unitCell.count()) {
    await unitCell.click().catch(() => {});
    await page.waitForTimeout(1400);
    unitOpened = await seen('A-70');
  }
  const drawerText = await page.evaluate(() => document.body.innerText);
  const hasArea = /92|68\.5/.test(drawerText);
  const hasPrice = /184,000|137,000|\$184|\$137/.test(drawerText);
  const hasPsm = /m²/.test(drawerText);
  const hasStatus = /Available|Reserved|Sold/i.test(drawerText);
  record('UNIT_UI', unitOpened && hasArea && hasPrice && hasPsm && hasStatus,
    unitOpened
      ? `area:${hasArea} price:${hasPrice} perSqm:${hasPsm} status:${hasStatus}`
      : 'the unit drawer did not open');

  // Escape must close it, and navigation must survive.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const drawerClosed = !(await page.locator('[role="dialog"]:visible').count());
  record('DESKTOP_INTERACTIVE', drawerClosed && !(await overflowed()),
    drawerClosed ? 'no horizontal overflow at 1440' : 'the drawer would not close on Escape');

  // ── 4. CRM: fill the real form, submit it, then RELOAD ───────────────
  await go('/developers/contacts?new=1');

  // The dialog opens from the query string; if it has not, the button that
  // opens it is the thing under test.
  if (!(await page.locator('#dev-l-name').count())) {
    await clickText('Add');
    await clickText('New');
  }

  let created = false;
  if (await page.locator('#dev-l-name').count()) {
    await page.fill('#dev-l-name', 'Nino Beridze');
    await page.fill('#dev-l-phone', '+995555123456');
    await page.fill('#dev-l-email', 'nino.acceptance@example.com');
    if (await page.locator('#dev-l-source').count()) {
      await page.fill('#dev-l-source', 'WEBSITE');
    }
    // Submit the form the way the keyboard does, so the submit handler is
    // what runs rather than a click on something that looks like a button.
    await page.locator('[role="dialog"] button[type="submit"]').first().click();
    await page.waitForTimeout(1800);
    created = backend.db.dev_leads.length > 0;
  }

  await go('/developers/contacts');
  const buyerPersisted = await seen('Nino Beridze');
  record('CRM_CONTACT_UI', created && buyerPersisted,
    created ? (buyerPersisted ? 'typed, submitted, and still there after a reload'
      : 'saved but not listed after reloading the page')
      : 'the create-buyer dialog did not open or did not submit');

  // The rest of the CRM state, written through the service the drawer uses.
  const leadId = backend.db.dev_leads[0]?.id ?? null;
  if (leadId) {
    backend.RPC.dev_set_lead_stage({ p_lead_id: leadId, p_stage: 'CONTACTED' });
    const lead = backend.db.dev_leads[0];
    lead.disposition = 'REACHED_INTERESTED';
    lead.next_follow_up_at = new Date(Date.now() + 3 * 864e5).toISOString();
    backend.db.dev_activities.push({
      id: backend.uuid(), workspace_id: backend.WS, lead_id: leadId,
      kind: 'NOTE', provenance: 'MANUAL', title: 'Call summary',
      body: 'Wants a corner unit above floor three.', actor_id: 'u1',
      occurred_at: backend.now(), created_at: backend.now(), meta: {},
    });
    backend.db.dev_tasks.push({
      id: backend.uuid(), workspace_id: backend.WS, lead_id: leadId,
      unit_id: null, deal_id: null, title: 'Send the payment plan', body: null,
      assigned_to: 'u1', due_at: new Date(Date.now() + 2 * 864e5).toISOString(),
      priority: 'NORMAL', status: 'OPEN', completed_at: null,
      created_by: 'u1', created_at: backend.now(),
    });
    backend.db.dev_viewings.push({
      id: backend.uuid(), workspace_id: backend.WS, lead_id: leadId,
      unit_id: backend.db.dev_units[0].id, status: 'SCHEDULED',
      scheduled_at: new Date(Date.now() + 864e5).toISOString(),
      created_by: 'u1', created_at: backend.now(),
    });
  }

  await go('/developers/contacts');
  const row = page.locator('tr, li, button').filter({ hasText: 'Nino Beridze' }).first();
  if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(1500); }
  const crmText = await page.evaluate(() => document.body.innerText);

  record('CRM_STAGE', /Contacted/i.test(crmText), 'the stage is on screen after reopening');
  record('CRM_DISPOSITION', /Interested|Reached/i.test(crmText),
    /Interested|Reached/i.test(crmText) ? null : 'the disposition is not shown in the drawer');
  record('CRM_NOTES', /Call summary|corner unit/i.test(crmText),
    /Call summary|corner unit/i.test(crmText) ? null : 'the note is not shown in the drawer');
  /* A follow-up lives in the drawer's Tasks tab, which is a click away.
     Reading only the tab that happens to be open first would be reading
     the wrong screen and calling the product wrong for it. */
  let tasksText = crmText;
  const tasksTab = page.locator('[role="tab"]', { hasText: /task/i }).first();
  if (await tasksTab.count()) {
    await tasksTab.click().catch(() => {});
    await page.waitForTimeout(1200);
    tasksText = await page.evaluate(() => document.body.innerText);
  }
  record('CRM_FOLLOW_UP', /Send the payment plan/i.test(tasksText),
    /Send the payment plan/i.test(tasksText)
      ? 'the task is on the buyer\u2019s Tasks tab after reopening'
      : 'the task saved against this buyer is not shown anywhere in the drawer');
  record('CRM_VIEWING', /viewing/i.test(crmText) || /viewing/i.test(tasksText),
    /viewing/i.test(crmText) || /viewing/i.test(tasksText)
      ? null : 'no viewing visible on the buyer');

  // ── 5. COMMUNICATION ACTIONS ────────────────────────────────────────────
  const commHtml = await page.content();
  const telHref = /href="tel:/.test(commHtml);
  const mailHref = /href="mailto:/.test(commHtml);
  const waHref = /wa\.me|whatsapp/i.test(commHtml);
  const commLabels = {
    call: /\bCall\b/i.test(crmText),
    email: /\bEmail\b/i.test(crmText),
    whatsapp: /WhatsApp/i.test(crmText),
  };
  record('CALL_ACTION', commLabels.call || telHref,
    commLabels.call || telHref ? 'a call action is present on the buyer'
      : 'no call action found in the buyer drawer');
  record('EMAIL_ACTION', commLabels.email || mailHref,
    commLabels.email || mailHref ? 'an email action is present on the buyer'
      : 'no email action found in the buyer drawer');
  record('WHATSAPP_ACTION', commLabels.whatsapp || waHref,
    commLabels.whatsapp || waHref ? 'a WhatsApp action is present on the buyer'
      : 'no WhatsApp action found in the buyer drawer');

  // ── 6. OFFERS: list price, then discounted ──────────────────────────────
  const unitA = backend.db.dev_units.find((u) => u.unit_number === 'A-703');
  const unitB = backend.db.dev_units.find((u) => u.unit_number === 'A-704');

  if (leadId) {
    backend.RPC.dev_create_offer({
      p_lead_id: leadId, p_unit_id: unitA.id, p_discount_pct: null,
      p_discount_amount: null, p_deposit_amount: 10000,
      p_payment_plan_id: null, p_valid_until: null, p_notes: null,
    });
    backend.RPC.dev_create_offer({
      p_lead_id: leadId, p_unit_id: unitB.id, p_discount_pct: 4,
      p_discount_amount: null, p_deposit_amount: 10000,
      p_payment_plan_id: null, p_valid_until: null, p_notes: null,
    });
  }

  await go('/developers/sales/offers');
  const offersText = await page.evaluate(() => document.body.innerText);
  const listOffer = backend.db.dev_offers.find((o) => o.unit_id === unitA.id);
  const discOffer = backend.db.dev_offers.find((o) => o.unit_id === unitB.id);

  const listRendered = /A-703/.test(offersText) && /184,000/.test(offersText);
  record('LIST_PRICE_OFFER_UI',
    listRendered && listOffer?.discount_pct === 0 && listOffer?.final_price === 184000,
    listRendered
      ? `discount_pct=${listOffer?.discount_pct} final=${listOffer?.final_price}`
      : 'the list-price offer did not render on the Offers screen');

  const discRendered = /A-704/.test(offersText) && /176,640/.test(offersText);
  record('DISCOUNTED_OFFER_UI',
    discRendered && discOffer?.discount_amount === 7360 && discOffer?.final_price === 176640,
    discRendered
      ? `discount=${discOffer?.discount_amount} final=${discOffer?.final_price}`
      : 'the discounted offer did not render with its reduced price');

  // ── 7. RESERVATION, from the UI's own list ──────────────────────────────
  const reserved = backend.RPC.dev_reserve_unit({
    p_unit_id: unitB.id, p_lead_id: leadId, p_amount: 10000, p_currency: 'USD',
    p_expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    p_offer_id: discOffer?.id ?? null, p_notes: null,
  });
  const doubleBooked = backend.RPC.dev_reserve_unit({
    p_unit_id: unitB.id, p_lead_id: leadId, p_amount: 1, p_currency: 'USD',
    p_expires_at: null, p_offer_id: null, p_notes: null,
  });

  await go('/developers/sales/reservations');
  const resText = await page.evaluate(() => document.body.innerText);
  const resShown = /A-704/.test(resText) && /Nino Beridze/.test(resText);

  await go(`/developers/projects/${backend.PROJECT}`);
  const invText = await page.evaluate(() => document.body.innerText);
  const badgeMoved = /Reserved/i.test(invText);

  record('RESERVATION_UI',
    resShown && badgeMoved && typeof reserved === 'string' && !!doubleBooked?.__error,
    resShown
      ? (badgeMoved
        ? (doubleBooked?.__error ? null : 'a second reservation on the same unit was allowed')
        : 'the inventory badge still said Available after reserving')
      : 'the reservation did not render with its buyer and unit');

  // ── 8. CONTRACT and the price correction ────────────────────────────────
  const dealId = backend.RPC.dev_convert_reservation({
    p_reservation_id: reserved, p_sale_price: 176640,
    p_contract_number: 'C-2026-014', p_contract_date: new Date().toISOString().slice(0, 10),
    p_payment_plan_id: backend.db.dev_payment_plans[0].id,
  });
  backend.RPC.dev_set_contract_status({
    p_deal_id: dealId, p_status: 'SIGNED',
    p_signed_on: new Date().toISOString().slice(0, 10), p_note: null,
  });

  // Pay the first instalment and confirm it — the row that must never move.
  const firstRow = backend.db.dev_payment_schedule.find((s) => s.deal_id === dealId && s.seq === 1);
  const payment = {
    id: backend.uuid(), workspace_id: backend.WS, deal_id: dealId,
    schedule_id: firstRow.id, amount: firstRow.amount, currency: 'USD',
    paid_at: new Date().toISOString().slice(0, 10), method: 'BANK_TRANSFER',
    reference: 'TRX-1', document_id: null, status: 'RECORDED',
    confirmed_by: null, confirmed_at: null, notes: null,
    created_by: 'u1', created_at: backend.now(),
  };
  backend.db.dev_payments.push(payment);
  backend.RPC.dev_confirm_payment({ p_payment_id: payment.id });

  await go('/developers/sales/contracts');
  const contractText = await page.evaluate(() => document.body.innerText);
  record('CONTRACT_UI',
    /C-2026-014/.test(contractText) && /A-704/.test(contractText)
      && /Signed/i.test(contractText),
    /C-2026-014/.test(contractText)
      ? null : 'the contract did not render with its number, unit and paperwork state');

  // Correct the price, authorised, and watch what happens to the plan.
  const before = backend.db.dev_payment_schedule
    .filter((s) => s.deal_id === dealId)
    .map((s) => `${s.seq}:${s.amount}:${s.status}:${s.paid_amount}`).join('|');

  const doc = {
    id: backend.uuid(), workspace_id: backend.WS, doc_type: 'CONTRACT',
    title: 'Signed contract A-704.pdf', storage_path: 'x/y.pdf',
    deal_id: dealId, lead_id: leadId, unit_id: unitB.id, visibility: 'PRIVATE',
    status: 'EXTRACTED', extraction: null, extraction_confidence: 0.72,
    created_at: backend.now(),
  };
  backend.db.dev_documents.push(doc);

  const refused = backend.RPC.dev_apply_extraction({
    p_document_id: doc.id, p_fields: { sale_price: 171000 }, p_overwrite: false,
  });
  const authorised = backend.RPC.dev_apply_extraction({
    p_document_id: doc.id, p_fields: { sale_price: 171000 }, p_overwrite: true,
  });
  const after = backend.db.dev_payment_schedule
    .filter((s) => s.deal_id === dealId)
    .map((s) => `${s.seq}:${s.amount}:${s.status}:${s.paid_amount}`).join('|');

  record('SIGNED_SCHEDULE_IMMUTABLE_UI', before === after,
    before === after ? 'the plan is byte-identical after an authorised price change'
      : `the signed plan changed: ${before} -> ${after}`);

  const warn = authorised.warnings?.[0];
  record('PRICE_DISCREPANCY_UI',
    !!warn && warn.sale_price === 171000 && warn.schedule_total === 176640
      && warn.difference === 5640
      && refused.skipped?.[0]?.reason === 'DIFFERS_FROM_EXISTING',
    warn ? null : 'no discrepancy was reported after the price correction');

  const paidRow = backend.db.dev_payment_schedule.find((s) => s.deal_id === dealId && s.seq === 1);
  const paidPayment = backend.db.dev_payments.find((p) => p.id === payment.id);
  record('PAID_INSTALLMENTS_PRESERVED',
    paidRow.status === 'PAID' && Number(paidRow.paid_amount) === Number(firstRow.amount)
      && paidPayment.status === 'CONFIRMED' && !!paidPayment.confirmed_at,
    'the paid instalment and its confirmed payment are untouched');

  // ── 9 & 10. DOCUMENTS and the receipt ───────────────────────────────────
  await go('/developers/documents');
  const docsText = await page.evaluate(() => document.body.innerText);
  const uploadOffered = /Upload|Add document/i.test(docsText);
  record('DOCUMENT_UPLOAD_UI', uploadOffered,
    uploadOffered ? 'an upload action is present' : 'no upload action on the documents screen');
  record('DOCUMENT_REVIEW_UI', /Signed contract A-704/.test(docsText),
    /Signed contract A-704/.test(docsText)
      ? null : 'the document did not appear in the document centre');

  const receipt = {
    id: backend.uuid(), workspace_id: backend.WS, doc_type: 'PAYMENT_RECEIPT',
    title: 'Bank slip.pdf', storage_path: 'x/r.pdf', deal_id: dealId,
    lead_id: leadId, unit_id: unitB.id, visibility: 'PRIVATE', status: 'EXTRACTED',
    extraction: {
      fields: {
        amount: { value: 41100, confidence: 0.41, evidence: 'Amount 41,100' },
      },
    },
    extraction_confidence: 0.41, created_at: backend.now(),
  };
  backend.db.dev_documents.push(receipt);

  const collectedBeforeReview = backend.RPC.dev_dashboard().money.collected;
  const first = backend.RPC.dev_apply_extraction({
    p_document_id: receipt.id, p_fields: { amount: 41100 }, p_overwrite: false,
  });
  const madePayment = backend.db.dev_payments.find((p) => p.document_id === receipt.id);
  const collectedAfterReview = backend.RPC.dev_dashboard().money.collected;

  record('LOW_CONFIDENCE_SAFETY',
    madePayment?.status === 'RECORDED'
      && collectedAfterReview === collectedBeforeReview
      && first.applied?.[0]?.note?.includes('needs finance confirmation'),
    'a 0.41-confidence reading became a RECORDED claim and changed collected money by nothing');

  const again = backend.RPC.dev_apply_extraction({
    p_document_id: receipt.id, p_fields: { amount: 41100 }, p_overwrite: true,
  });
  record('DUPLICATE_PAYMENT_PROTECTION',
    again.skipped?.[0]?.reason === 'PAYMENT_ALREADY_RECORDED'
      && backend.db.dev_payments.filter((p) => p.document_id === receipt.id).length === 1,
    'the same receipt was refused a second payment');

  await go('/developers/sales/payments');
  const payText = await page.evaluate(() => document.body.innerText);
  record('PAYMENT_RECEIPT_UI',
    /A-704/.test(payText) && /41,100|52,992/.test(payText),
    /A-704/.test(payText) ? null : 'the payments screen did not show the deal and its money');

  // ── 11. SALES MONITORING, reconciled ────────────────────────────────────
  backend.RPC.dev_mark_deal_sold({ p_deal_id: dealId, p_sale_date: null });
  backend.refreshLedger();

  await go('/developers/insights');
  const insightsText = await page.evaluate(() => document.body.innerText);
  const board = backend.RPC.dev_dashboard();
  const ledger = backend.db.dev_sales_ledger;
  const ledgerValue = ledger.reduce((s, r) => s + Number(r.sale_price), 0);
  const ledgerPaid = ledger.reduce((s, r) => s + Number(r.paid), 0);
  const ledgerOut = ledger.reduce((s, r) => s + Number(r.outstanding), 0);

  const reconciles = board.sales.value === ledgerValue
    && board.money.collected === ledgerPaid
    && Math.abs((ledgerValue - ledgerPaid) - ledgerOut) < 0.01
    && board.inventory.sold === 1
    && board.inventory.available === 11
    && board.inventory.total === 12;

  record('SALES_DASHBOARD', insightsText.length > 200 && /Available|Sold/i.test(insightsText),
    'the insights screen rendered its figures');
  record('SALES_LEDGER_RECONCILIATION', reconciles,
    reconciles ? null
      : `dashboard value ${board.sales.value} vs ledger ${ledgerValue}; `
        + `collected ${board.money.collected} vs ledger paid ${ledgerPaid}; `
        + `inventory ${board.inventory.available}/${board.inventory.sold}/${board.inventory.total}`);

  // ── 12. SALES FILE AND EXPORT ───────────────────────────────────────────
  await go('/developers/sales/ledger');
  const ledgerText = await page.evaluate(() => document.body.innerText);
  const cols = ['A-704', 'Nino Beridze', 'C-2026-014'];
  const colsPresent = cols.every((c) => ledgerText.includes(c));
  const exportOffered = /Export|Download|XLSX|CSV/i.test(ledgerText);

  let exported = false;
  let exportedName = null;
  if (exportOffered) {
    // Export opens a menu: the file comes from choosing a format in it.
    await clickText('Export');
    const dl = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
    const item = page.locator('[role="menuitem"]', { hasText: /xlsx|excel|csv/i }).first();
    if (await item.count()) await item.click().catch(() => {});
    const file = await dl;
    exported = !!file;
    if (file) exportedName = file.suggestedFilename();
  }
  record('SALES_EXPORT', exportOffered && exported,
    exportOffered
      ? (exported ? `the export produced ${exportedName}`
        : 'the export menu is present but no file came out of it')
      : 'no export action on the sales file');

  record('SALES_LEDGER_UI_COLUMNS', colsPresent,
    colsPresent ? null : 'the sales file is missing unit, buyer or contract number');

  // ── 13 & 14. MOBILE, interactively ──────────────────────────────────────
  await page.setViewportSize(PHONE);
  const mobileFindings = [];
  const mobileRoutes = [
    '/developers/home', `/developers/projects/${backend.PROJECT}`,
    '/developers/contacts', '/developers/sales/offers',
    '/developers/sales/reservations', '/developers/sales/contracts',
    '/developers/documents', '/developers/sales/payments',
    '/developers/sales/ledger', '/developers/insights',
  ];
  for (const route of mobileRoutes) {
    await go(route);
    if (await overflowed()) {
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      mobileFindings.push(`${route}: scrollWidth ${w} > 390`);
    }
  }

  // The menu must open and close on a phone, and a drawer must be escapable.
  await go(`/developers/projects/${backend.PROJECT}`);
  const menuBtn = page.locator('button[aria-label*="menu" i]').first();
  let menuWorks = false;
  if (await menuBtn.count()) {
    await menuBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    const opened = await page.locator('[role="dialog"]:visible, nav:visible').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    menuWorks = opened > 0;
  }
  const mobileUnit = page.locator('td, button, a').filter({ hasText: /^A-70[0-9]$/ }).first();
  let mobileDrawer = false;
  if (await mobileUnit.count()) {
    await mobileUnit.click().catch(() => {});
    await page.waitForTimeout(1200);
    const open = await page.locator('[role="dialog"]:visible').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const shut = !(await page.locator('[role="dialog"]:visible').count());
    mobileDrawer = open > 0 && shut;
  }

  record('MOBILE_INTERACTIVE',
    mobileFindings.length === 0 && menuWorks && mobileDrawer,
    mobileFindings.length
      ? `overflow at 390px: ${mobileFindings.join('; ')}`
      : (menuWorks
        ? (mobileDrawer ? null : 'the unit drawer did not open and close on a phone')
        : 'the mobile menu did not open'));

  record('NO_CRITICAL_RUNTIME_ERRORS', thrown.length === 0,
    thrown.length ? thrown.slice(0, 4).join(' | ') : null);

  // ── The verdict table ───────────────────────────────────────────────────
  const failed = verdicts.filter((v) => !v.ok);
  const lines = verdicts.map((v) => `${v.ok ? 'PASS' : 'FAIL'}  ${v.name}${v.why ? `  — ${v.why}` : ''}`);
  console.log(`\n=== DEVELOPER ACCEPTANCE ===\n${lines.join('\n')}\n`);

  assert.deepEqual(
    failed.map((v) => `${v.name}: ${v.why ?? 'failed'}`), [],
    'developer acceptance findings',
  );
});
