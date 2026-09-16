// THE HEADER, THE INSTALL CONTROL, AND HOW MUCH THE PAGE MOVES.
//
// Three things that can only be checked at a real viewport, in a real
// browser, and that had all three gone wrong in ways nothing reported:
//
//   THE INSTALL BUTTON WAS INVISIBLE. On the black hero it was a dark
//   hairline over a transparent background — `border-foreground/20` on
//   near-black — so it appeared only on hover, which a phone does not have.
//   A contrast measurement of the control at rest is the check; a screenshot
//   review is not, because the button IS there, it just cannot be seen.
//
//   THE INSTALL BUTTON DELETED ITSELF. Dismissing Chrome's own install
//   dialog called rememberDismissal(), and the control vanished for sixty
//   days. The single likeliest interaction destroyed the entry point.
//
//   TWO ANIMATIONS WERE HIDDEN FOR EVERYONE. One stray brace put two
//   `animation: none; opacity: 0` rules outside the reduced-motion query, so
//   they applied always. An animation that never runs looks exactly like a
//   design decision, which is why this asserts that the band is RUNNING for
//   somebody who has not asked it to stop.
//
// The backend is stubbed, so this needs no session, no network and no
// production data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4333;
const BASE = `http://127.0.0.1:${PORT}`;

/** Real devices, narrowest first. 320 is the floor this product supports. */
const WIDTHS = [320, 375, 390, 430];

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

/** sRGB relative luminance, for the contrast ratio below. */
function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
/** Alpha of an rgba() string, or 1 for an opaque colour. */
const alphaOf = (s) => {
  const n = (s.match(/[\d.]+/g) ?? []).map(Number);
  return n.length >= 4 ? n[3] : 1;
};
/** A translucent colour flattened onto the one painted behind it. */
const over = (fg, bg) => {
  const a = alphaOf(fg);
  const f = rgb(fg); const b = rgb(bg);
  if (f.length < 3) return b;
  if (b.length < 3 || a >= 1) return f;
  return f.map((c, i) => Math.round(c * a + b[i] * (1 - a)));
};

async function serve(t, chromium) {
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
  return browser;
}

const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

async function stub(page) {
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
    if (url.includes('/rest/v1/rpc/')) return r.fulfill(json(null));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });
}

/**
 * Chromium only fires `beforeinstallprompt` for a site it judges installable,
 * which headless Chrome will not do. The event is a plain CustomEvent with a
 * `prompt()` and a `userChoice`, so the platform's half of the contract is
 * replayed here — what is under test is OUR half: what the control does with
 * an offer, an acceptance, and a refusal.
 */
const INSTALL_SHIM = `
  window.__installOutcome = 'accepted';
  window.__promptCalls = 0;
  window.__fireInstallPrompt = () => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__promptCalls += 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: window.__installOutcome, platform: 'web' });
    window.dispatchEvent(e);
  };
`;

