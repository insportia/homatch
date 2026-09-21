// The three auth screens in all six languages, including the two that
// mirror.
//
// WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
//
// Every password field reserved its space with `pr-10` — physical right —
// while its reveal button was placed with `isRTL ? 'left-3' : 'right-3'`.
// In English those agree. In Arabic and Hebrew they point at opposite
// sides: forty pixels held empty on the right, twelve on the left, and a
// sixteen-pixel button standing in those twelve. A typed password ran
// underneath it, on /auth/login, /auth/signup and /auth/reset-password
// alike, at every width in both languages.
//
// formControls.test.mjs already visited all three routes and checked that
// each control is big enough, tappable, labelled and asks for the right
// keyboard — all of which was true. The property nobody was asserting is
// that a control floating inside a field sits on the side the field
// actually reserved for it, and that is only visible in a mirrored
// locale. So it is asserted here, for EVERY password input on every auth
// screen, found by querying the inputs rather than by naming the ones
// somebody remembered.
//
// THE OTHER TWO REPORTS WERE THE MEASURING INSTRUMENT
//
// A Turkish line was once reported as rendering "0px wide", and Russian
// and Hebrew as having truncated content. Neither was real. clientWidth
// is zero for every non-replaced inline element by specification, so the
// first reported identically for <span> in all six languages including
// English; and innerText.length is not a completeness measure, because
// Hebrew is an abjad and writes the same sentence in a fifth fewer
// characters. This file asserts what those two were reaching for in forms
// that cannot produce the same false positive: words are checked for real
// line breaks using Range geometry, and completeness is checked as the
// SET OF CONTROLS AND STRINGS, never as a character count.
//
// WHY THE RESET SCREEN NEEDS A SESSION
//
// Its form only renders once Supabase reports one, because a recovery
// link is what normally puts one there. The harness writes the same stub
// session the rest of this suite uses, which takes the page to its
// `ready` phase and paints the two password fields.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Its own port: routeOverflow 4321, expatsReadable 4322/4323,
   formControls 4337. */
const PORT = 4341;
const BASE = `http://127.0.0.1:${PORT}`;

const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const RTL = new Set(['ar', 'he']);
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];

/**
 * The three screens that ask for a password.
 *
 * `session` marks the one whose form is behind a recovery session. The
 * other two must NOT have one: LoginPage and SignupPage both navigate
 * away when they see a session, so seeding one there would measure the
 * dashboard instead.
 */
const SCREENS = [
  { path: '/auth/login', name: 'login', session: false, fields: ['password'] },
  { path: '/auth/signup', name: 'signup', session: false, fields: ['password'] },
  { path: '/auth/reset-password', name: 'reset', session: true, fields: ['new-password', 'confirm-password'] },
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME) return process.env.PLAYWRIGHT_CHROME;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
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
    sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp,
    email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * Every password input on the page and the control floating inside it.
 *
 * Queried from the inputs rather than from a list of ids, so a field
 * nobody remembered — the confirm box on the reset form — is measured on
 * the same terms. Computed padding is read rather than class names, so
 * the rule survives a restyle.
 */
const PASSWORD_FIELDS = () => {
  const out = [];
  const seen = new Set();
  for (const field of document.querySelectorAll(
    'input[type="password"], input[autocomplete*="password"], input[id*="password"]',
  )) {
    if (seen.has(field)) continue;
    seen.add(field);
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cs = getComputedStyle(field);
    const paddingLeft = parseFloat(cs.paddingLeft || '0');
    const paddingRight = parseFloat(cs.paddingRight || '0');
    const button = field.parentElement?.querySelector('button');
    const row = {
      id: field.id || field.name || '(unnamed)',
      direction: cs.direction,
      paddingLeft, paddingRight,
      hasButton: Boolean(button),
    };
    if (button) {
      const br = button.getBoundingClientRect();
      const onLeft = (br.left + br.width / 2) < (rect.left + rect.width / 2);
      row.buttonSide = onLeft ? 'left' : 'right';
      row.buttonWidth = br.width;
      row.reserved = onLeft ? paddingLeft : paddingRight;
      row.accessibleName = button.getAttribute('aria-label') || button.textContent.trim() || null;
      /* The strip the value is allowed to occupy, and whether the button
         stands inside it. */
      const textLeft = rect.left + paddingLeft;
      const textRight = rect.right - paddingRight;
      row.overlapsTextBox = br.left < textRight - 0.5 && br.right > textLeft + 0.5;
      /*
       * CAN A TYPED PASSWORD EVER REACH THE BUTTON?
       *
       * An input paints its value only inside its content box, and
       * clips there — a value too long to fit scrolls rather than
       * spilling into the padding. So the question is not where a
       * particular string happens to end; it is whether the padding on
       * the button's side clears the button ENTIRELY, inset included.
       * Measuring the button's far edge from the field's edge gives that
       * directly, and it holds for any value in any language.
       *
       * The earlier form of this check projected a canvas measurement of
       * the value from the start edge, which assumes no scrolling and so
       * flagged every 320px field in all six locales, English included,
       * for a string that was simply longer than the box.
       */
      row.buttonReach = onLeft
        ? br.right - rect.left
        : rect.right - br.left;
      row.clearsButton = row.reserved >= row.buttonReach - 0.5;
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      row.valueWidth = Math.round(c.measureText(field.value || '').width);
    }
    out.push(row);
  }
  return out;
};

