// TasResultExhauster.ts — TAS-specific, live-verified latest-record traversal.
//
// Contract verified manually against tas.ge / docs.tbilisi.gov.ge on
// 2026-09-07:
//   1) search result rows contain AR number + DD/MM/YYYY;
//   2) if <=10 results exist, inspect all of them;
//   3) if >10 exist, move to the last result page and work backwards only
//      as far as needed to collect the latest 10 candidates;
//   4) sort those candidates by real date DESC (newest first);
//   5) open each selected AR in the SAME Playwright context;
//   6) the real detail content lives in iframe.page-iframe whose URL is
//      docs.tbilisi.gov.ge/architect/public.html?docId=...;
//   7) read the full iframe body, scroll all lazy/ExtJS containers to bottom,
//      then click every exact ExtJS button whose inner span text is
//      "შედეგის ნახვა";
//   8) fully parse opened PDFs (all pages, no text truncation);
//   9) duplicate result buttons/documents are deduped before persistence;
//  10) no eye-icon traversal — deliberately removed from the product contract.
//
// The browser/context lifecycle is NOT owned here. ResearchOrchestrator
// closes each non-WAITING_HUMAN step context and closes the shared browser at
// job completion; CAPTCHA/human verification is the only intentional hold.
import type { Frame, Page } from 'playwright';
import { readPdfDocument } from '../../documents/PdfDocumentReader.js';

const GRID_ROW_SELECTOR =
  '[role="row"], .x-grid-row, tr[class*="x-grid" i], [class*="grid-row" i], [class*="grid" i] tbody tr';
const MAX_SELECTED_RESULTS = 10;
const RESULT_BUTTON_TEXT = 'შედეგის ნახვა';
const SOURCE = 'tas';

type TasRowMeta = {
  ar: string;
  date: string;
  timestamp: number;
  text: string;
  page: number;
};

type TasDocument = {
  url: string;
  label: string;
  rawText: string;
  source: string;
  complete: boolean;
  documentType: string;
  pagesRead: number;
  pageCount: number;
};

export interface TasRowExhaustionResult {
  rowDocuments: TasDocument[];
  trace: any[];
  rowsVisited: number;
  rowsDiscoveredBySelector: number;
  skippedReasons: { label: string; reason: string }[];
  rowStrategy: string;
  /** Actual source counter, when known. Selection is intentionally capped. */
  sourceTotalResults?: number | null;
  /** Number of latest records this run was required to process (<=10). */
  selectionTarget?: number;
  selectionPagesVisited?: number[];
}

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDate(text: string): { date: string; timestamp: number } | null {
  const match = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const timestamp = new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return { date: `${dd}/${mm}/${yyyy}`, timestamp };
}

async function newestPage(ownerPage: Page, before: Set<Page>, timeout = 5000): Promise<Page | null> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const page of ownerPage.context().pages()) if (!before.has(page)) return page;
    await sleep(100);
  }
  return null;
}

async function bodyText(scope: any): Promise<string> {
  return scope.locator('body').innerText().catch(() => '');
}

async function collectCurrentPageRows(scope: any, pageNumber: number): Promise<TasRowMeta[]> {
  const rows = scope.locator(GRID_ROW_SELECTOR);
  const count = await rows.count().catch(() => 0);
  const found = new Map<string, TasRowMeta>();

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = clean(await row.innerText().catch(() => ''));
    if (!text) continue;
    const ar = text.match(/\bAR[A-Z0-9_-]*\d+[A-Z0-9_-]*\b/i)?.[0]?.toUpperCase();
    if (!ar) continue;
    const parsed = parseDate(text);
    if (!parsed) continue;
    if (!found.has(ar)) found.set(ar, { ar, date: parsed.date, timestamp: parsed.timestamp, text, page: pageNumber });
  }

  return [...found.values()];
}

