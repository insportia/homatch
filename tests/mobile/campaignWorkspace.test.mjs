// EXTERNAL MATCHING CAMPAIGNS, THE CONTACT LIBRARY AND EMAIL STUDIO — in a real browser.
//
// Harness build, answered by fixtures shaped like production rows
// (find_buyers_job_state, find_buyers_leads, my_contact_library,
// email_studio_documents). Checks:
//   * a campaign has its own page; a refresh lands on the same campaign;
//   * stages and progress come from the server's queue, never invented, and no
//     internal machinery (content read, stale skipped, pool sizes) is shown;
//   * completed / empty / failed runs route to the right state, and a finished
//     run opens its matches;
//   * the matches page names Internal and External Matching separately;
//   * Email Studio: AI only proposes, a send needs consent AND confirmation, and
//     only then calls the audience RPC, the campaign builder and outreach-send;
//   * 1440px and 390px in six locales: no horizontal overflow, RTL for ar/he,
//     no untranslated keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4363;
const BASE = `http://127.0.0.1:${PORT}`;
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    .find((p) => existsSync(p)) ?? null;
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
const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const JOB = '22222222-2222-2222-2222-222222222222';
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const property = {
  id: PROPERTY_ID, user_id: 'u1', title: '2-bedroom apartment in Krtsanisi', transaction_type: 'SALE', property_type: 'APARTMENT',
  contact_phone_e164: '+995555123456', is_deleted: false, created_at: ago(30), photos: [],
  facts: [{ city: 'Tbilisi', district: 'Krtsanisi', total_price: 120000, currency: 'USD', bedrooms: 2, rooms: 3, area: 75 }],
};
const PHOTO = 'https://cdn.example.test/p/cover.jpg';

const campaign = (state, over = {}) => ({
  jobId: JOB, campaignId: 'c1', propertyId: PROPERTY_ID, state, stage: null,
  active: ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'].includes(state),
  createdAt: ago(0.02), startedAt: ago(0.02), completedAt: null, pausedAt: null, lastActivityAt: ago(0.001), transaction: 'SALE',
  languages: ['ka', 'ru', 'en'],
  queue: { total: 9, queued: 3, running: 4, done: 2, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 4, succeeded: 2, failed: 0 },
  sources: [
    { source: 'FACEBOOK', state: 'RUNNING', total: 5, running: 3, queued: 1, done: 1, failed: 0, results: 2, checked: 412, communities: 0, qualified: 2 },
    { source: 'TELEGRAM', state: 'RUNNING', total: 4, running: 1, queued: 2, done: 1, failed: 0, results: 31, checked: 2, communities: 31, qualified: 1 },
  ],
  signalsAnalyzed: 414, signalsChecked: 414, communitiesFound: 31, staleSkipped: 57, duplicatesRemoved: 2,
  newResults: 3, newLeads: 3, newMatches: 0, strong: 1, executed: true, failureReason: null,
  ...over,
});
const readiness = { ready: true, reason: null, sources: ['FACEBOOK', 'TELEGRAM'], network: [{ family: 'FACEBOOK', state: 'AVAILABLE' }, { family: 'TELEGRAM', state: 'AVAILABLE' }] };

const lead = (id, over = {}) => ({
  id, matching_job_id: JOB, counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 90, strength: 'STRONG',
  similarity: 90, intent_score: 90, signal_count: 1, signal_at: ago(2), seen_before: false, language: 'ru', created_at: ago(1),
  author_name: 'Дмитрий К.', author_profile_url: 'https://www.facebook.com/profile.php?id=1',
  score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['price'], parentAgeDays: null } },
  evidence: [{ signalId: `s${id}`, parentSignalId: null, kind: 'POST', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 90, similarity: 90, ageDays: 2,
    text: 'Ищу 2-комнатную квартиру в Крцаниси до 130 000$', url: 'https://www.facebook.com/groups/x/posts/1/', parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(2) }],
  ...over,
});
const LEADS = [lead('l1'), lead('l2', { author_name: 'Nino B.', strength: 'GOOD', overall_score: 70, source: 'TELEGRAM', author_profile_url: 'https://t.me/nino' })];

