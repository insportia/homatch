import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  decideHandoff,
  specFor,
  canonicalSourceKey,
  isHandoffCapable,
} from '../sources.ts';

/*
 * REGRESSION — THE REAL PRODUCTION FAILURE.
 *
 * Job 49c5f98d-972b-4e72-8ebf-dd228f24992b, a genuine customer Verify run.
 * The worker parked on the RS taxpayer registry and wrote this into
 * research_jobs.captcha:
 *
 *   { "source": "rstax",
 *     "url": "https://www.rs.ge/TaxpayersRegistry",
 *     "step": { "type":"entity", "source":"rstax",
 *               "idCode":"404670272", "name":"შპს მილენიო გრუპი" },
 *     "networkBlocked": false,
 *     "fullInteractiveSession": true, "scrollable": true,
 *     "recommendedWidth": 1100, "recommendedMaxHeight": "90vh" }
 *
 * The customer was then shown a Google reCAPTCHA image challenge rendered
 * INSIDE the Railway Chromium, as a streamed screenshot with relayed clicks,
 * and asked to solve it there.
 *
 * TWO independent defects produced that, and either one alone was enough:
 *
 *   1. decideHandoff() sent an ordinary CAPTCHA to RETRY_IN_SERVER_BROWSER.
 *      Only a terminal network refusal reached USER_SIDE_HANDOFF, and this
 *      payload says networkBlocked=false.
 *
 *   2. The matrix was keyed on the EVIDENCE vocabulary (rs.taxpayer) while
 *      every worker payload carries the RUNTIME vocabulary (rstax). So
 *      specFor('rstax') was null and the decision failed closed to SKIP --
 *      meaning even a networkBlocked=true refusal would never have been
 *      handed off either. Zero handoffs existed in production, ever.
 */

const ROOT = process.cwd();

/** The production payload, verbatim from research_jobs.captcha. */
const REAL_PARKED_PAYLOAD = Object.freeze({
  source: 'rstax',
  url: 'https://www.rs.ge/TaxpayersRegistry',
  step: { type: 'entity', source: 'rstax', idCode: '404670272', name: 'შპს მილენიო გრუპი' },
  networkBlocked: false,
  fullInteractiveSession: true,
});

const AVAILABLE = Object.freeze({ cadastralCode: '01.18.06.019.055.03.01.601', companyIdCode: '404670272' });

/* ---------------- defect 2: the vocabularies now meet ---------------- */

test('the worker source key the real job used resolves to a spec', () => {
  assert.equal(canonicalSourceKey('rstax'), 'rs.taxpayer');
  assert.ok(specFor('rstax'), 'specFor("rstax") returned null in production');
  assert.ok(isHandoffCapable('rstax'));
});

test('every worker source key production has emitted resolves', () => {
  // 'rstax' and 'mygov' are the only two values ever recorded in
  // research_jobs.captcha; enreg/debtor exist in research-agent's code.
  for (const k of ['rstax', 'enreg', 'debtor', 'mygov']) {
    assert.ok(specFor(k), `${k} must map onto the matrix`);
  }
});

test('both vocabularies address the same source', () => {
  assert.equal(specFor('rstax')?.key, specFor('rs.taxpayer')?.key);
  assert.equal(specFor('enreg')?.key, specFor('napr.enreg')?.key);
  assert.equal(specFor('debtor')?.key, specFor('enforcement.debtors')?.key);
});

/* ---------------- defect 1: an ordinary CAPTCHA is a handoff ---------------- */

test('THE FAILURE: an ordinary CAPTCHA on rstax hands off to the customer', () => {
  const plan = decideHandoff({
    sourceKey: REAL_PARKED_PAYLOAD.source,
    status: 'CAPTCHA_REQUIRED',
    networkRefusal: REAL_PARKED_PAYLOAD.networkBlocked,
    available: AVAILABLE,
    priorAttempt: 'NONE',
  });

  assert.equal(plan.decision, 'USER_SIDE_HANDOFF',
    'this is the exact input that put a customer in front of a relayed reCAPTCHA');
  assert.equal(plan.kind, 'VERIFY_ON_SOURCE');
  assert.equal(plan.serverCanContinue, false);
});

test('no input can ever produce a "solve it in our browser" decision', () => {
  // The decision union no longer contains RETRY_IN_SERVER_BROWSER, but assert
  // it behaviourally too, across the whole cross-product of real inputs.
  for (const sourceKey of ['rstax', 'enreg', 'debtor', 'mygov', 'napr', 'unknown.source']) {
    for (const status of ['CAPTCHA_REQUIRED', 'BLOCKED', 'TECHNICAL_FAILED', 'WAITING_HUMAN', 'RUNNING']) {
      for (const networkRefusal of [true, false]) {
        for (const priorAttempt of ['NONE', 'CANCELLED', 'EXPIRED', 'COMPLETED']) {
          const plan = decideHandoff({ sourceKey, status, networkRefusal, available: AVAILABLE, priorAttempt });
          assert.ok(
            plan.decision === 'USER_SIDE_HANDOFF' || plan.decision === 'SKIP_SOURCE',
            `${sourceKey}/${status} produced ${plan.decision}`
          );
        }
      }
    }
  }
});