test('the install control is visible, reachable and does not delete itself', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 780 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await ctx.addInitScript(INSTALL_SHIM);
    await ctx.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
    const page = await ctx.newPage();
    await stub(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__fireInstallPrompt());
    await page.waitForTimeout(600);

    /* ── 1. On the utility strip, before the menu is even opened ─────── */
    /*
     * The strip's control is measured FIRST, and separately, because it is
     * the one on a dark surface. The previous version of this test opened
     * the menu and measured whichever control it found — always the menu's,
     * on a light panel — and so never looked at the dark-tone skin at all.
     * That is how `bg-white/12`, which names no Tailwind rule and generates
     * nothing, shipped as a fully transparent button.
     */
    const strip = page.locator('button:visible').filter({ hasText: /Install app/i }).first();
    assert.ok(await strip.count() > 0, `no install control on the utility strip at ${width}px`);
    const stripLook = await strip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, color: cs.color };
    });
    assert.equal(/rgba\(0, 0, 0, 0\)|transparent/.test(stripLook.background), false,
      `the strip's install control is transparent at ${width}px — it has no surface of its own`);

    /* ── 2. And in the menu as well ──────────────────────────────────── */
    /*
     * The menu toggle BY ITS NAME.
     *
     * `header button[aria-expanded]` also matches the language trigger on the
     * utility strip, and `.last()` picked exactly that — so this opened a
     * language dropdown, never the menu, and then measured the strip's button
     * while believing it was the menu's.
     */
    const menuButton = page.getByRole('button', { name: /open menu/i }).first();
    assert.ok(await menuButton.count() > 0, `no menu control in the header at ${width}px`);
    await menuButton.click();
    await page.waitForTimeout(700);

    const shown = page.locator('button:visible').filter({ hasText: /Install app/i });
    assert.ok(await shown.count() > 0,
      `the mobile menu offers no way to install the app at ${width}px`);

    const target = shown.first();
    await target.scrollIntoViewIfNeeded();

    /* ── 2. VISIBLE AT REST. The old treatment was a dark hairline on
           near-black: present in the DOM, invisible on a phone. ──────── */
    const look = await target.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Walk up for the first painted background behind the control.
      let behind = 'rgba(0, 0, 0, 0)';
      for (let n = el.parentElement; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { behind = bg; break; }
      }
      return {
        background: cs.backgroundColor, color: cs.color, behind,
        width: Math.round(r.width), height: Math.round(r.height),
        left: Math.round(r.left), right: Math.round(r.right),
      };
    });

    assert.ok(look.height >= 40,
      `the install control is ${look.height}px tall at ${width}px — below the touch floor`);
    assert.ok(look.left >= -1 && look.right <= width + 1,
      `the install control hangs outside the ${width}px viewport`);

    assert.ok(
      !/rgba\(0, 0, 0, 0\)|transparent/.test(look.background),
      `the install control has no background of its own at ${width}px — it is invisible until hover`,
    );
    /*
     * Composite the surface over what is behind it before comparing.
     *
     * A translucent surface read naively gives its own colour, so white text
     * on 12% white scored 1.00:1 and looked like a contrast failure when the
     * control is in fact perfectly legible over a dark header. Flattening the
     * alpha is what makes the number mean what it says.
     */
    const flat = over(look.background, look.behind);
    assert.ok(
      contrast(rgb(look.color), flat) >= 4.5,
      `the install label is ${contrast(rgb(look.color), flat).toFixed(2)}:1 where it is painted at ${width}px`,
    );

    /* ── 3. The language selector is reachable on a phone ────────────── */
    /* By what it says, trimmed: the trigger is a two-letter code beside a
       globe and a chevron, both of which are SVG and contribute no text. */
    const langs = await page.locator('button:visible').evaluateAll(
      (els) => els.filter((e) => /^(en|ka|ru|tr|ar|he)$/i.test((e.textContent ?? '').trim())).length,
    );
    assert.ok(langs > 0, `no language control is reachable at ${width}px`);

    await ctx.close();
  }
});

test('refusing the browser dialog is "not now", never "never again"', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript(INSTALL_SHIM);
  await ctx.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const page = await ctx.newPage();
  await stub(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__installOutcome = 'dismissed'; window.__fireInstallPrompt(); });
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /open menu/i }).first().click();
  await page.waitForTimeout(700);

  const button = page.locator('button:visible').filter({ hasText: /Install app/i }).first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(900);

  assert.equal(await page.evaluate(() => window.__promptCalls), 1,
    'pressing the control did not replay the browser prompt');

  /* THE REGRESSION. A dismissal used to mute the control for sixty days, so
     the likeliest interaction was the one that removed the entry point. */
  assert.equal(
    await page.evaluate(() => Object.keys(window.localStorage)
      .some((k) => /install|pwa/i.test(k) && /dismiss|mute/i.test(window.localStorage.getItem(k) ?? k))),
    false,
    'refusing the browser dialog wrote a "do not show again" flag',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /open menu/i }).first().click();
  await page.waitForTimeout(700);
  /*
   * Either label. What this asserts is that the control SURVIVED the
   * dismissal, not what it happens to say: within the first six seconds of a
   * load the button truthfully reads "Preparing install…" while the browser
   * is still deciding whether it can offer one, and only then settles to
   * "Install app". Pinning the wording here would make an honest state
   * change look like the regression this test exists to catch.
   */
  assert.ok(
    await page.locator('button:visible')
      .filter({ hasText: /Install app|Preparing install/i }).count() > 0,
    'the install control disappeared after the dialog was dismissed once',
  );
});

