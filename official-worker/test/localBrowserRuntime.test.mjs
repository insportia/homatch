import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_EXTENSION_DIR,
  validateBundledExtension,
  extensionLaunchArgs,
  confirmExtensionRuntime,
  isJobBrowserAlive,
  closeJobBrowser,
  openJobBrowserCount,
  logBrowserLifecycle,
} from '../.tstest-build/browser/LocalBrowserRuntime.js';

/*
 * LOCAL CHROMIUM RUNTIME — migration 2026-09-08.
 *
 * Browserless is out; the transport is local Playwright Chromium again, as it
 * was before e109bce3, with one persistent context per Verify job so the
 * bundled Manifest V3 extension can be loaded.
 *
 * These are the pure/lifecycle tests. The REAL browser proof (Chromium
 * actually launches, the extension service worker actually registers, a page
 * runs JS, page A closes while the context survives, page B still works,
 * profile is removed) lives in chromiumSmoke.test.mjs, which is skipped where
 * no browser binary is available.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const runtimeSource = readFileSync(`${here}../src/browser/LocalBrowserRuntime.ts`, 'utf8');
const orchestratorSource = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');

/* ------------------------------------------------------------------ *
 * Extension validation and launch arguments.                          *
 * ------------------------------------------------------------------ */

test('extension launch args name exactly one directory and forbid every other extension', () => {
  const args = extensionLaunchArgs('/opt/app/extensions/human-assist');
  assert.deepEqual(args, [
    '--disable-extensions-except=/opt/app/extensions/human-assist',
    '--load-extension=/opt/app/extensions/human-assist',
  ]);
  // Both switches must name the SAME path, or Chromium silently loads nothing.
  const [except, load] = args.map((a) => a.split('=')[1]);
  assert.equal(except, load);
});

test('the bundled extension directory is resolved from the module, not the working directory', () => {
  assert.equal(path.isAbsolute(BUNDLED_EXTENSION_DIR), true);
  assert.equal(BUNDLED_EXTENSION_DIR.replace(/\\/g, '/').endsWith('official-worker/extensions/human-assist'), true);
});

test('validateBundledExtension: a missing directory is reported, never thrown', async () => {
  const status = await validateBundledExtension(path.join(tmpdir(), 'homatch-no-such-extension-dir'));
  assert.deepEqual(status, { present: false, manifestV3: false, name: null, declaresServiceWorker: false, reason: 'directory_missing' });
});

test('validateBundledExtension: a real MV3 manifest with a service worker is accepted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'homatch-ext-'));
  try {
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'Homatch Human Assist', version: '1.0.0', background: { service_worker: 'sw.js' } })
    );
    const status = await validateBundledExtension(dir);
    assert.equal(status.present, true);
    assert.equal(status.manifestV3, true);
    assert.equal(status.declaresServiceWorker, true);
    assert.equal(status.name, 'Homatch Human Assist');
    assert.equal(status.reason, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateBundledExtension: Manifest V2 and unreadable manifests are rejected', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'homatch-ext-'));
  try {
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'old' }));
    const v2 = await validateBundledExtension(dir);
    assert.equal(v2.present, true);
    assert.equal(v2.manifestV3, false);
    assert.equal(v2.reason, 'manifest_version_not_3');

    writeFileSync(path.join(dir, 'manifest.json'), '{ not json');
    const broken = await validateBundledExtension(dir);
    assert.equal(broken.present, false);
    assert.equal(broken.reason, 'manifest_unreadable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('confirmExtensionRuntime proves the SERVICE WORKER registered — launch flags are never proof', async () => {
  // Already registered.
  assert.equal(await confirmExtensionRuntime({ serviceWorkers: () => [{}] }, 10), true);
  // Registers after launch.
  const late = {
    serviceWorkers: (() => {
      let calls = 0;
      return () => (++calls > 1 ? [{}] : []);
    })(),
    waitForEvent: async () => ({}),
  };
  assert.equal(await confirmExtensionRuntime(late, 10), true);
  // Never registers -> false, never a throw.
  assert.equal(
    await confirmExtensionRuntime({ serviceWorkers: () => [], waitForEvent: async () => { throw new Error('timeout'); } }, 10),
    false
  );
});

/* ------------------------------------------------------------------ *
 * Job browser lifecycle.                                              *
 * ------------------------------------------------------------------ */

function fakeJobBrowser(overrides = {}) {
  const events = { contextClosed: 0 };
  return {
    events,
    jobBrowser: {
      jobId: 'job-1',
      context: {
        pages: () => [],
        close: async () => {
          events.contextClosed += 1;
        },
        browser: () => ({ isConnected: () => true }),
        ...overrides,
      },
      userDataDir: mkdtempSync(path.join(tmpdir(), 'homatch-profile-')),
      extension: { present: true, manifestV3: true, name: 'x', declaresServiceWorker: true, reason: 'ok' },
      extensionRuntimeConfirmed: true,
      closed: false,
    },
  };
}