test('a source that genuinely cannot be handed off is skipped, not streamed', () => {
  // my.gov.ge permits is SESSION_BOUND: a customer cannot reproduce the wizard
  // state from a cold start. Skipping is honest; showing them our browser is not.
  const plan = decideHandoff({
    sourceKey: 'mygov', status: 'CAPTCHA_REQUIRED', networkRefusal: false,
    available: AVAILABLE, priorAttempt: 'NONE',
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.match(plan.reason, /SESSION_BOUND/);
});

test('a handoff is not offered without the inputs it needs', () => {
  const plan = decideHandoff({
    sourceKey: 'rstax', status: 'CAPTCHA_REQUIRED', networkRefusal: false,
    available: { cadastralCode: 'x', companyIdCode: null }, priorAttempt: 'NONE',
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.match(plan.reason, /companyIdCode/);
});

test('a completed, cancelled or expired handoff is never re-offered', () => {
  for (const priorAttempt of ['COMPLETED', 'CANCELLED', 'EXPIRED']) {
    const plan = decideHandoff({
      sourceKey: 'rstax', status: 'CAPTCHA_REQUIRED', networkRefusal: false,
      available: AVAILABLE, priorAttempt,
    });
    assert.equal(plan.decision, 'SKIP_SOURCE', `${priorAttempt} must not loop the customer`);
  }
});

/* ---------------- the frontend must not render the worker browser ---------------- */

const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'VerifyPage.tsx'), 'utf8');

test('the streamed worker-browser CAPTCHA surface no longer exists', () => {
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'src', 'components', 'research', 'ResearchCaptchaModal.tsx')),
    'the component that rendered the relayed screenshot must be gone, not merely unused'
  );
  assert.ok(!page.includes('ResearchCaptchaModal'), 'VerifyPage must not reference it');
});

test('the only human-verification surface is the local-browser handoff', () => {
  assert.match(page, /HumanVerificationHandoff/);
  const handoff = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'research', 'HumanVerificationHandoff.tsx'), 'utf8');
  // Comments stripped: this file's header explains why a screenshot of the
  // Railway browser cannot solve a network refusal, and scanning the raw text
  // finds that explanation rather than any actual screenshot rendering.
  const code = handoff.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // A real navigation in the customer's own browser, not an embedded surface.
  assert.match(code, /target="_blank"/);
  assert.match(code, /rel="noopener noreferrer"/);
  assert.ok(!/<iframe/i.test(code), 'the handoff must not embed the source');
  assert.ok(!/shot\?\.image|screenshot/i.test(code), 'the handoff must not stream a screenshot');
});

test('every human-required stop asks for a handoff, with no networkBlocked gate', () => {
  // The gate `if(data?.captcha?.networkBlocked===true)` is what made the real
  // job (networkBlocked=false) fall through to the worker browser.
  assert.ok(
    !/if\(data\?\.captcha\?\.networkBlocked===true/.test(page),
    'minting must not be conditional on a network block'
  );
  assert.match(page, /void offerHandoff\(id,src,/);
});

test('a source with no possible handoff is skipped rather than left parked', () => {
  const fn = page.slice(page.indexOf('const offerHandoff=async'));
  const body = fn.slice(0, fn.indexOf('};') + 2);
  assert.match(body, /void skip\(\)/, 'no handoff must fall through to skip, never to the worker browser');
  assert.match(body, /catch\{void skip\(\)\}/, 'a mint failure must not strand the customer');
});

test('completion releases the source instead of resuming into the same challenge', () => {
  const fn = page.slice(page.indexOf('const completeHandoff=async'));
  const body = fn.slice(0, fn.indexOf('};') + 2);
  assert.match(body, /const canContinue=handoff\.serverCanContinue===true/);
  assert.match(body, /if\(canContinue\)\{await resume\(\)\}else\{await skip\(\)\}/);
});

/* ---------------- the mint has the input it needs ---------------- */

test('the parked entity id is read from the payload the worker actually wrote', () => {
  // The company a source parks on is often a DISCOVERED developer, not the
  // job's primary company, so result_json.companyProfile.idCode alone was not
  // enough — for the real job the id lived only in captcha.step.idCode.
  const fn = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'verification-handoff', 'index.ts'), 'utf8');
  assert.match(fn, /\.select\('id,query,result_json,captcha'\)/);
  assert.match(fn, /c\.step\?\.idCode/);
  assert.match(fn, /\(parkedIdCode \|\| r\.companyProfile\?\.idCode\)/);
});
