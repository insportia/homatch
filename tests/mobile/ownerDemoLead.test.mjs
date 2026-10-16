// HOMATCH LEADS — DEMO MODE, the whole journey in a real browser.
//
// Harness build; the owner_demo_lead_* / demo_send_message RPCs are answered by an
// in-memory fake shaped exactly like 20261029090000_owner_demo_lead.sql (the behaviour
// itself is proven against Postgres by tests/sql/run-owner-demo-lead.sh):
//
//   * the entry appears only when owner_demo_lead_available says so;
//   * campaign → locked lead card → unlock dialog (labelled DEMO, 2.5 shown, 0 charged)
//     → fictional contact → CRM save, stage, note → conversation with simulated replies →
//     property offer → Email Studio draft and preview (send disabled) → notifications;
//   * the guided walkthrough opens on first visit; Reset and Exit work;
//   * NOTHING real is called: no atomic-unlock, no internal_leads_unlock_quote, no
//     send-message, no Email Studio send/test/generate/save, no CRM write;
//   * 390 and 1440 px in en / ka / he: no horizontal overflow, RTL flips.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Unique within the mobile:discovery shard (node --test runs its files in parallel). */
const PORT = 4368;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.OWNER_DEMO_SHOTS || null;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p) && !p.endsWith('/opt/pw-browsers/chromium')) ?? null;
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: true, role: 'admin', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const PROPERTY_ID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';
const CONV = '99999999-0000-4000-8000-000000000001';
const REPLIES = [
  'Hello, thank you for your message. Your apartment fits what I am looking for — is it still available?',
  'Could I come to see it this week? Weekday evenings suit me best.',
  'Thank you. Is the price open to discussion within the budget I shared?',
  'Understood, thank you. I will think it over and reply soon.',
];
const STAGES = ['UNLOCKED', 'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'VIEWING_SCHEDULED', 'CLOSED', 'NOT_INTERESTED'];

/** In-memory owner_demo_lead_* — the same rules as the migration. */
function demoServer(available) {
  const s = { unlocked_at: null, state: {}, events: [], messages: [], seq: 0, opened: false };
  const now = () => new Date().toISOString();
  const ev = (kind, detail = {}) => { s.events.push({ kind, detail, at: now(), simulated: true }); };
  const payload = () => ({
    is_demo: true, conversation_id: CONV,
    property: { id: PROPERTY_ID, homatch_id: 244486, title: '3-room apartment, Krtsanisi St 6' },
    facts: { city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 },
    profile: {
      id: 'p1', display_label: 'DEMO', display_name: s.unlocked_at ? 'Alex Morgan' : null, transaction_type: 'SALE',
      property_types: ['APARTMENT'], city: 'Tbilisi', districts: ['Krtsanisi', 'Ortachala'], budget_min: 140000, budget_max: 180000,
      currency: 'USD', bedrooms_min: 2, bedrooms_max: 2, timeline_months: 3, search_criteria: { parking: true },
      details: {
        simulated: true, match_score: 92, band: 'STRONG', segment: 'STANDARD', source: 'HOMATCH_DEMO', unlock_credits: 2.5, language: 'en',
        agreed: ['TRANSACTION', 'PROPERTY_TYPE', 'CITY', 'DISTRICT', 'BEDROOMS', 'PARKING'], conflicted: ['PRICE'], request_days_ago: 12,
        history: [{ kind: 'SEARCH_CREATED', days_ago: 12 }, { kind: 'BUDGET_UPDATED', days_ago: 5 }, { kind: 'ALERT_ENABLED', days_ago: 5 }, { kind: 'SEARCH_ACTIVE', days_ago: 1 }],
      },
    },
    contact: s.unlocked_at ? { email: 'alex.morgan.demo@example.com', phone: '+995 000 00 00 92', preferred_channel: 'MESSAGE', fictional: true } : null,
    unlocked_at: s.unlocked_at, state: s.state, events: s.events, messages: s.messages, opened_at: now(),
  });
  const send = (body) => {
    const owners = s.messages.filter((m) => m.sender === 'OWNER').length;
    const t = now();
    s.messages.push({ id: `m${++s.seq}`, seq: s.seq, sender: 'OWNER', body, is_simulated: false, language: 'en', sent_at: t, delivered_at: t, seen_at: t, created_at: t });
    const t2 = new Date(Date.now() + 3000).toISOString();
    s.messages.push({ id: `m${++s.seq}`, seq: s.seq, sender: 'DEMO_BUYER', body: REPLIES[owners % 4], is_simulated: true, language: 'en', sent_at: t2, delivered_at: t2, seen_at: t2, created_at: t2 });
  };
  return {
    s,
    available: () => available,
    open: () => { if (!s.opened) { s.opened = true; ev('MATCH_DISCOVERED', { score: 92 }); } return payload(); },
    send: (body) => { send(body); return { message: s.messages.at(-2), reply: s.messages.at(-1) }; },
    reset: () => {
      s.unlocked_at = null; s.messages = [];
      s.state = s.state.walkthrough_done_at ? { walkthrough_done_at: s.state.walkthrough_done_at } : {};
      s.events = []; ev('MATCH_DISCOVERED', { score: 92 });
      return payload();
    },
    act: (action, p = {}) => {
      switch (action) {
        case 'VIEW_DETAILS': s.state.details_viewed_at ??= now(); break;
        case 'UNLOCK': if (!s.unlocked_at) { s.unlocked_at = now(); ev('UNLOCKED', { credits: 2.5, charged_credits: 0 }); } break;
        case 'TOGGLE_SAVED': s.state.saved = !s.state.saved; break;
        case 'SAVE_CRM': if (!s.unlocked_at) return { error: 'DEMO_LOCKED' }; if (!s.state.crm_saved_at) { s.state.crm_saved_at = now(); s.state.crm_stage = 'UNLOCKED'; ev('CRM_SAVED'); } break;
        case 'SET_STAGE': if (!STAGES.includes(p.stage)) return { error: 'DEMO_INVALID_STAGE' }; ev('CRM_STAGE', { from: s.state.crm_stage, to: p.stage }); s.state.crm_stage = p.stage; break;
        case 'ADD_NOTE': (s.state.notes ??= []).push({ id: `n${s.state.notes.length}`, body: p.body, at: now() }); ev('CRM_NOTE'); break;
        case 'OPEN_CHAT': if (!s.state.chat_opened_at) { s.state.chat_opened_at = now(); ev('CHAT_OPENED'); } break;
        case 'ATTACH_OFFER': send(p.body); s.state.offer_attached_at = now(); s.state.chat_opened_at ??= now(); ev('OFFER_SENT'); break;
        case 'SAVE_EMAIL_DRAFT': s.state.email_draft = { subject: p.subject, template_id: p.template_id, language: p.lang, saved_at: now() }; ev('EMAIL_DRAFT'); break;
        case 'NOTIFICATIONS_READ': s.state.notifications_read_at = new Date(Date.now() + 10000).toISOString(); break;
        case 'WALKTHROUGH_DONE': s.state.walkthrough_done_at = now(); break;
        default: return { error: 'DEMO_INVALID_ACTION' };
      }
      return payload();
    },
  };
}

async function boot(t, { width = 1440, height = 900, lang = 'en', available = true } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const demo = demoServer(available);
  const calls = [];
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const rpcError = (code) => json({ code: 'P0001', message: code, details: null, hint: null }, 400);
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    calls.push({ url, body: req.postData() ?? '' });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? profile : [profile]));
    if (url.includes('/rest/v1/properties')) {
      const p = { id: PROPERTY_ID, title: '3-room apartment, Krtsanisi St 6', homatch_id: 244486 };
      return r.fulfill(json(wantsObject ? p : [p]));
    }
    const body = JSON.parse(req.postData() || '{}');
    if (url.includes('/rpc/owner_demo_lead_available')) return r.fulfill(json(demo.available()));
    if (url.includes('/rpc/owner_demo_lead_open')) return r.fulfill(demo.available() ? json(demo.open()) : rpcError('DEMO_NOT_ALLOWED'));
    if (url.includes('/rpc/owner_demo_lead_act')) {
      const out = demo.act(body.p_action, body.p_payload);
      return r.fulfill(out.error ? rpcError(out.error) : json(out));
    }
    if (url.includes('/rpc/owner_demo_lead_reset')) return r.fulfill(json(demo.reset()));
    if (url.includes('/rpc/demo_send_message')) return r.fulfill(json(demo.send(body.p_body)));
    if (url.includes('/functions/v1/outreach-send') && body.action === 'studio_render') {
      return r.fulfill(json({
        ok: true, html: '<p>x</p>', text: 'x', subject: 'x', droppedImages: 0, templates: {},
        property: {
          title: '3-room apartment, Krtsanisi St 6', homatchId: 244486, transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi',
          district: 'Krtsanisi', address: null, price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, bathrooms: 1, floor: 5,
          totalFloors: 12, images: [], segment: 'STANDARD',
        },
      }));
    }
    if (url.includes('/rpc/internal_leads_feed')) {
      return r.fulfill(json({ total: 0, prices: { STANDARD: 2.5, PREMIUM: 6, active: true }, lastSeenAt: null, items: [],
        counts: { ALL: 0, STRONG: 0, POTENTIAL: 0, STANDARD: 0, PREMIUM: 0, FRESH: 0, UNLOCKED: 0, CONTACTED: 0, SAVED: 0 } }));
    }
    if (url.includes('/rpc/internal_leads_mark_seen') || url.includes('/rpc/internal_leads_request_matching')) return r.fulfill(json(true));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, demo, calls };
}

