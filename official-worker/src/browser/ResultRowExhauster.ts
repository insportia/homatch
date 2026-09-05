// ResultRowExhauster.ts — generic best-effort result-row exhaustion, shared
// by TAS and MyGov (both expose a list of result rows that must each be
// opened, read, and returned from). Extracted out of TasPage.ts so the two
// workflows that need it don't duplicate ~90 lines of Playwright plumbing.
// Anchor-based rows are tried first (correct for a plain HTML list); only
// when that selector matches nothing does this fall back to the ExtJS
// grid-row double-click path (dblclick, then inspect whatever appears: a
// new page/tab, an in-page modal/dialog, or in-place content change).
//
// Uses NavigationStack for loop-avoidance bookkeeping so the same row is
// never re-opened. Every row that could not be found/opened is recorded as
// an explicit, named skip reason — never silently treated as visited.
import type { Page } from 'playwright';
import { text as pageText } from './BrowserSession.js';
import { NavigationStack } from './NavigationStack.js';
import { classifyDocumentLink } from '../documents/DocumentReader.js';

const GRID_ROW_SELECTOR = '[role="row"], .x-grid-row, tr[class*="x-grid" i], [class*="grid-row" i], [class*="grid" i] tbody tr';
const MAX_RESULT_ROWS = 25;

async function openRowDetail(p: Page, row: any): Promise<{ url: string; text: string } | null> {
  const before = await pageText(p as any).catch(() => '');
  const newPagePromise = (p as any)
    .context()
    .waitForEvent('page', { timeout: 4000 })
    .catch(() => null);
  try {
    await row.dblclick({ timeout: 3000 });
  } catch {
    try {
      await row.click({ timeout: 2000 });
    } catch {
      /* row is not interactive the way we expected — caller records the skip */
    }
  }
  await (p as any).waitForTimeout(900);
  const newPage = await newPagePromise;
  if (newPage) {
    await newPage.waitForTimeout(1000).catch(() => {});
    const t = await pageText(newPage).catch(() => '');
    const u = newPage.url();
    await newPage.close().catch(() => {});
    return t && t.trim().length > 20 ? { url: u, text: t } : null;
  }
  const modal = (p as any).locator('[role="dialog"],.x-window,[class*="modal" i]').first();
  if (await modal.count().catch(() => 0)) {
    const t = await modal.innerText().catch(() => '');
    const closeBtn = modal.locator('[aria-label*="close" i],.x-tool-close,button:has-text("×"),button:has-text("Close")').first();
    if (await closeBtn.count().catch(() => 0)) await closeBtn.click({ timeout: 2000 }).catch(() => {});
    else await (p as any).keyboard.press('Escape').catch(() => {});
    await (p as any).waitForTimeout(300);
    return t && t.trim().length > 20 ? { url: (p as any).url(), text: t } : null;
  }
  const after = await pageText(p as any).catch(() => '');
  if (after && after !== before && after.trim().length > 20) return { url: (p as any).url(), text: after };
  return null;
}

export interface RowExhaustionResult {
  rowDocuments: { url: string; label: string; rawText: string; source: string; complete: boolean; documentType: string; pagesRead: number; pageCount: number }[];
  trace: any[];
  rowsVisited: number;
  rowsDiscoveredBySelector: number;
  skippedReasons: { label: string; reason: string }[];
  rowStrategy: string;
}

export async function exhaustResultRows(page: Page, sourceLabel: string): Promise<RowExhaustionResult> {
  const nav = new NavigationStack(`${sourceLabel.toUpperCase()}_RESULTS`);
  const rowDocuments: RowExhaustionResult['rowDocuments'] = [];
  const skippedReasons: RowExhaustionResult['skippedReasons'] = [];
  try {
    const anchorRows = (page as any).locator('table tr:has(a),ul li:has(a),ol li:has(a),[class*="result" i]:has(a),[class*="row" i]:has(a)');
    const anchorCount = Math.min(await anchorRows.count().catch(() => 0), MAX_RESULT_ROWS);
    if (anchorCount > 0) {
      for (let i = 0; i < anchorCount; i++) {
        const row = anchorRows.nth(i);
        const link = row.locator('a').first();
        const href = await link.getAttribute('href').catch(() => null);
        const label = ((await link.innerText().catch(() => '')) as string)?.trim() || `row-${i}`;
        if (!href || /^javascript:|^#$/.test(href)) {
          skippedReasons.push({ label, reason: 'NO_USABLE_HREF' });
          continue;
        }
        let full = href;
        try {
          full = new URL(href, (page as any).url()).toString();
        } catch {
          /* keep href as-is */
        }
        if (!nav.enter(label, full)) continue;
        const cls = classifyDocumentLink({ url: full, label }, { pageUrl: (page as any).url() });
        if (!cls.worthOpening) {
          nav.back();
          continue;
        }
        try {
          const rowPage = await (page as any).context().newPage();
          await rowPage.goto(full, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await rowPage.waitForTimeout(1000);
          const rowText = await pageText(rowPage).catch(() => '');
          if (rowText && rowText.trim().length > 20)
            rowDocuments.push({ url: full, label, rawText: rowText.slice(0, 50000), source: `${sourceLabel}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
          else skippedReasons.push({ label, reason: 'ROW_PAGE_PRODUCED_NO_TEXT' });
          await rowPage.close().catch(() => {});
        } catch (e) {
          skippedReasons.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
        }
        nav.back();
      }
      return { rowDocuments, trace: nav.trace(), rowsVisited: nav.visitedCount(), rowsDiscoveredBySelector: anchorCount, skippedReasons, rowStrategy: 'ANCHOR_BASED' };
    }
    const gridRows = (page as any).locator(GRID_ROW_SELECTOR);
    const gridCount = Math.min(await gridRows.count().catch(() => 0), MAX_RESULT_ROWS);
    for (let i = 0; i < gridCount; i++) {
      const row = gridRows.nth(i);
      const label = (((await row.innerText().catch(() => '')) as string)?.trim().slice(0, 140)) || `grid-row-${i}`;
      if (!label.trim()) {
        skippedReasons.push({ label: `grid-row-${i}`, reason: 'EMPTY_ROW_TEXT' });
        continue;
      }
      if (!nav.enter(label, `${sourceLabel}-grid-row-${i}-${label.slice(0, 40)}`)) continue;
      try {
        const detail = await openRowDetail(page, row);
        if (detail) rowDocuments.push({ url: detail.url, label, rawText: detail.text.slice(0, 50000), source: `${sourceLabel}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
        else skippedReasons.push({ label, reason: 'ROW_INTERACTION_PRODUCED_NO_DETECTABLE_CONTENT' });
      } catch (e) {
        skippedReasons.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
      }
      nav.back();
    }
    if (gridCount >= MAX_RESULT_ROWS) skippedReasons.push({ label: '(overflow)', reason: 'ROW_LIMIT_CAP_REACHED' });
    return { rowDocuments, trace: nav.trace(), rowsVisited: nav.visitedCount(), rowsDiscoveredBySelector: gridCount, skippedReasons, rowStrategy: gridCount > 0 ? 'GRID_ROW_DBLCLICK' : 'NO_ROW_SELECTOR_MATCHED' };
  } catch {
    return { rowDocuments, trace: nav.trace(), rowsVisited: nav.visitedCount(), rowsDiscoveredBySelector: 0, skippedReasons, rowStrategy: 'ERROR' };
  }
}
