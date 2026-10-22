// The worker's PDF text extraction, in one place, so the worker thread and the in-process fallback
// run exactly the same code. Plain JavaScript: loaded by node:worker_threads without a TS loader.
import { createRequire } from 'node:module';

const pdfParse = createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js');

/** pdf-parse's own result, reduced to the fields callers read (text, page count, document info). */
export async function parseDefault(bytes) {
  const r = await pdfParse(bytes);
  return { text: r.text, numpages: r.numpages, info: r.info ?? null };
}

/** pdf-parse with per-page text kept (same line joining as pdf-parse's own renderer). */
export async function parsePages(bytes) {
  const pages = [];
  const r = await pdfParse(bytes, {
    pagerender: async (pageData) => {
      const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY;
      let text = '';
      for (const item of tc.items) {
        text += lastY == item.transform[5] || !lastY ? item.str : `\n${item.str}`;
        lastY = item.transform[5];
      }
      const idx = typeof pageData.pageIndex === 'number' ? pageData.pageIndex : pages.length;
      pages[idx] = text;
      return text;
    },
  });
  const n = Number(r.numpages) || 0;
  return { text: r.text, numpages: n, info: r.info ?? null, pages: n > 0 ? Array.from({ length: n }, (_, i) => pages[i] ?? '') : undefined };
}

export const parseIn = (mode, bytes) => (mode === 'pages' ? parsePages(bytes) : parseDefault(bytes));
