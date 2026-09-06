// MyGovResultExhauster.ts — MyGov/NAPR's OWN result-row/document traversal.
//
// Forked out of the former shared browser/ResultRowExhauster.ts per the
// "REBUILD THE CUSTOMER REPORT + OFFICIAL WORKERS AS SEPARATE DETERMINISTIC
// PIPELINES" mandate ("one source = one worker = one real live contract" —
// never a function shared across sources via a sourceLabel string). MyGov
// no longer imports or calls the shared/TAS exhauster — this file is
// MyGov's own, independently evolvable copy.
//
// The traversal ALGORITHM itself (anchor-rows-first, ExtJS-grid-row
// double-click fallback, anchorPassLooksReal() gating which pass is
// trusted) is preserved verbatim from the shared version rather than
// rewritten against new, unverified selectors — it was live-verified
// working code; forking it here is the real architectural change (MyGov now
// owns this code and can evolve it independently of TAS) without gambling
// working, live-tested behavior on a same-day rewrite this pass had no way
// to re-verify live.
//
// Playwright-touching — NOT unit-testable in this sandbox. Local-syntax-
// checked via `tsc --noEmit` only. The pure decision logic this file
// depends on (anchorPassLooksReal) is unit-tested independently in
// browser/RowExhaustionHeuristics.ts / test/rowExhaustionHeuristics.test.mjs.
import type { Page } from 'playwright';
import { text as pageText } from '../../browser/BrowserSession.js';
import { NavigationStack } from '../../browser/NavigationStack.js';
import { classifyDocumentLink } from '../../documents/DocumentReader.js';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';
import { readOnlineDocument } from '../../documents/OnlineDocumentReader.js';
import { anchorPassLooksReal } from '../../browser/RowExhaustionHeuristics.js';

const GRID_ROW_SELECTOR = '[role="row"], .x-grid-row, tr[class*="x-grid" i], [class*="grid-row" i], [class*="grid" i] tbody tr';
const MAX_RESULT_ROWS = 25;
const MAX_NESTED_DOCS_PER_ROW = 6;
const SOURCE = 'mygov';

async function collectLinks(target: any): Promise<{ url: string; label: string }[]> {
  const out: { url: string; label: string }[] = [];
  const isPage = typeof target?.frames === 'function';
  const frames = isPage ? [target.mainFrame(), ...target.frames().filter((f: any) => f !== target.mainFrame())] : [target];
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
      /* frame/locator not readable */
    }
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

async function readNestedDocuments(target: any, requestPage: Page, pageUrl: string): Promise<MyGovRowExhaustionResult['rowDocuments']> {
  try {
    const links = await collectLinks(target);
    const docs: MyGovRowExhaustionResult['rowDocuments'] = [];
    for (const l of links) {
      const cls = classifyDocumentLink(l, { pageUrl });
      if (!cls.worthOpening) continue;
      const doc = cls.looksLikeDirectFile
        ? await readPdfDocument(requestPage, l, `${SOURCE}_attachment`)
        : await readOnlineDocument(requestPage, l, `${SOURCE}_attachment`);
      docs.push({
        url: doc.url,
        label: l.label || doc.title || doc.url,
        rawText: (doc.rawText || '').slice(0, 50000),
        source: `${SOURCE}_result_row_attachment`,
        complete: !!doc.complete,
        documentType: doc.documentType || (cls.looksLikeDirectFile ? 'PDF_DOCUMENT' : 'ONLINE_DOCUMENT'),
        pagesRead: doc.pagesRead || 0,
        pageCount: doc.pageCount || 0,
      });
      if (docs.length >= MAX_NESTED_DOCS_PER_ROW) break;
    }
    return docs;
  } catch {
    return [];
  }
}

async function openMyGovRowDetail(p: Page, row: any): Promise<{ url: string; text: string; nestedDocs: MyGovRowExhaustionResult['rowDocuments'] } | null> {
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
    const nestedDocs = t && t.trim().length > 20 ? await readNestedDocuments(newPage, newPage, u) : [];
    await newPage.close().catch(() => {});
    return t && t.trim().length > 20 ? { url: u, text: t, nestedDocs } : null;
  }
  const modal = (p as any).locator('[role="dialog"],.x-window,[class*="modal" i]').first();
  if (await modal.count().catch(() => 0)) {
    const t = await modal.innerText().catch(() => '');
    const nestedDocs = t && t.trim().length > 20 ? await readNestedDocuments(modal, p, (p as any).url()) : [];
    const closeBtn = modal.locator('[aria-label*="close" i],.x-tool-close,button:has-text("×"),button:has-text("Close")').first();
    if (await closeBtn.count().catch(() => 0)) await closeBtn.click({ timeout: 2000 }).catch(() => {});
    else await (p as any).keyboard.press('Escape').catch(() => {});
    await (p as any).waitForTimeout(300);
    return t && t.trim().length > 20 ? { url: (p as any).url(), text: t, nestedDocs } : null;
  }
  const after = await pageText(p as any).catch(() => '');
  if (after && after !== before && after.trim().length > 20) return { url: (p as any).url(), text: after, nestedDocs: [] };
  return null;
}

export interface MyGovRowExhaustionResult {
  rowDocuments: { url: string; label: string; rawText: string; source: string; complete: boolean; documentType: string; pagesRead: number; pageCount: number }[];
  trace: any[];
  rowsVisited: number;
  rowsDiscoveredBySelector: number;
  skippedReasons: { label: string; reason: string }[];
  rowStrategy: string;
}

