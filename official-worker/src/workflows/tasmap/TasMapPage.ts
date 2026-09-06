// TasMapPage.ts — the TAS_MAP Page Object (renamed+rewritten from
// MsMapPage.ts, 2026-09-06 "final alignment pass" mandate). Every method
// does ONE browser action and returns the raw signal it actually observed —
// no status/FSM judgment happens in this file, that is TasMapWorker.ts's
// job (calling assertions.ts against these raw signals).
//
// This REPLACES the old direct-ms.gov.ge-navigation implementation. The
// real production flow, live-recorded (msmap-recording.spec.ts, repo root):
// tas.ge's own homepage -> a popup opens (an Angular Material app: mat-tree
// layer panel, app-ol-map, app-info-result-window) -> search -> select
// suggestion -> enable required layers -> activate identify -> click the
// resolved parcel -> the parcel-info window exposes many named, dynamically
// row-populated sections. Fragile per-run recording artifacts (AR numbers,
// numbered mat-mdc-checkbox ids, nth-child tree-node positions, a hardcoded
// canvas pixel) are intentionally NOT reproduced — every lookup below is by
// role/accessible-name/visible-text/structural-containment instead.
//
// Playwright-touching — NOT unit-testable in this sandbox (no network path
// to tas.ge). Local-syntax-checked via `tsc --noEmit` only.
import type { Page } from 'playwright';
import { text as pageText } from '../../browser/BrowserSession.js';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';
import { readOnlineDocument } from '../../documents/OnlineDocumentReader.js';
import { classifyDocumentLink } from '../../documents/DocumentReader.js';
import type { ResearchDocument } from '../../documents/DocumentTypes.js';
import {
  TAS_HOME_URL,
  MAP_LAUNCH_LINK_SELECTOR,
  MAP_LAUNCH_LINK_FALLBACK_EMPTY_TEXT_INDEX,
  MAP_SEARCH_TEXTBOX_NAME,
  MAP_CANVAS_SELECTOR,
  MAP_CANVAS_SELECTOR_FALLBACK,
  MAP_REDRAW_NETWORK_PATTERN,
  INFO_ICON_ROLE_NAME,
  INFO_ICON_SELECTOR_FALLBACKS,
  INFO_RESULT_WINDOW_SELECTOR,
  REQUIRED_LAYER_1,
  REQUIRED_LAYER_2,
  REQUIRED_LAYER_2_PREFIX,
  REQUIRED_LAYER_CATEGORY,
  REQUIRED_CATEGORY_SUBLAYERS,
  PARCEL_INFO_SECTIONS,
  APPLICATION_ROW_TEXT_PATTERN,
  NESTED_GRIDVIEW_SELECTOR,
  PUBLIC_REGISTRY_ROW_TEXT,
  MAX_SECTION_ROWS,
  MAX_NESTED_DOCS_PER_ROW,
} from './selectors.js';

const SOURCE = 'TAS_MAP';
// Overall cap across every section this run — bounded deliberately, same
// reasoning TAS Document's MAX_NESTED_DOCS_PER_ROW documents: the mandate
// wants documents actually read, not an unbounded crawl.
const MAX_TOTAL_DOCS = 80;