/** Words the browser was forced to split across two lines. */
const BROKEN_WORDS = () => {
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement;
    if (!parent || !parent.checkVisibility?.()) continue;
    const cs = getComputedStyle(parent);
    if (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') continue;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length < 2) continue;
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      range.detach?.();
      if (rects.length < 2) continue;
      /* Several rects on ONE line are bidi runs and are fine; rects at
         different tops mean the word itself was cut in half. */
      if (new Set(rects.map((r) => Math.round(r.top))).size > 1) {
        bad.push({ word: m[0].slice(0, 24), tag: parent.tagName, context: text.trim().slice(0, 50) });
      }
    }
  }
  return bad;
};

/** The page as a set of things, not as a number of characters. */
const SHAPE = () => ({
  dir: document.documentElement.getAttribute('dir') || getComputedStyle(document.body).direction,
  inputs: [...document.querySelectorAll('input')].map((e) => e.type).sort(),
  buttonCount: document.querySelectorAll('button').length,
  linkTargets: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).sort(),
  labelCount: document.querySelectorAll('label').length,
  headings: document.querySelectorAll('h1,h2').length,
  strings: (document.body.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean),
  overflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
});

/* A value long enough to fill the field, so the overlap has something to
   overlap. An empty password hides the entire defect. */
const LONG_PASSWORD = 'Sup3rLongPassphraseForTheField';

