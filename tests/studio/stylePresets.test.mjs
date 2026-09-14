// STYLE PRESETS — measured on the rendered page, not asserted about.
//
// The unit tests beside src/site/style.ts prove the mark is right: which
// attribute each step emits, that an unknown step emits nothing, that no raw
// value reaches the DOM. All of that can be true of a system that changes
// nothing on screen, because a data attribute is only worth anything if a
// rule matches it and the rule wins.
//
// So this renders a page with presets stored on it and MEASURES the result:
// the section's computed background, the measure its content is held to, the
// gold that a neutral accent is supposed to have taken away. Then it renders
// the same page with no presets and measures again, because "it changed" and
// "it changed to the right thing" are different claims and only the pair of
// them says the controls work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4337;
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

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'admin@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

/** A stored home page whose Verify region carries presets. */
function pageWith(style) {
  return {
    schema: 1,
    sections: [{
      id: 'verify-1', type: 'verify', enabled: true, variant: 'default',
      theme: null, spacing: 'normal', style,
      content: {}, i18n: {}, media: {}, links: {}, icons: {}, items: [],
    }],
    seo: null,
  };
}

test('a style preset changes what the page actually renders', opts, async (t) => {
  if (skipReason) assert.fail(`style preset gate could not run: ${skipReason}`);

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

  /** Open Site Studio against a stored page and measure the Verify region. */
  async function measure(style) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(([k, s]) => {
      window.localStorage.setItem(k, JSON.stringify(s));
      window.localStorage.setItem('homatch_lang', 'en');
    }, ['sb-stubproj-auth-token', fakeSession()]);

    const page = await ctx.newPage();
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(BASE)) return r.continue();
      if (r.request().method() === 'OPTIONS') {
        return r.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
          },
        });
      }
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/rpc/')) {
        const name = url.split('/rpc/')[1].split('?')[0];
        if (name === 'site_get_page') {
          return r.fulfill(json({
            slug: 'home', title: 'home', draft: pageWith(style),
            published: null, published_version: null, published_at: null, versions: [],
          }));
        }
        return r.fulfill(json(null));
      }
      if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    const frame = page.frames().find(f => f !== page.mainFrame());
    assert.ok(frame, 'the preview did not render');

    const seen = await frame.evaluate(() => {
      const section = document.querySelector('section#verify');
      if (!section) return null;
      /* Most regions ARE the measure — the PAGE class is on the <section>
         itself — and a few nest it. Both shapes are real, so look at the
         section first and inside it only if it is not the one. */
      const measured = section.classList.contains('hm-measure')
        ? section : section.querySelector('.hm-measure');
      const cs = getComputedStyle(section);
      return {
        background: cs.backgroundColor,
        measure: measured ? getComputedStyle(measured).maxWidth : null,
        /* The gold the accent is supposed to be able to take away, read off
           the section rather than off :root — that is the whole point of
           remapping it inside the region. */
        gold: getComputedStyle(section).getPropertyValue('--gold').trim(),
        padding: cs.paddingTop,
      };
    });
    await ctx.close();
    return seen;
  }

  const plain = await measure({});
  assert.ok(plain, 'the unstyled page did not render the Verify region');

  const styled = await measure({
    surface: 'contrast',
    width: 'narrow',
    density: 'compact',
    accent: 'neutral',
  });
  assert.ok(styled, 'the styled page did not render the Verify region');

  /* ── Surface ─────────────────────────────────────────────────────────
     #0d0d0d, and specifically NOT whatever the section had before. */
  assert.equal(styled.background, 'rgb(13, 13, 13)',
    `surface=contrast did not paint the section (got ${styled.background})`);
  assert.notEqual(styled.background, plain.background);

  /* ── Width ───────────────────────────────────────────────────────────
     64rem at the root 16px = 1024px. Read as a computed length so the test
     is measuring the browser rather than the class string. */
  assert.equal(styled.measure, '1024px',
    `width=narrow did not narrow the measure (got ${styled.measure})`);
  assert.notEqual(styled.measure, plain.measure);

  /* ── Density ─────────────────────────────────────────────────────────
     Less air than the section shipped with, on the section itself. */
  assert.ok(parseFloat(styled.padding) < parseFloat(plain.padding),
    `density=compact did not reduce the padding (${plain.padding} -> ${styled.padding})`);

  /* ── Accent ──────────────────────────────────────────────────────────
     The remap has to reach INSIDE the section; a rule on :root would leave
     this identical and every gold detail still gold. */
  assert.notEqual(styled.gold, plain.gold,
    'accent=neutral left --gold untouched inside the section');
});
