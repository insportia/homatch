import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { ADDABLE } from './useStudioState';

/**
 * THE BLOCK LIBRARY.
 *
 * "+ Add a block" used to be a row of buttons pinned under the structure
 * list — fine at three blocks, unusable as the catalogue grows, and with no
 * way to find one by name.
 *
 * WHAT IS IN IT, AND WHAT IS NOT
 *
 * Only the REPEATABLE section types, which is the same rule the old control
 * followed and the reason the list is shorter than the registry. The design's
 * own regions — the hero, the launcher, the intelligence layers — exist once,
 * in code, and are hidden rather than duplicated: a page with two heroes is
 * not a layout this design system implements, so offering it would be
 * offering a way to make a page the designers would not recognise.
 *
 * Each entry is named by its registry label, so the library says what the
 * page will say, in the language the admin is working in.
 */
export function SectionLibrary({
  onPick, onClose,
}: { onPick: (type: string) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ADDABLE;
    return ADDABLE.filter(def => t(def.labelKey).toLowerCase().includes(needle));
  }, [q, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('studio_library_title')}
    >
      <button
        type="button"
        aria-label={t('studio_delete')}
        onClick={onClose}
        className="absolute inset-0 bg-[hsl(0_0%_0%/0.45)]"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-[34rem] flex-col overflow-hidden rounded-xl border bg-card shadow-hover">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('studio_library_title')}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t('studio_library_sub')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('studio_collapse')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative border-b px-5 py-3">
          <Search className="pointer-events-none absolute start-8 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('studio_library_search')}
            aria-label={t('studio_library_search')}
            className="ps-9"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-[15px] text-muted-foreground">
              {t('studio_library_empty')}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map(def => (
                <li key={def.type}>
                  <button
                    type="button"
                    onClick={() => onPick(def.type)}
                    className="flex w-full flex-col gap-1 rounded-lg border border-border bg-background p-3 text-start transition-colors hover:border-gold hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-[16px] font-medium text-foreground">{t(def.labelKey)}</span>
                    {/* What the block is made of, so the choice is informed
                        rather than a name and a hope. */}
                    <span className="truncate text-[13px] text-muted-foreground">
                      {def.fields.length} · {def.items ? t(def.items.itemLabelKey) : t('studio_layer_fields')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