async function sourceTotalFromPage(scope: any, expectedCount: number | null): Promise<number | null> {
  if (expectedCount != null && Number.isFinite(expectedCount) && expectedCount >= 0) return expectedCount;
  const text = clean(await bodyText(scope));
  for (const pattern of [
    /სულ\s+მოიძებნა\s*:\s*(\d+)/i,
    /ჩანაწერები\s+\d+\s*-\s*\d+\s*,\s*(\d+)\s+დან/i,
  ]) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

async function findPaginationInput(scope: any): Promise<any | null> {
  // ExtJS paging toolbar first; generic numeric-input fallback second.
  for (const selector of ['input.x-tbar-page-number', 'input[class*="page-number" i]']) {
    const candidate = scope.locator(selector).first();
    if ((await candidate.count().catch(() => 0)) && (await candidate.isVisible().catch(() => false))) return candidate;
  }

  const inputs = scope.locator('input[type="text"],input:not([type])');
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    const value = clean(await input.inputValue().catch(() => ''));
    if (!/^\d+$/.test(value)) continue;
    const nearby = clean(
      await input
        .evaluate((el: any) => {
          let node = el.parentElement;
          for (let depth = 0; depth < 7 && node; depth++) {
            const text = node.innerText || '';
            if (/დან|გვერდ/i.test(text)) return text;
            node = node.parentElement;
          }
          return '';
        })
        .catch(() => ''),
    );
    if (/დან|გვერდ/i.test(nearby)) return input;
  }
  return null;
}

async function currentPageNumber(scope: any): Promise<number> {
  const input = await findPaginationInput(scope);
  if (!input) return 1;
  return Number(await input.inputValue().catch(() => '1')) || 1;
}

async function goToPage(scope: any, pageNumber: number): Promise<boolean> {
  const input = await findPaginationInput(scope);
  if (!input) return pageNumber === 1;

  const beforeRows = await collectCurrentPageRows(scope, await currentPageNumber(scope));
  const beforeSignature = beforeRows.map((x) => x.ar).join('|');

  await input.click({ timeout: 2000 }).catch(() => {});
  await input.fill(String(pageNumber));
  await input.press('Enter');

  for (let i = 0; i < 24; i++) {
    await sleep(150);
    const value = Number(await input.inputValue().catch(() => '0')) || 0;
    const rows = await collectCurrentPageRows(scope, pageNumber);
    const signature = rows.map((x) => x.ar).join('|');
    if (value === pageNumber && rows.length > 0 && (signature !== beforeSignature || pageNumber === 1)) return true;
  }
  return false;
}

async function selectLatestRows(scope: any, expectedCount: number | null, trace: any[]): Promise<{
  rows: TasRowMeta[];
  total: number | null;
  pagesVisited: number[];
}> {
  const firstRows = await collectCurrentPageRows(scope, 1);
  const total = await sourceTotalFromPage(scope, expectedCount);
  const target = Math.min(MAX_SELECTED_RESULTS, total != null ? total : firstRows.length);

  if (target <= 0) return { rows: [], total, pagesVisited: [1] };

  // If the whole result set fits in the current page, no pagination is needed.
  if ((total != null && total <= firstRows.length) || (total != null && total <= MAX_SELECTED_RESULTS) || !total) {
    const selected = firstRows.sort((a, b) => b.timestamp - a.timestamp).slice(0, target);
    trace.push({ action: 'SELECT_LATEST', sourceTotal: total, target, pagesVisited: [1], selected: selected.map((r) => ({ ar: r.ar, date: r.date })) });
    return { rows: selected, total, pagesVisited: [1] };
  }

  const pageSize = Math.max(1, firstRows.length);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const collected = new Map<string, TasRowMeta>();
  const pagesVisited: number[] = [];

  for (let pageNo = lastPage; pageNo >= 1 && collected.size < target; pageNo--) {
    const moved = pageNo === 1 ? await goToPage(scope, 1) : await goToPage(scope, pageNo);
    if (!moved) {
      trace.push({ action: 'PAGINATION_FAILED', page: pageNo, lastPage, total, pageSize });
      continue;
    }
    pagesVisited.push(pageNo);
    const pageRows = await collectCurrentPageRows(scope, pageNo);
    for (const row of pageRows) if (!collected.has(row.ar)) collected.set(row.ar, row);
  }

  const selected = [...collected.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, target);
  trace.push({
    action: 'SELECT_LATEST',
    sourceTotal: total,
    target,
    pageSize,
    lastPage,
    pagesVisited,
    selected: selected.map((r) => ({ ar: r.ar, date: r.date, page: r.page })),
  });
  return { rows: selected, total, pagesVisited };
}

