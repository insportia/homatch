// MsMapPage.ts — the MSMAP Page Object. Every method here does ONE browser
// action and returns the raw signal it actually observed — no status/FSM
// judgment happens in this file, that is MsMapWorkflow.ts's job (calling
// assertions.ts against these raw signals). Ported from the pre-refactor
// msmapAdapter()/msmapSuggestion()/msmapDeepDive() in index.js — the actual
// interaction logic is unchanged (it was already the most battle-tested
// part of the old code, confirmed live via /debug/msmap diagnostics); what
// changed is that it no longer decides completion itself.
//
// Playwright-touching — NOT unit-testable in this sandbox (no network path
// to ms.gov.ge). Local-syntax-checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { interact, candidateRankedRetry, visible, text as pageText } from '../../browser/BrowserSession.js';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';
import { readOnlineDocument } from '../../documents/OnlineDocumentReader.js';
import { classifyDocumentLink } from '../../documents/DocumentReader.js';
import type { ResearchDocument } from '../../documents/DocumentTypes.js';
import {
  CADASTRAL_SECTION_LABEL,
  REQUIRED_LAYER_1,
  REQUIRED_LAYER_2_PREFIX,
  SEARCH_INPUT_SELECTOR,
  UNIFIED_SEARCH_NETWORK_PATTERN,
  IDENTIFY_BUTTON_SELECTOR,
  IDENTIFY_BUTTON_SELECTOR_FALLBACKS,
  MAP_CANVAS_SELECTOR,
  INFO_POPUP_SELECTOR,
  NAPR_LINK_TEXT,
  LATEST_INFORMATION_LABEL,
  MAP_REDRAW_NETWORK_PATTERN,
} from './selectors.js';
import { MSMAP_URL } from './MsMapState.js';

