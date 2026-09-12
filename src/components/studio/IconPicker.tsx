import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
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

  return (
    <div className="space-y-2 border-b py-4">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[15px] font-medium">{t(labelKey)}</Label>
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

      <div
        role="radiogroup"
        aria-label={t('studio_icon_pick')}
        className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-md border p-1.5"
      >
        {ICON_NAMES.map(name => {
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
      </div>
    </div>
  );
}
