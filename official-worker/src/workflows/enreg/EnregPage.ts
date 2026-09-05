// EnregPage.ts — the ENREG Page Object. Ported from the pre-refactor
// enregAdapter() in index.js — the full search -> exact-match -> info-icon
// -> numeric verification -> entity page -> latest application ->
// prepared documents -> registry extract -> full read -> history chain.
//
// Playwright-touching — NOT unit-testable in this sandbox (no network path
// to enreg.reestri.gov.ge). Local-syntax-checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { interact, waitForResultSignal, challenge, text as pageText, candidateRankedRetry } from '../../browser/BrowserSession.js';
import { readOnlineDocument } from '../../documents/OnlineDocumentReader.js';
import { ID_CODE_INPUT_HINTS, NAME_INPUT_HINTS } from './selectors.js';
import { ENREG_URL, ENREG_APPLICATIONS_LABEL, ENREG_PREPARED_DOCS_LABEL, ENREG_EXTRACT_LABEL } from './EnregState.js';

export class EnregPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(ENREG_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
  }

  async search(page: Page, searchMethod: 'ID_CODE' | 'NAME', value: string) {
    const hints = searchMethod === 'ID_CODE' ? ID_CODE_INPUT_HINTS : NAME_INPUT_HINTS;
    let hit = await interact(page as any, value, hints);
    if (!hit.found && searchMethod === 'ID_CODE') hit = await interact(page as any, value, NAME_INPUT_HINTS);
    if (!hit.found) hit = (await candidateRankedRetry(page as any, value)) as any;
    if (!hit.found) return { found: false, resultText: '', trace: hit.trace };
    const sig = await waitForResultSignal(hit.frame, hit.before || '', value);
    return { found: true, submitted: !!hit.sub?.ok, resultChanged: sig.changed, resultText: sig.after, frame: hit.frame, trace: [...hit.trace, { action: 'RESULT', changed: sig.changed }] };
  }

  /** Clicks the info/exclamation icon aligned with the row containing
   * `searchValue` — never row 0 (mandate Section 13: "Do NOT click the
   * first row"). Returns the page that ends up active (a new tab, if one
   * opened) and whether a human-verification interstitial appeared. */
  async clickInfoIconForRow(page: Page, searchValue: string) {
    try {
      const row = (page as any).getByText(searchValue, { exact: false }).first();
      const rowExists = await row.count().catch(() => 0);
      const infoIcon = rowExists
        ? row.locator('xpath=ancestor::tr[1]//a | ancestor::li[1]//a | ancestor::div[1]//a').first()
        : (page as any).locator('a,button').filter({ hasText: /ინფორმაცია|დეტალ|info|i\b/i }).first();
      if (!(await infoIcon.count().catch(() => 0))) return { clicked: false, activePage: page };
      const newPagePromise = (page as any)
        .context()
        .waitForEvent('page', { timeout: 4000 })
        .catch(() => null);
      await infoIcon.click({ timeout: 4000 }).catch(() => {});
      await (page as any).waitForTimeout(1200);
      const newPage = await newPagePromise;
      const activePage = newPage || page;
      if (newPage) await activePage.waitForTimeout(800).catch(() => {});
      return { clicked: true, activePage };
    } catch {
      return { clicked: false, activePage: page };
    }
  }

  async detectVerificationChallenge(page: Page) {
    return challenge(page as any);
  }

  /** Reads the numeric verification value the page displays after the info
   * icon (mandate Section 14: "Never hardcode it. Read the number actually
   * displayed by the current page."). This is a best-effort text scan for a
   * short standalone digit run near a "შემოწმება"/verification-shaped
   * control — genuinely unknown exact markup since this sandbox cannot
   * reach the real site; if the mechanism turns out to BE a real
   * human-verification challenge, detectVerificationChallenge() above (the
   * same challenge() detector every workflow uses) is what correctly routes
   * to WAITING_HUMAN instead of this numeric-read path. */
  async readVerificationValue(page: Page): Promise<string | null> {
    try {
      const t = await pageText(page as any);
      const m = /(?:შემოწმ\w*|verif\w*)[^0-9]{0,40}(\d{2,6})/i.exec(t) || /\b(\d{2,6})\b/.exec(t);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  async submitVerificationValue(page: Page, value: string): Promise<boolean> {
    try {
      const hit = await interact(page as any, value, ['input[name*="verif" i]', 'input[id*="verif" i]', 'input[type="text"]']);
      if (!hit.found) return false;
      return true; // interact() already submits on a verified fill
    } catch {
      return false;
    }
  }

  async readEntityPage(page: Page): Promise<{ opened: boolean; text: string }> {
    const t = await pageText(page as any).catch(() => '');
    const opened = !!t && /რეგისტრაცი|სტატუსი|საიდენტიფიკაციო/i.test(t);
    return { opened, text: t };
  }

  async findLatestApplicationDate(page: Page): Promise<string[]> {
    try {
      const appsSection = (page as any).getByText(ENREG_APPLICATIONS_LABEL.slice(0, 8), { exact: false }).first();
      if (!(await appsSection.count().catch(() => 0))) return [];
      const sectionText = (await appsSection.locator('xpath=ancestor::div[1] | ancestor::section[1]').first().innerText().catch(() => '')) || (await pageText(page as any));
      return [...sectionText.matchAll(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g)].map((m) => m[0]);
    } catch {
      return [];
    }
  }

  async openLatestApplication(page: Page, date: string): Promise<boolean> {
    try {
      const el = (page as any).getByText(date, { exact: false }).first();
      if (await el.count().catch(() => 0)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await (page as any).waitForTimeout(800);
        return true;
      }
    } catch {
      /* not found */
    }
    return false;
  }

  async openPreparedDocuments(page: Page): Promise<boolean> {
    try {
      const el = (page as any).getByText(ENREG_PREPARED_DOCS_LABEL.slice(0, 12), { exact: false }).first();
      if (await el.count().catch(() => 0)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await (page as any).waitForTimeout(800);
        return true;
      }
    } catch {
      /* not found */
    }
    return false;
  }

  async openRegistryExtract(page: Page) {
    try {
      const el = (page as any).getByText('ამონაწერი', { exact: false }).first();
      if (!(await el.count().catch(() => 0))) return { opened: false, doc: null };
      const newPagePromise = (page as any)
        .context()
        .waitForEvent('page', { timeout: 4000 })
        .catch(() => null);
      await el.click({ timeout: 3000 }).catch(() => {});
      await (page as any).waitForTimeout(1200);
      const extractPage = (await newPagePromise) || page;
      const doc = await readOnlineDocument(extractPage, { url: extractPage.url(), label: ENREG_EXTRACT_LABEL }, 'enreg');
      return { opened: true, doc, activePage: extractPage };
    } catch {
      return { opened: false, doc: null, activePage: page };
    }
  }
}