async function ensureRowVisible(scope: any, row: TasRowMeta): Promise<boolean> {
  if (await scope.getByText(row.ar, { exact: false }).count().catch(() => 0)) return true;
  if (!(await goToPage(scope, row.page))) return false;
  return !!(await scope.getByText(row.ar, { exact: false }).count().catch(() => 0));
}

async function openSelectedAr(scope: any, ownerPage: Page, row: TasRowMeta): Promise<Page | null> {
  if (!(await ensureRowVisible(scope, row))) return null;
  const candidate = scope.getByText(row.ar, { exact: false }).first();

  for (let attempt = 0; attempt < 2; attempt++) {
    const before = new Set(ownerPage.context().pages());
    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await candidate.dblclick({ timeout: 4000 });
    } catch {
      await candidate.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    const detail = await newestPage(ownerPage, before, 5000);
    if (detail) return detail;
    await sleep(250);
  }
  return null;
}

async function resolveDetailFrame(detail: Page): Promise<Frame | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const frame of detail.frames()) {
      if (/docs\.tbilisi\.gov\.ge\/architect\/public\.html/i.test(frame.url())) return frame;
    }
    try {
      const iframe = detail.locator('iframe.page-iframe').first();
      if (await iframe.count().catch(() => 0)) {
        const handle = await iframe.elementHandle();
        if (handle) {
          const frame = await handle.contentFrame();
          if (frame) return frame;
        }
      }
    } catch {
      // iframe can be between ExtJS reload states; retry briefly.
    }
    await sleep(150);
  }
  return null;
}

async function waitUntilReadable(frame: Frame): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    if ((await bodyText(frame)).trim().length > 100) return true;
    await sleep(150);
  }
  return false;
}

async function scrollEverything(frame: Frame): Promise<void> {
  await frame
    .evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let pass = 0; pass < 3; pass++) {
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        for (const el of all) {
          const style = getComputedStyle(el);
          if (
            el.scrollHeight > el.clientHeight + 10 &&
            (style.overflowY === 'auto' || style.overflowY === 'scroll')
          ) {
            el.scrollTop = el.scrollHeight;
          }
        }
        window.scrollTo(0, document.body.scrollHeight);
        await wait(80);
      }
    })
    .catch(() => {});
  await sleep(100);
}

async function exactResultButtons(frame: Frame): Promise<any[]> {
  const all = frame.locator('button[type="button"][role="button"]');
  const count = await all.count().catch(() => 0);
  const matches: any[] = [];
  for (let i = 0; i < count; i++) {
    const button = all.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const span = button.locator('span.x-btn-inner');
    if (!(await span.count().catch(() => 0))) continue;
    const text = clean(await span.innerText().catch(() => ''));
    if (text === RESULT_BUTTON_TEXT) matches.push(button);
  }
  return matches;
}

function makeOnlineDocument(url: string, label: string, rawText: string, source: string): TasDocument {
  return {
    url,
    label,
    rawText,
    source,
    complete: rawText.trim().length > 0,
    documentType: 'ONLINE_DOCUMENT',
    pagesRead: rawText.trim().length > 0 ? 1 : 0,
    pageCount: rawText.trim().length > 0 ? 1 : 0,
  };
}

