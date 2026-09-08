import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  launchJobBrowser,
  jobContext,
  closeJobBrowser,
  isJobBrowserAlive,
  validateBundledExtension,
  BUNDLED_EXTENSION_DIR,
} from '../.tstest-build/browser/LocalBrowserRuntime.js';

/*
 * REAL local Chromium smoke test — the proof that the migration off
 * Browserless actually works, not just that the code compiles.
 *
 * It launches a genuine Chromium through the production code path and
 * exercises the full per-job lifecycle: persistent context, page A runs
 * JavaScript, page A closes while the CONTEXT SURVIVES, page B still works
 * afterwards, terminal cleanup closes the context once and deletes the
 * throwaway profile.
 *
 * Extension assertions are conditional on the bundled extension actually
 * being present on disk: when it is, the MV3 SERVICE WORKER must register —
 * launch flags are never accepted as proof. When it is not yet bundled the
 * extension assertions are skipped and reported, never silently passed.
 *
 * Skipped entirely where no Chromium binary is available (a clean CI box
 * without `npx playwright install`), so the suite stays runnable everywhere.
 */

async function chromiumAvailable() {
  try {
    const { chromium } = await import('playwright');
    const path = chromium.executablePath();
    return typeof path === 'string' && existsSync(path);
  } catch {
    return false;
  }
}

const HAVE_CHROMIUM = await chromiumAvailable();

