import React, { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ICON_NAMES, ICON_SET } from '@/site/icons';

/**
 * CHOOSING AN ICON.
 *
 * A grid of the forty-four icons this product draws with, and nothing else.
 *
 * WHY THERE IS NO UPLOAD BUTTON HERE
 *
 * The obvious feature is "upload your own SVG", and it is the one thing this
 * control must not do. An SVG is a document: it can carry script, external
 * references and event handlers, and accepting one means accepting markup
 * into a page from a form. The whole content model stores plain strings for
 * exactly that reason, and an icon slot should not be the single hole in it.
 *
 * So a choice is a NAME, checked against the set on the way in and resolved
 * against it on the way out. The worst an admin can store is a name nothing
 * matches, which renders the icon the section already ships.
 *
 * The second reason is design, and it would be enough on its own: a set that
 * included everything would let somebody put a birthday cake on a
 * due-diligence report. These forty-four are the vocabulary the sections were
 * drawn around, so no combination of choices produces a page that looks like
 * a different product.
 */
export function IconPicker({
  value, onChange, labelKey,
}: {
  /** The stored name, or undefined for "whatever the section ships". */
  value: string | undefined;
  onChange: (name: string | null) => void;
  labelKey: string;
}) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');

  /*
   * SEARCH, BECAUSE FORTY-FOUR IS TOO MANY TO SCAN.
   *
   * The grid is eight across and scrolls, so most of the set is off screen
   * and the only way to find "Landmark" was to read every icon in order.
   * Matching on the NAME rather than on a tag list is deliberate: the name is
   * the identifier that gets stored, so what an admin types is the thing they
   * will see again in the field.
   */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ICON_NAMES;
    return ICON_NAMES.filter(name => name.toLowerCase().includes(needle));
  }, [q]);

  /* What is on the page right now, drawn rather than named. */
  const Current = value ? ICON_SET[value] : null;

  return (
    <div className="space-y-2 border-b py-4">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
          {Current && (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded border bg-secondary text-foreground">
              <Current className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 truncate">{t(labelKey)}</span>
        </Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded px-1.5 py-0.5 text-[14px] text-muted-foreground hover:bg-accent"
          >
            {t('studio_icon_none')}
          </button>
        )}
      </div>

      <Input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={t('studio_library_search')}
        aria-label={t('studio_icon_pick')}
        className="h-8 text-[15px]"
      />

      <div
        role="radiogroup"
        aria-label={t('studio_icon_pick')}
        className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-md border p-1.5"
      >
        {shown.map(name => {
          const Glyph = ICON_SET[name];
          const chosen = value === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={chosen}
              // The name is the only label there is. It is also the only
              // string here that is deliberately NOT translated: it is an
              // identifier, and an admin comparing it with the stored value
              // needs to see the same characters in both places.
              title={name}
              onClick={() => onChange(name)}
              className={`grid aspect-square place-items-center rounded transition-colors ${
                chosen
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Glyph className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="col-span-8 px-1 py-3 text-center text-[14px] text-muted-foreground">
            {t('studio_library_empty')}
          </p>
        )}
      </div>
    </div>
  );
}
