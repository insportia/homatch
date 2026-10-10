// HOMATCH INTERNAL MATCHES — in a real browser.
//
// Harness build, the Matches page of HOMATCH 244486 answered by fixtures shaped like
// production: one real HOMATCH member (a requirements MATCH and an interest
// RELATIONSHIP for the SAME person), three external Find Buyers leads, and — for an
// administrator only — the DEMO buyer with a stateful simulated conversation.
//
//   * two sections, two counts, never summed; one person is one card;
//   * the demo card is badged Internal Match / Strong / DEMO and its score is the one
//     the matching engine computes for these facts (imported here and compared);
//   * card → profile (drawer / full-screen sheet) → Message privately → simulated reply
//     → back to profile → history kept; desktop 1440, phone 390, Hebrew (RTL);
//   * no horizontal scroll at 390 and 360;
//   * the demo flow never calls the real messaging stack (send-message, messages,
//     conversations, notifications);
//   * a member who is neither admin nor tester sees no demo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { scoreDemoMatch } from '../../src/matching/internalMatch.ts';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Unique within the mobile:discovery shard — node --test runs its files in
   parallel, and 4361 belongs to findPropertyMarketplace. */
const PORT = 4366;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.INTERNAL_MATCHES_SHOTS || null;

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
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const PROPERTY_ID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';
const FACTS = { city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 };
const property = {
  id: PROPERTY_ID, user_id: 'u1', homatch_id: 244486, title: '3-room apartment, Krtsanisi St 6', transaction_type: 'SALE', property_type: 'APARTMENT',
  listed_by_role: 'OWNER', is_deleted: false, created_at: new Date().toISOString(), photos: [], facts: [FACTS],
};
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

/* The seeded demo buyer, as demo_internal_match_for_property returns it. */
const DEMO_PROFILE = {
  id: 'dddddddd-0000-0000-0000-000000000001', demo_key: 'internal-match-demo-244486', property_id: PROPERTY_ID, is_demo: true, display_label: 'DEMO',
  intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', districts: ['Krtsanisi', 'Ortachala'], property_types: ['APARTMENT'],
  budget_min: 190000, budget_max: 235000, currency: 'USD', bedrooms_min: 2, bedrooms_max: 2, rooms_min: null, rooms_max: null,
  area_min: 85, area_max: 115, timeline_months: 3, search_criteria: {}, created_at: ago(1),
};
const DEMO_PROPERTY = { id: PROPERTY_ID, homatch_id: 244486, transaction_type: 'SALE', property_type: 'APARTMENT', listed_by_role: 'OWNER' };
const EXPECTED = scoreDemoMatch({ profile: DEMO_PROFILE, property: DEMO_PROPERTY, facts: FACTS });

/* One real member, twice: a requirements MATCH and an interest RELATIONSHIP. */
const nativeRow = (over) => ({
  kind: 'MATCH', id: 'm-1', role: 'OWNER', property_id: PROPERTY_ID, homatch_id: 244486, property_title: property.title,
  counterparty_name: 'Nino', match_score: 0.86, agreed: ['TRANSACTION', 'CITY', 'PRICE', 'BEDROOMS'], preference_misses: ['DISTRICT'],
  deal_kind: 'SALE', state: 'MATCHED', viewing_requested: false, has_conversation: false, updated_at: ago(1),
  city: 'Tbilisi', district: 'Krtsanisi', property_type: 'APARTMENT', transaction_type: 'SALE', price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2,
  ...over,
});
const NATIVE = [nativeRow({}), nativeRow({ kind: 'RELATIONSHIP', id: 'r-1', match_score: null, agreed: [], preference_misses: [], state: 'INTERESTED' })];
const COUNTERPARTS = [{ kind: 'MATCH', id: 'm-1', counterpart_key: 'k-nino' }, { kind: 'RELATIONSHIP', id: 'r-1', counterpart_key: 'k-nino' }];