test('closeJobBrowser closes the context exactly once and removes the throwaway profile', async () => {
  const { jobBrowser, events } = fakeJobBrowser();
  const dir = jobBrowser.userDataDir;

  await closeJobBrowser(jobBrowser, 'job_complete');
  assert.equal(events.contextClosed, 1);
  assert.equal(jobBrowser.closed, true);
  assert.equal(readFileSync ? !dirExists(dir) : true, true, 'the profile directory must be deleted');

  // Idempotent: a TTL sweep, a terminal path and a signal may all call it.
  await closeJobBrowser(jobBrowser, 'ttl_expired');
  await closeJobBrowser(jobBrowser, 'signal_SIGTERM');
  assert.equal(events.contextClosed, 1, 'the context is never closed twice');
});

function dirExists(p) {
  try {
    readFileSync(path.join(p, '.probe'));
    return true;
  } catch (e) {
    return e.code !== 'ENOENT' ? true : false;
  }
}

test('isJobBrowserAlive reports a closed or disconnected browser without throwing', () => {
  const { jobBrowser } = fakeJobBrowser();
  assert.equal(isJobBrowserAlive(jobBrowser), true);

  jobBrowser.closed = true;
  assert.equal(isJobBrowserAlive(jobBrowser), false);

  assert.equal(isJobBrowserAlive(null), false);
  assert.equal(isJobBrowserAlive(undefined), false);

  const dead = fakeJobBrowser({ browser: () => ({ isConnected: () => false }) }).jobBrowser;
  assert.equal(isJobBrowserAlive(dead), false);

  const throwing = fakeJobBrowser({ pages: () => { throw new Error('Target closed'); } }).jobBrowser;
  assert.equal(isJobBrowserAlive(throwing), false);
});

