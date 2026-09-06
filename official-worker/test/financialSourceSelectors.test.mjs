// financialSourceSelectors.test.mjs — RS Taxpayers Registry / MyGov Debtor
// Registry selector constants (workflows/financial/selectors.ts), added by
// the "FINANCIAL/COMPANY SOURCE EXPANSION" mandate section. These two
// sources are each their own independent worker (RsTaxpayerWorker.ts /
// DebtorWorker.ts, split out of the earlier shared FinancialSourceWorkflow.ts
// by the "REBUILD THE CUSTOMER REPORT + OFFICIAL WORKERS AS SEPARATE
// DETERMINISTIC PIPELINES" mandate — "one source = one worker = one real
// live contract", never a function parameterized by a source-key string),
// deliberately NOT full per-source FSMs (see each worker's own header) and
// — like every other *Workflow.ts/*Worker.ts driver in this codebase
// (TAS/MSMap/MyGov/ENREG/Generic) — not unit-mocked at the Playwright-Page
// level here; that behavior is covered by the live browser verification
// recorded in selectors.ts's own comments plus this codebase's established
// convention of testing the pure logic layer, not the browser-driving
// layer, in this suite. What IS pure and safely testable without a DOM
// lib / Page mock is the actual selector and phrase-matching data these two
// independent workers each depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RSTAX_URL,
  RSTAX_ID_INPUT_SELECTORS,
  RSTAX_CAPTCHA_BLOCK_PHRASE,
  RSTAX_SOURCE_META,
  DEBTOR_URL,
  DEBTOR_ID_INPUT_SELECTORS,
  DEBTOR_SOURCE_META,
} from '../.tstest-build/workflows/financial/selectors.js';

test('RS Taxpayers: the confirmed-live #tin input id is the primary selector', () => {
  assert.equal(RSTAX_ID_INPUT_SELECTORS[0], '#tin');
  assert.equal(RSTAX_URL, 'https://www.rs.ge/TaxpayersRegistry');
});

test('MyGov Debtor: the confirmed-live debtorIdNumber field name is the primary selector', () => {
  assert.equal(DEBTOR_ID_INPUT_SELECTORS[0], 'input[name="debtorIdNumber" i]');
  assert.equal(DEBTOR_URL, 'https://my.gov.ge/ka-ge/services/38/searchdebtorinfo');
});

// The exact client-side banner text confirmed live on 2026-09-06 when a
// search is submitted with the reCAPTCHA checkbox unchecked — this is a
// distinct "blocked, not yet searched" signal that must never be read as a
// confirmed no-result (mandate: "TECHNICAL FAILURE ≠ PROPERTY RISK").
test('RSTAX_CAPTCHA_BLOCK_PHRASE: matches the real confirmed-live captcha-block banner', () => {
  assert.ok(RSTAX_CAPTCHA_BLOCK_PHRASE.test('გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი!'));
});

test('RSTAX_CAPTCHA_BLOCK_PHRASE: does NOT match an unrelated confirmed result/no-result phrase', () => {
  assert.ok(!RSTAX_CAPTCHA_BLOCK_PHRASE.test('მონაცემები ვერ მოიძებნა'));
  assert.ok(!RSTAX_CAPTCHA_BLOCK_PHRASE.test('გადასახადის გადამხდელის ბარათი'));
});

test('source meta: both new sources are classed as OFFICIAL_REGISTRY with their real confirmed URLs', () => {
  assert.equal(RSTAX_SOURCE_META.class, 'OFFICIAL_REGISTRY');
  assert.equal(RSTAX_SOURCE_META.url, RSTAX_URL);
  assert.equal(DEBTOR_SOURCE_META.class, 'OFFICIAL_REGISTRY');
  assert.equal(DEBTOR_SOURCE_META.url, DEBTOR_URL);
});
