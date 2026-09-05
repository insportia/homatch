// MyGovPage.ts — the MyGov Page Object. Ported from the pre-refactor
// mygovAdapter() in index.js. "Do not use MyGov's global site search" —
// this only ever tries the service-176-specific HINT selectors first, and
// falls back to a ranked candidate scan (tagged with its confidence tier)
// ONLY inside the naprweb registry app itself, never the my.gov.ge portal
// chrome.
//
// Playwright-touching — NOT unit-testable in this sandbox. Local-syntax-
// checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { interact, candidateRankedRetry, waitForResultSignal, pollForIframe } from '../../browser/BrowserSession.js';
import { CADASTRAL_INPUT_SELECTORS, MYGOV_URL, REGISTRY_IFRAME_PATTERN } from './selectors.js';

export class MyGovPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(MYGOV_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* the naprweb Angular app can take longer than networkidle allows */
    }
    await (page as any).waitForTimeout(1500);
  }

  /** Opens the naprweb registry application — either it is already reached
   * from the top-level service page, or (the confirmed real case) its
   * iframe only appears in the raw DOM after its invisible reCAPTCHA
   * finishes executing, so this polls for it directly rather than giving up
   * after one static check. Returns the page actually operating in the
   * registry context (may be a fresh page opened to the iframe's own src). */
  async openRegistryApplication(page: Page, ctx: any): Promise<{ registryAppOpened: boolean; activePage: Page | null }> {
    const poll = await pollForIframe(page as any, REGISTRY_IFRAME_PATTERN, { timeoutMs: 15000, pollMs: 1000 });
    if (!poll.found) return { registryAppOpened: false, activePage: null };
    let full = poll.src as string;
    try {
      full = new URL(poll.src as string, (page as any).url()).toString();
    } catch {
      /* keep the raw src if URL resolution fails */
    }
    const p2 = await ctx.newPage();
    try {
      await p2.goto(full, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p2.waitForTimeout(2000);
      return { registryAppOpened: true, activePage: p2 };
    } catch {
      await p2.close().catch(() => {});
      return { registryAppOpened: false, activePage: null };
    }
  }

  async searchCadastral(page: Page, q: string) {
    let hit = await interact(page as any, q, CADASTRAL_INPUT_SELECTORS);
    if (!hit.found) hit = (await candidateRankedRetry(page as any, q)) as any;
    if (!hit.found) return { found: false, contextConfidence: null as string | null, trace: hit.trace };
    const sig = await waitForResultSignal(hit.frame, hit.before || '', q);
    return {
      found: true,
      submitted: !!hit.sub?.ok,
      submitAction: hit.sub?.method || null,
      contextConfidence: hit.contextConfidence || null,
      resultChanged: sig.changed,
      resultText: sig.after,
      trace: [...hit.trace, { action: 'RESULT', changed: sig.changed, signal: sig.signal, contextConfidence: hit.contextConfidence || null }],
    };
  }
}