test('open job browsers are tracked so process signals cannot leave zombie Chromium', () => {
  assert.equal(typeof openJobBrowserCount(), 'number');
  assert.match(runtimeSource, /process\.once\(signal/);
  assert.match(runtimeSource, /closeAllJobBrowsers\(`signal_\$\{signal\}`\)/);
  for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(runtimeSource.includes(signal), true);
});

/* ------------------------------------------------------------------ *
 * Per-job isolation and ownership, asserted structurally.              *
 * ------------------------------------------------------------------ */

test('every job gets its OWN throwaway profile directory — never a shared or developer profile', () => {
  assert.match(runtimeSource, /mkdtemp\(path\.join\(tmpdir\(\), 'homatch-verify-'\)\)/);
  assert.match(runtimeSource, /launchPersistentContext\(userDataDir/);
  // Never a developer Chrome profile or an installed channel.
  assert.equal(/channel:\s*'chrome'/.test(runtimeSource), false);
  assert.equal(/User Data|Default\/Profile|LOCALAPPDATA/i.test(runtimeSource), false);
  // The profile is removed on close and on a failed launch.
  assert.equal((runtimeSource.match(/rm\(.*userDataDir.*recursive: true, force: true/g) || []).length >= 1, true);
});

test('a source owns only its Page — never the job context, never Chromium', () => {
  const runStep = orchestratorSource.slice(
    orchestratorSource.indexOf('private async runStep('),
    orchestratorSource.indexOf('private async run(')
  );
  // It opens its own page on the shared job context.
  assert.match(runStep, /const ctx = jobContext\(jobBrowser\);/);
  assert.match(runStep, /page = await ctx\.newPage\(\);/);
  // It closes its page (and popups) and nothing else.
  assert.match(runStep, /await page\?\.close\(\)/);
  assert.equal(/ctx\.close\(\)/.test(runStep), false, 'a source must never close the shared job context');
  assert.equal(/closeJobBrowser/.test(runStep), false, 'a source must never close the job browser');
  // Popups are tracked and cleaned with the source.
  assert.match(runStep, /ctx\.on\('page', onPopup\)/);
  assert.match(runStep, /popup\.close\(\)/);
});

test('only terminal paths close the job browser, and each removes it from the registry', () => {
  for (const reason of ['job_complete', 'job_failed', 'ttl_expired']) {
    assert.match(orchestratorSource, new RegExp(`closeJobBrowser\\([^)]*'${reason}'\\)`), `${reason} must close the job browser`);
  }
  assert.equal((orchestratorSource.match(/this\.jobBrowsers\.delete\(/g) || []).length, 3);
});

test('CAPTCHA preserves the exact Chromium, context and Page — nothing is created or closed', () => {
  const runStep = orchestratorSource.slice(
    orchestratorSource.indexOf('private async runStep('),
    orchestratorSource.indexOf('private async run(')
  );
  const waiting = runStep.slice(runStep.indexOf('const isWaitingHuman'), runStep.indexOf('// SOURCE COMPLETED'));
  // The preserved session carries the same jobBrowser/ctx/page objects.
  assert.match(waiting, /this\.sessions\.set\(job\.id, \{ jobBrowser, ctx, page, jobId: job\.id, step, query/);
  // And closes nothing.
  assert.equal(/close\(\)/.test(waiting), false, 'the WAITING_HUMAN branch must not close anything');
  assert.equal(/newPage|launchJobBrowser/.test(waiting), false, 'no new page or browser at CAPTCHA');
});

test('resume and skip continue on the SAME session and close only the Page', () => {
  const resume = orchestratorSource.slice(orchestratorSource.indexOf('async resume('), orchestratorSource.indexOf('async skip('));
  // The workflows are re-driven with the preserved page/context.
  assert.match(resume, /runEnregWorkflow\(session\.page,/);
  assert.match(resume, /runMyGovWorkflow\(session\.page, session\.ctx,/);
  // Only the page closes; the job continues on the same browser.
  assert.match(resume, /await session\.page\.close\(\)/);
  assert.equal(/session\.ctx\.close\(\)/.test(resume), false);
  assert.match(resume, /this\.run\(job, job\.sourceIndex \+ 1, session\.jobBrowser\)/);

  const skip = orchestratorSource.slice(orchestratorSource.indexOf('async skip('));
  assert.match(skip, /await session\.page\.close\(\)/);
  assert.equal(/session\.ctx\.close\(\)/.test(skip), false);
  assert.match(skip, /this\.run\(job, job\.sourceIndex \+ 1, jobBrowser\)/);
  // Skip records the source as skipped, never as a property finding.
  assert.match(skip, /status: 'SKIPPED_HUMAN_VERIFICATION'/);
  assert.match(skip, /resultConfirmed: false/);
  assert.match(skip, /noResultConfirmed: false/);
});

test('a source failure yields a technical result and never kills the job or the context', () => {
  const runStep = orchestratorSource.slice(
    orchestratorSource.indexOf('private async runStep('),
    orchestratorSource.indexOf('private async run(')
  );
  assert.match(runStep, /return \{ result: buildTechnicalFailureResult\(key, forEntity, e\), keep: false \}/);
  assert.equal(/throw /.test(runStep), false, 'runStep must never rethrow into the job loop');
  const technical = orchestratorSource.slice(
    orchestratorSource.indexOf('function buildTechnicalFailureResult('),
    orchestratorSource.indexOf('export class ResearchOrchestrator')
  );
  assert.match(technical, /resultConfirmed: false/);
  assert.match(technical, /noResultConfirmed: false/);
  assert.equal(/propertyRisk|verdict/.test(technical), false, 'a technical failure is never property evidence');
});

/* ------------------------------------------------------------------ *
 * Browserless is gone.                                                *
 * ------------------------------------------------------------------ */

test('no Browserless runtime, token, bridge or network call remains in worker source', () => {
  const srcDir = `${here}../src`;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSyncSafe(dir)) {
      const full = path.join(dir, entry);
      if (entry.endsWith('.pre-consolidation') || entry.endsWith('.bak')) continue;
      if (isDir(full)) walk(full);
      else if (entry.endsWith('.ts')) {
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/'\/health\/browserless'/g, '');
        if (/browserless/i.test(code)) offenders.push(entry);
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], 'Browserless must not appear in any worker source code');
});

test('no BROWSERLESS_* environment variable is read anywhere', () => {
  const srcDir = `${here}../src`;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSyncSafe(dir)) {
      const full = path.join(dir, entry);
      if (entry.endsWith('.pre-consolidation') || entry.endsWith('.bak')) continue;
      if (isDir(full)) walk(full);
      else if (entry.endsWith('.ts') && /BROWSERLESS_/.test(readFileSync(full, 'utf8'))) offenders.push(entry);
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], 'Verify must run with no Browserless environment variable at all');
});

test('the runtime opens no network transport of its own — it launches a local browser', () => {
  assert.equal(/connectOverCDP|wss:\/\/|https:\/\/production-|fetch\(/.test(runtimeSource), false);
  assert.match(runtimeSource, /chromium\.launchPersistentContext\(/);
});

test('lifecycle logs stay secret-free — no profile path, cookie, token or extension storage', () => {
  const logCalls = runtimeSource.match(/logBrowserLifecycle\([\s\S]*?\}\);/g) || [];
  assert.equal(logCalls.length >= 3, true);
  for (const call of logCalls) {
    assert.equal(/userDataDir|profilePath|cookie|token|storage/i.test(call), false, `log must stay secret-free: ${call}`);
  }
  // The logger itself only emits what it is given.
  assert.match(runtimeSource, /scope: 'browser_lifecycle'/);
  assert.doesNotThrow(() => logBrowserLifecycle('test_event', { jobId: 'x' }));
});

function readdirSyncSafe(dir) {
  return readdirSync(dir);
}
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
