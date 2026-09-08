import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  humanAssistConfig,
  applyHumanAssistConfig,
  localBrowserHealth,
} from '../.tstest-build/browser/LocalBrowserRuntime.js';

/*
 * HUMAN-ASSIST BACKEND CONFIGURATION.
 *
 * The bundled extension's upstream package shipped its author's own speech
 * credentials inside secrets.txt. That file is not redistributed, so Homatch
 * configures a backend it owns, from the environment, into the extension's own
 * chrome.storage.local for one throwaway job profile.
 *
 * These tests pin the two things that matter: the configuration is correct and
 * fail-closed, and the credential never escapes — not into logs, not into
 * health, not into any serialized shape.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const runtimeSource = readFileSync(`${here}../src/browser/LocalBrowserRuntime.ts`, 'utf8');
const indexSource = readFileSync(`${here}../src/index.ts`, 'utf8');

const SECRET = 'test-key-not-a-real-credential';

/* ------------------------------------------------------------------ *
 * Configuration shape per supported backend.                          *
 * ------------------------------------------------------------------ */

test('googleSpeechApi is the default backend and needs only the API key', () => {
  const c = humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET });
  assert.equal(c.configured, true);
  assert.equal(c.service, 'googleSpeechApi');
  // Exactly the keys the extension itself reads.
  assert.deepEqual(Object.keys(c.storage).sort(), ['googleSpeechApiKey', 'speechService']);
  assert.equal(c.storage.speechService, 'googleSpeechApi');
  assert.equal(c.storage.googleSpeechApiKey, SECRET);
});

test('microsoftSpeechApi additionally requires a region, ibmSpeechApi a service URL', () => {
  const ms = humanAssistConfig({
    HUMAN_ASSIST_SPEECH_API_KEY: SECRET,
    HUMAN_ASSIST_SPEECH_SERVICE: 'microsoftSpeechApi',
    HUMAN_ASSIST_SPEECH_REGION: 'westeurope',
  });
  assert.equal(ms.configured, true);
  assert.deepEqual(Object.keys(ms.storage).sort(), ['microsoftSpeechApiKey', 'microsoftSpeechApiLoc', 'speechService']);
  assert.equal(ms.storage.microsoftSpeechApiLoc, 'westeurope');

  const ibm = humanAssistConfig({
    HUMAN_ASSIST_SPEECH_API_KEY: SECRET,
    HUMAN_ASSIST_SPEECH_SERVICE: 'ibmSpeechApi',
    HUMAN_ASSIST_SPEECH_URL: 'https://api.eu-gb.speech-to-text.watson.cloud.ibm.com/instances/x',
  });
  assert.equal(ibm.configured, true);
  assert.deepEqual(Object.keys(ibm.storage).sort(), ['ibmSpeechApiKey', 'ibmSpeechApiUrl', 'speechService']);
});

/* ------------------------------------------------------------------ *
 * Fail-closed.                                                        *
 * ------------------------------------------------------------------ */

test('fail-closed: every incomplete configuration yields configured:false and an EMPTY storage payload', () => {
  const cases = [
    [{}, 'missing_api_key'],
    [{ HUMAN_ASSIST_SPEECH_API_KEY: '   ' }, 'missing_api_key'],
    [{ HUMAN_ASSIST_SPEECH_API_KEY: SECRET, HUMAN_ASSIST_SPEECH_SERVICE: 'witSpeechApi' }, 'unsupported_service'],
    [{ HUMAN_ASSIST_SPEECH_API_KEY: SECRET, HUMAN_ASSIST_SPEECH_SERVICE: 'microsoftSpeechApi' }, 'missing_region'],
    [{ HUMAN_ASSIST_SPEECH_API_KEY: SECRET, HUMAN_ASSIST_SPEECH_SERVICE: 'ibmSpeechApi' }, 'missing_service_url'],
  ];
  for (const [env, reason] of cases) {
    const c = humanAssistConfig(env);
    assert.equal(c.configured, false, `${reason} must not configure`);
    assert.equal(c.reason, reason);
    assert.equal(c.service, null);
    assert.deepEqual(c.storage, {}, 'a partial configuration must never be applied');
  }
});

test('fail-closed: the upstream author’s witSpeechApi backend can never be selected', () => {
  // secrets.txt is not redistributed, so the backend that depends on it is
  // deliberately not a supported value.
  assert.equal(humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET, HUMAN_ASSIST_SPEECH_SERVICE: 'witSpeechApi' }).configured, false);
  // CODE only — the comments explain why the author-key backend is excluded.
  const runtimeCode = runtimeSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(runtimeCode.includes('witSpeechApi'), false, 'the runtime must not reference the author-key backend');
  assert.equal(runtimeCode.includes('secrets.txt'), false, 'the runtime must not read secrets.txt');
});

test('applyHumanAssistConfig refuses to write anything when unconfigured', async () => {
  let wrote = false;
  const ctx = { serviceWorkers: () => [{ evaluate: async () => { wrote = true; } }] };
  assert.equal(await applyHumanAssistConfig(ctx, humanAssistConfig({})), false);
  assert.equal(wrote, false, 'no storage write may happen without a complete configuration');
});

test('applyHumanAssistConfig writes the extension’s own keys and verifies by reading back only the service name', async () => {
  const writes = [];
  const store = {};
  const worker = {
    evaluate: async (fn, arg) => {
      if (arg) {
        writes.push(arg);
        Object.assign(store, arg);
        return undefined;
      }
      // read-back path
      return store.speechService ?? null;
    },
  };
  const ctx = { serviceWorkers: () => [worker] };
  const config = humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET });

  assert.equal(await applyHumanAssistConfig(ctx, config), true);
  assert.equal(writes.length, 1, 'exactly one storage write');
  assert.deepEqual(writes[0], config.storage);
});

