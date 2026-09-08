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

test('no tracked startup script writes to src/ — startup must never mutate source', () => {
  const scripts = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'));
  assert.equal(scripts.length > 0, true, 'scripts/ must be scanned');

  for (const name of scripts) {
    const source = readFileSync(`${SCRIPTS_DIR}/${name}`, 'utf8');
    // Comments explain the old behaviour; code must not perform it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/writeFileSync|writeFile\s*\(|fs\.promises\.writeFile/.test(code), false, `${name} must not write files at startup`);
    assert.equal(/readFileSync\(\s*['"`]src\//.test(code), false, `${name} must not read src/ for patching`);
    assert.equal(code.includes("patch('src/index.ts'"), false, `${name} must not patch src/index.ts`);
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

test('exactly one handler is registered per live route, and it is the real one', () => {
  const postLive = indexSource.match(/app\.post\('\/research\/:id\/live'/g) || [];
  const getLive = indexSource.match(/app\.get\('\/research\/:id\/live'/g) || [];
  assert.equal(postLive.length, 1, 'a second POST /research/:id/live would shadow the real handler');
  assert.equal(getLive.length, 1);
  assert.match(indexSource, /app\.post\('\/research\/:id\/live',\s*auth,\s*liveBrowserHandler\)/);
  assert.match(indexSource, /app\.get\('\/research\/:id\/live',\s*auth,\s*liveBrowserHandler\)/);
});

test('the live route is registered by the real handler, which consults the visual watch and the trusted capability', () => {
  const handler = indexSource.slice(
    indexSource.indexOf('async function liveBrowserHandler('),
    indexSource.indexOf("app.post('/research/:id/live'")
  );
  // The legacy handler's signature failure: it only ever looked at
  // getSession() and 404'd for every RUNNING visualWatch job.
  assert.match(handler, /orchestrator\.isVisualWatchEnabled\(req\.params\.id\)/);
  assert.match(handler, /orchestrator\.getOrCreateLiveView\(req\.params\.id\)/);
  // It must not mint its own live URL or hardcode a plan-busting timeout.
  assert.equal(/['"`]Browserless\.liveURL['"`]/.test(indexSource), false);
  assert.equal(indexSource.includes('timeout: 900000'), false);
});

test('the health payload has no patch-only marker — its presence in production proves the patcher ran', () => {
  // `browserRuntime` was added ONLY by the startup patcher. If a live
  // /health response ever contains it again, the override is back.
  assert.equal(indexSource.includes('browserRuntime'), false);
  assert.match(indexSource, /liveInteractiveBrowser: true/);
  // /health/browserless previously existed ONLY in the patch; it is now a
  // real route built on the production Browserless functions, returning
  // booleans only and never a URL, handle or credential.
  assert.match(indexSource, /app\.get\('\/health\/browserless', async/);
  const probe = indexSource.slice(
    indexSource.indexOf("app.get('/health/browserless'"),
    indexSource.indexOf("app.post('/research', auth")
  );
  assert.match(probe, /createHumanLiveURL\(page, 120000\)/, 'must reuse the production mint path, not hand-rolled CDP');
  assert.equal(/liveURL: live\.liveURL|liveURLId: live\.liveURLId/.test(probe), false, 'no URL or handle may be serialized');
  assert.match(probe, /liveURL: !!live\.liveURL/, 'boolean only');
  assert.match(probe, /BROWSERLESS_PROBE_TTL_MS/, 'probe must be cached so it cannot burn Browserless quota');
  assert.equal(probe.includes('BROWSERLESS_TOKEN'), false);
  assert.equal(probe.includes('wss://'), false);
});

test('the Dockerfile CMD is the authoritative entrypoint and does not invoke the patcher', () => {
  const dockerfile = readFileSync(`${here}../Dockerfile`, 'utf8');
  const cmd = dockerfile.split('\n').filter((l) => l.trim().startsWith('CMD')).join('\n');
  assert.match(cmd, /npm","start"/);
  assert.equal(cmd.includes('apply-live-browser-patch'), false, 'the image must never start the patcher');
});
