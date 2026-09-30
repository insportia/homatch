import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";

/**
 * THE DIGITAL TWIN’S DECODERS, SERVED FROM OUR OWN ORIGIN.
 *
 * Draco, KTX2 and Meshopt are the difference between a building that is
 * sixty megabytes and one that is four — which is what makes the 3D
 * affordable to serve from a CDN rather than streamed from a GPU. Three.js
 * ships their decoders inside the package, but they are not reachable
 * through its `exports` map, so `new URL(…, import.meta.url)` cannot resolve
 * them and the build fails.
 *
 * The usual answer is to point the loaders at a public CDN. This project
 * does not: a viewer that stops working because somebody else’s free tier
 * changed is not a viewer we own. So the four files are copied out of the
 * pinned `three` package into a fixed, unhashed path — fixed because
 * DRACOLoader and KTX2Loader are given a DIRECTORY and append their own
 * filenames to it.
 *
 * Both halves matter: emitFile puts them in the build, and the middleware
 * serves the same paths in dev, so the viewer behaves identically in each.
 */
const THREE_DECODERS: Array<{ from: string; to: string }> = [
  // The glTF-specific Draco build: the decoder only, without the encoder.
  { from: "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm", to: "three/draco/draco_decoder.wasm" },
  { from: "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js", to: "three/draco/draco_wasm_wrapper.js" },
  { from: "three/examples/jsm/libs/basis/basis_transcoder.wasm", to: "three/basis/basis_transcoder.wasm" },
  { from: "three/examples/jsm/libs/basis/basis_transcoder.js", to: "three/basis/basis_transcoder.js" },
];

function resolveDecoder(relative: string): string {
  return path.resolve(__dirname, "node_modules", relative);
}

function threeDecoders(): Plugin {
  return {
    name: "homatch:three-decoders",
    apply: () => true,

    generateBundle() {
      for (const asset of THREE_DECODERS) {
        const source = resolveDecoder(asset.from);
        // A missing decoder is a broken viewer, not a warning to scroll
        // past: fail the build where somebody will see it.
        if (!fs.existsSync(source)) {
          this.error(`three decoder missing: ${asset.from}`);
        }
        this.emitFile({
          type: "asset",
          // Unhashed on purpose. The loaders are handed this directory.
          fileName: asset.to,
          source: fs.readFileSync(source),
        });
      }
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const match = THREE_DECODERS.find((a) => url === `/${a.to}`);
        if (!match) return next();
        const source = resolveDecoder(match.from);
        if (!fs.existsSync(source)) return next();
        res.setHeader(
          "Content-Type",
          match.to.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        res.end(fs.readFileSync(source));
        return undefined;
      });
    },
  };
}

/**
 * THE SERVICE WORKER CHANGES WITH EVERY BUILD, ON PURPOSE.
 *
 * public/sw.js used to ship byte-identical across deploys, so an installed
 * PWA never saw `updatefound` and a resumed app could run last month's
 * bundle forever — the only way out was deleting and reinstalling the app.
 * Stamping the VERSION placeholder with a per-build id makes every deploy
 * a real worker update: the new worker installs, refreshes the shell
 * precache, activates (install() calls skipWaiting), and its activate
 * handler drops every previous build's caches. The page then offers a
 * one-tap reload (SwUpdateToast) instead of forcing one mid-form.
 */
