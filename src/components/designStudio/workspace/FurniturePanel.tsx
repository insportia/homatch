import React, { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset } from '@/lib/designStudio/catalog';
import { assetTagKeys } from '@/lib/designStudio/assetTags';
import { parseAssetQuery, rankAssets } from '@/lib/designStudio/search';
import { cn } from '@/lib/utils';
import { CatalogThumb } from './CatalogThumb';
import { useIncrementalList } from './useIncrementalList';

export const ASSET_DRAG_TYPE = 'application/x-homatch-asset';

const CATEGORY_KEYS: Record<string, string> = {
  SOFA: 'ds_cat_sofa', ARMCHAIR: 'ds_cat_armchair', TABLE: 'ds_cat_table', CHAIR: 'ds_cat_chair', BED: 'ds_cat_bed',
  WARDROBE: 'ds_cat_wardrobe', STORAGE: 'ds_cat_storage', RUG: 'ds_cat_rug', LIGHTING: 'ds_cat_lighting',
  DECOR: 'ds_cat_decor', KITCHEN: 'ds_cat_kitchen', BATHROOM: 'ds_cat_bathroom', OUTDOOR: 'ds_cat_outdoor',
  TEXTILE: 'ds_cat_textile',
};

export interface FitCheck {
  (asset: CatalogAsset): 'FITS' | 'WARN' | 'NO';
}

/**
 * THE FURNITURE LIBRARY. Metadata and small pictures; no model loads while browsing.
 *
 * Every row shows what it is before it is picked: the piece's picture (signed
 * only once the row is on screen, batched, cached), its name, kind, size and
 * a short line of style/material/colour. Replace mode uses the same rows. A
 * long result is drawn a page at a time.
 *
 * Browsing: natural words become structured filters ("small wooden table" →
 * TABLE + wood + small), categories narrow, results rank toward the room
 * being designed. Replacing: the same list, narrowed to the piece's
 * category, each result checked against the spot it would stand in.
 */