async function readOpenedResult(
  ownerPage: Page,
  detail: Page,
  frame: Frame,
  beforePages: Set<Page>,
  beforeFrameUrl: string,
  beforeText: string,
  downloadPromise: Promise<any>,
  label: string,
): Promise<TasDocument | null> {
  // Download response first.
  const download = await Promise.race([downloadPromise, sleep(1000).then(() => null)]).catch(() => null);
  if (download) {
    const url = String(download.url?.() || '');
    if (/^https?:/i.test(url)) {
      const doc = await readPdfDocument(ownerPage, { url, label }, `${SOURCE}_result_document`);
      return {
        url: doc.url,
        label: label || doc.title || doc.url,
        rawText: doc.rawText || '',
        source: `${SOURCE}_result_document`,
        complete: !!doc.complete,
        documentType: doc.documentType || 'PDF_DOCUMENT',
        pagesRead: doc.pagesRead || 0,
        pageCount: doc.pageCount || 0,
      };
    }
  }

  // New tab/window — the live-confirmed PDF path.
  const child = await newestPage(ownerPage, beforePages, 2500);
  if (child) {
    await child.waitForLoadState('commit', { timeout: 10000 }).catch(() => {});
    await sleep(200);
    const url = child.url();
    let out: TasDocument | null = null;
    if (/^https?:/i.test(url)) {
      const doc = await readPdfDocument(child, { url, label }, `${SOURCE}_result_document`);
      out = {
        url: doc.url,
        label: label || doc.title || doc.url,
        rawText: doc.rawText || '',
        source: `${SOURCE}_result_document`,
        complete: !!doc.complete,
        documentType: doc.documentType || 'PDF_DOCUMENT',
        pagesRead: doc.pagesRead || 0,
        pageCount: doc.pageCount || 0,
      };
      // Some rare result links are HTML rather than PDF; retain rendered text.
      if (!out.complete) {
        const rendered = await bodyText(child);
        if (rendered.trim().length > 20) out = makeOnlineDocument(url, label, rendered, `${SOURCE}_result_document`);
      }
    } else {
      const rendered = await bodyText(child);
      if (rendered.trim().length > 20) out = makeOnlineDocument(url, label, rendered, `${SOURCE}_result_document`);
    }
    await child.close().catch(() => {});
    return out;
  }

  // Same iframe navigation/content/modal fallbacks.
  if (frame.url() !== beforeFrameUrl) {
    await sleep(200);
    const text = await bodyText(frame);
    return text.trim().length > 20
      ? makeOnlineDocument(frame.url(), label, text, `${SOURCE}_result_document`)
      : null;
  }

  const windows = frame.locator('.x-window');
  const windowCount = await windows.count().catch(() => 0);
  for (let i = windowCount - 1; i >= 0; i--) {
    const win = windows.nth(i);
    if (!(await win.isVisible().catch(() => false))) continue;
    const text = await win.innerText().catch(() => '');
    if (text.trim().length > 20) return makeOnlineDocument(frame.url(), label, text, `${SOURCE}_result_document`);
  }

  const afterText = await bodyText(frame);
  if (afterText.trim().length > 20 && afterText !== beforeText) {
    return makeOnlineDocument(frame.url(), label, afterText, `${SOURCE}_result_document`);
  }
  return null;
}

