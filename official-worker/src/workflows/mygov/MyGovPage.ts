// MyGovPage.ts — the MyGov/NAPR Page Object (2026-09-06 "final alignment
// pass" mandate rewrite). "Do not use MyGov's global site search" — this
// only ever tries the known-good HINT selectors inside the real registry
// iframe, never a generic keyword search against the my.gov.ge portal.
//
// This REPLACES the previous `pollForIframe` + `ctx.newPage()` mechanism
// (opening the naprweb iframe's raw `src` in a brand-new page/tab). The
// real, live-recorded production flow (napr-recording.spec.ts, repo root)
// never opens a new page for this: it goes to
// https://my.gov.ge/ka-ge/services/10, clicks the real property-search
// link, and the naprweb Angular app renders directly into
// `#main-routing-container iframe` ON THE SAME PAGE — every subsequent step
// is a `.contentFrame()` locator chained off that one iframe, on the same
// `page` the CAPTCHA/human-verification lifecycle already tracks.
//
// Playwright-touching — NOT unit-testable in this sandbox. Local-syntax-
// checked via `tsc --noEmit` only.
import type { Page, Frame } from 'playwright';
import { interact, candidateRankedRetry, waitForResultSignal } from '../../browser/BrowserSession.js';
import {
  CADASTRAL_INPUT_SELECTORS,
  MYGOV_URL,
  PROPERTY_SEARCH_LINK_TEXT,
  MAIN_ROUTING_IFRAME_SELECTOR,
  APPLICATION_SEARCH_BUTTON_LABEL,
  APPLICATION_ROW_BUTTON_PATTERN,
  PREPARED_DOCUMENT_BUTTON_PATTERN,
  MAX_APPLICATIONS,
} from './selectors.js';

