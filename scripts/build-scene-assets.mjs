#!/usr/bin/env node
/*
 * Builds the Main Page's responsive image sets from the owner-approved
 * source artwork.
 *
 * HOW TO RUN
 *
 *   npm install --no-save sharp
 *   node scripts/build-scene-assets.mjs <directory-with-the-source-files>
 *
 * sharp is deliberately NOT a project dependency: this runs once when the
 * artwork changes, not on every install, and nothing in the app or in any
 * gate imports it. The committed output under public/images/ is what ships.
 *
 * The source PNGs themselves are not committed — they are ~2.2 MB each and
 * the largest generated WebP is visually indistinguishable from them at every
 * size the page can render. Keep the originals with the design files; point
 * this script at them again to regenerate.
 *
 * WHAT IT PRODUCES, AND WHY
 *
 * Three widths per image, in AVIF, WebP and JPEG. The widths are chosen from
 * how each image is actually laid out, not from a generic ladder: the hero
 * panel is at most 56vw, the verification figure is at most ~640px, and the
 * two full-bleed bands can reach the full viewport. JPEG is the floor that
 * must always exist; AVIF and WebP are what almost every visitor will get.
 *
 * Quality is set high on purpose. These are the brand's photographs and the
 * page is mostly whitespace around them — banding in a sunset gradient would
 * be far more visible here than the saved kilobytes are worth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp is not installed. Run:  npm install --no-save sharp');
  process.exit(1);
}

const SOURCE_DIR = process.argv[2];
if (!SOURCE_DIR) {
  console.error('usage: node scripts/build-scene-assets.mjs <directory-with-the-source-files>');
  process.exit(1);
}

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

/** name → where it lives, how wide it ever renders, and what it is called. */
const IMAGES = [
  { source: 'homatch-hero-tbilisi-luxury', dir: 'hero', widths: [768, 1200, 1536] },
  { source: 'homatch-verification-property', dir: 'verification', widths: [640, 960, 1280] },
  { source: 'homatch-tbilisi-network', dir: 'platform', widths: [960, 1400, 1672] },
  { source: 'homatch-closing-tbilisi', dir: 'cta', widths: [960, 1400, 1832] },
];

/** The download may arrive as `name.png` or, from some clients, `name.png.png`. */
function resolveSource(name) {
  for (const candidate of [`${name}.png`, `${name}.png.png`, `${name}.jpg`, `${name}.jpeg`, `${name}.webp`]) {
    const full = path.join(SOURCE_DIR, candidate);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(`no source found for ${name} in ${SOURCE_DIR}`);
}

const ENCODERS = [
  { ext: 'avif', apply: img => img.avif({ quality: 62, effort: 6, chromaSubsampling: '4:4:4' }) },
  { ext: 'webp', apply: img => img.webp({ quality: 84, effort: 6 }) },
  { ext: 'jpg', apply: img => img.jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }) },
];

async function main() {
  for (const image of IMAGES) {
    const source = resolveSource(image.source);
    const outDir = path.join(ROOT, 'public', 'images', image.dir);
    fs.mkdirSync(outDir, { recursive: true });

    const meta = await sharp(source).metadata();
    console.log(`\n${image.source}  ${meta.width}x${meta.height}`);

    for (const width of image.widths) {
      if (width > meta.width) {
        console.log(`  skip ${width}w (wider than the source)`);
        continue;
      }
      for (const encoder of ENCODERS) {
        const out = path.join(outDir, `${image.source}-${width}.${encoder.ext}`);
        await encoder
          .apply(sharp(source).resize({ width, withoutEnlargement: true, kernel: 'lanczos3' }))
          .toFile(out);
        const kb = (fs.statSync(out).size / 1024).toFixed(0);
        console.log(`  ${path.basename(out).padEnd(48)} ${kb.padStart(5)} kB`);
      }
    }
  }
  console.log('\ndone');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