function stampServiceWorker(): Plugin {
  const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8)
    || Date.now().toString(36);
  return {
    name: 'homatch-stamp-sw',
    apply: 'build',
    /* The worker source lives OUTSIDE public/ precisely so the publicDir
       copy cannot overwrite the stamped output (it did: the copy lands
       after closeBundle under rolldown-vite). It is emitted as a build
       asset instead, already stamped. Dev never registers a worker
       (main.tsx guards on PROD), so no dev middleware is needed. */
    generateBundle() {
      const src = fs.readFileSync(path.resolve(__dirname, 'src/serviceWorker/sw.source.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src.replaceAll('__BUILD__', buildId) });
    },
  };
}

/**
 * HOMATCH DESIGN STUDIO — PUBLIC SHARE LINKS.
 *
 * /w/<token> and /d/<token> are a separate, small page (share.html) so anonymous visitors
 * never load the signed-in application. Vercel rewrites it in production
 * (vercel.json); this does the same for vite dev and vite preview.
 */
function shareViewerRewrite(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && /^\/[wd]\/[A-Za-z0-9_-]{43}\/?(\?.*)?$/.test(req.url)) req.url = '/share.html';
    next();
  };
  return {
    name: 'homatch:share-viewer-rewrite',
    // First in the stack: the HTML fallback would otherwise answer a page
    // request (Accept: text/html) with index.html before this runs.
    configureServer(server) { server.middlewares.stack.unshift({ route: '', handle: rewrite as never }); },
    configurePreviewServer(server) { server.middlewares.stack.unshift({ route: '', handle: rewrite as never }); },
  };
}

/**
 * ONE LANGUAGE PER CHUNK, CUT FROM THE ONE SOURCE FILE.
 *
 * src/i18n/translations.ts holds all six languages and stays the file every
 * apply-script, gate and test reads. The runtime (src/i18n/bundles.ts) never
 * imports it: it imports virtual:homatch-i18n/<lang>, which this plugin
 * answers by evaluating translations.ts once and emitting that one language's
 * object — English whole (the fallback, in the entry), every other language
 * as only its own strings, in a chunk of its own.
 *
 * Emitted as JSON.parse of a string: a large object literal parses measurably
 * slower than the same data as JSON, and nothing here needs to be code.
 */
function i18nLanguageChunks(): Plugin {
  const SOURCE = path.resolve(__dirname, 'src/i18n/translations.ts');
  const PREFIX = 'virtual:homatch-i18n/';
  const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
  let cached: { mtimeMs: number; bundles: Record<string, Record<string, string>> } | null = null;

  async function bundles(): Promise<Record<string, Record<string, string>>> {
    const { mtimeMs } = fs.statSync(SOURCE);
    if (cached && cached.mtimeMs === mtimeMs) return cached.bundles;
    /* Node strips the file's types itself (the i18n node tests import it the
       same way); its one import is `import type`, which is erased. The query
       string makes an edited file a new module rather than the cached one. */
    const mod = await import(`${pathToFileURL(SOURCE).href}?v=${mtimeMs}`);
    const merged = mod.translations as Record<string, Record<string, string>>;
    /* English whole; every other language only where it differs, so a chunk
       carries no copy of English (t() already falls back to English). */
    const en = merged.en;
    const out: Record<string, Record<string, string>> = { en };
    for (const lang of LANGS) {
      if (!merged[lang] || typeof merged[lang] !== 'object') throw new Error(`[i18n] translations.ts has no "${lang}" bundle`);
      if (lang === 'en') continue;
      const own: Record<string, string> = {};
      for (const [k, v] of Object.entries(merged[lang])) if (v !== en[k]) own[k] = v;
      out[lang] = own;
    }
    cached = { mtimeMs, bundles: out };
    return out;
  }

  return {
    name: 'homatch:i18n-language-chunks',
    resolveId(id) {
      if (id.startsWith(PREFIX) && LANGS.includes(id.slice(PREFIX.length))) return `\0${id}`;
      return null;
    },
    async load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      this.addWatchFile(SOURCE);
      const lang = id.slice(PREFIX.length + 1);
      const bundle = (await bundles())[lang];
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(bundle))});`;
    },
    // Dev: the virtual modules do not import translations.ts, so an edit to it
    // would not reach them on its own. Drop them and reload the page.
    handleHotUpdate({ file, server }) {
      if (path.resolve(file) !== SOURCE) return;
      for (const lang of LANGS) {
        const mod = server.moduleGraph.getModuleById(`\0${PREFIX}${lang}`);
        if (mod) server.moduleGraph.invalidateModule(mod);
      }
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    i18nLanguageChunks(),
    shareViewerRewrite(),
    stampServiceWorker(),
    threeDecoders(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // Keyed "index" so the app's entry chunk keeps its index-*.js name.
        index: path.resolve(__dirname, 'index.html'),
        share: path.resolve(__dirname, 'share.html'),
      },
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
});