test('the page moves on a phone, and stops dead when asked to', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  /** Every section's opacity, to catch a reveal that never arrives. */
  const opacities = (page) => page.evaluate(() => Array.from(document.querySelectorAll('main section'))
    .map((s) => Number(getComputedStyle(s).opacity)));

  /* ── Motion ON ────────────────────────────────────────────────────── */
  const moving = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await moving.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const page = await moving.newPage();
  await stub(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  /*
   * The band that says a document is being read must actually be running.
   *
   * This is the assertion that would have caught the stray brace: the rule
   * existed, the keyframes existed, and the element was in the page — with
   * `animation: none` applied to everyone.
   */
  const band = await page.evaluate(() => {
    const el = document.querySelector('.hm-read');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      duration: cs.animationDuration,
      opacity: Number(cs.opacity),
      running: el.getAnimations().length,
    };
  });
  if (band) {
    assert.notEqual(band.name, 'none',
      'the reading band has no animation for somebody who never asked it to stop');
    assert.ok(band.running > 0, 'the reading band is not actually animating');
  }

  // Scroll the page the way a reader would, then check nothing was left
  // behind at opacity 0 by a reveal that never fired.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(1200);
  const after = await opacities(page);
  assert.equal(after.filter((o) => o < 0.99).length, 0,
    'a section was left invisible after the page had been scrolled past it');
  await moving.close();

  /* ── Motion OFF ───────────────────────────────────────────────────── */
  const still = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  await still.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const quiet = await still.newPage();
  await stub(quiet);
  await quiet.goto(BASE, { waitUntil: 'domcontentloaded' });
  await quiet.waitForTimeout(3000);

  /*
   * Nothing is animating, and everything is visible.
   *
   * Both halves matter. The naive implementation of "respect reduced motion"
   * is `animation: none`, which CANCELS an animation — so anything whose
   * final state comes from its keyframes is stuck at its first frame,
   * invisible. A near-zero duration ends instead, in the right place.
   */
  const runningNow = await quiet.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running'
      && Number(a.effect?.getTiming?.().duration ?? 0) > 1).length);
  assert.equal(runningNow, 0, 'something is still animating for a reader who asked it to stop');

  const quietOpacities = await opacities(quiet);
  assert.ok(quietOpacities.length > 0, 'the home page rendered no sections at all');
  assert.equal(quietOpacities.filter((o) => o < 0.99).length, 0,
    'reduced motion left part of the page invisible');
});

/*
 * ── IS IT BIG ENOUGH TO NOTICE? ─────────────────────────────────────────
 *
 * The test above proves nothing was left invisible. That is the safety
 * property, and it passed throughout the period when the reported problem
 * was "mobile animations do not work" — because the animations DID run.
 * They ran 10px in 340ms, which is a tenth of a finger's width finishing
 * before the eye settles, and they ran while the section was still 80px
 * into view and the reader was looking somewhere else.
 *
 * So this measures the two things a person actually perceives: how far a
 * thing travels, and whether it travels while they are looking at it. The
 * floor is 16px, which is the smallest movement that reads as an arrival on
 * a phone rather than as a font swap.
 *
 * Every sample scrolls WHILE watching, because a reader does not stop short
 * of a section and wait for it.
 */
const MOTION_FLOOR_PX = 16;