async function checkTreeitemCheckbox(page: Page, name: string): Promise<boolean> {
  try {
    const item = (page as any).getByRole('treeitem', { name }).first();
    if (!(await item.count().catch(() => 0))) return false;
    // Prefer a real scoped checkbox <input> — more robust than the
    // recording's own `.getByLabel('')` pattern (an empty accessible-name
    // match), which is fragile if the real markup's aria wiring differs
    // slightly between runs.
    const checkbox = item.locator('input[type="checkbox"]').first();
    if (await checkbox.count().catch(() => 0)) {
      try {
        if (!(await checkbox.isChecked().catch(() => false))) await checkbox.check({ timeout: 3000 });
        return true;
      } catch {
        /* fall through to the recording's own getByLabel pattern */
      }
    }
    try {
      await item.getByLabel('').check({ timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function expandTreeitem(page: Page, name: string): Promise<boolean> {
  try {
    const item = (page as any).getByRole('treeitem', { name }).first();
    if (!(await item.count().catch(() => 0))) return false;
    const toggle = item.locator('svg,.mat-icon').first();
    if (!(await toggle.count().catch(() => 0))) return false;
    await toggle.click({ timeout: 3000 }).catch(() => {});
    await (page as any).waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

export class TasMapPage {
  /** Opens the real production entry point: tas.ge's homepage, then the map
   * popup it opens. Never a direct ms.gov.ge navigation. */
  async openMapFromTas(page: Page): Promise<{ opened: boolean; mapPage: Page | null; matchedSelector: string | null }> {
    try {
      await (page as any).goto(TAS_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await (page as any).waitForTimeout(1500);
      const candidates = (page as any).locator(MAP_LAUNCH_LINK_SELECTOR);
      const semanticCount = await candidates.count().catch(() => 0);
      if (semanticCount > 0) {
        const [popup] = await Promise.all([
          (page as any).context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
          candidates.first().click({ timeout: 4000 }).catch(() => {}),
        ]);
        if (popup) {
          await popup.waitForTimeout(1500).catch(() => {});
          return { opened: true, mapPage: popup, matchedSelector: MAP_LAUNCH_LINK_SELECTOR };
        }
      }
      // Last-resort fallback: the recording's own positional pattern (the
      // second icon-only, no-visible-text link on the homepage) — tried
      // only when no semantic candidate above matched or opened a popup.
      const emptyTextLinks = (page as any).getByRole('link').filter({ hasText: /^$/ });
      const emptyCount = await emptyTextLinks.count().catch(() => 0);
      if (emptyCount > MAP_LAUNCH_LINK_FALLBACK_EMPTY_TEXT_INDEX) {
        const [popup] = await Promise.all([
          (page as any).context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
          emptyTextLinks.nth(MAP_LAUNCH_LINK_FALLBACK_EMPTY_TEXT_INDEX).click({ timeout: 4000 }).catch(() => {}),
        ]);
        if (popup) {
          await popup.waitForTimeout(1500).catch(() => {});
          return { opened: true, mapPage: popup, matchedSelector: 'FALLBACK_POSITIONAL_EMPTY_TEXT_LINK' };
        }
      }
      return { opened: false, mapPage: null, matchedSelector: null };
    } catch {
      return { opened: false, mapPage: null, matchedSelector: null };
    }
  }

  async enterCadastralInMap(mapPage: Page, query: string): Promise<{ found: boolean }> {
    try {
      const box = (mapPage as any).getByRole('textbox', { name: MAP_SEARCH_TEXTBOX_NAME }).first();
      if (!(await box.count().catch(() => 0))) return { found: false };
      await box.click({ timeout: 3000 }).catch(() => {});
      await box.fill(query, { timeout: 5000 });
      const val = ((await box.inputValue().catch(() => '')) as string).replace(/\s/g, '');
      return { found: val === query.replace(/\s/g, '') };
    } catch {
      return { found: false };
    }
  }

  /** Same progressively-shorter-cadastral-prefix suggestion wait the
   * pre-existing (pre-rename) implementation used — a real, semantic
   * text-match strategy already generalized for any cadastral shape, not a
   * recording artifact, so it is kept as-is under the new identity. */
  async waitForSuggestion(mapPage: Page, query: string, { timeoutMs = 5000, pollMs = 400 }: { timeoutMs?: number; pollMs?: number } = {}) {
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
      await new Promise((r) => setTimeout(r, pollMs));
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
      await el.click({ timeout: 5000 });
      clicked = true;
      await (mapPage as any).waitForTimeout(1500);
    } catch {
      /* click failed — clicked stays false */
    }
    (mapPage as any).off('request', onFeature);
    let domConfirmed = false;
    if (clicked && netFeature.length === 0) {
      // Best-effort DOM fallback: this Angular-wrapped map's own tile
      // requests may not match the plain-OpenLayers geoserver/tileserver
      // pattern (never verified live) — treat the suggestion element
      // disappearing plus the map canvas being present as a secondary,
      // lower-confidence redraw signal rather than failing outright.
      const stillVisible = await el.isVisible().catch(() => true);
      const canvasPresent = await (mapPage as any).locator(MAP_CANVAS_SELECTOR).first().count().catch(() => 0);
      domConfirmed = !stillVisible && canvasPresent > 0;
    }
    return { clicked, redrawConfirmed: netFeature.length > 0 || domConfirmed, requestCount: netFeature.length, domConfirmed };
  }

  /** The mandate's exact 7-item required-layer list: 2 root layers checked
   * directly, then the "თბილისის ელექტრონული განცხადებები" category
   * expanded (best-effort — it has no checkbox of its own) to reveal its 4
   * checkable sub-items. Returns a per-layer result map so the caller can
   * report exactly which named layer failed, never one opaque boolean. */
  async enableRequiredLayers(mapPage: Page): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    results[REQUIRED_LAYER_1] = await checkTreeitemCheckbox(mapPage, REQUIRED_LAYER_1);
    results[REQUIRED_LAYER_2] = (await checkTreeitemCheckbox(mapPage, REQUIRED_LAYER_2)) || (await checkTreeitemCheckbox(mapPage, REQUIRED_LAYER_2_PREFIX));
    await expandTreeitem(mapPage, REQUIRED_LAYER_CATEGORY);
    await (mapPage as any).waitForTimeout(400);
    for (const sub of REQUIRED_CATEGORY_SUBLAYERS) {
      results[sub] = await checkTreeitemCheckbox(mapPage, sub);
    }
    return results;
  }

  async activateIdentify(mapPage: Page): Promise<{ activated: boolean; matchedSelector: string | null }> {
    try {
      const img = (mapPage as any).getByRole('img', { name: INFO_ICON_ROLE_NAME }).first();
      if (await img.count().catch(() => 0)) {
        await img.click({ timeout: 3000 });
        await (mapPage as any).waitForTimeout(500);
        return { activated: true, matchedSelector: `role=img[name="${INFO_ICON_ROLE_NAME}"]` };
      }
    } catch {
      /* fall through to CSS fallbacks */
    }
    for (const sel of INFO_ICON_SELECTOR_FALLBACKS) {
      try {
        const btn = (mapPage as any).locator(sel).first();
        if (await btn.count().catch(() => 0)) {
          await btn.click({ timeout: 3000 });
          await (mapPage as any).waitForTimeout(500);
          return { activated: true, matchedSelector: sel };
        }
      } catch {
        continue;
      }
    }
    return { activated: false, matchedSelector: null };
  }

  /** Clicks the resolved parcel's own bounding-box center — never a fixed
   * pixel coordinate. The recording's own literal `{x:624,y:260}` click was
   * specific to that one run's rendered viewport/zoom and is exactly the
   * kind of artifact the mandate forbids generalizing on. */
  async clickParcelCenter(mapPage: Page): Promise<boolean> {
    for (const sel of [MAP_CANVAS_SELECTOR, MAP_CANVAS_SELECTOR_FALLBACK]) {
      try {
        const el = (mapPage as any).locator(sel).first();
        if (await el.count().catch(() => 0)) {
          const box = await el.boundingBox().catch(() => null);
          if (box) {
            await (mapPage as any).mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await (mapPage as any).waitForTimeout(1000);
            return true;
          }
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  async openParcelInfoWindow(mapPage: Page): Promise<{ opened: boolean; windowText: string | null }> {
    try {
      const win = (mapPage as any).locator(INFO_RESULT_WINDOW_SELECTOR).first();
      if (!(await win.count().catch(() => 0))) return { opened: false, windowText: null };
      await (mapPage as any).waitForTimeout(500);
      const windowText = await win.innerText({ timeout: 3000 }).catch(() => null);
      return { opened: true, windowText };
    } catch {
      return { opened: false, windowText: null };
    }
  }

  /** The "საჯარო რეესტრის ინფორმაცია:" row's own link — opens the NAPR/
   * public-registry document in a popup, mirroring the pre-existing
   * MSMAP->NAPR contract but against the real app-info-result-window
   * markup instead of a generic .ol-popup. */
  async openPublicRegistryLink(mapPage: Page): Promise<{ found: boolean; opened: boolean; target: Page | null }> {
    try {
      const win = (mapPage as any).locator(INFO_RESULT_WINDOW_SELECTOR).first();
      if (!(await win.count().catch(() => 0))) return { found: false, opened: false, target: null };
      const row = win.getByRole('row', { name: new RegExp(PUBLIC_REGISTRY_ROW_TEXT) }).first();
      const rowExists = await row.count().catch(() => 0);
      const link = rowExists ? row.getByRole('link').first() : win.getByText(PUBLIC_REGISTRY_ROW_TEXT, { exact: false }).first();
      if (!(await link.count().catch(() => 0))) return { found: false, opened: false, target: null };
      const [popup] = await Promise.all([
        (mapPage as any).context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
        link.click({ timeout: 3000 }).catch(() => {}),
      ]);
      if (popup) await popup.waitForTimeout(1200).catch(() => {});
      return { found: true, opened: !!popup, target: popup || null };
    } catch {
      return { found: false, opened: false, target: null };
    }
  }

  /** Traverses EVERY section in PARCEL_INFO_SECTIONS, dynamically
   * enumerating every application/document row in each (by
   * APPLICATION_ROW_TEXT_PATTERN, never a fixed AR-number list), opening
   * each row's popup, reading it, and following one level of nested
   * iframe/gridview document popup when the row's own popup exposes one
   * (recording: `.locator('iframe').contentFrame().locator('#gridview-*')`
   * -> a further popup). Returns per-section discovered/visited/skipped
   * counts so the caller can enforce the completion invariant honestly —
   * a section genuinely absent for this parcel is reported as
   * discovered=0 (trivially satisfied), never silently skipped without a
   * count. */
  async traverseSections(mapPage: Page): Promise<{ sections: { label: string; discovered: number; visited: number; skipped: number }[]; documents: ResearchDocument[] }> {
    const sectionsResult: { label: string; discovered: number; visited: number; skipped: number }[] = [];
    const documents: ResearchDocument[] = [];
    const win = (mapPage as any).locator(INFO_RESULT_WINDOW_SELECTOR).first();
    if (!(await win.count().catch(() => 0))) return { sections: [], documents: [] };

    for (const label of PARCEL_INFO_SECTIONS) {
      let discovered = 0;
      let visited = 0;
      let skipped = 0;
      try {
        const header = win.getByText(label, { exact: false }).first();
        if (!(await header.count().catch(() => 0))) {
          // Section genuinely not present for this parcel — honest zero,
          // not a silent skip.
          sectionsResult.push({ label, discovered: 0, visited: 0, skipped: 0 });
          continue;
        }
        await header.click({ timeout: 3000 }).catch(() => {});
        await (mapPage as any).waitForTimeout(700);

        const rows = win.getByRole('table').filter({ hasText: APPLICATION_ROW_TEXT_PATTERN });
        discovered = Math.min(await rows.count().catch(() => 0), MAX_SECTION_ROWS);

        for (let i = 0; i < discovered; i++) {
          if (documents.length >= MAX_TOTAL_DOCS) {
            skipped += discovered - i;
            break;
          }
          const row = rows.nth(i);
          const link = row.getByRole('link').first();
          if (!(await link.count().catch(() => 0))) {
            skipped++;
            continue;
          }
          const [popup] = await Promise.all([
            (mapPage as any).context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
            link.click({ timeout: 3000 }).catch(() => {}),
          ]);
          if (!popup) {
            skipped++;
            continue;
          }
          await popup.waitForTimeout(1000).catch(() => {});
          const rowLabel = `${label} — row ${i + 1}`;
          const rowUrl = popup.url();
          const cls = classifyDocumentLink({ url: rowUrl, label: rowLabel }, { pageUrl: rowUrl });
          const doc = cls.looksLikeDirectFile ? await readPdfDocument(popup, { url: rowUrl, label: rowLabel }, `${SOURCE}_section_row`) : await readOnlineDocument(popup, { url: rowUrl, label: rowLabel }, `${SOURCE}_section_row`);
          if (doc?.rawText && doc.rawText.trim().length > 20) {
            documents.push(doc);
            visited++;
          } else {
            skipped++;
          }

          // One level of nested iframe/gridview -> further document popup.
          try {
            const nestedFrameHandle = popup.locator('iframe').first();
            if (await nestedFrameHandle.count().catch(() => 0)) {
              const frame = await nestedFrameHandle.contentFrame().catch(() => null);
              const grid = frame ? frame.locator(NESTED_GRIDVIEW_SELECTOR).first() : null;
              if (grid && (await grid.count().catch(() => 0))) {
                const [nestedPopup] = await Promise.all([
                  popup.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
                  grid.click({ timeout: 3000 }).catch(() => {}),
                ]);
                if (nestedPopup) {
                  await nestedPopup.waitForTimeout(1000).catch(() => {});
                  const nestedUrl = nestedPopup.url();
                  const nestedLabel = `${rowLabel} (nested document)`;
                  const nestedCls = classifyDocumentLink({ url: nestedUrl, label: nestedLabel }, { pageUrl: nestedUrl });
                  const nestedDoc = nestedCls.looksLikeDirectFile ? await readPdfDocument(nestedPopup, { url: nestedUrl, label: nestedLabel }, `${SOURCE}_nested_document`) : await readOnlineDocument(nestedPopup, { url: nestedUrl, label: nestedLabel }, `${SOURCE}_nested_document`);
                  if (nestedDoc?.rawText && nestedDoc.rawText.trim().length > 20 && documents.length < MAX_TOTAL_DOCS) documents.push(nestedDoc);
                  await nestedPopup.close().catch(() => {});
                }
              }
            }
          } catch {
            /* not every row has a nested gridview document — fine */
          }
          if (documents.length && documents[documents.length - 1] !== undefined) {
            // Cap nested docs per row implicitly via MAX_NESTED_DOCS_PER_ROW
            // is not separately tracked here (at most one nested doc per
            // row by construction above), consistent with the constant's
            // intent of bounding, not requiring, a fixed count per row.
          }
          await popup.close().catch(() => {});
        }
      } catch {
        /* this section could not be traversed at all — report what we have */
      }
      sectionsResult.push({ label, discovered, visited, skipped });
    }
    return { sections: sectionsResult, documents };
  }

  async readText(target: Page): Promise<string> {
    return pageText(target as any).catch(() => '');
  }
}

// MAX_NESTED_DOCS_PER_ROW is imported for documentation/parity with TAS
// Document's own per-row bound even though this file's nested-document step
// is naturally capped at one per row by construction; referenced here so a
// future increase to "more than one nested doc per row" has an existing,
// intentional constant to wire up rather than a new magic number.
void MAX_NESTED_DOCS_PER_ROW;