const LEAD_TEXT = 'Ищу 2-комнатную квартиру в Крцаниси до 230 000$.';
const lead = (id, over = {}) => ({
  id, matching_job_id: 'job1', counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 88, strength: 'STRONG',
  similarity: 86, intent_score: 90, signal_count: 1, signal_at: ago(2), seen_before: false, language: 'ru', created_at: ago(1),
  author_name: 'Дмитрий К.', author_profile_url: 'https://www.facebook.com/profile.php?id=1',
  score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['price'], parentAgeDays: null } },
  evidence: [{ signalId: `s-${id}`, parentSignalId: null, kind: 'POST', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 90, similarity: 86, ageDays: 2,
    text: LEAD_TEXT, url: 'https://www.facebook.com/groups/x/posts/1/', parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(2) }],
  ...over,
});
const LEADS = [lead('l1'), lead('l2', { overall_score: 72, strength: 'GOOD' }), lead('l3', { overall_score: 66, strength: 'GOOD' })];

const REPLIES = {
  en: ['Hello, thank you for your message. Your apartment fits what I am looking for — is it still available?', 'Could I come to see it this week? Weekday evenings suit me best.'],
  he: ['שלום, תודה על ההודעה. הדירה שלך מתאימה למה שאני מחפש — היא עדיין זמינה?', 'אפשר לבוא לראות אותה השבוע? ערבים באמצע השבוע הכי נוחים לי.'],
};

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = true } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  if (process.env.IM_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const state = { conversation: null, messages: [], unlockedAt: null, seq: 0 };
  const realMessaging = [];
  const demoCalls = [];
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    const who = admin ? { ...profile, is_admin: true, role: 'admin' } : profile;
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? who : [who]));
    /* The real messaging stack: recorded, so the demo can be proven never to reach it. */
    if (/\/functions\/v1\/(send-message|push-send)|\/rest\/v1\/(messages|conversations|message_receipts|notifications)\b|\/rpc\/(ensure_conversation|open_native_conversation)/.test(url)
      && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) realMessaging.push(`${req.method()} ${url}`);
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(wantsObject ? property : [property]));
    if (url.includes('/rest/v1/find_buyers_current_leads')) {
      return r.fulfill({ ...json(LEADS), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `0-${LEADS.length - 1}/${LEADS.length}` } });
    }
    if (url.includes('/rest/v1/matches')) {
      return r.fulfill({ ...json([]), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/0' } });
    }
    if (url.includes('/rpc/my_native_matches')) return r.fulfill(json(NATIVE));
    if (url.includes('/rpc/my_native_match_counterparts')) return r.fulfill(json(COUNTERPARTS));
    if (url.includes('/rpc/demo_')) {
      const body = JSON.parse(req.postData() ?? '{}');
      demoCalls.push(url.split('/rpc/')[1]);
      if (!admin) {
        if (url.includes('/rpc/demo_internal_match_for_property')) return r.fulfill(json(null));
        return r.fulfill(json({ code: '42501', message: 'DEMO_NOT_ALLOWED' }, 403));
      }
      if (url.includes('/rpc/demo_internal_match_for_property')) {
        return r.fulfill(json({ is_demo: true, profile: DEMO_PROFILE, property: DEMO_PROPERTY, facts: FACTS,
          conversation_id: state.conversation, demo_unlocked_at: state.unlockedAt }));
      }
      if (url.includes('/rpc/demo_open_conversation')) {
        state.conversation = state.conversation ?? 'cccccccc-0000-0000-0000-000000000001';
        return r.fulfill(json(state.conversation));
      }
      if (url.includes('/rpc/demo_list_messages')) {
        return r.fulfill(json({ conversation: { id: body.p_conversation_id, demo_buyer_id: DEMO_PROFILE.id, property_id: PROPERTY_ID, demo_unlocked_at: state.unlockedAt, is_demo: true }, messages: state.messages }));
      }
      if (url.includes('/rpc/demo_send_message')) {
        const now = Date.now();
        const sent = state.messages.filter((m) => m.sender === 'OWNER').length;
        const iso = (ms) => new Date(now + ms).toISOString();
        const mine = { id: `m${(state.seq += 1)}`, seq: state.seq, conversation_id: body.p_conversation_id, sender: 'OWNER', body: body.p_body, is_simulated: false, language: body.p_lang,
          sent_at: iso(0), delivered_at: iso(1000), seen_at: iso(2000), created_at: iso(0) };
        const replies = REPLIES[body.p_lang] ?? REPLIES.en;
        const reply = { id: `m${(state.seq += 1)}`, seq: state.seq, conversation_id: body.p_conversation_id, sender: 'DEMO_BUYER', body: replies[sent % replies.length], is_simulated: true, language: body.p_lang,
          sent_at: iso(3000), delivered_at: iso(3000), seen_at: iso(3000), created_at: iso(3000) };
        state.messages.push(mine, reply);
        return r.fulfill(json({ message: mine, reply }));
      }
      if (url.includes('/rpc/demo_unlock_contact')) {
        state.unlockedAt = new Date().toISOString();
        return r.fulfill(json({ demo_unlocked_at: state.unlockedAt, simulated: true, charged_credits: 0, phone: null }));
      }
    }
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json({ readiness: { ready: true, reason: null, sources: ['FACEBOOK'] }, campaign: null }));
    if (url.includes('/rpc/background_jobs_mine')) return r.fulfill(json([]));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 10, creditsPerUsd: 10, minCredits: 100 }));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state, realMessaging, demoCalls };
}