test('the motion on a phone is big enough for a person to see', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  const failures = [];

  for (const width of [390, 320]) {
    /* A fresh load per measurement. Scrolling the page to "warm" it fires
       every IntersectionObserver on the way past, so every sequence would
       have finished before it was sampled. */
    const open = async () => {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 }, isMobile: true, hasTouch: true,
        reducedMotion: 'no-preference',
      });
      await ctx.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
      const page = await ctx.newPage();
      await stub(page);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      return { ctx, page };
    };

    /** Sample opacity and translateY for `n` ticks. */
    const sample = async (page, selector, ticks, scrollBy = 0) => {
      const ys = []; const os = [];
      for (let i = 0; i < ticks; i += 1) {
        if (scrollBy) await page.evaluate((n) => window.scrollBy(0, n), scrollBy);
        const s = await page.evaluate((q) => {
          const el = document.querySelector(q);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
          return { o: Number(cs.opacity), y: m.m42 };
        }, selector);
        if (s) { ys.push(s.y); os.push(s.o); }
        await page.waitForTimeout(70);
      }
      if (!ys.length) return null;
      return {
        travel: Math.round(Math.max(...ys) - Math.min(...ys)),
        fade: Math.max(...os) - Math.min(...os),
        end: os[os.length - 1],
      };
    };

    /* 1. A section arriving as the reader scrolls into it. */
    {
      const { ctx, page } = await open();
      const top = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('main section')]
          .find((s) => s.getBoundingClientRect().top > window.innerHeight * 1.4);
        if (!sec) return null;
        // Reveal wraps the section from OUTSIDE, so the wrapper is the parent.
        sec.parentElement?.setAttribute('data-motion-probe', '');
        return sec.getBoundingClientRect().top + window.scrollY;
      });
      if (top === null) {
        failures.push(`${width}: no section below the fold to measure`);
      } else {
        /* Stop exactly one viewport short, not "somewhere near": the reveal
           fires when the section crosses 70% of the screen, and a step loop
           that overshoots by up to 240px starts sampling after it has
           already begun -- which is how this measured 7px one run and 18px
           the next. */
        await page.evaluate((n) => window.scrollTo(0, n), Math.max(0, top - 800));
        await page.waitForTimeout(250);
        const seen = await sample(page, '[data-motion-probe]', 26, 32);
        if (!seen) failures.push(`${width}: the reveal wrapper vanished`);
        else if (seen.travel < MOTION_FLOOR_PX) {
          failures.push(`${width}: a section arrives with ${seen.travel}px of travel`);
        } else if (seen.fade < 0.5) {
          failures.push(`${width}: a section arrives with almost no fade (${seen.fade.toFixed(2)})`);
        }
      }
      await ctx.close();
    }

    /* 2. The building's findings, and its layer story. */
    {
      const { ctx, page } = await open();
      await page.evaluate(() => document.querySelector('#intelligence')
        ?.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const finding = await sample(page, '#intelligence dl > div', 70);
      if (!finding) failures.push(`${width}: the building reports no findings`);
      else if (finding.travel < MOTION_FLOOR_PX) {
        failures.push(`${width}: a building finding arrives with ${finding.travel}px of travel`);
      }

      /* The seven layers and their explanation used to live inside a
         `hidden lg:grid` container, so a phone visitor got the drawing and
         four numbers and never learned what the section was arguing. */
      const rows = await page.evaluate(() => [...document.querySelectorAll('#intelligence li button')]
        .filter((e) => e.getBoundingClientRect().width > 0).length);
      if (rows < 7) failures.push(`${width}: only ${rows} of the seven layers are on the phone`);

      const panel = await page.evaluate(() => [...document.querySelectorAll('#intelligence p')]
        .some((e) => e.getBoundingClientRect().width > 0 && (e.textContent || '').includes(' / ')));
      if (!panel) failures.push(`${width}: the active layer has no explanation on the phone`);

      /* And it moves on its own: the highlight used to walk only from lg up. */
      const walked = await page.evaluate(async () => {
        const lit = () => document.querySelector('#intelligence [aria-current="true"] span:last-child')
          ?.textContent?.trim() ?? null;
        const a = lit();
        await new Promise((r) => setTimeout(r, 4200));
        return a !== lit();
      });
      if (!walked) failures.push(`${width}: the layer highlight does not advance on a phone`);
      await ctx.close();
    }

    /* 3. Property Intelligence tells its story in order. */
    {
      const { ctx, page } = await open();
      await page.evaluate(() => {
        const head = [...document.querySelectorAll('p')]
          .find((e) => /confirmed in/i.test(e.textContent || ''));
        head?.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
      const filled = await page.evaluate(async () => {
        const head = [...document.querySelectorAll('p')]
          .find((e) => /confirmed in/i.test(e.textContent || ''));
        if (!head) return null;
        const panel = head.parentElement;
        const shown = () => [...panel.querySelectorAll('p, li, div')]
          .filter((e) => Number(getComputedStyle(e).opacity) > 0.9).length;
        const first = shown();
        await new Promise((r) => setTimeout(r, 4800));
        return { first, last: shown() };
      });
      if (!filled) failures.push(`${width}: Property Intelligence is not on the page`);
      else if (filled.last <= filled.first) {
        failures.push(`${width}: Property Intelligence arrives all at once (${filled.first} then ${filled.last})`);
      }
      await ctx.close();
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});

/*
 * ── THE BUILDING AND THE WORDS ARE ONE THING ────────────────────────────
 *
 * The owner's report was "the visual animation and explanatory text are not
 * synchronized", and the cause was structural rather than cosmetic: the
 * building kept its own clock (a phase sequence, a pointer, and a timer that
 * walked the floors on a phone) while the section beside it ran a SECOND
 * timer walking the seven intelligence layers and the sentence explaining
 * them. Two clocks, never started together. Within a few seconds the drawing
 * was lighting floor 5 while the paragraph talked about Contract.
 *
 * The building now takes the floor as a prop. This asserts the consequence:
 * the layer number, the layer's name and the lit storey advance on the same
 * tick, because they are the same number.
 *
 * It also pins the composition the owner asked for — drawing and finding
 * SIDE BY SIDE on a phone, not a full-width tower with the text below the
 * fold — at the widths where it is hardest.
 */
test('on a phone the building stands beside its finding, and they move together', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);
  const failures = [];

  for (const [width, lang] of [[390, 'ka'], [320, 'ka'], [375, 'en']]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 840 }, isMobile: true, hasTouch: true,
      reducedMotion: 'no-preference',
    });
    await ctx.addInitScript((l) => window.localStorage.setItem('homatch_lang', l), lang);
    const page = await ctx.newPage();
    await stub(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    await page.evaluate(() => document.querySelector('#intelligence')
      ?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(1200);

    const read = () => page.evaluate(() => {
      const svg = [...document.querySelectorAll('#intelligence svg[role="img"]')]
        .find((e) => e.getBoundingClientRect().width > 0);
      /* The pair is the nearest ancestor laid out as two grid tracks. */
      let row = svg;
      while (row && row !== document.body) {
        if (getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length === 2) break;
        row = row.parentElement;
      }
      if (!row || row === document.body) return null;
      const cols = [...row.children].map((e) => Math.round(e.getBoundingClientRect().width));
      const ps = [...row.children[1].querySelectorAll('p')].map((e) => e.textContent.trim());
      return {
        cols,
        counter: ps[0] ?? null,
        title: ps[1] ?? null,
        /* The first callout is the storey, read off the LIT floor. If the
           drawing and the words disagree, this disagrees with the counter. */
        storey: [...document.querySelectorAll('#intelligence dl dd')]
          .filter((e) => e.getBoundingClientRect().width > 0)[0]?.textContent?.trim() ?? null,
        clipped: [...document.querySelectorAll('#intelligence *')]
          .filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    const first = await read();
    if (!first) {
      failures.push(`${width}/${lang}: the building and its finding are not side by side`);
      await ctx.close();
      continue;
    }

    /* Both columns have to be usable: a drawing under ~100px stops resolving
       into floors, and Georgian under ~140px starts breaking mid-word. */
    const [drawing, words] = first.cols;
    if (drawing < 100) failures.push(`${width}/${lang}: the building is ${drawing}px — too narrow to read as a building`);
    if (words < 140) failures.push(`${width}/${lang}: the finding has ${words}px — Georgian will break mid-word`);
    if (words <= drawing) failures.push(`${width}/${lang}: the text column (${words}px) is not wider than the drawing (${drawing}px)`);
    if (first.clipped) failures.push(`${width}/${lang}: ${first.clipped} clipped elements`);
    if (first.overflow) failures.push(`${width}/${lang}: ${first.overflow}px of horizontal overflow`);

    /* The counter says which layer; the storey says which floor is lit. One
       number produces both, so they must agree — before and after it moves. */
    const agree = (s) => s && s.counter && s.storey
      && s.counter.startsWith(String(Number(s.storey)).padStart(2, '0'));
    if (!agree(first)) {
      failures.push(`${width}/${lang}: layer ${first.counter} is lit on floor ${first.storey}`);
    }

    await page.waitForTimeout(3600);
    const later = await read();
    if (!later || later.title === first.title) {
      failures.push(`${width}/${lang}: the story did not advance on its own`);
    } else if (!agree(later)) {
      failures.push(`${width}/${lang}: after advancing, layer ${later.counter} is lit on floor ${later.storey}`);
    }
    await ctx.close();
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});

/*
 * ── THE APP AFFORDANCE DOES NOT COME AND GO ─────────────────────────────
 *
 * Reported repeatedly: the install control disappears. It did, in two states
 * that are completely ordinary — press "not now" once, or open Homatch as the
 * installed app — because both resolved to one mode that rendered null into a
 * row which had reserved space for it.
 *
 * WHAT THE DEFECT ACTUALLY WAS, NOW THAT ONE STATE HAS CHANGED SIDES
 *
 * Not "the control vanished" -- it was the HOLE. Space reserved for something
 * that renders nothing, so the row keeps a divider and a wide empty rectangle
 * where a button used to be.
 *
 * Inside the installed app the control is now deliberately absent: an app
 * offering to install itself is absurd, and a chip announcing that the app
 * you are looking at exists reports the obvious. That is a different thing
 * from the hole, and the difference is whether the row knows. `hasInstallAction`
 * tells the strip in advance, so the divider goes with the button.
 *
 * So: present and full-size where there is something to offer, cleanly absent
 * where there is not, and the row the same height either way — because a
 * person switching between the app and the website should not see the header
 * change shape.
 */
test('the app affordance is present where it belongs, absent where it does not', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);
  const failures = [];
  const seen = new Map();

  for (const state of ['normal', 'dismissed', 'standalone']) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: 820 }, isMobile: true, hasTouch: true,
      });
      await ctx.addInitScript((s) => {
        window.localStorage.setItem('homatch_lang', 'ka');
        if (s === 'dismissed') {
          window.localStorage.setItem('homatch_install_dismissed_at', String(Date.now()));
        }
        if (s === 'standalone') {
          // What the product reads to decide it is the installed app.
          const real = window.matchMedia.bind(window);
          window.matchMedia = (q) => (q.includes('display-mode: standalone')
            ? {
              matches: true, media: q, onchange: null,
              addEventListener() {}, removeEventListener() {},
              addListener() {}, removeListener() {}, dispatchEvent() { return false; },
            }
            : real(q));
        }
      }, state);
      const page = await ctx.newPage();
      await stub(page);
      await page.goto(`${BASE}/pricing`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);

      const found = await page.evaluate(() => {
        const app = [...document.querySelectorAll('header [aria-label]')]
          .filter((e) => e.getBoundingClientRect().height > 0)
          .find((e) => /Homatch/i.test(e.getAttribute('aria-label') || '')
            && !/home page/i.test(e.getAttribute('aria-label') || '')
            && !(e.getAttribute('aria-label') || '').includes('მთავარი'));
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        /*
         * The HEADER is the thing measured for movement, because it is the
         * same element in every state. Measuring the control's own parent
         * compared two different boxes once the control was gone, and read
         * as a 14px jump that nobody would ever see.
         */
        const header = document.querySelector('header');
        /*
         * And the hole, tested directly: the divider is a hairline, `h-5
         * w-px`. One still standing when the control beside it has gone is
         * the exact defect this file was written for.
         */
        const hairlines = [...(header?.querySelectorAll('span, div') ?? [])]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.width < 4 && r.height > 8).length;
        return {
          present: !!app,
          h: app ? Math.round(app.getBoundingClientRect().height) : 0,
          rowH: header ? Math.round(header.getBoundingClientRect().height) : 0,
          hairlines,
          overflow,
        };
      });

      if (found.overflow) failures.push(`${state} @${width}: ${found.overflow}px overflow`);

      if (state === 'standalone') {
        /* Absent by instruction. An installed app must not carry a control
           for installing itself. */
        if (found.present) {
          failures.push(`${state} @${width}: the installed app still carries an install affordance`);
        }
        if (found.hairlines > 0) {
          failures.push(`${state} @${width}: ${found.hairlines} divider(s) left beside nothing — the hole`);
        }
      } else if (!found.present) {
        failures.push(`${state} @${width}: no app affordance at all`);
      } else if (found.h < 36) {
        failures.push(`${state} @${width}: the control is ${found.h}px tall`);
      }

      if (found.rowH) {
        const key = `@${width}`;
        const before = seen.get(key);
        if (before === undefined) seen.set(key, found.rowH);
        else if (before !== found.rowH) {
          failures.push(`${state} @${width}: the row is ${found.rowH}px here and ${before}px in another state — it jumps`);
        }
      }
      await ctx.close();
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
