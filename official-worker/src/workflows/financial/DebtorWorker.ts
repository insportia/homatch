// DebtorWorker.ts — MyGov Debtor Registry ('debtor'), my.gov.ge Service 38,
// as its OWN fully independent worker. Split out of the old
// FinancialSourceWorkflow.ts (2026-09-06, "HOMATCH VERIFY — REBUILD THE
// CUSTOMER REPORT + OFFICIAL WORKERS AS SEPARATE DETERMINISTIC PIPELINES"
// mandate): "one source = one worker = one real live contract" — this file
// owns its own URL, its own confirmed selector, its own submit control and
// its own CAPTCHA handling; nothing here is chosen by branching on a
// source-key string shared with any other registry.
//
// Real, live-confirmed contract: a real, stable
// `input[name="debtorIdNumber"]` sits directly on the page with NO iframe,
// alongside a real `<button type="submit">ძიება</button>`. Its reCAPTCHA is
// invisible and normally passes silently. For 404670272 the live flow
// returned the official zero-result phrase "მონაცემები ვერ მოიძებნა".
import type { Page } from 'playwright';
import { challenge, waitForResultSignal, hasNoResultPhrase } from '../../browser/BrowserSession.js';
import { DEBTOR_URL, DEBTOR_ID_INPUT_SELECTORS, DEBTOR_SOURCE_META } from './selectors.js';
import type { LegacySourceResult } from '../WorkflowResult.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';

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
  const validated = status === 'SEARCH_CONFIRMED' || status === 'NO_RESULT_CONFIRMED';
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
    // A confirmed zero-result is itself a valid official registry outcome;
    // do not mark it as unvalidated merely because no debtor row exists.
    resultValidated: validated,
    status,
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
    return buildResult('START', { forEntity, error: 'no identifier (ID code) supplied — official debtor lookup has no name-search field' });
  }

  try {
    if (!opts.skipGoto) {
      await (page as any).goto(DEBTOR_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
    }

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
        /* try next confirmed selector */
      }
    }
    if (!usedSelector) {
      return buildResult('SEARCH_CONTROL_NOT_FOUND', { forEntity, value: idCode, error: 'search field not found' });
    }

    const before = await (page as any).mainFrame().locator('body').innerText({ timeout: 5000 }).catch(() => '');

    let submitted = false;
    try {
      const btn = (page as any).getByRole('button', { name: /ძიება/i }).first();
      if (await btn.isVisible()) {
        await btn.click();
        submitted = true;
      }
    } catch {
      /* fall through */
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

    const cap = await challenge(page as any);
    if (cap) {
      return { ...buildResult('WAITING_HUMAN', { forEntity, selector: usedSelector, value: idCode, error: null }), status: 'WAITING_HUMAN' };
    }

    const sig = await waitForResultSignal((page as any).mainFrame(), before, idCode);
    if (!sig.changed) {
      return buildResult('SUBMITTED_UNCONFIRMED', { forEntity, selector: usedSelector, value: idCode, resultText: sig.after, error: 'search submitted but no new result signal appeared' });
    }

    const status = hasNoResultPhrase(sig.after) ? 'NO_RESULT_CONFIRMED' : 'SEARCH_CONFIRMED';
    if (entities && status === 'SEARCH_CONFIRMED' && sig.after) {
      entities.scanText(sig.after, { source: 'debtor', sourceDocument: DEBTOR_SOURCE_META.url, retrievedAt: new Date().toISOString() });
    }
    return buildResult(status, { forEntity, selector: usedSelector, value: idCode, resultText: sig.after });
  } catch (e) {
    return buildResult('FAILED', { forEntity, error: String(e) });
  }
}