export class MyGovPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(MYGOV_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* the service-group page can take longer than networkidle allows */
    }
    await (page as any).waitForTimeout(1000);
  }

  /** Clicks the real property-search link on the service-group page — SAME
   * page, no popup (live-recorded: napr-recording.spec.ts never awaits a
   * `page.waitForEvent('popup')` for this click). Returns whether the link
   * was found/clicked at all; the caller still has to resolve the iframe
   * itself afterward via resolveRegistryFrame(). */
  async openPropertySearchLink(page: Page): Promise<{ clicked: boolean }> {
    try {
      const link = (page as any).locator('a').filter({ hasText: PROPERTY_SEARCH_LINK_TEXT }).first();
      if (!(await link.count().catch(() => 0))) return { clicked: false };
      await link.click({ timeout: 5000 });
      await (page as any).waitForTimeout(1500);
      return { clicked: true };
    } catch {
      return { clicked: false };
    }
  }

  /** Resolves the naprweb Angular app's real Frame via `.contentFrame()` on
   * `#main-routing-container iframe` — the one mechanism every step of the
   * real recorded flow actually uses. Polls because the app (behind an
   * invisible reCAPTCHA on some renders) can take a few seconds to mount. */
  async resolveRegistryFrame(page: Page, { timeoutMs = 20000, pollMs = 1000 }: { timeoutMs?: number; pollMs?: number } = {}): Promise<Frame | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const handle = (page as any).locator(MAIN_ROUTING_IFRAME_SELECTOR).first();
        if (await handle.count().catch(() => 0)) {
          const frame = await handle.contentFrame().catch(() => null);
          if (frame) {
            // A frame object can exist before its own app has actually
            // mounted anything — require at least one element before
            // trusting it as "ready."
            const ready = await frame.locator('body *').first().count().catch(() => 0);
            if (ready > 0) return frame as any as Frame;
          }
        }
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  }

  /** `scope` is the real naprweb Frame (never a separate page opened to its
   * raw src). `opts.allowGenericFallback` mirrors the previous contract:
   * safe here because the entire frame IS the registry's own single-purpose
   * search UI, not a multi-purpose portal page. */
  async searchCadastral(scope: Frame | Page, q: string, opts: { allowGenericFallback?: boolean } = {}) {
    let hit = await interact(scope as any, q, CADASTRAL_INPUT_SELECTORS);
    if (!hit.found && opts.allowGenericFallback) hit = (await candidateRankedRetry(scope as any, q)) as any;
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

  /** Explicitly clicks the real "განცხადების ძებნა" submit button when
   * `interact()`'s own generic nearest-submit-control click did not already
   * fire it (defensive — interact() already matches /ძებნა/i, this is a
   * belt-and-suspenders direct click by the exact recorded label). */
  async clickApplicationSearchButton(scope: Frame | Page): Promise<boolean> {
    try {
      const btn = (scope as any).getByRole('button', { name: APPLICATION_SEARCH_BUTTON_LABEL }).first();
      if (!(await btn.count().catch(() => 0))) return false;
      await btn.click({ timeout: 3000 });
      await new Promise((r) => setTimeout(r, 1000));
      return true;
    } catch {
      return false;
    }
  }

  /** Dynamically enumerates every real "განცხადება <number>" application
   * button — never a fixed application-number list (recording:
   * "განცხადება 892024345197" is per-search, not a stable id). */
  async enumerateApplications(scope: Frame | Page): Promise<{ label: string }[]> {
    try {
      const buttons = (scope as any).getByRole('button', { name: APPLICATION_ROW_BUTTON_PATTERN });
      const count = Math.min(await buttons.count().catch(() => 0), MAX_APPLICATIONS);
      const out: { label: string }[] = [];
      for (let i = 0; i < count; i++) {
        const label = ((await buttons.nth(i).innerText().catch(() => '')) as string)?.trim() || `application-${i}`;
        out.push({ label });
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Opens one application by its exact enumerated label (re-resolved by
   * text at click time — Playwright locators are lazy, so the button's own
   * live element is used, never a stale handle from enumeration). This is
   * also the step that most often triggers the real Google reCAPTCHA
   * ("დაადასტურეთ მონიშვნით 'მე არ ვარ რობოტი'") — left entirely to the
   * existing challenge()/WAITING_HUMAN lifecycle, never solved here. */
  async openApplication(scope: Frame | Page, label: string): Promise<boolean> {
    try {
      const btn = (scope as any).getByRole('button', { name: label, exact: true }).first();
      if (!(await btn.count().catch(() => 0))) return false;
      await btn.click({ timeout: 5000 });
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    } catch {
      return false;
    }
  }

  /** Dynamically enumerates every real prepared-document button inside the
   * now-open application detail view — never a fixed document list
   * (recording: "მომზადებული დოკუმენტი: ...", "დოკუმენტი: ...", both with
   * per-application, per-run text after the colon). */
  async enumeratePreparedDocuments(scope: Frame | Page): Promise<{ label: string }[]> {
    try {
      const buttons = (scope as any).getByRole('button', { name: PREPARED_DOCUMENT_BUTTON_PATTERN });
      const count = await buttons.count().catch(() => 0);
      const out: { label: string }[] = [];
      for (let i = 0; i < count; i++) {
        const label = ((await buttons.nth(i).innerText().catch(() => '')) as string)?.trim() || `document-${i}`;
        out.push({ label });
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Clicks one prepared-document button by its exact enumerated label — a
   * REAL new popup page every time (recording: `page.waitForEvent('popup')`
   * around each of these clicks), never a same-page navigation. */
  async openPreparedDocument(page: Page, scope: Frame | Page, label: string): Promise<Page | null> {
    try {
      const btn = (scope as any).getByRole('button', { name: label, exact: true }).first();
      if (!(await btn.count().catch(() => 0))) return null;
      const [popup] = await Promise.all([
        (page as any).context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
        btn.click({ timeout: 5000 }).catch(() => {}),
      ]);
      if (popup) await popup.waitForTimeout(1200).catch(() => {});
      return popup || null;
    } catch {
      return null;
    }
  }
}
