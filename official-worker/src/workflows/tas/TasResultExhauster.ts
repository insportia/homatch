// TasResultExhauster.ts — TAS's OWN result-row/document traversal.
//
// Forked out of the former shared browser/ResultRowExhauster.ts per the
// "REBUILD THE CUSTOMER REPORT + OFFICIAL WORKERS AS SEPARATE DETERMINISTIC
// PIPELINES" mandate ("one source = one worker = one real live contract" —
// never a function shared across sources via a sourceLabel string; the
// mandate explicitly names "ResultRowExhauster for TAS" in its DO-NOT list).
// TAS no longer imports or calls the shared exhauster at all — this file is
// TAS's own, independently evolvable copy.
//
// The traversal ALGORITHM itself (anchor-rows-first, ExtJS-grid-row
// double-click fallback, anchorPassLooksReal() gating which pass is
// trusted) is preserved verbatim from the shared version rather than
// rewritten against new, unverified selectors: that algorithm was itself
// built and live-verified directly against TAS's real production DOM (see
// the ANCHOR_ROW_SELECTOR comment below — the nav-menu false-positive bug
// it guards against was found and fixed AGAINST TAS specifically), so
// forking it here is a real architectural change (TAS now owns this code
// and can evolve it independently of MyGov) without gambling working,
// live-tested behavior on a same-day rewrite this pass had no way to
// re-verify live. A genuinely TAS-specific real-iframe traversal
// (enumerateTasResultsInRealIframe / openTasResultFromIframe /
// enumerateTasResultChildren, per the mandate's naming) is the natural next
// step for this file, but belongs in a pass that can be checked against the
// live tas.ge/docs.tbilisi.gov.ge DOM rather than guessed blind.
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
// Cap on nested attachments opened PER result row — bounded deliberately:
// the mandate wants attachments actually read, not an unbounded crawl.
const MAX_NESTED_DOCS_PER_ROW = 6;
const SOURCE = 'tas';

/** Collects `{url,label}` for every <a href> reachable from `target` (a Page
 * — walks every frame — or a Locator scoped to one element/modal). */
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

