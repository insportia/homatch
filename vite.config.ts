import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import fs from "fs";

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

export default defineConfig({
  plugins: [
    react(),
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
