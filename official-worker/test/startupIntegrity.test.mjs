import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * STARTUP INTEGRITY — production incident 2026-09-08, jobs aaf11509…,
 * 785134fd… and 9bd269c2-b6a3-49ee-aec1-e09f462131ca.
 *
 * The live Railway service ran a dashboard start-command override,
 * `node scripts/apply-live-browser-patch.mjs --run`, which rewrote
 * src/index.ts at container boot and injected a LEGACY
 * `POST /research/:id/live` handler ahead of the real one. Express dispatches
 * to the first matching route, so every production POST to that path hit a
 * handler that 404s whenever there is no WAITING_HUMAN session — always true
 * for a RUNNING visualWatch job. Deployment 2273a16b's own logs proved it:
 *
 *   Starting Container
 *   patched src/index.ts
 *   starting patched Homatch worker
 *
 * These tests make both halves of that failure impossible to reintroduce
 * silently: no startup script may mutate source, and the app may register
 * exactly one handler per live route.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const SCRIPTS_DIR = `${here}../scripts`;
const indexSource = readFileSync(`${here}../src/index.ts`, 'utf8');

/* ------------------------------------------------------------------ *
 * No startup script may mutate source.                                *
 * ------------------------------------------------------------------ */

test('no script may mutate src/, and nothing on the startup path writes at all', () => {
  const scripts = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'));
  assert.equal(scripts.length > 0, true, 'scripts/ must be scanned');

  // The startup path is the Dockerfile CMD plus package.json's start script.
  // Nothing there may reference a script at all — the app starts directly.
  const dockerfile = readFileSync(`${here}../Dockerfile`, 'utf8');
  const pkg = JSON.parse(readFileSync(`${here}../package.json`, 'utf8'));
  const cmdLines = dockerfile.split(/\r?\n/).filter((l) => l.trim().startsWith('CMD')).join(' ');
  const startupPath = `${cmdLines} ${pkg.scripts.start}`;
  for (const name of scripts) {
    assert.equal(startupPath.includes(name), false, `${name} must not be on the startup path`);
  }

  for (const name of scripts) {
    const source = readFileSync(`${SCRIPTS_DIR}/${name}`, 'utf8');
    // Comments explain the old behaviour; code must not perform it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The historical bug: rewriting application source. Banned outright,
    // whether at startup or from a maintenance tool.
    assert.equal(/readFileSync\(\s*['"`]src\/|readFile\(\s*['"`]src\//.test(code), false, `${name} must not read src/ for patching`);
    assert.equal(/['"`]src\/index\.ts['"`]/.test(code), false, `${name} must not target src/index.ts`);
    assert.equal(code.includes("patch('src/index.ts'"), false, `${name} must not patch src/index.ts`);
    // A maintenance tool may write, but only outside src/.
    for (const m of code.matchAll(/write(?:File)?(?:Sync)?\(\s*([^,)]+)/g)) {
      assert.equal(/['"`]src\//.test(m[1]), false, `${name} must never write into src/`);
    }
  }
});

test('the quarantined live-browser patch script is inert but still bootable', () => {
  const source = readFileSync(`${SCRIPTS_DIR}/apply-live-browser-patch.mjs`, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // It injects no routes any more.
  assert.equal(code.includes('app.post('), false, 'the script must not inject routes');
  assert.equal(code.includes('app.get('), false);
  assert.equal(code.includes('Browserless.liveURL'), false);
  assert.equal(code.includes('browserRuntime'), false);
  // A stale start-command override must still boot the real worker rather
  // than crash the container.
  assert.match(code, /--run/);
  assert.match(code, /await import\('\.\.\/src\/index\.ts'\)/);
  // And it announces itself, so a stale override is visible in deploy logs.
  assert.match(code, /legacy_patch_script_disabled/);
  // The exact strings whose presence in deploy logs means the old patcher ran.
  assert.equal(source.includes("'patched src/index.ts'"), false);
  assert.equal(source.includes("'starting patched Homatch worker'"), false);
});

/* ------------------------------------------------------------------ *
 * The real live route may never be shadowed.                          *
 * ------------------------------------------------------------------ */

test('no route is registered twice — a duplicate would shadow the real handler', () => {
  const registrations = [...indexSource.matchAll(/app\.(get|post)\('([^']+)'/g)].map(([, verb, route]) => `${verb} ${route}`);
  const seen = new Set();
  for (const r of registrations) {
    assert.equal(seen.has(r), false, `duplicate handler registered for ${r}`);
    seen.add(r);
  }
  // The Browserless live-view endpoints are gone with the Browserless runtime.
  assert.equal(indexSource.includes("'/research/:id/live'"), false, 'the Browserless live route must not come back');
});

test('human CAPTCHA interaction is served by the screenshot/action routes against the live Page', () => {
  // The pre-Browserless, proven mechanism (ae74a228), restored as the only
  // human-interaction transport.
  assert.match(indexSource, /app\.get\('\/research\/:id\/screenshot',\s*auth,/);
  assert.match(indexSource, /app\.post\('\/research\/:id\/action',\s*auth,/);
  const screenshot = indexSource.slice(indexSource.indexOf("app.get('/research/:id/screenshot'"), indexSource.indexOf("app.post('/research/:id/action'"));
  assert.match(screenshot, /orchestrator\.getSession\(req\.params\.id\)/);
  assert.match(screenshot, /s\.page\.screenshot\(/, 'must screenshot the EXACT preserved page');
  // No Browserless anything in the HTTP layer.
  assert.equal(/['"`]Browserless\.liveURL['"`]/.test(indexSource), false);
  assert.equal(indexSource.includes('timeout: 900000'), false);
  // No Browserless in CODE (comments explaining the removal are fine, and the
  // deprecated /health/browserless alias path is allowed by name only).
  const indexCode = indexSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'\/health\/browserless'/g, '');
  assert.equal(/browserless/i.test(indexCode), false, 'no Browserless code may remain in the HTTP layer');
});

test('the health payload advertises the local runtime, and /health/browserless is a deprecated LOCAL alias', () => {
  // `browserRuntime` was once injected by the startup patcher with the value
  // 'browserless-cdp'. It is now a real source field with the local value —
  // seeing 'browserless-cdp' in a live /health again would mean the patcher
  // is back.
  assert.match(indexSource, /browserRuntime: 'local-playwright-chromium'/);
  assert.equal(indexSource.includes("'browserless-cdp'"), false);
  assert.match(indexSource, /humanVerificationTransport: 'screenshot\+action'/);
  // /health/browser is the real local Chromium smoke test; /health/browserless
  // survives only as a deprecated alias that runs the SAME local check and
  // never contacts Browserless.
  assert.match(indexSource, /app\.get\('\/health\/browser', browserHealthHandler\)/);
  assert.match(indexSource, /app\.get\('\/health\/browserless', \(req: any, res: any\)/);
  const probe = indexSource.slice(
    indexSource.indexOf('async function browserHealthHandler('),
    indexSource.indexOf("app.post('/research', auth")
  );
  assert.match(probe, /localBrowserHealth\(\)/, 'must run the local Chromium probe');
  assert.match(probe, /BROWSER_PROBE_TTL_MS/, 'probe must be cached so it cannot spawn Chromium repeatedly');
  assert.equal(/token|cookie|userDataDir|profile/i.test(probe), false, 'no secret or profile path may be serialized');
  assert.match(probe, /Deprecation/, 'the alias must announce itself as deprecated');
});

test('the Dockerfile CMD is the authoritative entrypoint and does not invoke the patcher', () => {
  const dockerfile = readFileSync(`${here}../Dockerfile`, 'utf8');
  const cmd = dockerfile.split('\n').filter((l) => l.trim().startsWith('CMD')).join('\n');
  assert.match(cmd, /npm","start"/);
  assert.equal(cmd.includes('apply-live-browser-patch'), false, 'the image must never start the patcher');
});