const LIBRARY = [
  { contact_key: 'contact:c1', kind: 'OUTREACH_CONTACT', display_name: 'Ana Kapanadze', email: 'ana@example.test', phone: null, profile_url: null, source_url: null,
    source: 'IMPORT', language: 'ka', property_id: null, property_title: null, campaign_job_id: null, acquired_at: ago(10), email_sendable: true, outreach_contact_id: 'c1' },
  { contact_key: 'contact:c2', kind: 'OUTREACH_CONTACT', display_name: 'Opted Out', email: 'out@example.test', phone: null, profile_url: null, source_url: null,
    source: 'IMPORT', language: 'en', property_id: null, property_title: null, campaign_job_id: null, acquired_at: ago(10), email_sendable: false, outreach_contact_id: 'c2' },
  { contact_key: 'lead:p1', kind: 'CAMPAIGN_LEAD', display_name: 'Дмитрий К.', email: null, phone: null, profile_url: 'https://www.facebook.com/profile.php?id=1', source_url: null,
    source: 'FACEBOOK', language: 'ru', property_id: PROPERTY_ID, property_title: property.title, campaign_job_id: JOB, acquired_at: ago(1), email_sendable: false, outreach_contact_id: null },
];

const AI_DESIGN = {
  ok: true, subject: 'A bright 2-bedroom in Krtsanisi', preheader: '75 m², $120,000',
  design: { version: 1, theme: { accent: '#C9962B', background: '#F4F1EA', surface: '#FFFFFF', ink: '#14213D', font: 'sans' }, blocks: [
    { id: 'h1', type: 'header', brand: 'HOMATCH', tagline: '' },
    { id: 'i1', type: 'image', src: PHOTO, alt: 'Living room', width: 100, align: 'center', caption: '', href: '' },
    { id: 't1', type: 'heading', text: '2-bedroom apartment in Krtsanisi', level: 1, align: 'left' },
    { id: 'p1', type: 'text', html: 'Hello {{first_name|}}, <b>75 m²</b> for $120,000.', align: 'left' },
  ] },
};

async function boot(t, { width = 1440, height = 900, lang = 'en', run = campaign('PARTIAL_RESULTS'), history = null } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  /* try: the email preview is a sandboxed iframe with no storage, and init scripts run in every frame. */
  await ctx.addInitScript(([k, s, l]) => { try { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); } catch { /* sandboxed frame */ } },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  if (process.env.CW_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const calls = [];
  const json = (b, status = 200, extra = {}) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...extra }, body: JSON.stringify(b) });
  const state = { run };
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (url.startsWith('https://cdn.example.test/')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return {}; } })() : {};
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? profile : [profile]));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(wantsObject ? property : [property]));
    if (url.includes('/rest/v1/property_photos')) return r.fulfill(json([{ public_url: PHOTO, is_cover: true, display_order: 0, width: 1600, height: 1000, visibility: 'PUBLIC' }]));
    if (url.includes('/rpc/find_buyers_my_campaign')) {
      if (url.includes('/rpc/find_buyers_my_campaigns')) return r.fulfill(json(history ?? [{ jobId: JOB, propertyId: PROPERTY_ID, propertyTitle: property.title, transaction: 'SALE',
        createdAt: ago(0.02), completedAt: null, creditsCommitted: 250, languages: ['ka', 'ru', 'en'], state: state.run.state, active: state.run.active, results: state.run.newResults }]));
      calls.push({ rpc: 'find_buyers_my_campaign', body });
      return r.fulfill(json({ propertyId: PROPERTY_ID, readiness, campaign: state.run }));
    }
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json({ readiness, campaign: state.run }));
    if (url.includes('/rest/v1/find_buyers_leads') || url.includes('/rest/v1/find_buyers_current_leads')) {
      const rows = state.run.newResults > 0 ? LEADS : [];
      return r.fulfill(json(rows, 200, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }));
    }
    if (url.includes('/rest/v1/matches')) return r.fulfill(json([], 200, { 'content-range': '*/0' }));
    if (url.includes('/rpc/my_native_matches')) return r.fulfill(json([]));
    if (url.includes('/rpc/my_contact_library')) return r.fulfill(json(LIBRARY));
    if (url.includes('/rest/v1/email_studio_documents')) {
      calls.push({ table: 'email_studio_documents', method: req.method(), body });
      const row = { id: 'd1', kind: 'DRAFT', name: '', subject: '', preheader: '', language: 'en', property_id: null, design: { version: 1, blocks: [] }, recipients: [],
        outreach_campaign_id: null, created_at: ago(0), updated_at: ago(0), ...(Array.isArray(body) ? body[0] : body) };
      return r.fulfill(json(req.method() === 'GET' ? [] : (wantsObject ? row : [row])));
    }
    if (url.includes('/functions/v1/communication-studio-ai')) { calls.push({ fn: 'communication-studio-ai', body }); return r.fulfill(json(AI_DESIGN)); }
    if (url.includes('/rpc/email_studio_prepare_audience')) { calls.push({ rpc: 'email_studio_prepare_audience', body }); return r.fulfill(json({ listId: 'list1', eligible: 1, excluded: 0 })); }
    if (url.includes('/functions/v1/outreach-campaign-preview')) { calls.push({ fn: 'outreach-campaign-preview', body }); return r.fulfill(json({ campaign: { id: 'oc1' } })); }
    if (url.includes('/functions/v1/outreach-send')) { calls.push({ fn: 'outreach-send', body }); return r.fulfill(json({ processed: 1, sent: 1, failed: 0, skipped: 0, remaining_hint: false })); }
    if (url.includes('/rest/v1/outreach_campaigns')) return r.fulfill(json(wantsObject ? { status: 'COMPLETED', sent_count: 1, delivered_count: 1, bounce_count: 0, complaint_count: 0, unsubscribe_count: 0, failed_count: 0, last_send_error: null } : []));
    if (url.includes('/functions/v1/match-campaign')) { calls.push({ fn: 'match-campaign', body }); return r.fulfill(json({ ok: true })); }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls, state };
}

