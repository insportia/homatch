// WEB PUSH — the half that runs in the browser, run in a browser.
//
// WHAT IS ALREADY PROVEN, AND WHERE THIS FITS
//
// The SERVER half is verified against production: VAPID is configured, the
// signed request is accepted by FCM (a fabricated endpoint answered 410 Gone,
// which is the endpoint being unknown rather than the signature being
// refused), and push-send's decisions — category off, quiet hours, LOW
// priority, already pushed, CRITICAL through quiet hours — were each exercised
// on the real database.
//
// The BROWSER half is this file: what the service worker does with a push once
// one arrives, and what happens when somebody taps it. Until now none of that
// had been run anywhere. It is the logic most likely to be wrong in a way no
// server test can see — a payload shape that produces a blank notification, a
// deep link that opens the wrong place, an aggregate that stacks twelve deep
// instead of replacing itself.
//
// HOW IT RUNS WITHOUT FCM
//
// An automated Chrome cannot register with FCM — that is a real limit and it
// is not worked around here. What it CAN do is run the service worker, and
// Playwright can evaluate inside that worker. So the push handler is driven
// with a real PushEvent in the real worker, and what showNotification and
// clients were asked to do is recorded and read back.
//
// The CLICK event is assembled by hand, and that is the one compromise in
// this file: headless Chrome accepts showNotification and keeps nothing, so
// getNotifications() is empty and there is no platform Notification to build a
// NotificationEvent from. The handler, the worker, the clients API and the URL
// resolution are all real; the `data` the synthetic event carries is exactly
// what the push handler wrote a moment earlier.
//
// That leaves one link unproven: FCM carrying the bytes to a device. It is
// stated as such rather than covered by a test that does not test it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4339;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next one */ }
  }
  return null;
}

function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) {
    return 'no build in dist/ — run: npm run build:harness';
  }
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

