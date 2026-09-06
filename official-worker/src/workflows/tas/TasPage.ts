// TasPage.ts — the TAS Page Object. Ported from the pre-refactor
// tasAdapter() in index.js; row/document traversal delegates to the shared
// browser/ResultRowExhauster.ts (used identically by MyGovPage — both
// sources expose a result list that must be fully opened/read/returned).
//
// Playwright-touching — NOT unit-testable in this sandbox. Local-syntax-
// checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { interact, waitForResultSignal, hasNoResultPhrase, totalFoundCount, pollForSelectorVisible } from '../../browser/BrowserSession.js';
import { exhaustResultRows } from '../../browser/ResultRowExhauster.js';
import { CADASTRAL_INPUT_SELECTORS, DWR_NETWORK_PATTERN, TAS_URL, TAS_SEARCH_MENU_LABEL } from './selectors.js';

export class TasPage {
  async goto(page: Page): Promise<{ searchMenuClicked: boolean }> {
    await (page as any).goto(TAS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* the heavy ExtJS/DWR app can take longer than networkidle allows */
    }
    await (page as any).waitForTimeout(1500);
    // Best-effort reproduction of the manual entry path (click
    // "სამსახურის პასუხის მოძებნა") on top of the already-confirmed-live
    // deep link above — see the selector's own comment for why this is
    // additive/non-blocking rather than a replacement for the direct URL.
    const searchMenuClicked = await this.clickSearchMenuIfPresent(page);
    // Live-confirmed 2026-09-06: this label is a real <a href> pointing at
    // the SAME URL already loaded, so clicking it (when present) triggers a
    // genuine page reload of the outer tas.ge page — which tears down and
    // re-embeds the docs.tbilisi.gov.ge ExtJS iframe from scratch. The old
    // fixed waitForTimeout(1000) inside clickSearchMenuIfPresent gave that
    // iframe's JS-rendered form no positive confirmation it had actually
    // re-initialized before the caller proceeds to search — a plausible
    // direct cause of the production SEARCH_CONTROL_NOT_FOUND result (the
    // real field, input[name*="cad" i], was confirmed live to exist and work
    // correctly once actually rendered). This poll gives the FIRST search
    // attempt a genuine positive signal the control exists, bounded so a
    // page that never re-embeds the iframe still proceeds (interact() itself
    // then does the real, authoritative check).
    if (searchMenuClicked) await pollForSelectorVisible(page as any, CADASTRAL_INPUT_SELECTORS, { timeoutMs: 12000 });
    return { searchMenuClicked };
  }

  async clickSearchMenuIfPresent(page: Page): Promise<boolean> {
    try {
      const menuItem = (page as any).getByText(TAS_SEARCH_MENU_LABEL, { exact: false }).first();
      if (await menuItem.count().catch(() => 0)) {
        await menuItem.click({ timeout: 3000 }).catch(() => {});
        await (page as any).waitForTimeout(1000).catch(() => {});
        return true;
      }
    } catch {
      /* label not present on this page state — the direct URL already
       * landed on the search form, which is the expected/confirmed case */
    }
    return false;
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