async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${label}: horizontal overflow ${sw} > ${iw}`);
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

const sectionCount = (page, which) => page.locator(`[data-count="${which}"]`).innerText();

async function openMatches(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-section="internal-matches"]').waitFor({ timeout: 30000 });
  await page.locator('[data-testid="internal-match-card"]').first().waitFor({ timeout: 30000 });
}

/* card → profile → message → simulated reply → back to profile → history. */
async function flow(page, state, { lang, prefix, width }) {
  await openMatches(page);
  const demoCard = page.locator('[data-testid="internal-match-card-demo"]');
  await demoCard.waitFor({ timeout: 30000 });

  /* Two sections, two counts. One real member (two rows) + the demo = 2; three leads. */
  await page.waitForFunction(() => document.querySelector('[data-count="external"]')?.textContent?.trim() === '3', null, { timeout: 30000 });
  assert.equal((await sectionCount(page, 'internal')).trim(), '2', 'internal = one member + the demo, the member counted once');
  assert.equal((await sectionCount(page, 'external')).trim(), '3', 'external = the three leads, nothing internal added');
  assert.equal(await page.locator('[data-testid="internal-match-card"]').count(), 1, 'a MATCH and a RELATIONSHIP for one person are one card');

  /* Badges and the engine's score. */
  for (const badge of ['INTERNAL', 'STRONG', 'DEMO']) {
    assert.equal(await demoCard.locator(`[data-badge="${badge}"]`).count(), 1, `demo card carries ${badge}`);
  }
  assert.equal(EXPECTED.band, 'STRONG');
  const cardText = await demoCard.innerText();
  assert.ok(cardText.includes(String(EXPECTED.percent)), `card shows the engine's ${EXPECTED.percent}: ${cardText.slice(0, 200)}`);
  if (width <= 400) await demoCard.scrollIntoViewIfNeeded();
  await noOverflow(page, `${prefix} matches`);
  await shot(page, `${prefix}-card`);

  /* Profile. */
  await demoCard.locator('[data-testid="demo-view-profile"]').click();
  const sheet = page.locator('[data-testid="buyer-profile"]');
  await sheet.waitFor({ timeout: 10000 });
  assert.equal(await sheet.locator('[data-field="rooms"][data-state="NOT_PROVIDED"]').count(), 1, 'unstated rooms say so');
  assert.equal(await sheet.locator('[data-field="budget"][data-state="CONFIRMED"]').count(), 1);
  assert.equal(await sheet.locator('[data-field="timeline"][data-state="CONFIRMED"]').count(), 1);
  assert.equal(await sheet.locator('[data-dimension="PRICE"][data-verdict="AGREE"]').count(), 1, 'factor list from the engine');
  assert.ok((await sheet.locator('[data-testid="profile-score"]').innerText()).includes(String(EXPECTED.percent)));
  const box = await sheet.boundingBox();
  if (width <= 400) assert.ok(box.width >= width - 1, `phone: full-screen sheet (${box.width} of ${width})`);
  else assert.ok(box.width < width / 2, 'desktop: a drawer, not a page');
  await noOverflow(page, `${prefix} profile`);
  await shot(page, `${prefix}-profile`);

  /* Message privately → the demo conversation. */
  await sheet.locator('[data-testid="profile-message"]').click();
  await page.waitForURL(/\/matches\/demo\/cccccccc-/, { timeout: 15000 });
  await page.locator('[data-testid="demo-banner"]').waitFor({ timeout: 15000 });
  const first = lang === 'he' ? 'שלום, הדירה עדיין זמינה' : 'Hello, the apartment is still available.';
  await page.locator('[data-testid="demo-composer"]').fill(first);
  await page.locator('[data-testid="demo-send"]').click();
  await page.locator('[data-testid="demo-msg-reply"]').first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('[data-testid="demo-msg-owner"]').count(), 1);
  assert.equal(await page.locator('[data-testid="simulated-label"]').count(), 1, 'every simulated reply is labelled');
  assert.equal(await page.locator('[data-testid="demo-msg-owner"] [data-status="SEEN"]').count(), 1, 'delivery state reaches SEEN');
  assert.ok((await page.locator('[data-testid="demo-msg-reply"]').innerText()).includes(REPLIES[lang === 'he' ? 'he' : 'en'][0]));
  await noOverflow(page, `${prefix} conversation`);
  await shot(page, `${prefix}-conversation`);

  /* Back to the profile: the sheet reopens; then the history is still there. */
  await page.locator('[data-testid="back-to-profile"]').click();
  await page.waitForURL(/\/matches\?profile=demo/, { timeout: 15000 });
  await page.locator('[data-testid="buyer-profile"]').waitFor({ timeout: 15000 });
  await page.locator('[data-testid="profile-message"]').click();
  await page.waitForURL(/\/matches\/demo\//, { timeout: 15000 });
  await page.locator('[data-testid="demo-msg-reply"]').first().waitFor({ timeout: 10000 });
  assert.equal(await page.locator('[data-testid="demo-msg-owner"]').count(), 1, 'history kept');
  assert.equal(await page.locator('[data-testid="demo-msg-reply"]').count(), 1, 'history kept');
  assert.equal(state.messages.length, 2);
}

