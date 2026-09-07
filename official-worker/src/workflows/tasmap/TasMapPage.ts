// TasMapPage.ts — live-verified TAS_MAP browser adapter.
//
// Verified 2026-09-07 against the real UI:
// direct MS Map -> cadastral input -> Enter -> suggestion -> highlighted parcel
// -> expand only "საკადასტრო მონაცემები" -> enable the two cadastral layers
// -> Identify -> parcel -> app-info-result-window -> NAPR -> enumerate unique
// registration numbers once -> open each document once -> read every PDF page.

import type { Page } from 'playwright';
import { text as pageText } from '../../browser/BrowserSession.js';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';
import type { ResearchDocument } from '../../documents/DocumentTypes.js';
import {
  MS_MAP_URL,
  MAP_SEARCH_INPUT_SELECTOR,
  MAP_CANVAS_SELECTOR,
  MAP_CANVAS_SELECTOR_FALLBACK,
  MAP_REDRAW_NETWORK_PATTERN,
  CADASTRAL_LAYER_CATEGORY,
  REQUIRED_LAYER_1,
  REQUIRED_LAYER_2,
  REQUIRED_LAYER_2_PREFIX,
  INFO_ICON_ROLE_NAME,
  INFO_ICON_SELECTOR_FALLBACKS,
  INFO_RESULT_WINDOW_SELECTOR,
  PUBLIC_REGISTRY_ROW_TEXT,
  NAPR_REGISTRATION_PATTERN,
} from './selectors.js';

const SOURCE = 'TAS_MAP';

export interface LayerDiagnostics {
  treeNodeCount: number;
  expandedNodeCount: number;
  matchedLayers: string[];
  missingLayers: string[];
  checkboxBefore: Record<string, boolean | null>;
  checkboxAfter: Record<string, boolean | null>;
}

export interface NaprTraversalResult {
  discovered: number;
  visited: number;
  failed: number;
  duplicateUrls: number;
  registrations: string[];
  documents: ResearchDocument[];
}

