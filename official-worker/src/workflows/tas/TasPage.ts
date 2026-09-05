// TasPage.ts — the TAS Page Object. Ported from the pre-refactor
// tasAdapter() in index.js; row/document traversal delegates to the shared
// browser/ResultRowExhauster.ts (used identically by MyGovPage — both
// sources expose a result list that must be fully opened/read/returned).
//
// Playwright-touching — NOT unit-testable in this sandbox. Local-syntax-
// checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { interact, waitForResultSignal, hasNoResultPhrase, totalFoundCount } from '../../browser/BrowserSession.js';
import { exhaustResultRows } from '../../browser/ResultRowExhauster.js';
import { CADASTRAL_INPUT_SELECTORS, DWR_NETWORK_PATTERN, TAS_URL } from './selectors.js';

export class TasPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(TAS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* the heavy ExtJS/DWR app can take longer than networkidle allows */
    }
    await (page as any).waitForTimeout(1500);
  }

  async searchCadastral(page: Page, code: string) {
    const hit = await interact(page as any, code, CADASTRAL_INPUT_SELECTORS, { networkPattern: DWR_NETWORK_PATTERN });
    if (!hit.found) return { found: false, submitted: false, resultsDiscovered: null as number | null, resultText: '', networkConfirmed: false, trace: hit.trace };
    const sig = await waitForResultSignal(hit.frame, hit.before || '', code);
    const networkConfirmed = !!hit.net?.matched;
    const resultsDiscovered = sig.changed ? totalFoundCount(sig.after) : null;
    const noResult = sig.changed && hasNoResultPhrase(sig.after);
    return {
      found: true,
      submitted: !!hit.sub?.ok,
      submitAction: hit.sub?.method || null,
      networkConfirmed,
      resultChanged: sig.changed || networkConfirmed,
      resultsDiscovered: noResult ? 0 : resultsDiscovered,
      noResultConfirmed: noResult,
      resultText: sig.after,
      frame: hit.frame,
      trace: [...hit.trace, { action: 'RESULT', changed: sig.changed, networkConfirmed, signal: sig.signal }],
    };
  }

  async exhaustResultRows(page: Page, expectedCount: number | null = null) {
    return exhaustResultRows(page, 'tas', { expectedCount });
  }
}