function documentFingerprint(doc: TasDocument): string {
  // URL is the primary stable identity. The content signature catches the
  // live-confirmed TAS duplicate-button case where two ExtJS buttons open the
  // same PDF through equivalent/different transient URLs.
  const normalizedUrl = doc.url.replace(/[?#].*$/, '');
  const text = doc.rawText || '';
  return `${normalizedUrl}|${doc.documentType}|${doc.pageCount}|${text.length}|${text.slice(0, 160)}`;
}

async function processDetail(ownerPage: Page, detail: Page, row: TasRowMeta): Promise<TasDocument[]> {
  const frame = await resolveDetailFrame(detail);
  if (!frame) throw new Error('DETAIL_IFRAME_NOT_FOUND');
  await waitUntilReadable(frame);

  const initialText = await bodyText(frame);
  await scrollEverything(frame);
  const fullText = await bodyText(frame);
  const detailText = fullText.trim().length >= initialText.trim().length ? fullText : initialText;

  const docs: TasDocument[] = [];
  if (detailText.trim().length > 20) {
    docs.push(makeOnlineDocument(frame.url(), `${row.ar} ${row.date}`, detailText, `${SOURCE}_result_row`));
  }

  const seen = new Set<string>(docs.map(documentFingerprint));
  const initialButtons = await exactResultButtons(frame);

  for (let index = 0; index < initialButtons.length; index++) {
    // ExtJS can rebuild the toolbar after a result opens; always re-query.
    const buttons = await exactResultButtons(frame);
    if (index >= buttons.length) break;
    const button = buttons[index];
    await button.scrollIntoViewIfNeeded().catch(() => {});

    const beforePages = new Set(ownerPage.context().pages());
    const beforeFrameUrl = frame.url();
    const beforeText = await bodyText(frame);
    const downloadPromise = detail.waitForEvent('download', { timeout: 2500 }).catch(() => null);

    await button.click({ force: true, timeout: 5000 });
    await sleep(200);

    const opened = await readOpenedResult(
      ownerPage,
      detail,
      frame,
      beforePages,
      beforeFrameUrl,
      beforeText,
      downloadPromise,
      `${row.ar} ${RESULT_BUTTON_TEXT} ${index + 1}`,
    );
    if (!opened || !opened.complete) continue;
    const fp = documentFingerprint(opened);
    if (!seen.has(fp)) {
      seen.add(fp);
      docs.push(opened);
    }
  }

  return docs;
}

/**
 * Traverses only the latest relevant TAS history, not an unbounded archive.
 * The selection policy is deterministic and date-first: latest <=10 records.
 * Older records remain history and are intentionally not visited by this
 * source worker once the latest target is satisfied.
 */
export async function exhaustTasResultRows(scope: Page | any, expectedCount: number | null = null): Promise<TasRowExhaustionResult> {
  const ownerPage: Page = typeof scope?.page === 'function' ? scope.page() : (scope as Page);
  const rowDocuments: TasDocument[] = [];
  const skippedReasons: TasRowExhaustionResult['skippedReasons'] = [];
  const trace: any[] = [];

  try {
    const selection = await selectLatestRows(scope, expectedCount, trace);
    const selected = selection.rows;
    let visited = 0;

    for (const row of selected) {
      let detail: Page | null = null;
      try {
        if (!(await ensureRowVisible(scope, row))) {
          skippedReasons.push({ label: row.ar, reason: `SELECTED_AR_NOT_VISIBLE page=${row.page}` });
          continue;
        }
        detail = await openSelectedAr(scope, ownerPage, row);
        if (!detail) {
          skippedReasons.push({ label: row.ar, reason: 'DETAIL_TAB_NOT_OPENED' });
          continue;
        }

        const docs = await processDetail(ownerPage, detail, row);
        if (!docs.some((d) => d.source === `${SOURCE}_result_row` && d.complete)) {
          skippedReasons.push({ label: row.ar, reason: 'DETAIL_TEXT_NOT_READ' });
          continue;
        }

        visited++;
        rowDocuments.push(...docs);
        trace.push({ action: 'RESULT_COMPLETE', ar: row.ar, date: row.date, page: row.page, documents: docs.length });
      } catch (e) {
        skippedReasons.push({ label: row.ar, reason: `RESULT_FAILED: ${String(e).slice(0, 180)}` });
      } finally {
        if (detail && !detail.isClosed()) await detail.close().catch(() => {});
        await sleep(150);
      }
    }

    return {
      rowDocuments,
      trace,
      rowsVisited: visited,
      rowsDiscoveredBySelector: selected.length,
      skippedReasons,
      rowStrategy: 'TAS_LATEST_DATE_MAX_10_LAST_PAGES+DETAIL_IFRAME+FINAL_RESULT_BUTTON',
      sourceTotalResults: selection.total,
      selectionTarget: selected.length,
      selectionPagesVisited: selection.pagesVisited,
    };
  } catch (e) {
    return {
      rowDocuments,
      trace: [...trace, { action: 'EXHAUSTION_FAILED', error: String(e) }],
      rowsVisited: 0,
      rowsDiscoveredBySelector: 0,
      skippedReasons: [...skippedReasons, { label: 'TAS_RESULTS', reason: String(e).slice(0, 180) }],
      rowStrategy: 'TAS_LATEST_DATE_MAX_10_FAILED',
      sourceTotalResults: expectedCount,
      selectionTarget: 0,
      selectionPagesVisited: [],
    };
  }
}