const workspace = (view = '') => `${BASE}/property/${PROPERTY_ID}/campaigns/${JOB}${view}`;
const text = (page) => page.textContent('main');

test('a running campaign has its own page: real stages and progress, no internal machinery, survives a refresh', opts, async (t) => {
  const { page, calls } = await boot(t);
  await page.goto(workspace(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cw-progress-title', { timeout: 30000 });
  let body = await text(page);
  assert.match(body, /External Matching/);
  assert.match(body, /Preparing your search/);
  assert.match(body, /Discovering potential matches/);
  assert.match(body, /2 of 9 search steps finished/, 'progress is the server queue: done 2 of 2 done + 3 queued + 4 running');
  assert.match(body, /results found/);
  for (const internal of [/414/, /57/, /older than 30 days/i, /signals checked/i, /communities/i, /registered users/i]) {
    assert.doesNotMatch(body, internal, `internal figure leaked: ${internal}`);
  }
  assert.ok(calls.some((c) => c.rpc === 'find_buyers_my_campaign' && c.body.p_job_id === JOB));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cw-progress-title', { timeout: 30000 });
  body = await text(page);
  assert.match(body, /Discovering potential matches/, 'refresh lands on the same campaign');
});

test('a campaign that finished with results opens its matches; selection prepares a message', opts, async (t) => {
  const { page } = await boot(t, { run: campaign('COMPLETED_WITH_RESULTS', { active: false, completedAt: ago(0), queue: { total: 9, queued: 0, running: 0, done: 9, failed: 0, cancelled: 0, paused: 0 } }) });
  await page.goto(workspace(), { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/view=results/, { timeout: 30000 });
  await page.waitForSelector('#cw-leads-title', { timeout: 30000 });
  const body = await text(page);
  assert.match(body, /Дмитрий К\./);
  assert.match(body, /Nino B\./);
  await page.getByRole('button', { name: /Select Дмитрий/ }).click();
  await page.getByRole('button', { name: 'Prepare message' }).click();
  await page.waitForSelector('text=Message assistant');
  assert.match(await page.textContent('[role="dialog"]'), /HOMATCH cannot post into other platforms|Their public profile/);
});

test('empty and failed runs say so, with real next steps', opts, async (t) => {
  for (const [state, title] of [['COMPLETED_NO_RESULTS', /No suitable matches this time/], ['FAILED', /The campaign could not run/]]) {
    const { page } = await boot(t, { run: campaign(state, { active: false, newResults: 0, newLeads: 0, strong: 0, completedAt: ago(0) }) });
    await page.goto(workspace(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cw-progress-title', { timeout: 30000 });
    const body = await text(page);
    assert.match(body, title);
    assert.match(body, /Start another search/);
    assert.match(body, /Adjust property details/);
    assert.doesNotMatch(body, /View \d+ matches/);
  }
});

test('the matches page names Internal and External Matching separately', opts, async (t) => {
  const { page } = await boot(t);
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#svc-external-title', { timeout: 30000 });
  const body = await text(page);
  assert.match(body, /Internal Matching/);
  assert.match(body, /External Matching/);
  assert.match(body, /No HOMATCH members match this property right now/);
  await page.waitForSelector(`a[href="/property/${PROPERTY_ID}/campaigns/${JOB}"]`, { timeout: 30000 }); /* the link to the live campaign */
});

test('Email Studio: AI proposes, the owner accepts; nothing is sent without consent and confirmation', opts, async (t) => {
  const { page, calls } = await boot(t);
  await page.goto(`${BASE}/outreach/email/studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=What is this email about?', { timeout: 30000 });
  await page.selectOption('select:near(:text("Property"))', PROPERTY_ID).catch(async () => {
    await page.locator('select').first().selectOption(PROPERTY_ID);
  });
  await page.getByRole('button', { name: /Start from contacts/ }).click();
  await page.waitForSelector('text=Ana Kapanadze');
  /* The opted-out address cannot be selected, and says why. */
  assert.ok(await page.getByRole('checkbox', { name: /Opted Out/ }).isDisabled());
  await page.getByRole('checkbox', { name: /Ana Kapanadze/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Generate email' }).click();
  await page.waitForSelector('text=Review the AI draft');
  assert.ok(calls.some((c) => c.fn === 'communication-studio-ai' && c.body.action === 'compose_email' && c.body.propertyId === PROPERTY_ID));
  assert.ok(!calls.some((c) => c.fn === 'outreach-send'), 'generating never sends');
  await page.getByRole('button', { name: 'Accept' }).first().click();
  await page.getByRole('button', { name: 'Next' }).click();
  const send = page.getByRole('button', { name: /Send to 1 recipients/ });
  assert.ok(await send.isDisabled(), 'no send before consent');
  await page.getByRole('checkbox', { name: /I confirm these recipients/ }).check();
  await send.click();
  await page.waitForSelector('text=Send this email to 1 recipients?');
  assert.ok(!calls.some((c) => c.fn === 'outreach-send'), 'opening the confirmation does not send');
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.waitForSelector('text=Sent to 1.');
  const audience = calls.find((c) => c.rpc === 'email_studio_prepare_audience');
  assert.deepEqual(audience.body.p_contact_ids, ['c1']);
  const created = calls.find((c) => c.fn === 'outreach-campaign-preview');
  assert.equal(created.body.contact_list_id, 'list1');
  assert.match(created.body.html_body, /cdn\.example\.test\/p\/cover\.jpg/);
  assert.doesNotMatch(created.body.html_body, /<script/i);
  assert.equal(calls.filter((c) => c.fn === 'outreach-send').length, 1);
});

test('1440px and 390px, six locales: workspace, history, library and studio fit, RTL for ar/he', opts, async (t) => {
  const failures = [];
  const pages = [
    ['workspace', workspace(), '#cw-progress-title'],
    ['results', workspace('?view=results'), '#cw-leads-title'],
    ['history', `${BASE}/property/${PROPERTY_ID}/campaigns`, 'a[href*="/campaigns/"]'],
    ['library', `${BASE}/outreach/library`, 'ul li [role="checkbox"]'],
    ['studio', `${BASE}/outreach/email/studio`, 'ol[aria-label] button'],
  ];
  for (const width of [1440, 390]) {
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang });
      for (const [name, url, ready] of pages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        try { await page.waitForSelector(ready, { timeout: 30000 }); } catch { failures.push(`${lang} ${width} ${name}: did not render`); continue; }
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dir: document.documentElement.getAttribute('dir'),
        }));
        if (process.env.CW_SHOTS && (lang === 'en' || lang === 'ka' || lang === 'ar')) await page.screenshot({ path: join(process.env.CW_SHOTS, `${name}-${lang}-${width}.png`), fullPage: true });
        if (layout.overflow > 1) failures.push(`${lang} ${width} ${name}: horizontal overflow ${layout.overflow}px`);
        if (['ar', 'he'].includes(lang) && layout.dir !== 'rtl') failures.push(`${lang} ${name}: not RTL`);
        const body = (await page.textContent('body')) ?? '';
        const leaked = body.match(/\b(?:svc|cw|cl|ma|es)_[a-z_]{3,}\b/);
        if (leaked) failures.push(`${lang} ${width} ${name}: untranslated key ${leaked[0]}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