test('desktop 1440 (en): separate sections, demo card → profile → message → reply → back → history', opts, async (t) => {
  const { page, state, realMessaging, demoCalls } = await boot(t, { width: 1440, lang: 'en' });
  await flow(page, state, { lang: 'en', prefix: 'desktop', width: 1440 });
  const subtitle = await page.evaluate(() => document.body.innerText);
  assert.ok(demoCalls.includes('demo_send_message'));
  assert.deepEqual(realMessaging, [], `the demo never touched the real messaging stack: ${realMessaging.join(' ')}`);
  assert.ok(subtitle.length > 0);
});

test('phone 390 (en): full-screen profile sheet, the same flow, no horizontal scroll', opts, async (t) => {
  const { page, state, realMessaging } = await boot(t, { width: 390, height: 844, lang: 'en' });
  await flow(page, state, { lang: 'en', prefix: 'mobile', width: 390 });
  assert.deepEqual(realMessaging, []);
});

test('phone 390 (he, RTL): direction flips and the flow holds', opts, async (t) => {
  const { page, state, realMessaging } = await boot(t, { width: 390, height: 844, lang: 'he' });
  await flow(page, state, { lang: 'he', prefix: 'mobile-he', width: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.deepEqual(realMessaging, []);
});

test('phone 360: the matches page and the profile sheet never scroll sideways', opts, async (t) => {
  const { page } = await boot(t, { width: 360, height: 780, lang: 'ka' });
  await openMatches(page);
  await page.locator('[data-testid="internal-match-card-demo"]').waitFor({ timeout: 30000 });
  await noOverflow(page, '360 ka matches');
  await page.locator('[data-testid="demo-view-profile"]').click();
  await page.locator('[data-testid="buyer-profile"]').waitFor({ timeout: 10000 });
  await noOverflow(page, '360 ka profile');
});

test('a member who is neither admin nor tester sees no demo, and the counts say so', opts, async (t) => {
  const { page } = await boot(t, { width: 1440, lang: 'en', admin: false });
  await openMatches(page);
  await page.waitForFunction(() => document.querySelector('[data-count="external"]')?.textContent?.trim() === '3', null, { timeout: 30000 });
  assert.equal(await page.locator('[data-testid="internal-match-card-demo"]').count(), 0, 'no demo card');
  assert.equal((await sectionCount(page, 'internal')).trim(), '1', 'only the real member');
  assert.equal(await page.locator('[data-badge="DEMO"]').count(), 0, 'no DEMO badge anywhere');
});