async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${label}: horizontal overflow ${sw} > ${iw}`);
}
async function shot(page, name, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}
function assertNothingReal(calls) {
  for (const c of calls) {
    assert.ok(!c.url.includes('/functions/v1/atomic-unlock'), 'no real unlock');
    assert.ok(!c.url.includes('/rpc/internal_leads_unlock_quote'), 'no real quote');
    assert.ok(!c.url.includes('/functions/v1/send-message'), 'no real message');
    assert.ok(!/\/rpc\/(crm_|lead_crm_|email_studio_save|open_native_conversation|internal_lead_open)/.test(c.url), `no real CRM / conversation write: ${c.url}`);
    if (c.url.includes('/functions/v1/outreach-send')) assert.match(c.body, /"action":"studio_render"/, 'Email Studio is only asked to render');
  }
}

test('no entry for someone the server does not allow, and ?demo=1 shows nothing simulated', opts, async (t) => {
  const { page } = await boot(t, { available: false });
  await page.goto(`${BASE}/property/${PROPERTY_ID}/leads?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Your Matching Buyers').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-testid="demo-entry"]').count(), 0);
  assert.equal(await page.locator('[data-testid="owner-demo"]').count(), 0);
});

test('1440 (en): the whole Demo Mode journey, simulated end to end', opts, async (t) => {
  const { page, demo, calls } = await boot(t);
  await page.goto(`${BASE}/property/${PROPERTY_ID}/leads`, { waitUntil: 'domcontentloaded' });
  const entry = page.locator('[data-testid="demo-entry"]');
  await entry.waitFor({ timeout: 30000 });
  assert.match(await entry.textContent(), /Try the full Leads journey with a test lead/);
  await shot(page, 'demo-entry-en-1440', false);
  await page.locator('[data-testid="demo-start"]').click();

  /* Guided walkthrough opens on the first visit. */
  const guide = page.locator('[data-testid="demo-guide"]');
  await guide.waitFor({ timeout: 15000 });
  assert.match(await guide.textContent(), /Step 1 of 11/);
  await page.locator('[data-testid="demo-guide-next"]').click();
  assert.match(await page.locator('[data-testid="demo-guide-title"]').textContent(), /Read the lead card/);
  await shot(page, 'demo-guide-en-1440', false);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/rpc/owner_demo_lead_act')),
    page.locator('[data-testid="demo-guide-close"]').click(),
  ]);
  assert.ok(demo.s.state.walkthrough_done_at, 'closing the guide is remembered on the server');
  await page.locator('[data-testid="demo-mode-indicator"]').waitFor();

  /* 1–2: campaign, locked lead card, nothing identifying. */
  const main = await page.textContent('main');
  for (const copy of ['You are in Demo Mode', 'A potentially interested person was discovered', 'HOMATCH Demo', '0 credits (demo)', '92% match — simulated',
    'Unlock Contact · 2.5 Credits', 'Why this is a match', 'Parking', 'Buyer request (example)', 'Buyer activity (simulated)']) {
    assert.ok(main.includes(copy), `missing: ${copy}`);
  }
  assert.doesNotMatch(await page.content(), /Alex Morgan|example\.com|\+995 000/, 'no identity before the unlock');
  await page.getByRole('button', { name: 'View Match Details' }).click();
  await page.waitForFunction(() => document.querySelector('#demo-lead [data-testid="lead-card"]') != null);
  await page.locator('[data-testid="demo-why"]').waitFor();

  /* 3: the real UnlockDialog, labelled DEMO, 2.5 shown, nothing charged. */
  await page.locator('[data-testid="lead-unlock"]').click();
  const dialog = page.locator('[data-testid="unlock-dialog"]');
  await dialog.waitFor();
  await page.waitForFunction(() => /2\.5/.test(document.querySelector('[data-testid="unlock-dialog"]')?.textContent ?? ''));
  assert.equal(await dialog.locator('[data-testid="unlock-demo-badge"]').count(), 1);
  assert.match(await dialog.textContent(), /0 will be charged/);
  await shot(page, 'demo-unlock-en-1440', false);
  await dialog.locator('[data-testid="unlock-confirm"]').click();
  await page.locator('[data-testid="demo-contact-revealed"]').waitFor({ timeout: 15000 });

  /* 4: fictional contact. */
  const contact = await page.locator('[data-testid="demo-contact-revealed"]').textContent();
  assert.match(contact, /Alex Morgan/);
  assert.match(contact, /alex\.morgan\.demo@example\.com/);
  assert.match(contact, /Fictional contact/);

  /* 5–6: CRM save, stage, note. */
  await page.locator('[data-testid="demo-crm-save"]').click();
  await page.locator('[data-testid="demo-crm-stage"]').selectOption('INTERESTED');
  await page.waitForFunction(() => document.querySelector('[data-testid="demo-crm-stage"]')?.value === 'INTERESTED');
  await page.locator('[data-testid="demo-note-input"]').fill('Wants a viewing on Thursday');
  await page.locator('[data-testid="demo-note-add"]').click();
  await page.locator('[data-testid="demo-crm-notes"]').getByText('Wants a viewing on Thursday').waitFor();

  /* 7–8: conversation with simulated replies. */
  await page.locator('[data-testid="demo-chat-open"]').click();
  await page.locator('[data-testid="demo-chat-sample"]').first().click();
  await page.locator('[data-testid="demo-chat-send"]').click();
  await page.locator('[data-testid="demo-msg-reply"]').first().waitFor({ timeout: 15000 });
  assert.match(await page.locator('[data-testid="demo-msg-reply"]').first().textContent(), /Simulated reply/);

  /* 9: property offer. */
  await page.locator('[data-testid="demo-offer-attach"]').click();
  const offer = page.locator('[data-testid="demo-offer-preview"]');
  assert.match(await offer.textContent(), /HOMATCH 244486/);
  await page.locator('[data-testid="demo-offer-send"]').click();
  await page.locator('[data-testid="demo-offer-sent"]').waitFor();
  assert.equal(await page.locator('[data-testid="demo-msg-owner"]').count(), 2, 'message + offer in the thread');

  /* 10: Email Studio draft + preview; send stays disabled. */
  await page.locator('[data-testid="demo-email-generate"]').click();
  await page.locator('[data-testid="demo-email-preview"] iframe').waitFor({ timeout: 15000 });
  const doc = await page.locator('[data-testid="demo-email-preview"] iframe').getAttribute('srcdoc');
  assert.match(doc, /244486/, 'the preview is rendered from the real listing');
  assert.match(doc, /Following Up on Your Property Search/, 'the Personal Follow-Up template');
  assert.equal(await page.locator('[data-testid="demo-email-send"]').isDisabled(), true);
  await page.locator('[data-testid="demo-email-save"]').click();
  await page.locator('[data-testid="demo-email-saved"]').waitFor();
  assert.equal(demo.s.state.email_draft.template_id, 'PERSONAL_FOLLOW_UP');

  /* 11: notifications and activity. */
  const act = await page.locator('[data-testid="demo-activity-list"]').textContent();
  for (const line of ['Find Buyers discovered a potentially interested person', 'Contact opened — 2.5 credits simulated, 0 charged', 'Lead saved to CRM',
    'Note added', 'Property offer sent', 'Email draft saved', 'The demo buyer replied']) {
    assert.ok(act.includes(line), `activity: ${line}`);
  }
  await page.locator('[data-testid="demo-mark-read"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="demo-unread"]'));
  await page.locator('[data-testid="demo-activity-done"]').waitFor();
  await noOverflow(page, 'en 1440 complete');
  await shot(page, 'demo-complete-en-1440');

  /* Reset, then Exit. */
  await page.locator('[data-testid="demo-reset"]').click();
  await page.locator('[data-testid="demo-reset-confirm"]').click();
  await page.locator('[data-testid="lead-unlock"]').waitFor({ timeout: 15000 });
  assert.equal(demo.s.messages.length, 0);
  assert.equal(await page.locator('[data-testid="demo-contact-revealed"]').count(), 0);
  await page.locator('[data-testid="demo-exit"]').click();
  await page.locator('[data-testid="demo-entry"]').waitFor();
  assert.equal(await page.locator('[data-testid="owner-demo"]').count(), 0);
  assert.ok(!page.url().includes('demo=1'));

  assertNothingReal(calls);
});

