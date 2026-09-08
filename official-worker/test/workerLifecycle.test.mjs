import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * ALL SEVEN SOURCE WORKERS — browser ownership.
 *
 * Mandate: "One Verify job owns one persistent Chromium context. Every source
 * gets/owns only its Page and popups. Workers must NEVER close the job
 * BrowserContext." and "Audit all browser-backed workers: TAS_MAP, tas,
 * mygov, enreg, rstax, debtor, generic. Verify every one follows the same
 * ownership rules."
 *
 * localBrowserRuntime.test.mjs proves the ORCHESTRATOR side of that contract
 * (runStep opens the page, releaseSourcePages closes it and its popups, only
 * terminal paths close the browser). This file proves the other side: that no
 * worker reaches around the orchestrator to create or destroy a browser,
 * context or profile of its own. A single stray `ctx.close()` inside any of
 * these would silently end the job's Chromium mid-research and take every
 * later source — and the human's preserved CAPTCHA page — down with it.
 *
 * Enforced per FILE, over the whole workflow package, because the page
 * helpers (TasPage, MyGovPage, EnregPage, TasResultExhauster …) run against
 * the very same shared context as their workers.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const WORKFLOWS = `${here}../src/workflows`;

/** The seven sources the orchestrator dispatches, and every file that runs
 * inside the job's shared BrowserContext on their behalf. */
const SOURCES = {
  TAS_MAP: ['tasmap/TasMapWorker.ts', 'tasmap/TasMapPage.ts'],
  tas: ['tas/TasWorkflow.ts', 'tas/TasPage.ts', 'tas/TasResultExhauster.ts'],
  mygov: ['mygov/MyGovWorkflow.ts', 'mygov/MyGovPage.ts'],
  enreg: ['enreg/EnregWorkflow.ts', 'enreg/EnregPage.ts'],
  rstax: ['financial/RsTaxpayerWorker.ts'],
  debtor: ['financial/DebtorWorker.ts'],
  generic: ['generic/GenericWorkflow.ts'],
};

const sourceKeys = Object.keys(SOURCES);

/** Source with comments stripped: a comment may DISCUSS ownership, only code
 * may violate it. */
function codeOf(relative) {
  const full = `${WORKFLOWS}/${relative}`;
  assert.equal(existsSync(full), true, `${relative} must exist`);
  return readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('all seven sources are covered by this audit', () => {
  assert.deepEqual(sourceKeys.sort(), ['TAS_MAP', 'debtor', 'enreg', 'generic', 'mygov', 'rstax', 'tas'].sort());
  assert.equal(sourceKeys.length, 7);
});

for (const [source, files] of Object.entries(SOURCES)) {
  test(`${source}: never closes the job's BrowserContext or Chromium`, () => {
    for (const file of files) {
      const code = codeOf(file);
      // The exact call that would end the job for every OTHER source too.
      assert.equal(/\bcontext\.close\s*\(/.test(code), false, `${file} must never close the job context`);
      assert.equal(/\bctx\.close\s*\(/.test(code), false, `${file} must never close the job context`);
      assert.equal(/\bbrowser\.close\s*\(/.test(code), false, `${file} must never close the browser`);
      assert.equal(/\.browser\(\)\s*[?.]*\.close/.test(code), false, `${file} must never reach the Browser through the context`);
      assert.equal(/closeJobBrowser/.test(code), false, `${file} must never run terminal cleanup — that is the orchestrator's job`);
    }
  });

  test(`${source}: never creates a browser, context or profile of its own`, () => {
    for (const file of files) {
      const code = codeOf(file);
      assert.equal(/chromium\.launch/.test(code), false, `${file} must not launch its own browser`);
      assert.equal(/launchPersistentContext/.test(code), false, `${file} must not launch its own context`);
      assert.equal(/newContext\s*\(/.test(code), false, `${file} must not create a second context — cookies/session would split`);
      assert.equal(/mkdtemp|userDataDir/.test(code), false, `${file} must not manage a profile directory`);
    }
  });

  test(`${source}: opens no transport of its own and carries no Browserless residue`, () => {
    for (const file of files) {
      const code = codeOf(file);
      assert.equal(/connectOverCDP|wss:\/\//.test(code), false, `${file} must not open a remote browser transport`);
      assert.equal(/browserless/i.test(code), false, `${file} must contain no Browserless residue`);
      assert.equal(/BROWSERLESS_/.test(code), false, `${file} must read no Browserless environment variable`);
    }
  });
}

/* ------------------------------------------------------------------ *
 * The orchestrator must actually reach all seven — in BOTH directions *
 * of the human-verification lifecycle.                                *
 * ------------------------------------------------------------------ */

const orchestrator = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');

test('every source is dispatchable on the normal path AND on the resume path', () => {
  // resume() must be able to continue the SAME preserved page for whichever
  // source paused on a CAPTCHA — a source reachable only on the first pass
  // would strand a human session forever.
  const resume = orchestrator.slice(orchestrator.indexOf('async resume('), orchestrator.indexOf('async skip('));
  for (const key of ['tas', 'TAS_MAP', 'mygov', 'enreg', 'rstax', 'debtor']) {
    assert.match(resume, new RegExp(`key === '${key}'`), `resume() must handle ${key}`);
  }
  // 'generic' is the else-branch fallback (napr/property-enreg have no FSM).
  assert.match(resume, /runGenericWorkflow\(/, 'resume() must fall back to the generic workflow');

  // And every resumed worker continues on the preserved page rather than
  // re-navigating, which would discard the solved challenge.
  const skipGotoCount = (resume.match(/skipGoto: true/g) || []).length;
  assert.equal(skipGotoCount >= 5, true, `resumed workers must not re-navigate (found ${skipGotoCount} skipGoto flags)`);
});

test('resume and skip release only the Page, never the shared context', () => {
  const resume = orchestrator.slice(orchestrator.indexOf('async resume('), orchestrator.indexOf('async skip('));
  const skip = orchestrator.slice(orchestrator.indexOf('async skip('));
  for (const [name, body] of [['resume', resume], ['skip', skip]]) {
    assert.match(body, /session\.page\.close\(\)/, `${name}() must close the source page`);
    assert.equal(/session\.ctx\.close\(\)/.test(body), false, `${name}() must never close the context`);
    assert.equal(/closeJobBrowser/.test(body), false, `${name}() must never close the job browser`);
    // Both continue the SAME job browser rather than launching a new one.
    assert.equal(/launchJobBrowser/.test(body), false, `${name}() must not launch a new browser`);
  }
  assert.match(skip, /session\.jobBrowser/, 'skip() must carry the SAME job browser into the next source');
});

test('a skipped source is recorded as skipped, never as a property finding', () => {
  const skip = orchestrator.slice(orchestrator.indexOf('async skip('));
  assert.match(skip, /status: 'SKIPPED_HUMAN_VERIFICATION'/);
  assert.match(skip, /resultConfirmed: false/);
  assert.match(skip, /noResultConfirmed: false/);
  assert.match(skip, /skippedHumanVerification: true/);
  // Nothing about the property may be inferred from a skip.
  assert.equal(/propertyRisk|verdict/.test(skip), false, 'a skip must carry no verdict or risk meaning');
});
