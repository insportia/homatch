import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  assert.match(cmd, /docker-entrypoint\.sh/, 'the image must boot through the canonical entrypoint');
  assert.equal(cmd.includes('apply-live-browser-patch'), false, 'the image must never start the patcher');
  // The entrypoint must actually be in the image.
  assert.match(dockerfile, /COPY docker-entrypoint\.sh/);
});

/* ------------------------------------------------------------------ *
 * The container entrypoint — production incident 2026-09-08.          *
 *                                                                     *
 * `xvfb-run -a npm start` sent every xauth/Xvfb diagnostic to its     *
 * default ERRORFILE (/dev/null) and blocked waiting for the X         *
 * readiness signal, producing containers that were alive, completely  *
 * silent and never bound their port. It also placed npm and xvfb-run  *
 * between PID 1 and Node, so SIGTERM never reached the process whose  *
 * handlers delete Chromium profiles.                                  *
 * ------------------------------------------------------------------ */

const entrypoint = readFileSync(`${here}../docker-entrypoint.sh`, 'utf8');
// The header documents the incident verbatim — including the exact broken
// commands it replaces — so every "must NOT appear" assertion runs against
// executable lines only, never the explanation.
const entrypointCode = entrypoint
  .split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

test('no script may re-create the blind xvfb-run launcher chain', () => {
  /*
   * a13f53a4 ("Add deterministic Railway production launcher") added
   * scripts/start-production.mjs, which did
   *
   *     spawn('xvfb-run', ['-a', 'npm', 'start'], { stdio: 'inherit' })
   *
   * and forwarded SIGTERM/SIGINT to that child. It was removed during the
   * reconciliation, for three evidenced reasons:
   *
   *  1. It reinstates `xvfb-run`, whose default ERRORFILE is /dev/null and
   *     which routes ALL xauth/Xvfb output to it — the exact reason the
   *     failing containers were silent.
   *  2. Its signal forwarding cannot work. xvfb-run installs traps only for
   *     EXIT and USR1 (Debian xorg-server, debian/local/xvfb-run lines 159
   *     and 180) and runs the command as a plain foreground child, so a
   *     SIGTERM delivered to the xvfb-run PID is never forwarded to npm or
   *     to node. Node's cleanup handlers still could not run, and Chromium
   *     processes and profile directories would still leak on shutdown.
   *  3. It made the chain LONGER, not shorter: node -> xvfb-run -> npm ->
   *     node, four layers under PID 1.
   *
   * It was also referenced by nothing — an orphan that only becomes live
   * through a Railway dashboard start-command override, which is precisely
   * the coupling that caused this incident in the first place.
   */
  assert.equal(existsSync(`${SCRIPTS_DIR}/start-production.mjs`), false, 'the xvfb-run launcher must not come back');

  for (const name of readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'))) {
    const code = readFileSync(`${SCRIPTS_DIR}/${name}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/xvfb-run/.test(code), false, `${name} must not invoke the blind xvfb-run wrapper`);
    assert.equal(/spawn\(|execFile\(|fork\(/.test(code), false, `${name} must not spawn the application as a child process`);
    // A standalone quoted `npm` token, i.e. an argv entry — not the words
    // "npm start" appearing inside an explanatory message string.
    assert.equal(/(['"`])npm\1/.test(code), false, `${name} must not put npm on the signal path`);
  }
});