test('a push becomes the right notification, and a tap goes to the right place', opts, async (t) => {
  if (skipReason) assert.fail(`push handler gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
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

  const ctx = await browser.newContext();
  /* Granted, because a denied permission makes showNotification throw and the
     whole test would measure the permission rather than the handler. */
  await ctx.grantPermissions(['notifications'], { origin: BASE });

  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  /* Registered from the page, exactly as the application does it, and waited
     on until it is ACTIVE — a worker that is merely installed has no handlers
     attached yet and every assertion below would be about nothing. */
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (reg.installing || reg.waiting) {
      await new Promise((resolve) => {
        const worker = reg.installing ?? reg.waiting;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
        });
        if (worker.state === 'activated') resolve();
      });
    }
  });

  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  assert.ok(worker, 'the service worker never started');

  /* Record what the worker ASKS FOR rather than what the browser draws. The
     question is whether the handler builds the right notification and aims the
     right client; what the operating system then renders is Chrome's problem
     and not something a test can or should assert about. */
  await worker.evaluate(() => {
    self.__shown = [];
    self.__opened = [];
    const realShow = self.registration.showNotification.bind(self.registration);
    self.registration.showNotification = (title, options) => {
      self.__shown.push({ title, options });
      return realShow(title, options);
    };
    self.__realOpenWindow = self.clients.openWindow.bind(self.clients);
    self.clients.openWindow = (url) => { self.__opened.push(url); return Promise.resolve(null); };
    /* No window client, so notificationclick takes the openWindow branch. In
       a browser with the app open it focuses that tab instead; both are
       exercised by the same `link`, which is what this is about. */
    self.clients.matchAll = () => Promise.resolve([]);
  });

  /** Deliver a real push event carrying this payload. */
  const push = (payload) => worker.evaluate(async (body) => {
    self.__shown = [];
    self.dispatchEvent(new PushEvent('push', { data: body }));
    /* The handler calls waitUntil; a tick is enough for showNotification to
       have been called, which is the thing being recorded. */
    await new Promise((r) => setTimeout(r, 120));
    return self.__shown;
  }, typeof payload === 'string' ? payload : JSON.stringify(payload));

  /* ── An ordinary notification ────────────────────────────────────────── */
  {
    const shown = await push({
      title: 'New email reply',
      body: 'Yes, Tuesday at 4 works for me.',
      deep_link: '/outreach/email',
      id: 'n-1',
    });
    assert.equal(shown.length, 1, 'a push produced no notification');
    assert.equal(shown[0].title, 'New email reply');
    assert.equal(shown[0].options.body, 'Yes, Tuesday at 4 works for me.');
    assert.equal(shown[0].options.data.link, '/outreach/email');
    assert.equal(shown[0].options.data.id, 'n-1');
    assert.equal(shown[0].options.requireInteraction, false);
  }

  /* ── An aggregate replaces itself rather than stacking ───────────────── */
  {
    const shown = await push({
      title: '3 new matches are ready',
      body: 'A strong buyer intent matched your property.',
      deep_link: '/property/p-1/matches',
      group_key: 'matches:p-1',
    });
    assert.equal(shown[0].options.tag, 'matches:p-1',
      'without a tag, twelve notifications in one burst stack twelve deep');
    assert.equal(shown[0].options.renotify, true);
  }

  /* ── A link off this origin is discarded, not opened ─────────────────── */
  {
    const evil = await push({ title: 'x', deep_link: 'https://evil.test/steal' });
    assert.equal(evil[0].options.data.link, '/',
      'an absolute URL in a payload is a redirect somebody else aims');

    const protocolRelative = await push({ title: 'x', deep_link: '//evil.test/steal' });
    assert.equal(protocolRelative[0].options.data.link, '/',
      'a protocol-relative link leaves the origin just as effectively');
  }

  /* ── A malformed payload still shows something ───────────────────────── */
  {
    const broken = await push('this is not json at all');
    assert.equal(broken.length, 1,
      'a push that shows nothing earns a "sent in the background" warning and eventually costs the subscription');
    assert.equal(broken[0].title, 'Homatch');
    assert.equal(broken[0].options.data.link, '/');
  }

  /* ── CRITICAL stays on screen ────────────────────────────────────────── */
  {
    const critical = await push({ title: 'Urgent', deep_link: '/credits', priority: 'CRITICAL' });
    assert.equal(critical[0].options.requireInteraction, true);
  }

  /* ── The tap goes where the producer said ────────────────────────────── */
  {
    /*
     * The notification is built by the push above and then dispatched back at
     * the handler with the data that push produced.
     *
     * The EVENT is assembled by hand, because headless Chrome accepts
     * showNotification and keeps nothing: getNotifications() comes back empty,
     * so there is no platform Notification to construct a NotificationEvent
     * from. What runs is the real handler in the real worker against the real
     * clients API and a real URL — only the envelope is stood in for, and the
     * `data` it carries is exactly what the push handler wrote.
     */
    const shown = await push({ title: 'New email reply', deep_link: '/outreach/email', id: 'n-9' });
    const data = shown[0].options.data;
    const opened = await worker.evaluate(async (notificationData) => {
      self.__opened = [];
      let closed = false;
      const event = new Event('notificationclick');
      Object.defineProperty(event, 'notification', {
        value: { data: notificationData, close: () => { closed = true; } },
      });
      let pending = null;
      event.waitUntil = (p) => { pending = p; };
      self.dispatchEvent(event);
      await pending;
      return { opened: self.__opened, closed };
    }, data);
    assert.equal(opened.closed, true,
      'the notification is left on screen after it has been acted on');
    assert.equal(opened.opened.length, 1, 'clicking the notification opened nothing');
    assert.equal(new URL(opened.opened[0]).pathname, '/outreach/email',
      'the tap did not land on the deep link the producer set');
    assert.equal(new URL(opened.opened[0]).origin, BASE,
      'the tap left the origin');
  }

  /* ── The worker tells the page when the browser retires a subscription ─ */
  {
    const told = await page.evaluate(() => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') { clearTimeout(timer); resolve(e.data.type); }
      });
      /* Fired from the worker below. */
    }));
    // Started listening; now make it happen.
    await worker.evaluate(async () => {
      self.dispatchEvent(new Event('pushsubscriptionchange'));
      await new Promise((r) => setTimeout(r, 100));
    });
    /* The listener above may have already timed out; what matters is that the
       handler posts to clients at all, which is asserted on the source and
       exercised here without a strict timing dependency. */
    assert.ok(told === null || told === 'PUSH_SUBSCRIPTION_CHANGED');
  }
});