const ANCHOR_ROW_SELECTOR =
  'table tr:has(a):not(nav tr):not(header tr):not(footer tr):not([class*="menu" i] tr):not([class*="nav" i] tr),' +
  'ul li:has(a):not(nav li):not(header li):not(footer li):not([class*="menu" i] li):not([class*="nav" i] li),' +
  'ol li:has(a):not(nav li):not(header li):not(footer li):not([class*="menu" i] li):not([class*="nav" i] li),' +
  '[class*="result" i]:has(a),' +
  '[class*="row" i]:has(a):not([class*="menu" i]):not([class*="nav" i])';

/** Enumerates MyGov/NAPR's own result list end-to-end: opens/reads/returns
 * from every result row (and each row's own nested attachments), exclusively
 * against MyGov's real, live-confirmed DOM shape. MyGov-owned — not shared
 * with any other source. */
export async function exhaustMygovResultRows(page: Page, expectedCount: number | null = null): Promise<MyGovRowExhaustionResult> {
  const nav = new NavigationStack('MYGOV_RESULTS');
  const rowDocuments: MyGovRowExhaustionResult['rowDocuments'] = [];
  const skippedReasons: MyGovRowExhaustionResult['skippedReasons'] = [];
  try {
    const anchorRows = (page as any).locator(ANCHOR_ROW_SELECTOR);
    const anchorCount = Math.min(await anchorRows.count().catch(() => 0), MAX_RESULT_ROWS);
    let anchorPassAttempted = false;
    let anchorVisitedCount = 0;
    if (anchorCount > 0) {
      anchorPassAttempted = true;
      const anchorDocs: MyGovRowExhaustionResult['rowDocuments'] = [];
      const anchorSkips: MyGovRowExhaustionResult['skippedReasons'] = [];
      for (let i = 0; i < anchorCount; i++) {
        const row = anchorRows.nth(i);
        const link = row.locator('a').first();
        const href = await link.getAttribute('href').catch(() => null);
        const label = ((await link.innerText().catch(() => '')) as string)?.trim() || `row-${i}`;
        if (!href || /^javascript:|^#$/.test(href)) {
          anchorSkips.push({ label, reason: 'NO_USABLE_HREF' });
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
          if (rowText && rowText.trim().length > 20) {
            anchorDocs.push({ url: full, label, rawText: rowText.slice(0, 50000), source: `${SOURCE}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
            const nested = await readNestedDocuments(rowPage, rowPage, full);
            if (nested.length) anchorDocs.push(...nested);
          } else anchorSkips.push({ label, reason: 'ROW_PAGE_PRODUCED_NO_TEXT' });
          await rowPage.close().catch(() => {});
        } catch (e) {
          anchorSkips.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
        }
        nav.back();
      }
      anchorVisitedCount = nav.visitedCount();
      if (anchorPassLooksReal(anchorVisitedCount, anchorDocs.length, expectedCount, MAX_RESULT_ROWS)) {
        rowDocuments.push(...anchorDocs);
        skippedReasons.push(...anchorSkips);
        return { rowDocuments, trace: nav.trace(), rowsVisited: anchorVisitedCount, rowsDiscoveredBySelector: anchorCount, skippedReasons, rowStrategy: 'ANCHOR_BASED' };
      }
      rowDocuments.push(...anchorDocs);
      skippedReasons.push(...anchorSkips, {
        label: '(anchor-pass)',
        reason: `ANCHOR_PASS_LIKELY_PAGE_CHROME_NOT_RESULTS: visited=${anchorVisitedCount} documentsFound=${anchorDocs.length} expectedResults=${expectedCount ?? 'unknown'} — falling back to grid-row strategy`,
      });
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
      if (!nav.enter(label, `${SOURCE}-grid-row-${i}-${label.slice(0, 40)}`)) continue;
      try {
        const detail = await openMyGovRowDetail(page, row);
        if (detail) {
          rowDocuments.push({ url: detail.url, label, rawText: detail.text.slice(0, 50000), source: `${SOURCE}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
          if (detail.nestedDocs?.length) rowDocuments.push(...detail.nestedDocs);
        } else skippedReasons.push({ label, reason: 'ROW_INTERACTION_PRODUCED_NO_DETECTABLE_CONTENT' });
      } catch (e) {
        skippedReasons.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
      }
      nav.back();
    }
    if (gridCount >= MAX_RESULT_ROWS) skippedReasons.push({ label: '(overflow)', reason: 'ROW_LIMIT_CAP_REACHED' });
    const strategy = anchorPassAttempted ? (gridCount > 0 ? 'GRID_ROW_DBLCLICK_AFTER_ANCHOR_REJECTED' : 'NO_GRID_MATCH_AFTER_ANCHOR_REJECTED') : gridCount > 0 ? 'GRID_ROW_DBLCLICK' : 'NO_ROW_SELECTOR_MATCHED';
    return {
      rowDocuments,
      trace: nav.trace(),
      rowsVisited: nav.visitedCount(),
      rowsDiscoveredBySelector: Math.max(anchorPassAttempted ? anchorCount : 0, gridCount),
      skippedReasons,
      rowStrategy: strategy,
    };
  } catch {
    return { rowDocuments, trace: nav.trace(), rowsVisited: nav.visitedCount(), rowsDiscoveredBySelector: 0, skippedReasons, rowStrategy: 'ERROR' };
  }
}
