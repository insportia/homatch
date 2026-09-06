// RsTaxpayerWorker.ts — RS Taxpayers Registry ('rstax'), rs.ge, as its OWN
// fully independent worker. Split out of the old FinancialSourceWorkflow.ts
// (2026-09-06, "HOMATCH VERIFY — REBUILD THE CUSTOMER REPORT + OFFICIAL
// WORKERS AS SEPARATE DETERMINISTIC PIPELINES" mandate): "one source = one
// worker = one real live contract" — NOT a shared function parameterized by
// a source-name key, even when (as here) two sources happen to share the
// same page shape. This file owns its own URL, its own confirmed selector
// (`#tin`), its own submit control, its own CAPTCHA-block phrase, and its
// own result-read — nothing here is chosen by branching on a source-key
// string at runtime.
//
// Real, live-confirmed contract (2026-09-06, via the user's own connected
// browser — see this file's sibling selectors.ts for the original
// inspection notes): a stable `<input id="tin">`, a real
// `<button id="btnSearch1">ძებნა</button>`, and a normal-size (always
// visible, not invisible) `div.g-recaptcha` that blocks the search
// client-side with the exact banner "გთხოვთ მონიშნოთ უსაფრთხოების
// ღილაკი!" whenever the checkbox has not been ticked — a distinct
// "blocked, not yet searched" signal that must never be misread as a
// confirmed empty registry result (mandate: "TECHNICAL FAILURE ≠ PROPERTY
// RISK"), and is therefore checked BEFORE any no-result-phrase evaluation.
//
// Deliberately still uses a small set of genuinely source-agnostic DOM
// primitives from BrowserSession.ts (challenge()/waitForResultSignal()/
// contexts()) — those are frame-safe text/CAPTCHA infrastructure, not "how
// do I search rs.ge" decision logic, and rewriting them per worker would be
// pure duplication with no independence benefit. What this file does NOT
// use is BrowserSession's generic interact()/submitNear() control flow —
// the actual field fill and button click below are direct Playwright calls
// against this source's own known selector, so a change to how some other
// source searches can never silently change how this one does.
//
// RS Taxpayers exposes only a single national/company TIN field — no
// name-only search (confirmed live) — so a candidate with no idCode is a
// clean, honest precondition skip, never a guessed name-field attempt.
import type { Page } from 'playwright';
import { challenge, waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { RSTAX_URL, RSTAX_ID_INPUT_SELECTORS, RSTAX_CAPTCHA_BLOCK_PHRASE, RSTAX_SOURCE_META } from './selectors.js';
import type { LegacySourceResult } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';

function buildResult(status: string, opts: { selector?: string | null; value?: string | null; resultText?: string | null; error?: string | null; forEntity: { name: string; idCode: string | null } | null }): LegacySourceResult {
  return {
    source: 'rstax',
    sourceName: RSTAX_SOURCE_META.name,
    sourceClass: RSTAX_SOURCE_META.class,
    sourceUrl: RSTAX_SOURCE_META.url,
    startUrl: RSTAX_SOURCE_META.url,
    finalUrl: RSTAX_SOURCE_META.url,
    frameUrls: [],
    searchControlUsed: opts.selector || null,
    queryEntered: opts.value || null,
    submitAction: opts.selector ? 'CLICK #btnSearch1' : null,
    resultContext: opts.resultText || opts.error || null,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status === 'SEARCH_CONFIRMED',
    status,
    // No dedicated FSM/traversal ladder — RS Taxpayers is a single flat
    // identifier-in, result-out search with no nested applications/
    // documents list to enumerate, so there is nothing real for a
    // traversal object to describe.
    traversal: null,
    retrievedAt: new Date().toISOString(),
    documents: [],
    discoveredEntities: [],
    forEntity: opts.forEntity,
    error: opts.error || null,
  };
}

export async function runRsTaxpayerWorker(
  page: Page,
  forEntity: { name: string; idCode: string | null } | null,
  _entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {}
): Promise<LegacySourceResult> {
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;
  if (!forEntity || !idCode) {
    return buildResult('START', { forEntity, error: 'no identifier (TIN) supplied — RS Taxpayers Registry has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(RSTAX_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
    }

    // Own selector resolution: try each confirmed candidate directly
    // against the top-level page (rs.ge's TIN field is not framed) rather
    // than delegating to a shared hint-scanning primitive.
    let usedSelector: string | null = null;
    for (const sel of RSTAX_ID_INPUT_SELECTORS) {
      const x = (page as any).locator(sel).first();
      try {
        if (await x.isVisible()) {
          await x.fill(idCode);
          usedSelector = sel;
          break;
        }
      } catch {
        /* this candidate selector isn't present — try the next confirmed one */
      }
    }
    if (!usedSelector) {
      return buildResult('SEARCH_CONTROL_NOT_FOUND', { forEntity, value: idCode, error: 'search field not found' });
    }

    const before = await (page as any).mainFrame().locator('body').innerText({ timeout: 5000 }).catch(() => '');

    // Own submit control: rs.ge's own confirmed real button (#btnSearch1,
    // labeled "ძებნა"), clicked directly — never the shared submitNear()
    // role-scan.
    const btn = (page as any).locator('#btnSearch1').first();
    let submitted = false;
    try {
      if (await btn.isVisible()) {
        await btn.click();
        submitted = true;
      }
    } catch {
      /* fall through to Enter-key fallback below */
    }
    if (!submitted) {
      try {
        await (page as any).locator(usedSelector).first().press('Enter');
        submitted = true;
      } catch {
        return buildResult('SUBMIT_FAILED', { forEntity, selector: usedSelector, value: idCode, error: 'submit failed' });
      }
    }
    await (page as any).waitForTimeout(1000);

    // Own CAPTCHA gate: rs.ge's own confirmed always-visible g-recaptcha
    // blocks every unsolved search with a distinct client-side banner —
    // checked BEFORE any no-result-phrase evaluation so a blocked search
    // can never be misread as a confirmed empty registry result.
    const cap = await challenge(page as any);
    const sig = await waitForResultSignal((page as any).mainFrame(), before, idCode);
    if (cap || RSTAX_CAPTCHA_BLOCK_PHRASE.test(sig.after)) {
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after }), status: 'WAITING_HUMAN' };
    }
    if (!sig.changed) {
      return buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared' });
    }
    const status = hasNoResultPhrase(sig.after) ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
    return buildResult(status, { forEntity, selector: usedSelector, value: idCode, resultText: sig.after });
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e) });
  }
}