function normalizeText(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function readCheckedState(node: any): Promise<boolean | null> {
  const input = node.locator('input[type="checkbox"], mat-checkbox input').first();
  if (await input.count().catch(() => 0)) {
    const checked = await input.isChecked().catch(() => null);
    if (checked !== null) return checked;
  }
  const roleCheckbox = node.locator('[role="checkbox"]').first();
  if (await roleCheckbox.count().catch(() => 0)) {
    const aria = await roleCheckbox.getAttribute('aria-checked').catch(() => null);
    if (aria === 'true') return true;
    if (aria === 'false') return false;
  }
  return null;
}

export class TasMapPage {
  /** Open the exact direct URL that was verified live. */
  async openDirectMap(page: Page): Promise<{ opened: boolean; mapPage: Page | null; matchedSelector: string | null }> {
    try {
      await (page as any).goto(MS_MAP_URL, { waitUntil: 'commit', timeout: 90000 });
      const search = (page as any).locator(MAP_SEARCH_INPUT_SELECTOR).first();
      await search.waitFor({ state: 'visible', timeout: 60000 });
      await (page as any).waitForTimeout(1000);
      return { opened: true, mapPage: page, matchedSelector: MAP_SEARCH_INPUT_SELECTOR };
    } catch {
      return { opened: false, mapPage: null, matchedSelector: MAP_SEARCH_INPUT_SELECTOR };
    }
  }

  /** Fill the real cadastral input and PRESS ENTER — Enter is required live. */
  async enterCadastralInMap(mapPage: Page, query: string): Promise<{ found: boolean; submitted: boolean }> {
    try {
      const box = (mapPage as any).locator(MAP_SEARCH_INPUT_SELECTOR).first();
      if (!(await box.count().catch(() => 0))) return { found: false, submitted: false };
      await box.click({ timeout: 5000 }).catch(() => {});
      await box.fill(query, { timeout: 10000 });
      const val = String(await box.inputValue().catch(() => '')).replace(/\s/g, '');
      if (val !== query.replace(/\s/g, '')) return { found: false, submitted: false };
      await box.press('Enter', { timeout: 5000 });
      await (mapPage as any).waitForTimeout(1400);
      return { found: true, submitted: true };
    } catch {
      return { found: false, submitted: false };
    }
  }

  async waitForSuggestion(mapPage: Page, query: string, { timeoutMs = 15000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {}) {
    const segs = query.split('.');
    const minSegs = Math.min(3, segs.length);
    const prefixes: string[] = [];
    for (let n = segs.length; n >= minSegs; n--) prefixes.push(segs.slice(0, n).join('.'));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const prefix of prefixes) {
        const opt = (mapPage as any).getByText(prefix, { exact: false }).first();
        if (await opt.isVisible().catch(() => false)) return { found: true, prefix, el: opt };
      }
      await (mapPage as any).waitForTimeout(pollMs);
    }
    return { found: false, prefix: null, el: null };
  }

  async clickSuggestionAndConfirmRedraw(mapPage: Page, el: any) {
    const netFeature: string[] = [];
    const onFeature = (r: any) => {
      if (MAP_REDRAW_NETWORK_PATTERN.test(r.url())) netFeature.push(r.url());
    };
    (mapPage as any).on('request', onFeature);
    let clicked = false;
    try {
      await el.click({ timeout: 7000 });
      clicked = true;
      await (mapPage as any).waitForTimeout(1600);
    } catch {
      /* raw signal stays false */
    }
    (mapPage as any).off('request', onFeature);
    const stillVisible = await el.isVisible().catch(() => true);
    const canvasPresent = await (mapPage as any).locator(MAP_CANVAS_SELECTOR).first().count().catch(() => 0);
    const domConfirmed = clicked && !stillVisible && canvasPresent > 0;
    return {
      clicked,
      redrawConfirmed: netFeature.length > 0 || domConfirmed,
      requestCount: netFeature.length,
      domConfirmed,
    };
  }

  /**
   * Open only the cadastral category and enable only the two live-verified
   * cadastral layers. Deliberately never expands the whole layer tree.
   */
  async enableRequiredLayers(mapPage: Page): Promise<{ results: Record<string, boolean>; diagnostics: LayerDiagnostics }> {
    const results: Record<string, boolean> = {};
    const matchedLayers: string[] = [];
    const missingLayers: string[] = [];
    const checkboxBefore: Record<string, boolean | null> = {};
    const checkboxAfter: Record<string, boolean | null> = {};

    const category = (mapPage as any).getByText(CADASTRAL_LAYER_CATEGORY, { exact: false }).first();
    if (await category.isVisible().catch(() => false)) {
      await category.scrollIntoViewIfNeeded().catch(() => {});
      await category.click({ timeout: 5000 }).catch(() => {});
      await (mapPage as any).waitForTimeout(700);
    }

    const enableOne = async (labelText: string, looseText?: string) => {
      let label = (mapPage as any).getByText(labelText, { exact: false }).first();
      if (!(await label.isVisible().catch(() => false)) && looseText) {
        label = (mapPage as any).getByText(looseText, { exact: false }).first();
      }
      if (!(await label.isVisible().catch(() => false))) {
        results[labelText] = false;
        checkboxBefore[labelText] = null;
        checkboxAfter[labelText] = null;
        missingLayers.push(labelText);
        return;
      }

      await label.scrollIntoViewIfNeeded().catch(() => {});
      const row = label.locator('xpath=ancestor::*[self::mat-tree-node or self::mat-nested-tree-node or @role="treeitem"][1]');
      const node = (await row.count().catch(() => 0)) ? row : label.locator('..');
      const before = await readCheckedState(node);
      checkboxBefore[labelText] = before;

      if (before !== true) {
        const nativeCb = node.locator('input[type="checkbox"], mat-checkbox input').first();
        const roleCb = node.locator('[role="checkbox"]').first();
        if (await nativeCb.count().catch(() => 0)) {
          await nativeCb.click({ force: true, timeout: 5000 }).catch(() => {});
        } else if (await roleCb.count().catch(() => 0)) {
          await roleCb.click({ force: true, timeout: 5000 }).catch(() => {});
        } else {
          await label.click({ force: true, timeout: 5000 }).catch(() => {});
        }
        await (mapPage as any).waitForTimeout(700);
      }

      const after = await readCheckedState(node);
      checkboxAfter[labelText] = after;
      results[labelText] = after === true;
      if (after === true) matchedLayers.push(labelText);
      else missingLayers.push(labelText);
    };

    await enableOne(REQUIRED_LAYER_1);
    await enableOne(REQUIRED_LAYER_2, REQUIRED_LAYER_2_PREFIX);

    const treeNodeCount = await (mapPage as any).locator('[role="treeitem"],mat-tree-node,mat-nested-tree-node').count().catch(() => 0);
    return {
      results,
      diagnostics: {
        treeNodeCount,
        expandedNodeCount: 1,
        matchedLayers,
        missingLayers,
        checkboxBefore,
        checkboxAfter,
      },
    };
  }

  async activateIdentify(mapPage: Page): Promise<{ activated: boolean; matchedSelector: string | null }> {
    try {
      const img = (mapPage as any).getByRole('img', { name: INFO_ICON_ROLE_NAME }).first();
      if (await img.count().catch(() => 0)) {
        await img.click({ timeout: 5000 });
        await (mapPage as any).waitForTimeout(500);
        return { activated: true, matchedSelector: `role=img[name="${INFO_ICON_ROLE_NAME}"]` };
      }
    } catch {
      /* use fallbacks */
    }
    for (const sel of INFO_ICON_SELECTOR_FALLBACKS) {
      try {
        const btn = (mapPage as any).locator(sel).first();
        if (await btn.count().catch(() => 0)) {
          await btn.click({ timeout: 5000 });
          await (mapPage as any).waitForTimeout(500);
          return { activated: true, matchedSelector: sel };
        }
      } catch {
        /* try next */
      }
    }
    return { activated: false, matchedSelector: null };
  }

  async clickParcelCenter(mapPage: Page): Promise<boolean> {
    for (const sel of [MAP_CANVAS_SELECTOR, MAP_CANVAS_SELECTOR_FALLBACK]) {
      try {
        const el = (mapPage as any).locator(sel).first();
        if (!(await el.count().catch(() => 0))) continue;
        const box = await el.boundingBox().catch(() => null);
        if (!box) continue;
        await (mapPage as any).mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await (mapPage as any).waitForTimeout(900);
        return true;
      } catch {
        /* try fallback canvas */
      }
    }
    return false;
  }

  async openParcelInfoWindow(mapPage: Page): Promise<{ opened: boolean; windowText: string | null }> {
    try {
      const win = (mapPage as any).locator(INFO_RESULT_WINDOW_SELECTOR).first();
      if (!(await win.count().catch(() => 0))) return { opened: false, windowText: null };
      if (!(await win.isVisible().catch(() => false))) return { opened: false, windowText: null };
      const windowText = await win.innerText({ timeout: 5000 }).catch(() => null);
      return { opened: true, windowText };
    } catch {
      return { opened: false, windowText: null };
    }
  }

  /**
   * Persistent-but-bounded live retry. A transient missed map click must not
   * abort the browser run. Re-arm Identify and retry up to 60 times, polling
   * the info window after each click. This is the exact behavior validated in
   * the final local test.
   */
  async openParcelInfoWithRetry(mapPage: Page, maxAttempts = 60): Promise<{ opened: boolean; windowText: string | null; attempts: number; parcelClicked: boolean }> {
    let anyClick = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if ((mapPage as any).isClosed?.()) break;
      if (attempt > 1) {
        await this.activateIdentify(mapPage).catch(() => ({ activated: false, matchedSelector: null }));
        await (mapPage as any).waitForTimeout(500);
      }
      const clicked = await this.clickParcelCenter(mapPage);
      anyClick = anyClick || clicked;
      if (!clicked) {
        await (mapPage as any).waitForTimeout(1000);
        continue;
      }
      for (let poll = 0; poll < 8; poll++) {
        await (mapPage as any).waitForTimeout(750);
        const info = await this.openParcelInfoWindow(mapPage);
        if (info.opened) return { ...info, attempts: attempt, parcelClicked: true };
      }
      await (mapPage as any).waitForTimeout(1200);
    }
    return { opened: false, windowText: null, attempts: maxAttempts, parcelClicked: anyClick };
  }

  /** Hardened NAPR handoff: direct link click + long popup wait + context fallback. */
  async openPublicRegistryLink(mapPage: Page): Promise<{ found: boolean; opened: boolean; target: Page | null }> {
    try {
      const win = (mapPage as any).locator(INFO_RESULT_WINDOW_SELECTOR).first();
      if (!(await win.count().catch(() => 0))) return { found: false, opened: false, target: null };

      const row = win.getByRole('row', { name: new RegExp(PUBLIC_REGISTRY_ROW_TEXT) }).first();
      let link: any = null;
      if (await row.count().catch(() => 0)) {
        const rowLink = row.getByRole('link').first();
        if (await rowLink.count().catch(() => 0)) link = rowLink;
      }
      if (!link) {
        const firstAnchor = win.locator('a').first();
        if (await firstAnchor.count().catch(() => 0)) link = firstAnchor;
      }
      if (!link) return { found: false, opened: false, target: null };

      const existing = new Set((mapPage as any).context().pages());
      const popupPromise = (mapPage as any).context().waitForEvent('page', { timeout: 20000 }).catch(() => null);
      await link.click({ timeout: 10000 }).catch(() => {});
      let target = await popupPromise;
      if (!target) {
        await (mapPage as any).waitForTimeout(2500);
        target = (mapPage as any).context().pages().find((p: Page) => p !== mapPage && !existing.has(p)) || null;
      }
      if (target) {
        await target.waitForLoadState('commit', { timeout: 30000 }).catch(() => {});
        await target.waitForTimeout(1800).catch(() => {});
      }
      return { found: true, opened: !!target, target: target || null };
    } catch {
      return { found: false, opened: false, target: null };
    }
  }

  /**
   * Snapshot the NAPR registration list ONCE, dedupe by registration number,
   * click registration numbers only (never dates), dedupe again by final blob
   * URL, read every PDF page, and stop after the one pass.
   */
  async traverseNaprRegistrationDocuments(naprPage: Page): Promise<NaprTraversalResult> {
    const registrationMap = new Map<string, { registration: string }>();
    const candidates = (naprPage as any).locator('td, div, span');
    const count = await candidates.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const raw = normalizeText(await candidates.nth(i).innerText().catch(() => ''));
      if (!raw) continue;
      const match = raw.match(NAPR_REGISTRATION_PATTERN);
      if (!match) continue;
      const registration = match[1];
      if (!registrationMap.has(registration)) registrationMap.set(registration, { registration });
    }

    const records = Array.from(registrationMap.values());
    const visitedRegistrations = new Set<string>();
    const visitedUrls = new Set<string>();
    const documents: ResearchDocument[] = [];
    let failed = 0;
    let duplicateUrls = 0;

    for (const record of records) {
      if (visitedRegistrations.has(record.registration)) continue;
      visitedRegistrations.add(record.registration);

      const clickTarget = (naprPage as any).getByText(record.registration, { exact: false }).first();
      if (!(await clickTarget.count().catch(() => 0))) {
        failed++;
        continue;
      }

      const pagesBefore = new Set((naprPage as any).context().pages());
      const beforeUrl = (naprPage as any).url();
      const popupPromise = (naprPage as any).context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
      await clickTarget.click({ timeout: 7000 }).catch(async () => {
        await clickTarget.click({ force: true, timeout: 3000 }).catch(() => {});
      });

      let docPage: Page | null = await popupPromise;
      let openedAsChild = !!docPage;
      if (!docPage) {
        await (naprPage as any).waitForTimeout(1500);
        docPage = (naprPage as any).context().pages().find((p: Page) => p !== naprPage && !pagesBefore.has(p)) || null;
        openedAsChild = !!docPage;
      }
      if (!docPage && (naprPage as any).url() !== beforeUrl) {
        docPage = naprPage;
        openedAsChild = false;
      }
      if (!docPage) {
        failed++;
        continue;
      }

      await docPage.waitForLoadState('commit', { timeout: 30000 }).catch(() => {});
      await docPage.waitForTimeout(1000).catch(() => {});
      const documentUrl = docPage.url();

      if (visitedUrls.has(documentUrl)) {
        duplicateUrls++;
      } else {
        visitedUrls.add(documentUrl);
        const doc = await readPdfDocument(
          naprPage,
          { url: documentUrl, label: `NAPR registration ${record.registration}` },
          `${SOURCE}_NAPR_REGISTRATION`,
        );
        (doc as any).registrationNumber = record.registration;
        documents.push(doc);
        if (!doc.complete || !doc.rawText || !doc.rawText.trim()) failed++;
      }

      if (openedAsChild && docPage !== naprPage) {
        await docPage.close().catch(() => {});
      } else if (docPage === naprPage) {
        await (naprPage as any).goBack({ waitUntil: 'commit', timeout: 30000 }).catch(() => {});
        await (naprPage as any).waitForTimeout(1200);
      }
    }

    return {
      discovered: records.length,
      visited: visitedRegistrations.size - failed,
      failed,
      duplicateUrls,
      registrations: records.map((r) => r.registration),
      documents,
    };
  }

  async readText(target: Page): Promise<string> {
    return pageText(target as any).catch(() => '');
  }
}
