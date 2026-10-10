// pdfRender.ts — render vector PDF drawing pages (site plans, floor plans,
// sections, elevations, structural sheets) to PNG/JPEG, with NO new
// dependency and no paid service:
//
//   - the rasteriser is pdf.js v2.0.550, which the worker ALREADY ships inside
//     pdf-parse (node_modules/pdf-parse/lib/pdf.js/v2.0.550/build);
//   - the canvas is the Playwright Chromium the worker image already has
//     (mcr.microsoft.com/playwright base image), launched HEADLESS and
//     separate from any job's headed browser.
//
// The page is served from a routed, non-resolvable origin
// (https://pdf-render.invalid) so pdf.js can start its real Web Worker
// same-origin; nothing on that page ever reaches the network (every other
// request is aborted). One browser per acquire run, closed by the caller.

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { bytesToBuffer } from './tasModel.js';

export interface RenderedPage {
  page: number;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** The page's own text layer (title block / labels), bounded. */
  text: string;
}

export interface RenderPdfOptions {
  /** Max pages to return from this document. */
  maxPages: number;
  /** Long edge of the raster, px. */
  longEdge?: number;
  /** Hard byte ceiling for a single image (storage bucket limit is 8 MB). */
  maxBytes?: number;
  /** Prefer pages whose text matches (title block words); first pages otherwise. */
  preferText?: RegExp | null;
  /** Pages scanned for `preferText` (text layer only, cheap). */
  scanPages?: number;
  timeoutMs?: number;
}

export interface PdfPageRenderer {
  render(pdf: Uint8Array, opts: RenderPdfOptions): Promise<{ numPages: number; pages: RenderedPage[] }>;
  close(): Promise<void>;
}

export type PdfRendererFactory = () => PdfPageRenderer;

const ORIGIN = 'https://pdf-render.invalid';

