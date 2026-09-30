// "warm beige sofa", "small wooden bedside table" — natural words in,
// STRUCTURED filters out, deterministically.
//
// A small lexicon maps words (in all six product languages for the core
// nouns) to categories, colour families, materials, sizes and style tags.
// Whatever is not recognised stays as free text matched against names.
// AI may later help build the structure; the search itself never depends
// on it.

import type { CatalogAsset } from './catalog.ts';

export interface AssetQuery {
  categories: string[];
  colors: string[];
  materials: string[];
  styles: string[];
  size: 'SMALL' | 'LARGE' | null;
  text: string[];
}

const CATEGORY: Record<string, string> = {
  sofa: 'SOFA', sofas: 'SOFA', couch: 'SOFA', settee: 'SOFA',
  'დივანი': 'SOFA', 'диван': 'SOFA', 'kanepe': 'SOFA', 'koltuk': 'ARMCHAIR', 'أريكة': 'SOFA', 'ספה': 'SOFA',
  armchair: 'ARMCHAIR', 'სავარძელი': 'ARMCHAIR', 'кресло': 'ARMCHAIR', 'كرسي': 'CHAIR', 'כורסה': 'ARMCHAIR',
  table: 'TABLE', desk: 'TABLE', 'მაგიდა': 'TABLE', 'стол': 'TABLE', 'masa': 'TABLE', 'طاولة': 'TABLE', 'שולחן': 'TABLE',
  chair: 'CHAIR', stool: 'CHAIR', 'სკამი': 'CHAIR', 'стул': 'CHAIR', 'sandalye': 'CHAIR', 'כיסא': 'CHAIR',
  bed: 'BED', 'საწოლი': 'BED', 'кровать': 'BED', 'yatak': 'BED', 'سرير': 'BED', 'מיטה': 'BED',
  wardrobe: 'WARDROBE', closet: 'WARDROBE', 'კარადა': 'WARDROBE', 'шкаф': 'WARDROBE', 'gardırop': 'WARDROBE', 'خزانة': 'WARDROBE', 'ארון': 'WARDROBE',
  rug: 'RUG', carpet: 'RUG', 'ხალიჩა': 'RUG', 'ковёр': 'RUG', 'ковер': 'RUG', 'halı': 'RUG', 'سجادة': 'RUG', 'שטיח': 'RUG',
  lamp: 'LIGHTING', light: 'LIGHTING', 'ნათურა': 'LIGHTING', 'лампа': 'LIGHTING', 'lamba': 'LIGHTING', 'مصباح': 'LIGHTING', 'מנורה': 'LIGHTING',
  plant: 'DECOR', decor: 'DECOR', 'მცენარე': 'DECOR', 'растение': 'DECOR', 'bitki': 'DECOR', 'نبتة': 'DECOR', 'צמח': 'DECOR',
  shelf: 'STORAGE', shelves: 'STORAGE', bookshelf: 'STORAGE', storage: 'STORAGE', cabinet: 'STORAGE', dresser: 'STORAGE',
  kitchen: 'KITCHEN', island: 'KITCHEN', vanity: 'BATHROOM', sink: 'BATHROOM', outdoor: 'OUTDOOR', balcony: 'OUTDOOR',
};

const COLOR: Record<string, string> = {
  beige: 'beige', sand: 'beige', cream: 'beige', oat: 'beige', white: 'white', black: 'black', grey: 'grey', gray: 'grey',
  charcoal: 'grey', green: 'green', sage: 'green', blue: 'blue', navy: 'blue', brown: 'wood', terracotta: 'orange', rust: 'orange',
  'თეთრი': 'white', 'შავი': 'black', 'белый': 'white', 'чёрный': 'black', 'черный': 'black', 'beyaz': 'white', 'siyah': 'black',
};

