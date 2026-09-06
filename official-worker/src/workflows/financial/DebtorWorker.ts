// DebtorWorker.ts — MyGov Debtor Registry ('debtor'), my.gov.ge Service 38,
// as its OWN fully independent worker. Split out of the old
// FinancialSourceWorkflow.ts (2026-09-06, "HOMATCH VERIFY — REBUILD THE
// CUSTOMER REPORT + OFFICIAL WORKERS AS SEPARATE DETERMINISTIC PIPELINES"
// mandate): "one source = one worker = one real live contract" — this file
// owns its own URL, its own confirmed selector, its own submit control and
// its own CAPTCHA handling; nothing here is chosen by branching on a
// source-key string shared with any other registry.
//
// Real, live-confirmed contract (2026-09-06, via the user's own connected
// browser — see this file's sibling selectors.ts for the original
// inspection notes): a real, stable `input[name="debtorIdNumber"]` sits
// directly on the page with NO iframe (unlike Service 176's own registry),
// alongside a real `<button type="submit">ძიება</button>`. Its reCAPTCHA is
// `size=invisible` and passed silently with no visible challenge at all in
// the live test that produced this file (a real search executed
// immediately, returning "მონაცემები ვერ მოიძებნა" for 404670272) — the
// CAPTCHA check below is still run defensively for the rarer case where
// Google's own risk scoring decides to challenge this particular request.
//
// Deliberately still uses a small set of genuinely source-agnostic DOM
// primitives from BrowserSession.ts (challenge()/waitForResultSignal()) —
// frame-safe text/CAPTCHA infrastructure, not "how do I search my.gov.ge"
// decision logic. What this file does NOT use is BrowserSession's generic
// interact()/submitNear() control flow — the field fill and button click
// below are direct Playwright calls against this source's own known
// selector.
//
// MyGov Debtor exposes only a single national/company ID field — no
// name-only search (confirmed live) — so a candidate with no idCode is a
// clean, honest precondition skip, never a guessed name-field attempt. This
// also means this worker NEVER fires for a private individual's personal ID
// on its own initiative — it only ever runs against a companyProfile.idCode
// already evidenced elsewhere, never a person's ID the user did not
// themselves supply/authorize.
import type { Page } from 'playwright';
import { challenge, waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { DEBTOR_URL, DEBTOR_ID_INPUT_SELECTORS, DEBTOR_SOURCE_META } from './selectors.js';
import type { LegacySourceResult } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';

/** 2026-09-06 "final alignment pass" mandate: an explicit, code-computed
 * interpretation of the debtor-registry result — never left for the
 * customer report generator to infer from the raw status string alone. A
 * confirmed NO_RESULT (not listed as a debtor) is the POSITIVE outcome for
 * a property buyer; a confirmed SEARCH result (a real debtor record) needs
 * a human's attention. Any other status (technical failure, still waiting
 * on human verification, etc.) is neither — null, not a guess. */
function computeRegistryInterpretation(status: string): 'POSITIVE_WITHIN_DEBTOR_REGISTRY_SCOPE' | 'ATTENTION_REQUIRED' | null {
  if (status === 'NO_RESULT_CONFIRMED') return 'POSITIVE_WITHIN_DEBTOR_REGISTRY_SCOPE';
  if (status === 'SEARCH_CONFIRMED') return 'ATTENTION_REQUIRED';
  return null;
}

function buildResult(
  status: string,
  opts: { selector?: string | null; value?: string | null; resultText?: string | null; error?: string | null; forEntity: { name: string; idCode: string | null } | null }
): LegacySourceResult {
  const registryInterpretation = computeRegistryInterpretation(status);
  return {
    source: 'debtor',
    sourceName: DEBTOR_SOURCE_META.name,
    sourceClass: DEBTOR_SOURCE_META.class,
    sourceUrl: DEBTOR_SOURCE_META.url,
    startUrl: DEBTOR_SOURCE_META.url,
    finalUrl: DEBTOR_SOURCE_META.url,
    frameUrls: [],
    searchControlUsed: opts.selector || null,
    queryEntered: opts.value || null,
    submitAction: opts.selector ? 'CLICK button[type=submit]~=ძიება' : null,
    resultContext: opts.resultText || opts.error || null,
    resultConfirmed: status === 'SEARCH_CONFIRMED',
    noResultConfirmed: status === 'NO_RESULT_CONFIRMED',
    resultValidated: status === 'SEARCH_CONFIRMED',
    status,
    // No dedicated FSM/traversal ladder — MyGov Debtor is a single flat
    // identifier-in, result-out search with no nested applications/
    // documents list to enumerate, so there is nothing real for a
    // traversal object to describe.
    traversal: null,
    retrievedAt: new Date().toISOString(),
    documents: [],
    discoveredEntities: [],
    forEntity: opts.forEntity,
    error: opts.error || null,
    registryInterpretation,
    ...(registryInterpretation ? { debtorRecordFound: status === 'SEARCH_CONFIRMED' } : {}),
  };
}

export async function runDebtorWorker(
  page: Page,
  forEntity: { name: string; idCode: string | null } | null,
  entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {}
): Promise<LegacySourceResult> {
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;
  if (!forEntity || !idCode) {
    return buildResult('START', { forEntity, error: 'no identifier (ID code) supplied — MyGov Debtor Registry has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(DEBTOR_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
    }

    // Own selector resolution: the confirmed field sits directly on the
    // top-level page, no iframe — a direct fill against this source's own
    // known selector, never a shared hint-scanning primitive.
    let usedSelector: string | null = null;
    for (const sel of DEBTOR_ID_INPUT_SELECTORS) {
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

    // Own submit control: my.gov.ge's own confirmed real submit button
    // (labeled "ძიება"), clicked directly.
    let submitted = false;
    try {
      const btn = (page as any).getByRole('button', { name: /ძიება/i }).first();
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

    // Own CAPTCHA gate: usually an invisible reCAPTCHA that passes
    // silently, but checked defensively for the rarer challenged case —
    // never solved or bypassed, only detected.
    const cap = await challenge(page as any);
    if (cap) {
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, error: null }), status: 'WAITING_HUMAN' };
    }

    const sig = await waitForResultSignal((page as any).mainFrame(), before, idCode);
    if (!sig.changed) {
      return buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared' });
    }
    const status = hasNoResultPhrase(sig.after) ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
    // Feed whatever names/ids this result page actually carries into the
    // shared EntityQueue — mandate's "wire the previously-unused entities
    // parameter" fix. Never interrupts this worker's own result; purely
    // additive bookkeeping for the orchestrator's later entity pass.
    if (entities && status === 'SEARCH_CONFIRMED' && sig.after) {
      entities.scanText(sig.after, { source: 'debtor', sourceDocument: DEBTOR_SOURCE_META.url, retrievedAt: new Date().toISOString() });
    }
    return buildResult(status, { forEntity, selector: usedSelector, value: idCode, resultText: sig.after });
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e) });
  }
}