test('the entrypoint is observable: it logs before, during and after bringing up the display', () => {
  for (const event of ['container_started', 'env_surface', 'exec_app']) {
    assert.match(entrypoint, new RegExp(`emit ${event}\\b`), `${event} must always be logged`);
  }
  // Both display outcomes are reported — a failure may never be silent.
  assert.match(entrypoint, /emit xvfb_ready\b/);
  assert.match(entrypoint, /emit xvfb_unavailable\b/);
  // The exact defect that hid the incident: the X server's own output must
  // reach stdout/stderr, never a discard. (Checked on the Xvfb INVOCATION
  // line — `command -v Xvfb >/dev/null` is a presence probe, not the server.)
  const launch = entrypointCode.split('\n').find((l) => /^\s*Xvfb "/.test(l));
  assert.equal(typeof launch, 'string', 'the entrypoint must launch Xvfb itself');
  assert.equal(/\/dev\/null|>&\s*3/.test(launch), false, `Xvfb output must never be discarded: ${launch}`);
  assert.equal(entrypointCode.includes('xvfb-run'), false, 'the blind xvfb-run wrapper must not come back');
});

test('the entrypoint execs Node directly so SIGTERM reaches the process that cleans up Chromium', () => {
  assert.match(entrypointCode, /^exec node --import tsx src\/index\.ts$/m, 'the app must be exec-ed, not spawned');
  // npm must not sit between PID 1 and Node: it does not forward signals.
  assert.equal(/exec npm|npm start|npm run/.test(entrypointCode), false, 'npm must not be on the container signal path');
});

test('the entrypoint always starts the HTTP server, even when the display fails', () => {
  // The exec is unconditional: it is not nested inside the Xvfb branch, so a
  // display failure degrades the browser, never the whole service.
  const execIndex = entrypoint.indexOf('exec node');
  const xvfbBlockEnd = entrypoint.lastIndexOf('fi');
  assert.equal(execIndex > xvfbBlockEnd, true, 'the app exec must sit outside every Xvfb conditional');
  assert.match(entrypoint, /bounded/i, 'the wait for the display must be documented as bounded');
  assert.match(entrypoint, /\$waited" -lt \d+/, 'the readiness wait must be bounded by a counter');
});

test('the entrypoint patches nothing and leaks no credential', () => {
  assert.equal(/src\/index\.ts['"`]?\s*[;>]|>\s*src\//.test(entrypoint), false, 'the entrypoint must never write into src/');
  assert.equal(/sed -i|writeFile|patch /.test(entrypoint), false, 'the entrypoint must never mutate source');
  // It reports NODE_OPTIONS' size, never its content, and never touches a
  // credential variable at all.
  assert.match(entrypoint, /NODE_OPTIONS_CHARS/);
  assert.equal(/\$\{?NODE_OPTIONS\}?[^_:]/.test(entrypoint.replace(/\$\{NODE_OPTIONS:-\}/g, '')), false, 'NODE_OPTIONS content must never be printed');
  assert.equal(/HUMAN_ASSIST_SPEECH_API_KEY|WORKER_TOKEN|BROWSERLESS/.test(entrypoint), false, 'no credential variable may appear in the entrypoint');
});

test('package.json start remains the single canonical application command', () => {
  const pkg = JSON.parse(readFileSync(`${here}../package.json`, 'utf8'));
  assert.equal(pkg.scripts.start, 'tsx src/index.ts');
  // The short-lived diagnostic bootstrap shim must not return: it called
  // process.exit(1) on unhandledRejection, which would let one job's stray
  // promise kill every other customer's in-flight job.
  assert.equal(existsSync(`${here}../src/boot.ts`), false, 'src/boot.ts must not be reintroduced');
  assert.equal(pkg.scripts.start.includes('boot'), false);
});

test('crash paths are loud, and a stray rejection never kills the worker', () => {
  assert.match(indexSource, /process\.on\('unhandledRejection'/);
  assert.match(indexSource, /process\.on\('uncaughtException'/);
  const rejection = indexSource.slice(
    indexSource.indexOf("process.on('unhandledRejection'"),
    indexSource.indexOf("process.on('uncaughtException'")
  );
  assert.equal(/process\.exit/.test(rejection), false, 'an unhandled rejection must NOT exit the worker');
  assert.match(rejection, /logBrowserLifecycle\('unhandled_rejection'/);
  // A fatal exception must still tear down browsers before exiting, or every
  // in-flight job leaks a Chromium process and a profile directory.
  const fatal = indexSource.slice(indexSource.indexOf("process.on('uncaughtException'"));
  assert.match(fatal, /closeAllJobBrowsers\('uncaught_exception'\)/);
  assert.match(fatal, /process\.exit\(1\)/);
  // Neither handler may log a raw message that could carry a credential.
  assert.match(rejection, /redactSecrets\(/);
  assert.match(fatal, /redactSecrets\(/);
});