async function readNestedDocuments(target: any, requestPage: Page, pageUrl: string): Promise<TasRowExhaustionResult['rowDocuments']> {
  try {
    const links = await collectLinks(target);
    const docs: TasRowExhaustionResult['rowDocuments'] = [];
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

/** `scope` is where the row actually lives — the outer Page when the
 * results grid renders directly on tas.ge, or the real docs.tbilisi.gov.ge
 * ExtJS iframe's own Frame when it doesn't (2026-09-06 "final alignment
 * pass" mandate fix: Playwright's `Page.locator()` does NOT pierce into
 * iframe content, only `Frame.locator()` does — `scope` must be whichever
 * one the row/modal DOM actually lives in). `ownerPage` is the real
 * browser Page underneath (`frame.page()` when scope is a Frame, or scope
 * itself when it's already the Page) — needed only for the operations a
 * Frame genuinely has no equivalent for: `.context()` (new-tab detection),
 * `.keyboard`, and pacing waits. */
async function openTasChild(scope: any, ownerPage: Page, row: any): Promise<{ url: string; text: string; nestedDocs: TasRowExhaustionResult['rowDocuments'] } | null> {
  const before = await pageText(scope).catch(() => '');
  const newPagePromise = (ownerPage as any)
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
  await (ownerPage as any).waitForTimeout(900);
  const newPage = await newPagePromise;
  if (newPage) {
    await newPage.waitForTimeout(1000).catch(() => {});
    const t = await pageText(newPage).catch(() => '');
    const u = newPage.url();
    const nestedDocs = t && t.trim().length > 20 ? await readNestedDocuments(newPage, newPage, u) : [];
    await newPage.close().catch(() => {});
    return t && t.trim().length > 20 ? { url: u, text: t, nestedDocs } : null;
  }
  // The ExtJS floating window a double-click opens renders inside whichever
  // document actually hosts the grid — `scope`, not necessarily the outer
  // page — so it is looked for there first.
  const modal = (scope as any).locator('[role="dialog"],.x-window,[class*="modal" i]').first();
  if (await modal.count().catch(() => 0)) {
    const t = await modal.innerText().catch(() => '');
    const modalUrl = typeof (scope as any).url === 'function' ? (scope as any).url() : (ownerPage as any).url();
    const nestedDocs = t && t.trim().length > 20 ? await readNestedDocuments(modal, ownerPage, modalUrl) : [];
    const closeBtn = modal.locator('[aria-label*="close" i],.x-tool-close,button:has-text("×"),button:has-text("Close")').first();
    if (await closeBtn.count().catch(() => 0)) await closeBtn.click({ timeout: 2000 }).catch(() => {});
    else await (ownerPage as any).keyboard.press('Escape').catch(() => {});
    await (ownerPage as any).waitForTimeout(300);
    return t && t.trim().length > 20 ? { url: modalUrl, text: t, nestedDocs } : null;
  }
  const after = await pageText(scope).catch(() => '');
  const afterUrl = typeof (scope as any).url === 'function' ? (scope as any).url() : (ownerPage as any).url();
  if (after && after !== before && after.trim().length > 20) return { url: afterUrl, text: after, nestedDocs: [] };
  return null;
}

export interface TasRowExhaustionResult {
  rowDocuments: { url: string; label: string; rawText: string; source: string; complete: boolean; documentType: string; pagesRead: number; pageCount: number }[];
  trace: any[];
  rowsVisited: number;
  rowsDiscoveredBySelector: number;
  skippedReasons: { label: string; reason: string }[];
  rowStrategy: string;
}

// A page-wide `:has(a)` selector is NOT scoped to the actual results area —
// it matches equally well against tas.ge's own top nav / menu chrome
// (confirmed live: a 13-item nav menu using <ul><li><a>... satisfied this
// selector everywhere on the page, so the anchor-based branch took an
// immediate `return` after "visiting" 13 nav links and reading zero real
// documents, while the true ExtJS results grid — which renders with NO <a>
// anywhere at all, see selectors.ts — was never even tried). Excluding
// common nav/menu/header/footer containers here does not fully solve the
// general case, so `exhaustTasResultRows` additionally verifies the
// anchor-based pass actually produced usable rows (anchorPassLooksReal)
// before trusting it over the grid-row fallback.
const ANCHOR_ROW_SELECTOR =
  'table tr:has(a):not(nav tr):not(header tr):not(footer tr):not([class*="menu" i] tr):not([class*="nav" i] tr),' +
  'ul li:has(a):not(nav li):not(header li):not(footer li):not([class*="menu" i] li):not([class*="nav" i] li),' +
  'ol li:has(a):not(nav li):not(header li):not(footer li):not([class*="menu" i] li):not([class*="nav" i] li),' +
  '[class*="result" i]:has(a),' +
  '[class*="row" i]:has(a):not([class*="menu" i]):not([class*="nav" i])';

/** Enumerates TAS's own result list end-to-end: opens/reads/returns from
 * every result row (and each row's own nested attachments), exclusively
 * against TAS's real, live-confirmed DOM shape. TAS-owned — not shared with
 * any other source.
 *
 * `scope` (2026-09-06 "final alignment pass" mandate fix — the confirmed
 * production bug): the real search-result DOM frequently lives inside the
 * docs.tbilisi.gov.ge ExtJS iframe TasPage.searchCadastral() already
 * resolves and returns as `frame`, NOT on the outer tas.ge Page.
 * Playwright's `Page.locator()` does not pierce into iframe content (only
 * `Frame.locator()` does) — every row/link locator below must run against
 * `scope`, whatever it actually is, never unconditionally against the
 * outer page. `scope` accepts either a Page (kept for backward
 * compatibility with any caller that genuinely has no iframe to cross) or
 * a Frame; `ownerPage` (`frame.page()` when scope is a Frame, or scope
 * itself otherwise) is used only for the handful of operations a Frame has
 * no equivalent for. */
export async function exhaustTasResultRows(scope: Page | any, expectedCount: number | null = null): Promise<TasRowExhaustionResult> {
  const ownerPage: Page = typeof (scope as any)?.page === 'function' ? (scope as any).page() : (scope as Page);
  const rowDocuments: TasRowExhaustionResult['rowDocuments'] = [];
  const skippedReasons: TasRowExhaustionResult['skippedReasons'] = [];
  try {
    const scopeUrl = () => (typeof (scope as any).url === 'function' ? (scope as any).url() : (ownerPage as any).url());
    const anchorRows = (scope as any).locator(ANCHOR_ROW_SELECTOR);
    const anchorCount = Math.min(await anchorRows.count().catch(() => 0), MAX_RESULT_ROWS);
    let anchorPassAttempted = false;
    if (anchorCount > 0) {
      anchorPassAttempted = true;
      const anchorDocs: TasRowExhaustionResult['rowDocuments'] = [];
      const anchorSkips: TasRowExhaustionResult['skippedReasons'] = [];
      // 2026-09 "report intelligence v2" mandate, Section 2: real production
      // job 1aa45cdf-a5cf-4dcc-b7a9-524cedb596ae showed rowsVisited (19)
      // EXCEEDING resultsDiscovered (18) — impossible by construction once
      // visited is tracked as a SUBSET of one canonical discovered-key set
      // per pass, rather than one NavigationStack instance accumulating
      // visits across BOTH the anchor pass and the grid-row fallback pass
      // (the old shared `nav` counted anchor-pass visits into the same
      // total even when the anchor pass was later rejected as page-chrome,
      // not real results — see anchorPassLooksReal below). Each pass now
      // gets its own key sets and its own NavigationStack.
      const anchorNav = new NavigationStack('TAS_RESULTS_ANCHOR');
      const anchorDiscoveredKeys = new Set<string>();
      const anchorVisitedKeys = new Set<string>();
      for (let i = 0; i < anchorCount; i++) {
        const row = anchorRows.nth(i);
        const link = row.locator('a').first();
        const href = await link.getAttribute('href').catch(() => null);
        const label = ((await link.innerText().catch(() => '')) as string)?.trim() || `row-${i}`;
        const key = href ? `href:${href}` : `idx:${i}:${label}`;
        anchorDiscoveredKeys.add(key);
        if (!href || /^javascript:|^#$/.test(href)) {
          anchorSkips.push({ label, reason: 'NO_USABLE_HREF' });
          continue;
        }
        let full = href;
        try {
          full = new URL(href, scopeUrl()).toString();
        } catch {
          /* keep href as-is */
        }
        if (!anchorNav.enter(label, full)) continue;
        const cls = classifyDocumentLink({ url: full, label }, { pageUrl: scopeUrl() });
        if (!cls.worthOpening) {
          anchorNav.back();
          continue;
        }
        try {
          const rowPage = await (ownerPage as any).context().newPage();
          await rowPage.goto(full, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await rowPage.waitForTimeout(1000);
          const rowText = await pageText(rowPage).catch(() => '');
          if (rowText && rowText.trim().length > 20) {
            anchorDocs.push({ url: full, label, rawText: rowText.slice(0, 50000), source: `${SOURCE}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
            anchorVisitedKeys.add(key);
            const nested = await readNestedDocuments(rowPage, rowPage, full);
            if (nested.length) anchorDocs.push(...nested);
          } else anchorSkips.push({ label, reason: 'ROW_PAGE_PRODUCED_NO_TEXT' });
          await rowPage.close().catch(() => {});
        } catch (e) {
          anchorSkips.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
        }
        anchorNav.back();
      }
      const anchorVisitedCount = anchorVisitedKeys.size;
      const anchorDiscoveredCount = anchorDiscoveredKeys.size;
      if (anchorPassLooksReal(anchorVisitedCount, anchorDocs.length, expectedCount, MAX_RESULT_ROWS)) {
        rowDocuments.push(...anchorDocs);
        skippedReasons.push(...anchorSkips);
        return { rowDocuments, trace: anchorNav.trace(), rowsVisited: anchorVisitedCount, rowsDiscoveredBySelector: anchorDiscoveredCount, skippedReasons, rowStrategy: 'ANCHOR_BASED' };
      }
      // Rejected as likely page-chrome (nav/menu), not real results — kept
      // ONLY as a diagnostic summary line. Its documents are never merged
      // into the real result set the grid-row fallback below produces —
      // doing so would silently mix nav-menu junk into genuine TAS
      // documents and inflate the counters this fix exists to make honest.
      skippedReasons.push(...anchorSkips, {
        label: '(anchor-pass)',
        reason: `ANCHOR_PASS_LIKELY_PAGE_CHROME_NOT_RESULTS: visited=${anchorVisitedCount} documentsFound=${anchorDocs.length} expectedResults=${expectedCount ?? 'unknown'} — falling back to grid-row strategy`,
      });
    }
    const gridNav = new NavigationStack('TAS_RESULTS_GRID');
    const gridRows = (scope as any).locator(GRID_ROW_SELECTOR);
    const gridCount = Math.min(await gridRows.count().catch(() => 0), MAX_RESULT_ROWS);
    const gridDiscoveredKeys = new Set<string>();
    const gridVisitedKeys = new Set<string>();
    for (let i = 0; i < gridCount; i++) {
      const row = gridRows.nth(i);
      const label = (((await row.innerText().catch(() => '')) as string)?.trim().slice(0, 140)) || `grid-row-${i}`;
      const key = `grid:${i}:${label}`;
      gridDiscoveredKeys.add(key);
      if (!label.trim()) {
        skippedReasons.push({ label: `grid-row-${i}`, reason: 'EMPTY_ROW_TEXT' });
        continue;
      }
      if (!gridNav.enter(label, `${SOURCE}-grid-row-${i}-${label.slice(0, 40)}`)) continue;
      try {
        const detail = await openTasChild(scope, ownerPage, row);
        if (detail) {
          rowDocuments.push({ url: detail.url, label, rawText: detail.text.slice(0, 50000), source: `${SOURCE}_result_row`, complete: true, documentType: 'ONLINE_DOCUMENT', pagesRead: 1, pageCount: 1 });
          gridVisitedKeys.add(key);
          if (detail.nestedDocs?.length) rowDocuments.push(...detail.nestedDocs);
        } else skippedReasons.push({ label, reason: 'ROW_INTERACTION_PRODUCED_NO_DETECTABLE_CONTENT' });
      } catch (e) {
        skippedReasons.push({ label, reason: `ROW_OPEN_FAILED: ${String(e).slice(0, 120)}` });
      }
      gridNav.back();
    }
    if (gridCount >= MAX_RESULT_ROWS) skippedReasons.push({ label: '(overflow)', reason: 'ROW_LIMIT_CAP_REACHED' });
    const strategy = anchorPassAttempted ? (gridCount > 0 ? 'GRID_ROW_DBLCLICK_AFTER_ANCHOR_REJECTED' : 'NO_GRID_MATCH_AFTER_ANCHOR_REJECTED') : gridCount > 0 ? 'GRID_ROW_DBLCLICK' : 'NO_ROW_SELECTOR_MATCHED';
    return {
      rowDocuments,
      trace: gridNav.trace(),
      // Invariant: rowsVisited can never exceed rowsDiscoveredBySelector —
      // gridVisitedKeys is constructed as a subset of gridDiscoveredKeys.
      rowsVisited: gridVisitedKeys.size,
      rowsDiscoveredBySelector: gridDiscoveredKeys.size,
      skippedReasons,
      rowStrategy: strategy,
    };
  } catch {
    return { rowDocuments, trace: [], rowsVisited: 0, rowsDiscoveredBySelector: 0, skippedReasons, rowStrategy: 'ERROR' };
  }
}