test('every auth password control sits on the side its field reserved', opts, async (t) => {
  if (skipReason) assert.fail(`auth screens gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  async function open(screen, lang, width) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700,
    });
    await ctx.addInitScript(
      ([key, session, locale, withSession]) => {
        if (withSession) window.localStorage.setItem(key, JSON.stringify(session));
        else window.localStorage.removeItem(key);
        window.localStorage.setItem('homatch_lang', locale);
      },
      ['sb-stubproj-auth-token', fakeSession(), lang, screen.session],
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
    const json = (body) => ({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
    });
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(BASE)) return r.continue();
      if (r.request().method() === 'OPTIONS') {
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });
    await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    await page.waitForTimeout(400);
    return { ctx, page, errors };
  }

  const failures = [];
  const shapes = {};
  let measured = 0;
  let fieldsMeasured = 0;

  for (const screen of SCREENS) {
    for (const lang of LOCALES) {
      for (const width of WIDTHS) {
        const { ctx, page, errors } = await open(screen, lang, width);
        measured += 1;
        const where = `${screen.name}/${lang}@${width}`;

        /* Fill every password box so the value has real extent. */
        for (const id of screen.fields) {
          await page.fill(`#${id}`, LONG_PASSWORD).catch(() => {});
        }
        /* Reveal, so the characters are drawn rather than bulleted. */
        await page.click('.relative > button').catch(() => {});
        await page.waitForTimeout(200);

        const fields = await page.evaluate(PASSWORD_FIELDS);
        fieldsMeasured += fields.length;

        if (fields.length !== screen.fields.length) {
          failures.push(`${where}: expected ${screen.fields.length} password field(s), found ${fields.length}`);
        }
        if (!fields.some((f) => f.hasButton)) {
          failures.push(`${where}: no reveal control on any password field`);
        }

        for (const f of fields) {
          if (RTL.has(lang) && f.direction !== 'rtl') {
            failures.push(`${where} #${f.id}: field is ${f.direction}, not rtl`);
          }
          if (!f.hasButton) continue;
          if (!f.clearsButton) {
            failures.push(
              `${where} #${f.id}: reveal button is on the ${f.buttonSide} and reaches ` +
              `${Math.round(f.buttonReach)}px into the field, but only ${f.reserved}px is reserved ` +
              `there (padding L${f.paddingLeft}/R${f.paddingRight}) — a typed password renders under it`,
            );
          }
          if (f.overlapsTextBox) {
            failures.push(`${where} #${f.id}: reveal button stands inside the field's text area`);
          }

          if (!f.accessibleName) {
            failures.push(`${where} #${f.id}: the reveal button has no accessible name`);
          }
        }

        const broken = await page.evaluate(BROKEN_WORDS);
        if (broken.length) {
          failures.push(`${where}: ${broken.length} word(s) split across lines — "${broken[0].word}" in <${broken[0].tag}>`);
        }
        const shape = await page.evaluate(SHAPE);
        if (shape.overflow) failures.push(`${where}: the page scrolls sideways`);
        if (RTL.has(lang) && shape.dir !== 'rtl') failures.push(`${where}: document is ${shape.dir}, not rtl`);
        if (!RTL.has(lang) && shape.dir === 'rtl') failures.push(`${where}: document is rtl but ${lang} is not`);
        if (errors.length) failures.push(`${where}: ${errors[0]}`);

        if (width === 1440) shapes[`${screen.name}/${lang}`] = shape;
        await ctx.close();
      }
    }
  }

  /* Completeness, per screen, as a set rather than a length. Hebrew
     writes the same content shorter; it does not get to write less. */
  for (const screen of SCREENS) {
    const ref = shapes[`${screen.name}/en`];
    assert.ok(ref, `${screen.name}: English never rendered`);
    for (const lang of LOCALES) {
      const s = shapes[`${screen.name}/${lang}`];
      if (!s) { failures.push(`${screen.name}/${lang}: never rendered at 1440`); continue; }
      assert.deepEqual(s.inputs, ref.inputs, `${screen.name}/${lang} does not offer the same input types as English`);
      assert.deepEqual(s.linkTargets, ref.linkTargets, `${screen.name}/${lang} does not offer the same links as English`);
      if (s.buttonCount !== ref.buttonCount) failures.push(`${screen.name}/${lang}: ${s.buttonCount} buttons, English has ${ref.buttonCount}`);
      if (s.labelCount !== ref.labelCount) failures.push(`${screen.name}/${lang}: ${s.labelCount} labels, English has ${ref.labelCount}`);
      if (s.headings !== ref.headings) failures.push(`${screen.name}/${lang}: ${s.headings} headings, English has ${ref.headings}`);
      if (s.strings.length !== ref.strings.length) {
        failures.push(`${screen.name}/${lang}: ${s.strings.length} visible strings, English has ${ref.strings.length}`);
      }
      /* Exempt what is the same in every language by design: the
         wordmark, the example address, the locale chip, Google. */
      const SAME_EVERYWHERE = /homatch|example\.com|google|^[A-Z]{2}$|^©/i;
      if (lang !== 'en') {
        const untranslated = s.strings.filter((x, i) => x === ref.strings[i] && /[A-Za-z]{4}/.test(x) && !SAME_EVERYWHERE.test(x));
        if (untranslated.length) failures.push(`${screen.name}/${lang}: still in English — ${untranslated.slice(0, 3).join(' | ')}`);
      }
    }
  }

  /* The controls work, and the keyboard can reach them. */
  for (const screen of SCREENS) {
    for (const lang of LOCALES) {
      const { ctx, page } = await open(screen, lang, 390);
      const first = screen.fields[0];
      const before = await page.getAttribute(`#${first}`, 'type');
      await page.click('.relative > button');
      await page.waitForTimeout(150);
      if (await page.getAttribute(`#${first}`, 'type') === before) {
        failures.push(`${screen.name}/${lang}: the reveal button does not toggle the password`);
      }
      await page.focus(`#${first}`);
      const reached = [];
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('Tab');
        reached.push(await page.evaluate(() => {
          const a = document.activeElement;
          return a ? `${a.tagName}${a.getAttribute('aria-label') ? '[label]' : ''}` : 'none';
        }));
      }
      if (!reached.some((x) => x.startsWith('BUTTON'))) {
        failures.push(`${screen.name}/${lang}: the reveal button is not reachable by Tab (${reached.join(' → ')})`);
      }
      await ctx.close();
    }
  }

  /*
   * THE PIXEL PROOF, FOR THE TWO LANGUAGES THAT MIRROR.
   *
   * Everything above is geometry, and geometry is an argument about
   * where the text CAN go. This looks at where it actually went: the
   * reveal button is photographed with the field empty and again with a
   * long password revealed in it, both times with the same icon showing.
   * If a single character were painted under the button the two images
   * would differ. Identical bytes mean nothing reached it.
   */
  for (const screen of SCREENS) {
    for (const lang of ['ar', 'he']) {
      for (const width of [320, 390, 1440]) {
        const { ctx, page } = await open(screen, lang, width);
        const button = await page.$('.relative > button');
        if (!button) { failures.push(`${screen.name}/${lang}@${width}: no reveal button to photograph`); await ctx.close(); continue; }
        /*
         * Two variables have to be held still or this compares the wrong
         * thing. The icon changes when the field is revealed, so reveal
         * BEFORE both photographs; and the button's background is
         * transparent, so it photographs the field underneath it —
         * including the focus ring that filling the field brings up.
         * Unblurred, this reported a difference in English too, which is
         * how the focus ring gave itself away.
         */
        await button.click();
        await page.waitForTimeout(200);
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(200);
        const empty = await button.screenshot();
        await page.fill(`#${screen.fields[0]}`, LONG_PASSWORD);
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(250);
        const filled = await button.screenshot();
        if (!empty.equals(filled)) {
          failures.push(
            `${screen.name}/${lang}@${width}: the reveal button looks different once a password is typed — ` +
            'something is being painted underneath it',
          );
        }
        await ctx.close();
      }
    }
  }

  assert.ok(
    measured >= SCREENS.length * LOCALES.length * WIDTHS.length,
    `only ${measured} screen/locale/width combinations measured`,
  );
  assert.ok(fieldsMeasured >= measured, `only ${fieldsMeasured} password fields measured across ${measured} loads`);
  assert.deepEqual(failures, [], `auth password controls are broken:\n  ${failures.join('\n  ')}`);
});