async function pageLinks(p: any): Promise<{ url: string; label: string }[]> {
  const out: { url: string; label: string }[] = [];
  const frames = [p.mainFrame(), ...p.frames().filter((f: any) => f !== p.mainFrame())];
  for (const f of frames) {
    try {
      out.push(
        ...(await f.locator('a[href]').evaluateAll((as: any[]) =>
          as
            .slice(0, 300)
            .map((a) => ({ label: (a.textContent || '').trim().slice(0, 240), url: a.href }))
            .filter((x: any) => /^https?:/i.test(x.url))
        ))
      );
    } catch {
      /* frame not readable */
    }
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

export class MsMapPage {
  async goto(page: Page): Promise<void> {
    await (page as any).goto(MSMAP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await (page as any).waitForTimeout(1500);
  }

  async enterCadastral(page: Page, query: string) {
    let hit = await interact(page as any, query, [SEARCH_INPUT_SELECTOR], { networkPattern: UNIFIED_SEARCH_NETWORK_PATTERN });
    let usedFallback = false;
    if (!hit.found) {
      const retry = await candidateRankedRetry(page as any, query, { excludeLayers: true });
      if (retry.found) {
        hit = retry;
        usedFallback = true;
      }
    }
    return { found: hit.found, netConfirmed: !!hit.net?.matched, trace: hit.trace, usedFallback, candidates: (hit as any).candidates || null };
  }

  /** Waits for the Angular Material autocomplete suggestion — tries
   * progressively shorter cadastral prefixes since a real suggestion can
   * match at a shorter block/quarter-level prefix than the full query. */
  async waitForSuggestion(page: Page, query: string, { timeoutMs = 5000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {}) {
    const segs = query.split('.');
    const minSegs = Math.min(3, segs.length);
    const prefixes: string[] = [];
    for (let n = segs.length; n >= minSegs; n--) prefixes.push(segs.slice(0, n).join('.'));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const prefix of prefixes) {
        const opt = (page as any).locator(`text=${prefix}`).first();
        if (await visible(opt).catch(() => false)) return { found: true, prefix, el: opt };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return { found: false, prefix: null, el: null };
  }

  /** Clicks the located suggestion and reports whether the map genuinely
   * redrew (network-confirmed geoserver/tileserver requests), not merely
   * whether the click itself succeeded. */
  async clickSuggestionAndConfirmRedraw(page: Page, el: any) {
    const netFeature: string[] = [];
    const onFeature = (r: any) => {
      if (MAP_REDRAW_NETWORK_PATTERN.test(r.url())) netFeature.push(r.url());
    };
    (page as any).on('request', onFeature);
    let clicked = false;
    try {
      await el.click({ timeout: 5000 });
      clicked = true;
      await (page as any).waitForTimeout(1500);
    } catch {
      /* click failed — clicked stays false */
    }
    (page as any).off('request', onFeature);
    return { clicked, mapRedrawConfirmed: netFeature.length > 0, requestCount: netFeature.length };
  }

  async expandCadastralSection(page: Page): Promise<boolean> {
    try {
      const panel = (page as any).getByText(CADASTRAL_SECTION_LABEL, { exact: false }).first();
      if (await panel.count().catch(() => 0)) {
        await panel.click({ timeout: 3000 }).catch(() => {});
        await (page as any).waitForTimeout(500);
        return true;
      }
    } catch {
      /* panel not found */
    }
    return false;
  }

  async enableRequiredLayers(page: Page): Promise<{ layer1: boolean; layer2: boolean }> {
    let layer1 = false;
    let layer2 = false;
    try {
      const l1 = (page as any).getByText(REQUIRED_LAYER_1, { exact: false }).first();
      if (await l1.count().catch(() => 0)) {
        await l1.click({ timeout: 3000 }).catch(() => {});
        layer1 = true;
      }
      const l2 = (page as any).getByText(REQUIRED_LAYER_2_PREFIX, { exact: false }).first();
      if (await l2.count().catch(() => 0)) {
        await l2.click({ timeout: 3000 }).catch(() => {});
        layer2 = true;
      }
      await (page as any).waitForTimeout(800);
    } catch {
      /* best-effort — a failed layer toggle is honestly reported false */
    }
    return { layer1, layer2 };
  }

  /** Returns not just whether identify mode was activated, but which
   * selector actually matched (or none) and how many candidates each
   * selector found — the exact diagnostic the mandate asks for
   * ("inspect... to find why"), since a click that throws must never be
   * silently treated as success (the confirmed bug: the previous version
   * returned `true` merely because a matching element existed, even when
   * `.click()` itself failed and was swallowed by a bare `.catch(() => {})`). */
  async activateIdentify(page: Page): Promise<{ activated: boolean; matchedSelector: string | null; candidateCounts: Record<string, number> }> {
    const candidateCounts: Record<string, number> = {};
    const selectors = [IDENTIFY_BUTTON_SELECTOR, ...IDENTIFY_BUTTON_SELECTOR_FALLBACKS];
    for (const sel of selectors) {
      try {
        const btn = (page as any).locator(sel).first();
        const count = await (page as any).locator(sel).count().catch(() => 0);
        candidateCounts[sel] = count;
        if (!count) continue;
        await btn.click({ timeout: 3000 });
        await (page as any).waitForTimeout(500);
        return { activated: true, matchedSelector: sel, candidateCounts };
      } catch {
        /* this selector matched an element but the click itself failed —
         * an honest false, not a silently-assumed success; try the next
         * candidate rather than giving up immediately. */
        continue;
      }
    }
    return { activated: false, matchedSelector: null, candidateCounts };
  }

  async clickParcelCenter(page: Page): Promise<boolean> {
    try {
      const mapEl = (page as any).locator(MAP_CANVAS_SELECTOR).first();
      if (await mapEl.count().catch(() => 0)) {
        const box = await mapEl.boundingBox().catch(() => null);
        if (box) {
          await (page as any).mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await (page as any).waitForTimeout(1000);
          return true;
        }
      }
    } catch {
      /* not found */
    }
    return false;
  }

  async openInfoPopupAndNaprLink(page: Page) {
    try {
      const popup = (page as any).locator(INFO_POPUP_SELECTOR).first();
      if (!(await popup.count().catch(() => 0))) return { popupOpened: false, naprOpened: false, target: page, extraText: null };
      const naprLink = popup.locator('a,button').filter({ hasText: NAPR_LINK_TEXT }).first();
      if (!(await naprLink.count().catch(() => 0))) return { popupOpened: true, naprOpened: false, target: page, extraText: null };
      const [naprPage] = await Promise.all([
        (page as any)
          .context()
          .waitForEvent('page', { timeout: 5000 })
          .catch(() => null),
        naprLink.click({ timeout: 3000 }).catch(() => {}),
      ]);
      const target = naprPage || page;
      await target.waitForTimeout(1500).catch(() => {});
      return { popupOpened: true, naprOpened: true, target, extraText: null, isNewPage: !!naprPage };
    } catch {
      return { popupOpened: false, naprOpened: false, target: page, extraText: null };
    }
  }

  async openLatestInformation(target: Page): Promise<boolean> {
    try {
      const latest = (target as any).getByText(LATEST_INFORMATION_LABEL, { exact: false }).first();
      if (await latest.count().catch(() => 0)) {
        await latest.click({ timeout: 3000 }).catch(() => {});
        await (target as any).waitForTimeout(1000).catch(() => {});
        return true;
      }
    } catch {
      /* not found */
    }
    return false;
  }

  /** Reads whatever documents the NAPR/registry page (opened from the
   * parcel's info popup) itself exposes — the previous architecture read
   * only this page's TEXT and never followed its own document links. */
  async readChildDocuments(target: Page): Promise<ResearchDocument[]> {
    try {
      const links = await pageLinks(target as any);
      const pageUrl = (target as any).url();
      const docs: ResearchDocument[] = [];
      for (const l of links) {
        const cls = classifyDocumentLink(l, { pageUrl });
        if (!cls.worthOpening) continue;
        if (cls.looksLikeDirectFile) docs.push(await readPdfDocument(target, l, 'msmap'));
        else docs.push(await readOnlineDocument(target, l, 'msmap'));
        if (docs.length >= 12) break;
      }
      return docs;
    } catch {
      return [];
    }
  }

  async readText(target: Page): Promise<string> {
    return pageText(target as any).catch(() => '');
  }
}
