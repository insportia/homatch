// MyGovPage.ts — deterministic MyGov/NAPR page object.
import type { Page, Frame } from 'playwright';
import { interact, candidateRankedRetry, waitForResultSignal } from '../../browser/BrowserSession.js';
import {
  CADASTRAL_INPUT_SELECTORS,
  MYGOV_URL,
  MYGOV_DIRECT_SERVICE_URL,
  PROPERTY_SEARCH_LINK_TEXT,
  MAIN_ROUTING_IFRAME_SELECTOR,
  APPLICATION_SEARCH_BUTTON_LABEL,
  APPLICATION_ROW_BUTTON_PATTERN,
  PREPARED_DOCUMENT_BUTTON_PATTERN,
  MAX_APPLICATIONS,
} from './selectors.js';

const PUBLIC_REGISTRY_EXTRACT_LABEL = 'მომზადებული დოკუმენტი: ამონაწერი საჯარო რეესტრიდან';

export class MyGovPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(MYGOV_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {}
    await (page as any).waitForTimeout(1000);
  }

  async gotoDirectService176(page: Page): Promise<void> {
    await (page as any).goto(MYGOV_DIRECT_SERVICE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
    try {
      await (page as any).waitForLoadState('networkidle', { timeout: 8000 });
    } catch {}
    await (page as any).waitForTimeout(1000);
  }

  async openPropertySearchLink(page: Page): Promise<{ clicked: boolean }> {
    try {
      const link = (page as any).locator('a').filter({ hasText: PROPERTY_SEARCH_LINK_TEXT }).first();
      if (!(await link.count().catch(() => 0))) return { clicked: false };
      const beforeUrl = (page as any).url();
      await link.click({ timeout: 5000 });
      try {
        await (page as any).waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 8000 });
      } catch {}
      await (page as any).waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      await (page as any).waitForTimeout(500);
      return { clicked: true };
    } catch {
      return { clicked: false };
    }
  }

  async resolveRegistryFrame(page: Page, { timeoutMs = 30000, pollMs = 500 }: { timeoutMs?: number; pollMs?: number } = {}): Promise<Frame | null> {
    const start = Date.now();
    try {
      await (page as any).locator(MAIN_ROUTING_IFRAME_SELECTOR).first().waitFor({ state: 'attached', timeout: timeoutMs });
    } catch {
      return null;
    }
    while (Date.now() - start < timeoutMs) {
      try {
        const handle = (page as any).locator(MAIN_ROUTING_IFRAME_SELECTOR).first();
        if (await handle.count().catch(() => 0)) {
          const frame = await handle.contentFrame().catch(() => null);
          if (frame) {
            const ready = await frame.locator('body *').first().count().catch(() => 0);
            if (ready > 0) return frame as any as Frame;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  }

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

  async enumerateApplications(scope: Frame | Page): Promise<{ label: string }[]> {
    try {
      const buttons = (scope as any).locator('button[ng-click="view(app.appID)"]');
      const count = Math.min(await buttons.count().catch(() => 0), MAX_APPLICATIONS);
      const out: { label: string }[] = [];
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const aria = ((await btn.getAttribute('aria-label').catch(() => '')) as string)?.trim();
        const text = ((await btn.innerText().catch(() => '')) as string)?.trim();
        const label = aria || text || `application-${i}`;
        if (APPLICATION_ROW_BUTTON_PATTERN.test(label)) out.push({ label });
      }
      return out;
    } catch {
      return [];
    }
  }

  async openApplication(scope: Frame | Page, label: string): Promise<boolean> {
    try {
      let btn = (scope as any).locator(`button[ng-click="view(app.appID)"][aria-label="${label.replace(/"/g, '\\"')}"]`).first();
      if (!(await btn.count().catch(() => 0))) btn = (scope as any).getByRole('button', { name: label, exact: true }).first();
      if (!(await btn.count().catch(() => 0))) return false;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 5000, force: true });
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Success signal for the human CAPTCHA step. Google may leave its widget
   * mounted after a successful solve, so the appearance of the exact
   * prepared-extract control is stronger evidence that the registry app has
   * advanced than the continued presence of the old CAPTCHA iframe.
   */
  async preparedExtractReady(scope: Frame | Page): Promise<boolean> {
    try {
      const exact = (scope as any)
        .locator(`button[ng-click="navigateTo(edoc.BLOB_URI)"][aria-label="${PUBLIC_REGISTRY_EXTRACT_LABEL}"]`)
        .first();
      if (await exact.count().catch(() => 0)) return await exact.isVisible().catch(() => false);

      const item = (scope as any)
        .locator(`md-list-item[aria-label="${PUBLIC_REGISTRY_EXTRACT_LABEL}"]`)
        .first();
      return !!(await item.count().catch(() => 0)) && !!(await item.isVisible().catch(() => false));
    } catch {
      return false;
    }
  }

  async enumeratePreparedDocuments(scope: Frame | Page): Promise<{ label: string }[]> {
    try {
      const buttons = (scope as any).locator('button[ng-click="navigateTo(edoc.BLOB_URI)"]');
      const count = await buttons.count().catch(() => 0);
      const out: { label: string }[] = [];
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const aria = ((await btn.getAttribute('aria-label').catch(() => '')) as string)?.trim();
        const text = ((await btn.innerText().catch(() => '')) as string)?.trim();
        const label = aria || text || `document-${i}`;
        if (PREPARED_DOCUMENT_BUTTON_PATTERN.test(label) || /ამონაწერი\s+საჯარო\s+რეესტრიდან/i.test(label)) out.push({ label });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Clicks the exact live Angular document button. The control is an
   * absolutely positioned full-item button, so aria-label + ng-click is the
   * stable selector; we do not rely on innerText. Supports both popup and
   * same-page navigation, while preserving the same browser/context.
   */
  async openPreparedDocument(page: Page, scope: Frame | Page, label: string): Promise<Page | null> {
    try {
      const escaped = label.replace(/"/g, '\\"');
      let btn = (scope as any)
        .locator(`button[ng-click="navigateTo(edoc.BLOB_URI)"][aria-label="${escaped}"]`)
        .first();
      if (!(await btn.count().catch(() => 0))) {
        btn = (scope as any).locator('button[ng-click="navigateTo(edoc.BLOB_URI)"]').filter({ has: (scope as any).locator('div') }).first();
      }
      if (!(await btn.count().catch(() => 0))) return null;

      await btn.scrollIntoViewIfNeeded().catch(() => {});
      const beforeUrl = (page as any).url();
      const context = (page as any).context();
      const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);

      await btn.click({ timeout: 8000, force: true }).catch(async () => {
        await btn.evaluate((el: any) => el.click()).catch(() => {});
      });

      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await popup.waitForTimeout(1200).catch(() => {});
        return popup;
      }

      // Some registry builds navigate the same page instead of opening a popup.
      try {
        await (page as any).waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 5000 });
        return page;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }
}