export function FurniturePanel({
  assets, roomKind, roomName, replacing, fit, onAdd, onReplace, onCancelReplace,
}: {
  assets: CatalogAsset[];
  roomKind: string | null;
  roomName: string | null;
  replacing: { name: string; category: string } | null;
  fit?: FitCheck;
  onAdd: (asset: CatalogAsset) => void;
  onReplace: (asset: CatalogAsset) => void;
  onCancelReplace: () => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => [...new Set(assets.map((a) => a.category))].sort(), [assets]);
  const effectiveCategory = replacing ? replacing.category : category;

  const results = useMemo(() => {
    const q = parseAssetQuery(query);
    if (effectiveCategory) q.categories = [effectiveCategory];
    return rankAssets(assets, q, { roomKind });
  }, [assets, query, effectiveCategory, roomKind]);

  // A 2,000-row result is drawn a page at a time; the ranking is untouched.
  const list = useIncrementalList(results.length, `${query}|${effectiveCategory ?? ''}|${roomKind ?? ''}|${replacing?.name ?? ''}`);
  const visible = results.slice(0, list.shown);
  // The concept-block note speaks about what is on screen.
  const anyPlaceholder = visible.some((a) => a.isPlaceholder);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {replacing ? (
        <div className="flex items-center justify-between gap-2 border-b border-[#E4E6EA] bg-[hsl(41_88%_91%)]/60 px-4 py-2.5">
          <p className="min-w-0 text-[14px] text-[#0C1119]">
            {t('ds_replacing', { name: replacing.name })}
          </p>
          <button
            type="button"
            onClick={onCancelReplace}
            className="shrink-0 rounded-md px-2 py-1 text-[13px] font-medium text-[#0C1119] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
          >
            {t('ds_action_cancel')}
          </button>
        </div>
      ) : null}

      <div className="space-y-2.5 border-b border-[#E4E6EA] px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4A5263]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ds_library_search')}
            aria-label={t('ds_library_search')}
            className="h-9 w-full rounded-lg border border-[#D5D9E0] bg-white pe-8 ps-8 text-[14px] text-[#0C1119] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label={t('ds_picker_clear')} className="absolute end-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-[#4A5263] hover:text-[#0C1119]">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {!replacing ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ds_library_categories')}>
            <button
              type="button"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
              className={cn('rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                category === null ? 'bg-[#0C1119] text-white' : 'bg-[#F1F2F4] text-[#0C1119] hover:bg-[#E6E8EC]')}
            >
              {t('ds_library_all')}
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
                className={cn('rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                  category === c ? 'bg-[#0C1119] text-white' : 'bg-[#F1F2F4] text-[#0C1119] hover:bg-[#E6E8EC]')}
              >
                {t(CATEGORY_KEYS[c] ?? 'ds_cat_other')}
              </button>
            ))}
          </div>
        ) : null}
        {roomName && !replacing ? (
          <p className="text-[13px] text-[#4A5263]">{t('ds_library_for_room', { room: roomName })}</p>
        ) : null}
      </div>

      {anyPlaceholder ? (
        <p className="border-b border-[#E4E6EA] bg-[#F7F8FA] px-4 py-2 text-[13px] leading-snug text-[#4A5263]">
          {t('ds_library_placeholder_note')}
        </p>
      ) : null}

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label={t('ds_panel_furniture')}>
        {results.length === 0 ? (
          <li className="px-2 py-6 text-[14px] text-[#4A5263]">{t('ds_library_empty')}</li>
        ) : visible.map((asset) => {
          const verdict = replacing && fit ? fit(asset) : null;
          const tags = assetTagKeys(asset, 3);
          return (
            <li
              key={asset.code}
              draggable={!replacing}
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.code);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#F4F5F7]"
            >
              <CatalogThumb thumbKey={asset.thumbnailKey} className="h-16 w-16" fallback={<AssetSwatch asset={asset} />} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14px] font-medium leading-snug text-[#0C1119]">{asset.name}</p>
                <p className="min-w-0 break-words text-[13px] text-[#4A5263]">
                  {t(CATEGORY_KEYS[asset.category] ?? 'ds_cat_other')}
                  {' · '}
                  <span dir="ltr" className="whitespace-nowrap">{asset.widthM.toFixed(2)} × {asset.depthM.toFixed(2)} × {asset.heightM.toFixed(2)} m</span>
                </p>
                {tags.length ? (
                  <p className="truncate text-[13px] text-[#4A5263]">{tags.map((k) => t(k)).join(' · ')}</p>
                ) : null}
                {verdict ? (
                  <p className={cn('text-[13px] font-medium', verdict === 'FITS' ? 'text-[hsl(152_54%_28%)]' : verdict === 'WARN' ? 'text-[hsl(32_78%_34%)]' : 'text-[hsl(0_66%_40%)]')}>
                    {t(verdict === 'FITS' ? 'ds_fit_fits' : verdict === 'WARN' ? 'ds_fit_tight' : 'ds_fit_no')}
                  </p>
                ) : null}
              </div>
              {replacing ? (
                <button
                  type="button"
                  disabled={verdict === 'NO'}
                  onClick={() => onReplace(asset)}
                  className="h-8 shrink-0 rounded-md bg-[#0C1119] px-3 text-[13px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-40"
                >
                  {t('ds_action_use')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(asset)}
                  aria-label={t('ds_action_add_named', { name: asset.name })}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#D5D9E0] text-[#0C1119] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
        {list.hasMore ? (
          <li ref={list.sentinelRef} className="flex flex-wrap items-center justify-between gap-2 px-2 py-3">
            <span className="text-[13px] text-[#4A5263]">{t('ds_library_showing', { shown: list.shown, total: results.length })}</span>
            <button
              type="button"
              onClick={list.more}
              className="rounded-md border border-[#D5D9E0] px-3 py-1.5 text-[13px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              {t('ds_library_show_more')}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** A plan-view silhouette in the piece's own colours — when there is no picture (concept blocks, unsigned thumbnails). */
export function AssetSwatch({ asset }: { asset: CatalogAsset }) {
  const main = asset.materialSlots[0]?.defaultColor ?? '#c9ccd2';
  const accent = asset.materialSlots[1]?.defaultColor ?? main;
  const max = Math.max(asset.widthM, asset.depthM);
  const w = (asset.widthM / max) * 34;
  const d = (asset.depthM / max) * 34;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#F1F2F4]" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="h-9 w-9">
        {asset.procedural?.kind === 'ROUND_TABLE' || asset.procedural?.kind === 'PLANT' || asset.procedural?.kind === 'PLANTER' || asset.procedural?.kind === 'LAMP' || asset.procedural?.kind === 'STOOL'
          ? <circle cx="20" cy="20" r={Math.min(w, d) / 2} fill={main} stroke={accent} strokeWidth="1.5" />
          : <rect x={20 - w / 2} y={20 - d / 2} width={w} height={d} rx="2" fill={main} stroke={accent} strokeWidth="1.5" />}
      </svg>
    </span>
  );
}
