// OnlineDocumentReader.ts — reads a document that is NOT a downloadable
// file but a real in-browser viewer page (mandate Section 7's
// ONLINE_DOCUMENT kind). Ported from the pre-refactor onlineViewerEvidence()
// in index.js: opens the link in a fresh page in the SAME browser context
// (never disturbing the caller's own page), aggregates innerText across
// every page the viewer exposes by following its own "next" control, up to
// MAX_VIEWER_PAGES as a runaway-loop safety cap.
//
// Playwright-touching — NOT unit-testable in this sandbox (no network path
// to any of the four government hosts). Local-syntax-checked via
// `tsc --noEmit` only; the pure decision logic it calls into
// (classifyDocumentLink/detectPagination/sha256/extractDateFromText) is
// unit-tested in isolation instead.
import type { Page } from 'playwright';
import { detectPagination, extractDateFromText, sha256, MAX_VIEWER_PAGES } from './DocumentReader.js';
import { newDocumentShell, markComplete, type ResearchDocument } from './DocumentTypes.js';

async function pageText(p: any): Promise<string> {
  const frames = [p.mainFrame(), ...p.frames().filter((f: any) => f !== p.mainFrame())];
  const parts: string[] = [];
  for (const f of frames) {
    try {
      parts.push(await f.locator('body').innerText({ timeout: 8000 }));
    } catch {
      /* frame not readable — skip it, never fabricate its text */
    }
  }
  return parts.join('\n').slice(0, 120000);
}

export interface OnlineViewerLink {
  url: string;
  label?: string;
}

export async function readOnlineDocument(
  callerPage: Page,
  link: OnlineViewerLink,
  source: string,
  parentItemId: string | null = null
): Promise<ResearchDocument> {
  const doc = newDocumentShell(source, link.url, parentItemId);
  doc.documentType = 'ONLINE_DOCUMENT';
  doc.title = link.label || null;
  const ctx = (callerPage as any).context();
  const vp = await ctx.newPage();
  try {
    await vp.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await vp.waitForTimeout(1000);
    const pages: string[] = [await pageText(vp)];
    let pagination = detectPagination(pages[0]);
    let clicked = true;
    while (pagination.hasMore && pages.length < MAX_VIEWER_PAGES && clicked) {
      clicked = false;
      for (const sel of [
        'text=/შემდეგი(\\s*გვერდი)?/i',
        'text=/next(\\s*page)?/i',
        'a[rel="next"]',
        '[aria-label*="next" i]',
        '[aria-label*="შემდეგი" i]',
        'button[aria-label*="next" i]',
      ]) {
        const el = vp.locator(sel).first();
        try {
          if (await el.isVisible()) {
            await el.click({ timeout: 3000 });
            await vp.waitForTimeout(900);
            clicked = true;
            break;
          }
        } catch {
          /* this candidate "next" control wasn't real — try the next selector */
        }
      }
      if (!clicked) break;
      const t = await pageText(vp);
      if (pages.includes(t)) break; // clicked but content didn't actually change — stop rather than loop
      pages.push(t);
      pagination = detectPagination(t);
    }
    const aggregated = pages.join('\n\n').slice(0, 150000);
    doc.rawText = aggregated;
    doc.sha256 = sha256(Buffer.from(aggregated, 'utf8'));
    doc.documentDate = extractDateFromText(aggregated.slice(0, 4000));
    // Page count for an online viewer is only known when the viewer itself
    // stated "page N of M" — otherwise it stays null and markComplete()
    // falls back to "did we get non-trivial text," per DocumentTypes.ts's
    // documented rule.
    doc.pageCount = pagination.totalPages;
    doc.pagesRead = pages.length;
    markComplete(doc);
    return doc;
  } catch (e) {
    doc.error = String(e);
    return doc;
  } finally {
    await vp.close().catch(() => {});
  }
}