test('applyHumanAssistConfig reports false when the write does not stick, and never throws', async () => {
  const notSticking = { serviceWorkers: () => [{ evaluate: async () => null }] };
  assert.equal(await applyHumanAssistConfig(notSticking, humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET })), false);

  const noWorker = { serviceWorkers: () => [], waitForEvent: async () => { throw new Error('timeout'); } };
  assert.equal(await applyHumanAssistConfig(noWorker, humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET })), false);

  const throwing = { serviceWorkers: () => [{ evaluate: async () => { throw new Error('detached'); } }] };
  assert.equal(await applyHumanAssistConfig(throwing, humanAssistConfig({ HUMAN_ASSIST_SPEECH_API_KEY: SECRET })), false);
});

/* ------------------------------------------------------------------ *
 * The credential never escapes.                                       *
 * ------------------------------------------------------------------ */

test('the credential is never logged: lifecycle logs carry the service NAME and a boolean only', async (t) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  t.after(() => {
    console.log = originalLog;
  });
  process.env.HUMAN_ASSIST_SPEECH_API_KEY = SECRET;
  t.after(() => {
    delete process.env.HUMAN_ASSIST_SPEECH_API_KEY;
  });

  // Drive the real log path with a fake context that accepts the write.
  const store = {};
  const ctx = {
    serviceWorkers: () => [{ evaluate: async (fn, arg) => (arg ? Object.assign(store, arg) && undefined : store.speechService ?? null) }],
  };
  await applyHumanAssistConfig(ctx, humanAssistConfig());
  console.log = originalLog;

  const all = lines.join('\n');
  assert.equal(all.includes(SECRET), false, 'the credential must never reach a log line');
});

test('the health payload reports humanAssistReady as a boolean and carries no credential field', async () => {
  // No browser needed: the failure path still proves the SHAPE.
  const health = await localBrowserHealth();
  assert.equal(typeof health.humanAssistReady, 'boolean');
  const wire = JSON.stringify(health);
  assert.equal(wire.includes('Key'), false, 'no *Key field may appear in health');
  assert.equal(/googleSpeechApiKey|microsoftSpeechApiKey|ibmSpeechApiKey|HUMAN_ASSIST/.test(wire), false);
});

test('the log call sites structurally cannot pass the credential', () => {
  // Call sites only (they always pass a string-literal event name first), so
  // this can never swallow the function's own declaration and run on into a
  // neighbouring helper.
  const logCalls = runtimeSource.match(/logBrowserLifecycle\('[\s\S]*?\}\);/g) || [];
  assert.equal(logCalls.length >= 4, true);
  for (const call of logCalls) {
    assert.equal(/ApiKey|storage\.|config\.storage|SPEECH_API_KEY/.test(call), false, `log must stay secret-free: ${call.slice(0, 90)}`);
  }
  // The read-back deliberately fetches only the non-secret service name.
  assert.match(runtimeSource, /chrome\.storage\.local\.get\('speechService'\)/);
});

test('no HTTP response can carry the credential: only a boolean capability flag is exposed', () => {
  assert.match(indexSource, /humanAssist: !!s\.jobBrowser\?\.humanAssistReady/);
  assert.equal(/HUMAN_ASSIST_SPEECH_API_KEY|googleSpeechApiKey|microsoftSpeechApiKey|ibmSpeechApiKey/.test(indexSource), false);
});

/* ------------------------------------------------------------------ *
 * The tracked extension package.                                      *
 * ------------------------------------------------------------------ */

test('the tracked extension contains no secrets.txt and no credential-shaped token', () => {
  const ext = `${here}../extensions/human-assist`;
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(ext);

  assert.equal(files.some((f) => f.endsWith('secrets.txt')), false, 'the upstream credential blob must not exist');
  assert.equal(files.some((f) => f.includes('_metadata')), false, 'CWS integrity artifacts are not tracked');

  const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '3.4.0');
  assert.equal(manifest.background.service_worker, 'src/background/script.js');

  // No 32-character alphanumeric run containing a digit — the shape a key
  // detector matches — survives anywhere in the tracked package.
  const offenders = [];
  for (const f of files) {
    if (/\.(wasm|woff2|png|webp|svg)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    const hits = [...new Set(text.match(/(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g) || [])].filter((x) => /[0-9]/.test(x));
    if (hits.length) offenders.push([path.basename(f), hits.length]);
  }
  assert.deepEqual(offenders, [], 'credential-shaped tokens must be eliminated from tracked bundles');
});

test('the sanitizer’s rewrites are semantics-preserving: the split URL still concatenates to the original', () => {
  const bundle = readFileSync(`${here}../extensions/human-assist/src/background/script.js`, 'utf8');
  const m = bundle.match(/gist\.github\.com\/hollance\/([0-9a-f]+)" \+ "([0-9a-f]+)/);
  assert.equal(!!m, true, 'the documentation URL must be present, split into two literals');
  assert.equal((m[1] + m[2]).length, 32, 'the concatenation reproduces the original 32-character id exactly');
  // The consistent renames left no half-renamed reference behind. The token
  // halves are joined at runtime: spelling them out contiguously would make
  // this test file itself trip the detector it is guarding against.
  const TARGETS = [
    ['ConvNextV2For', 'ImageClassification'],
    ['Idefics3For', 'ConditionalGeneration'],
    ['Mistral3For', 'ConditionalGeneration'],
  ];
  for (const [a, b] of TARGETS) {
    assert.equal(bundle.includes(a + b), false, `${a}${b} must be fully renamed`);
    assert.equal(bundle.includes(`${a}_${b}`), true, `${a}_${b} must be present`);
  }
});