test('the auth screens link to each other', opts, async (t) => {
  if (skipReason) assert.fail(`auth journey gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT + 1), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const base = `http://127.0.0.1:${PORT + 1}`;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const failures = [];
  for (const lang of ['en', 'he']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((l) => {
      window.localStorage.removeItem('sb-stubproj-auth-token');
      window.localStorage.setItem('homatch_lang', l);
    }, lang);
    const page = await ctx.newPage();
    const json = (body) => ({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
    });
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(base)) return r.continue();
      if (r.request().method() === 'OPTIONS') {
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#password', { timeout: 20000 });
    await page.waitForTimeout(400);

    /* Login -> Create Account, followed rather than read off the href. */
    await page.click('a[href^="/auth/signup"]');
    await page.waitForTimeout(900);
    const onSignup = await page.evaluate(() => location.pathname);
    if (onSignup !== '/auth/signup') failures.push(`${lang}: Create Account went to ${onSignup}`);
    else if (!(await page.$('#password'))) failures.push(`${lang}: the signup screen has no password field`);

    /* Login -> Forgot password, which opens the dialog that starts the
       reset flow. The rest of that flow needs an emailed link. */
    await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#password', { timeout: 20000 });
    await page.waitForTimeout(400);
    await page.click('form button[type="button"]:not([aria-label])');
    await page.waitForTimeout(600);
    const dialog = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? { open: true, inputs: d.querySelectorAll('input').length } : { open: false };
    });
    if (!dialog.open) failures.push(`${lang}: the forgot-password dialog did not open`);
    else if (dialog.inputs < 1) failures.push(`${lang}: the forgot-password dialog has no email field`);
    await ctx.close();
  }

  assert.deepEqual(failures, [], `auth navigation:\n  ${failures.join('\n  ')}`);
});