const MATERIAL: Record<string, string> = {
  wood: 'wood', wooden: 'wood', oak: 'wood', walnut: 'wood', stone: 'stone', marble: 'stone', metal: 'metal',
  fabric: 'fabric', linen: 'fabric', velvet: 'fabric', rattan: 'rattan', ceramic: 'ceramic',
  'ხის': 'wood', 'деревянный': 'wood', 'ahşap': 'wood', 'خشبي': 'wood', 'עץ': 'wood',
};

const STYLE: Record<string, string[]> = {
  warm: ['warm-minimal', 'natural'], minimal: ['minimal', 'warm-minimal'], minimalist: ['minimal'],
  scandinavian: ['scandinavian'], nordic: ['scandinavian'], japandi: ['japandi'], japanese: ['japandi'],
  industrial: ['industrial'], classic: ['classic'], luxury: ['luxury'], luxurious: ['luxury'], elegant: ['luxury', 'classic'],
  natural: ['natural'], dark: ['dark-contemporary'], modern: ['contemporary'], contemporary: ['contemporary'],
  mediterranean: ['mediterranean'], family: ['family'],
};

const SMALL = new Set(['small', 'compact', 'little', 'narrow', 'პატარა', 'маленький', 'küçük', 'صغير', 'קטן']);
const LARGE = new Set(['large', 'big', 'wide', 'დიდი', 'большой', 'büyük', 'كبير', 'גדול']);
const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'in', 'this', 'room', 'of', 'to']);

export function parseAssetQuery(input: string): AssetQuery {
  const q: AssetQuery = { categories: [], colors: [], materials: [], styles: [], size: null, text: [] };
  for (const raw of input.toLowerCase().split(/[\s,.;:!?]+/u)) {
    const w = raw.trim();
    if (!w || STOP.has(w)) continue;
    if (CATEGORY[w]) q.categories.push(CATEGORY[w]);
    else if (COLOR[w]) q.colors.push(COLOR[w]);
    else if (MATERIAL[w]) q.materials.push(MATERIAL[w]);
    else if (STYLE[w]) q.styles.push(...STYLE[w]);
    else if (SMALL.has(w)) q.size = 'SMALL';
    else if (LARGE.has(w)) q.size = 'LARGE';
    else q.text.push(w);
  }
  const uniq = (a: string[]) => [...new Set(a)];
  return { ...q, categories: uniq(q.categories), colors: uniq(q.colors), materials: uniq(q.materials), styles: uniq(q.styles) };
}

/**
 * Rank assets for a query: hard filters (category, material) exclude;
 * soft signals (colour, style, size, room) order. Deterministic ties by name.
 */
export function rankAssets(assets: CatalogAsset[], q: AssetQuery, context: { roomKind?: string | null } = {}): CatalogAsset[] {
  const scored: Array<{ a: CatalogAsset; score: number }> = [];
  for (const a of assets) {
    if (q.categories.length && !q.categories.includes(a.category)) continue;
    if (q.materials.length && !q.materials.some((m) => a.materialTags.includes(m) || a.colorTags.includes(m))) continue;
    const haystack = `${a.name} ${a.code} ${a.subcategory ?? ''}`.toLowerCase();
    if (q.text.length && !q.text.every((t) => haystack.includes(t))) continue;
    let score = 0;
    if (q.colors.some((c) => a.colorTags.includes(c))) score += 3;
    score += q.styles.filter((s) => a.styleTags.includes(s)).length * 2;
    if (context.roomKind && a.roomKinds.includes(context.roomKind)) score += 2;
    scored.push({ a, score });
  }
  // "Small" and "large" are relative to what matched: the smallest sofa is
  // small for a sofa, whatever a table would call it.
  if (q.size && scored.length > 1) {
    const areas = scored.map((x) => x.a.widthM * x.a.depthM);
    const min = Math.min(...areas);
    const span = Math.max(...areas) - min || 1;
    for (const x of scored) {
      const rel = (x.a.widthM * x.a.depthM - min) / span; // 0 smallest … 1 largest
      x.score += 3 * (q.size === 'SMALL' ? 1 - rel : rel);
    }
  }
  return scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name)).map((s) => s.a);
}