export function pdfJsBuildDir(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const main = req.resolve('pdf-parse/package.json');
    const dir = path.join(path.dirname(main), 'lib', 'pdf.js', 'v2.0.550', 'build');
    return existsSync(path.join(dir, 'pdf.js')) && existsSync(path.join(dir, 'pdf.worker.js')) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Chromium-backed renderer. `launch` is injectable (tests pass an explicit
 * executable); production uses Playwright's bundled headless Chromium.
 */
export function createChromiumPdfRenderer(opts: { launch?: () => Promise<any>; executablePath?: string } = {}): PdfPageRenderer {
  let browserP: Promise<any> | null = null;
  let contextP: Promise<any> | null = null;
  const dir = pdfJsBuildDir();

  const launch = async () => {
    if (opts.launch) return opts.launch();
    const { chromium } = await import('playwright');
    return chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
      ...(opts.executablePath || process.env.PDF_RENDER_CHROMIUM_PATH ? { executablePath: opts.executablePath || process.env.PDF_RENDER_CHROMIUM_PATH } : {}),
    });
  };

  const context = async () => {
    if (!dir) throw new Error('PDFJS_NOT_AVAILABLE');
    if (!contextP) {
      browserP = launch();
      contextP = browserP.then(async (b) => {
        const ctx = await b.newContext({ javaScriptEnabled: true });
        const pdfJs = readFileSync(path.join(dir, 'pdf.js'));
        const pdfWorker = readFileSync(path.join(dir, 'pdf.worker.js'));
        await ctx.route('**/*', (route: any) => {
          const url = String(route.request().url());
          if (!url.startsWith(ORIGIN)) return route.abort();
          const p = url.slice(ORIGIN.length).split(/[?#]/)[0] || '/';
          if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/pdf.js"></script>' });
          if (p === '/pdf.js') return route.fulfill({ contentType: 'application/javascript', body: pdfJs });
          if (p === '/pdf.worker.js') return route.fulfill({ contentType: 'application/javascript', body: pdfWorker });
          return route.fulfill({ status: 404, body: '' });
        });
        return ctx;
      });
    }
    return contextP;
  };

  return {
    async render(pdf, o) {
      const ctx = await context();
      const page = await ctx.newPage();
      const timeoutMs = o.timeoutMs ?? 45_000;
      try {
        page.setDefaultTimeout(timeoutMs);
        await page.goto(`${ORIGIN}/`);
        const b64 = bytesToBuffer(pdf).toString('base64');
        const work = page.evaluate(
          async ({ b64, maxPages, longEdge, maxBytes, prefer, scanPages }: any) => {
            const g0 = globalThis as any;
            const lib = g0['pdfjs-dist/build/pdf'];
            lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.js';
            const bin = atob(b64);
            const data = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
            const doc = await lib.getDocument({ data, disableFontFace: false }).promise;
            const n = doc.numPages;
            const texts: Record<number, string> = {};
            const textOf = async (p: number) => {
              if (texts[p] !== undefined) return texts[p];
              try {
                const pg = await doc.getPage(p);
                const tc = await pg.getTextContent();
                texts[p] = tc.items.map((i: any) => i.str).join(' ').replace(/\s+/g, ' ').slice(0, 1500);
              } catch {
                texts[p] = '';
              }
              return texts[p];
            };
            let order: number[] = [];
            for (let p = 1; p <= n; p++) order.push(p);
            if (prefer) {
              const re = new RegExp(prefer, 'i');
              const scanned = order.slice(0, scanPages);
              const hits: number[] = [];
              for (const p of scanned) if (re.test(await textOf(p))) hits.push(p);
              order = [...hits, ...order.filter((p) => !hits.includes(p))];
            }
            const chosen = order.slice(0, maxPages).sort((a, b) => a - b);
            const out: any[] = [];
            for (const p of chosen) {
              const pg = await doc.getPage(p);
              const v1 = pg.getViewport(1);
              const scale = Math.min(longEdge / Math.max(v1.width, v1.height), 12);
              const vp = pg.getViewport(scale);
              const c = g0.document.createElement('canvas');
              c.width = Math.max(1, Math.round(vp.width));
              c.height = Math.max(1, Math.round(vp.height));
              const g = c.getContext('2d');
              g.fillStyle = '#ffffff';
              g.fillRect(0, 0, c.width, c.height);
              await pg.render({ canvasContext: g, viewport: vp }).promise;
              let mime = 'image/png';
              let url = c.toDataURL('image/png');
              // Line art compresses well as PNG; a dense colour sheet may not.
              if (url.length * 0.75 > Math.min(maxBytes * 0.7, 4 * 1024 * 1024)) {
                mime = 'image/jpeg';
                url = c.toDataURL('image/jpeg', 0.85);
              }
              out.push({ page: p, mime, b64: url.slice(url.indexOf(',') + 1), width: c.width, height: c.height, text: await textOf(p) });
              c.width = 0;
              c.height = 0;
            }
            try { await doc.destroy(); } catch { /* ignore */ }
            return { numPages: n, pages: out };
          },
          {
            b64,
            maxPages: Math.max(1, o.maxPages),
            longEdge: o.longEdge ?? 2200,
            maxBytes: o.maxBytes ?? 8 * 1024 * 1024,
            prefer: o.preferText ? o.preferText.source : null,
            scanPages: o.scanPages ?? 12,
          },
        );
        // A timed-out evaluate rejects later (page closed): never unhandled.
        work.catch(() => {});
        const res: any = await Promise.race([
          work,
          new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('PDF_RENDER_TIMEOUT')), timeoutMs); (t as any).unref?.(); }),
        ]);
        const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
        return {
          numPages: Number(res?.numPages) || 0,
          pages: (res?.pages ?? [])
            .map((p: any) => ({ page: p.page, mime: p.mime, bytes: new Uint8Array(Buffer.from(p.b64, 'base64')), width: p.width, height: p.height, text: String(p.text ?? '') }))
            .filter((p: RenderedPage) => p.bytes.length > 0 && p.bytes.length <= maxBytes),
        };
      } finally {
        await page.close().catch(() => {});
      }
    },
    async close() {
      const b = browserP;
      browserP = null;
      contextP = null;
      if (b) await b.then((x: any) => x.close()).catch(() => {});
    },
  };
}

/** Production default; `TAS_VISUAL_PAGE_RENDER=false` switches page rendering off without a deploy of anything else. */
export function defaultPdfRendererFactory(env: Record<string, string | undefined> = process.env): PdfRendererFactory | undefined {
  if (env.TAS_VISUAL_PAGE_RENDER === 'false') return undefined;
  if (!pdfJsBuildDir()) return undefined;
  return () => createChromiumPdfRenderer();
}