for (const lang of ['en', 'ka', 'he']) {
  test(`${lang}: Demo Mode at 390 and 1440 — no horizontal overflow${lang === 'he' ? ', RTL' : ''}, guide above the navigation`, opts, async (t) => {
    const { page, calls } = await boot(t, { width: 390, height: 844, lang });
    await page.goto(`${BASE}/property/${PROPERTY_ID}/leads?demo=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="owner-demo"]').waitFor({ timeout: 30000 });
    await page.locator('[data-testid="demo-guide"]').waitFor();
    await noOverflow(page, `${lang} 390 guide`);
    if (lang === 'he') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await shot(page, `demo-guide-${lang}-390`, false);
    await page.locator('[data-testid="demo-guide-close"]').click();
    await page.locator('[data-testid="lead-unlock"]').click();
    await page.locator('[data-testid="unlock-confirm"]').click();
    await page.locator('[data-testid="demo-contact-revealed"]').waitFor({ timeout: 15000 });
    await noOverflow(page, `${lang} 390 unlocked`);
    const unlock = await page.locator('[data-testid="demo-crm-save"]').boundingBox();
    assert.ok(unlock && unlock.height >= 44, 'touch target ≥ 44px');
    await shot(page, `demo-unlocked-${lang}-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await noOverflow(page, `${lang} 1440`);
    assertNothingReal(calls);
  });
}
