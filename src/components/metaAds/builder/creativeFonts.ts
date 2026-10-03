// The composer preview's fonts: the SAME pinned files the server exports with
// (public/creative-engine), registered under private family names so the app's
// own web fonts (or a system fallback) can never stand in for them.
import { BROWSER_FAMILY, CREATIVE_ASSET_BASE, FONT_FILES, type FontFaceKey, type FontKey } from '@/lib/metaAds/creativeLayout';

let loading: Promise<boolean> | null = null;

/** Resolves true once every face is loaded; false if the browser could not load them (the preview then says so). */
export function ensureCreativeFonts(): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve(false);
  loading ??= Promise.all((Object.keys(FONT_FILES) as FontFaceKey[]).map(async (key) => {
    const [font, weight] = key.split('-') as [FontKey, string];
    const face = new FontFace(BROWSER_FAMILY[font], `url(${CREATIVE_ASSET_BASE}${FONT_FILES[key].file}) format('truetype')`, { weight, style: 'normal', display: 'block' });
    document.fonts.add(await face.load());
  })).then(() => true).catch(() => { loading = null; return false; });
  return loading;
}
