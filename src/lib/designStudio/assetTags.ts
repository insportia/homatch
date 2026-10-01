// WHAT A CATALOGUE ROW SAYS ABOUT A PIECE, IN THE READER'S LANGUAGE.
//
// Tags in the catalogue are data words (English, lower case, sometimes
// provider-specific). The library row shows a short line of them — style,
// material, colour — only where a translation key exists, so a Georgian
// reader never sees raw English data words. Unknown words are dropped.

import type { CatalogAsset } from './catalog.ts';

const STYLE_KEY: Record<string, string> = {
  'warm-minimal': 'ds_style_warm_minimal', scandinavian: 'ds_style_scandinavian', nordic: 'ds_style_scandinavian',
  japandi: 'ds_style_japandi', contemporary: 'ds_style_contemporary', modern: 'ds_style_contemporary',
  mediterranean: 'ds_style_mediterranean', industrial: 'ds_style_industrial', classic: 'ds_style_classic',
  neoclassic: 'ds_style_classic', traditional: 'ds_style_classic', luxury: 'ds_style_luxury',
};

const MATERIAL_KEY: Record<string, string> = {
  wood: 'ds_tag_mat_wood', wooden: 'ds_tag_mat_wood', oak: 'ds_tag_mat_wood', walnut: 'ds_tag_mat_wood', timber: 'ds_tag_mat_wood',
  pine: 'ds_tag_mat_wood', birch: 'ds_tag_mat_wood', teak: 'ds_tag_mat_wood', plywood: 'ds_tag_mat_wood',
  fabric: 'ds_tag_mat_fabric', textile: 'ds_tag_mat_fabric', linen: 'ds_tag_mat_fabric', velvet: 'ds_tag_mat_fabric',
  cotton: 'ds_tag_mat_fabric', wool: 'ds_tag_mat_fabric', boucle: 'ds_tag_mat_fabric', upholstery: 'ds_tag_mat_fabric',
  leather: 'ds_tag_mat_leather',
  metal: 'ds_tag_mat_metal', steel: 'ds_tag_mat_metal', iron: 'ds_tag_mat_metal', brass: 'ds_tag_mat_metal',
  chrome: 'ds_tag_mat_metal', aluminium: 'ds_tag_mat_metal', aluminum: 'ds_tag_mat_metal', copper: 'ds_tag_mat_metal',
  glass: 'ds_tag_mat_glass',
  stone: 'ds_tag_mat_stone', marble: 'ds_tag_mat_stone', granite: 'ds_tag_mat_stone', concrete: 'ds_tag_mat_stone', travertine: 'ds_tag_mat_stone',
  ceramic: 'ds_tag_mat_ceramic', porcelain: 'ds_tag_mat_ceramic', terracotta: 'ds_tag_mat_ceramic',
  rattan: 'ds_tag_mat_rattan', wicker: 'ds_tag_mat_rattan', cane: 'ds_tag_mat_rattan',
  plastic: 'ds_tag_mat_plastic', acrylic: 'ds_tag_mat_plastic',
};

/** Canonical colour families (catalogSource.ts COLOR_FAMILIES) and the plain words hand-made rows use. */
const COLOR_KEY: Record<string, string> = {
  WHITE: 'ds_tag_col_white', OFF_WHITE: 'ds_tag_col_off_white', CREAM: 'ds_tag_col_cream', BEIGE: 'ds_tag_col_beige',
  BROWN: 'ds_tag_col_brown', BLACK: 'ds_tag_col_black', GRAY: 'ds_tag_col_gray', BLUE: 'ds_tag_col_blue', GREEN: 'ds_tag_col_green',
  RED: 'ds_tag_col_red', ORANGE: 'ds_tag_col_orange', YELLOW: 'ds_tag_col_yellow', PINK: 'ds_tag_col_pink', PURPLE: 'ds_tag_col_purple',
  METALLIC: 'ds_tag_col_metallic', WOOD_LIGHT: 'ds_tag_col_wood_light', WOOD_MEDIUM: 'ds_tag_col_wood_medium', WOOD_DARK: 'ds_tag_col_wood_dark',
  white: 'ds_tag_col_white', ivory: 'ds_tag_col_off_white', cream: 'ds_tag_col_cream', beige: 'ds_tag_col_beige', sand: 'ds_tag_col_beige',
  brown: 'ds_tag_col_brown', wood: 'ds_tag_col_wood_medium', black: 'ds_tag_col_black', grey: 'ds_tag_col_gray', gray: 'ds_tag_col_gray',
  charcoal: 'ds_tag_col_gray', blue: 'ds_tag_col_blue', navy: 'ds_tag_col_blue', green: 'ds_tag_col_green', sage: 'ds_tag_col_green',
  red: 'ds_tag_col_red', orange: 'ds_tag_col_orange', rust: 'ds_tag_col_orange', yellow: 'ds_tag_col_yellow', pink: 'ds_tag_col_pink',
  purple: 'ds_tag_col_purple', gold: 'ds_tag_col_metallic', silver: 'ds_tag_col_metallic',
};

/** Every key this file can return (the i18n coverage test reads it). */
export const ASSET_TAG_KEYS: readonly string[] = [...new Set([...Object.values(STYLE_KEY), ...Object.values(MATERIAL_KEY), ...Object.values(COLOR_KEY)])];

/**
 * Up to `max` translation keys describing a piece: one style, then
 * materials, then colours — de-duplicated, unknown words skipped.
 */
export function assetTagKeys(
  asset: Pick<CatalogAsset, 'styleTags' | 'materialTags' | 'colorTags'> & { colorFamilies?: string[] | null },
  max = 4,
): string[] {
  const out: string[] = [];
  const add = (k: string | undefined) => { if (k && !out.includes(k) && out.length < max) out.push(k); };
  const norm = (s: string) => s.trim().toLowerCase();
  add((asset.styleTags ?? []).map((s) => STYLE_KEY[norm(s)]).find(Boolean));
  for (const m of asset.materialTags ?? []) add(MATERIAL_KEY[norm(m)]);
  const families = asset.colorFamilies?.length ? asset.colorFamilies : asset.colorTags ?? [];
  for (const c of families) add(COLOR_KEY[c.trim()] ?? COLOR_KEY[norm(c)]);
  return out;
}