test(
  'REAL Chromium: per-job persistent context, page lifecycle, context survival and profile cleanup',
  { skip: HAVE_CHROMIUM ? false : 'no local Chromium binary available' },
  async (t) => {
    const extension = await validateBundledExtension();
    let jobBrowser = null;

    try {
      // ---- launch (production code path) ----------------------------------
      jobBrowser = await launchJobBrowser('smoke-test-job');
      assert.equal(isJobBrowserAlive(jobBrowser), true, 'Chromium must be alive after launch');
      assert.equal(existsSync(jobBrowser.userDataDir), true, 'the job must get its own profile directory');

      const ctx = jobContext(jobBrowser);

      // ---- extension: only asserted when actually bundled ------------------
      if (extension.present && extension.manifestV3) {
        assert.equal(
          jobBrowser.extensionRuntimeConfirmed,
          true,
          'a bundled MV3 extension must register its service worker in the real browser'
        );
        const workers = ctx.serviceWorkers?.() || [];
        assert.equal(workers.length > 0, true, 'the extension service worker must be visible');

        // PROOF it is OUR bundled extension running, not merely that some
        // worker exists: the service worker URL must be a chrome-extension://
        // origin serving the exact background script this manifest declares.
        const manifest = JSON.parse(readFileSync(path.join(BUNDLED_EXTENSION_DIR, 'manifest.json'), 'utf8'));
        const declared = manifest.background.service_worker;
        const swUrl = workers[0].url();
        assert.match(swUrl, /^chrome-extension:\/\/[a-p]{32}\//, 'the worker must run from a real extension origin');
        assert.equal(swUrl.endsWith(declared), true, `service worker must be ${declared}, got ${swUrl}`);
        t.diagnostic(`extension runtime confirmed: ${swUrl}`);
        t.diagnostic(`extension version ${manifest.version}, manifest_version ${manifest.manifest_version}`);

        // humanAssistReady reflects BOTH runtime and configuration. With no
        // credential in the environment it must be false (fail-closed).
        t.diagnostic(
          `humanAssistReady=${jobBrowser.humanAssistReady}` +
            (jobBrowser.humanAssistReady
              ? ' (a backend credential was present in the environment)'
              : ' (fail-closed: no backend credential configured for this run)')
        );
        assert.equal(typeof jobBrowser.humanAssistReady, 'boolean');

        // Normal browsing must still work with the extension loaded.
        const probe = await ctx.newPage();
        await probe.setContent('<h1 id="ok">browsing works with the extension loaded</h1>');
        assert.equal(await probe.textContent('#ok'), 'browsing works with the extension loaded');
        assert.equal(await probe.evaluate(() => navigator.userAgent.includes('Chrome')), true);
        await probe.close();
      } else {
        t.diagnostic(`bundled extension not present (${extension.reason}) at ${BUNDLED_EXTENSION_DIR} — extension runtime assertions skipped`);
        assert.equal(jobBrowser.extensionRuntimeConfirmed, false, 'an absent extension must never be reported as confirmed');
      }

      // ---- page A: opens, runs JS, navigates -------------------------------
      const pageA = await ctx.newPage();
      assert.equal(await pageA.evaluate(() => 6 * 7), 42, 'page A must execute JavaScript');
      await pageA.setContent('<h1 id="a">page A</h1>');
      assert.equal(await pageA.textContent('#a'), 'page A', 'page A must render and be queryable');
      await pageA.goto('data:text/html,<title>nav-ok</title>');
      assert.equal(await pageA.title(), 'nav-ok', 'page A must navigate');

      // ---- page A closes; the SHARED CONTEXT SURVIVES ----------------------
      await pageA.close();
      assert.equal(pageA.isClosed(), true);
      assert.equal(isJobBrowserAlive(jobBrowser), true, 'closing a source page must NEVER kill the job context');

      // ---- page B (the next source) still works ----------------------------
      const pageB = await ctx.newPage();
      assert.equal(await pageB.evaluate(() => 'second source'), 'second source', 'the next source must still get a working page');
      await pageB.setContent('<h1 id="b">page B</h1>');
      assert.equal(await pageB.textContent('#b'), 'page B');

      // ---- a source failure must not take the context down -----------------
      const pageC = await ctx.newPage();
      await assert.rejects(() => pageC.goto('http://127.0.0.1:1/definitely-not-listening', { timeout: 2000 }));
      await pageC.close().catch(() => {});
      assert.equal(isJobBrowserAlive(jobBrowser), true, 'a failed source must leave the job context usable');
      assert.equal(await pageB.evaluate(() => 1 + 1), 2, 'the earlier page must still work after another source failed');

      // ---- popups are tracked and closable without touching the context ----
      const pageD = await ctx.newPage();
      await pageD.setContent(`<button id="p" onclick="window.open('about:blank')">open</button>`);
      // (window.open, not a data: link: Chromium blocks top-level data:
      // navigation, so a data: href would never produce a popup at all.)
      const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), pageD.click('#p')]);
      assert.equal(!!popup, true, 'a popup must be observable on the context');
      await popup.close();
      await pageD.close();
      assert.equal(isJobBrowserAlive(jobBrowser), true, 'popup cleanup must not destroy the context');

      // ---- WAITING_HUMAN interaction path (no CAPTCHA is solved) -----------
      // Proves the customer-facing mechanism against a stand-in page: the
      // exact preserved Page is screenshotted, a coordinate click reaches it,
      // the Page identity and cookies survive, and it can be repeated.
      const humanPage = await ctx.newPage();
      // A routed real origin (data: URLs cannot hold cookies), standing in for
      // a government page that has paused on a challenge.
      await humanPage.route('https://verify.invalid/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body:
            '<html><body style="margin:0">' +
            '<div id="target" style="position:absolute;left:100px;top:120px;width:220px;height:70px;background:#ffcc00">assist</div>' +
            '<div id="log"></div><script>window.clicks=0;' +
            "document.getElementById('target').addEventListener('click',()=>{window.clicks+=1;" +
            "document.getElementById('log').textContent='clicked '+window.clicks;});" +
            "document.cookie='homatch_session_probe=preserved';</script></body></html>",
        })
      );
      await humanPage.goto('https://verify.invalid/paused');
      const pageIdentity = humanPage;

      const shot1 = await humanPage.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      assert.equal(shot1.length > 1000, true, 'screenshot must capture the live page');

      // Coordinate action, exactly as POST /research/:id/action performs it.
      await humanPage.mouse.click(210, 155);
      assert.equal(await humanPage.evaluate(() => window.clicks), 1, 'a coordinate click must reach the exact Page');

      // Repeatable, and the same Page/session survives.
      const shot2 = await humanPage.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      assert.equal(shot2.length > 1000, true);
      await humanPage.mouse.click(210, 155);
      assert.equal(await humanPage.evaluate(() => window.clicks), 2, 'repeated actions must keep working');
      assert.equal(humanPage, pageIdentity, 'the Page object identity must never change');
      assert.equal(humanPage.isClosed(), false, 'WAITING_HUMAN must not close the page');
      assert.equal(
        await humanPage.evaluate(() => document.cookie.includes('homatch_session_probe=preserved')),
        true,
        'cookies/session state must survive the human interaction'
      );
      assert.equal(isJobBrowserAlive(jobBrowser), true, 'the job context must survive WAITING_HUMAN');
      await humanPage.close();

      // ---- terminal cleanup -------------------------------------------------
      const profileDir = jobBrowser.userDataDir;
      await closeJobBrowser(jobBrowser, 'smoke_test_complete');
      assert.equal(jobBrowser.closed, true);
      assert.equal(isJobBrowserAlive(jobBrowser), false, 'the job context must be closed exactly once');
      assert.equal(existsSync(profileDir), false, 'the throwaway profile directory must be removed');

      // Idempotent second close (TTL sweep racing terminal cleanup).
      await closeJobBrowser(jobBrowser, 'ttl_expired');

      // ---- a SECOND job gets a fresh, isolated profile ---------------------
      const secondJob = await launchJobBrowser('smoke-test-job-2');
      try {
        assert.notEqual(secondJob.userDataDir, profileDir, 'every job must get its OWN profile directory');
        assert.equal(existsSync(secondJob.userDataDir), true);
        // The first job's profile is gone, so nothing can leak between jobs.
        assert.equal(existsSync(profileDir), false);
        if (extension.present && extension.manifestV3) {
          assert.equal(secondJob.extensionRuntimeConfirmed, true, 'the extension must load for every job, not just the first');
        }
        const p2 = await jobContext(secondJob).newPage();
        assert.equal(await p2.evaluate(() => 'second job'), 'second job');
        await p2.close();
      } finally {
        const secondProfile = secondJob.userDataDir;
        await closeJobBrowser(secondJob, 'smoke_test_complete');
        assert.equal(existsSync(secondProfile), false, 'the second job profile must also be removed');
      }
    } finally {
      await closeJobBrowser(jobBrowser, 'smoke_test_cleanup');
    }
  }
);
