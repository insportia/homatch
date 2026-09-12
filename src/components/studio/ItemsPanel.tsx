import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { readLocalized } from '@/site/model';
import type { ItemGroupDef } from '@/site/registry';
import type { StudioState } from './useStudioState';
import { FieldEditor } from './FieldEditor';
import { IconPicker } from './IconPicker';

/**
 * THE THINGS INSIDE A BLOCK: cards, questions, steps.
 *
 * Add, reorder, duplicate, delete — and inside each one, the same field
 * editor the section's own copy gets, with the same translation status.
 *
 * ONE OPEN AT A TIME
 *
 * Twelve cards with three fields each is thirty-six inputs in a panel about
 * as wide as a phone. Collapsed rows keep the LIST readable, which is what
 * this panel is actually for: reordering and finding. Writing happens either
 * in the one open row or, more often, by typing on the page itself, which is
 * where an admin can see what the words look like.
 *
 * WHY A ROW SHOWS ITS FIRST FIELD
 *
 * A list of rows all reading "Card" is not a list, it is a count. The row is
 * labelled with whatever the child's first field says in the language being
 * edited, so an admin can find the one they mean.
 */

/** Prompts for fields that have no shipped copy to fall back on. */
const PROMPTS: Record<string, string> = {
  title: 'studio_ph_card_title',
  body: 'studio_ph_card_body',
  question: 'studio_ph_question',
  answer: 'studio_ph_answer',
};

export function ItemsPanel({ studio, def }: { studio: StudioState; def: ItemGroupDef }) {
  const { t } = useLanguage();
  const { selected, locale, addItem, removeItem, moveItem, duplicateItem, setIcon } = studio;
  const [openId, setOpenId] = useState<string | null>(null);
  if (!selected) return null;

  const items = selected.items;
  const nameField = def.fields[0]?.key ?? '';
  const full = items.length >= def.max;

  return (
    <div className="border-b py-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-medium">{t('studio_items')}</h3>
        <Button
          variant="outline" size="sm" className="h-8 gap-1.5 text-[14px]"
          disabled={full}
          // Disabled AND explained: a control that simply stops working
          // teaches an admin that the editor is unreliable.
          title={full ? t('studio_item_max', { n: def.max }) : undefined}
          onClick={() => addItem(selected.id)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('studio_item_add')}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="py-3 text-[14px] text-muted-foreground">{t('studio_item_none')}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.map((item, i) => {
            const open = openId === item.id;
            const name = readLocalized(item.content[nameField], locale)
              || `${t(def.itemLabelKey)} ${i + 1}`;

            return (
              <li key={item.id} className="rounded-md border">
                <div className="flex items-center gap-0.5 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : item.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 truncate px-1 py-1 text-start text-[14px] hover:text-foreground"
                  >
                    {name}
                  </button>

                  <IconButton
                    label={t('studio_item_up')} disabled={i === 0}
                    onClick={() => moveItem(selected.id, item.id, -1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('studio_item_down')} disabled={i === items.length - 1}
                    onClick={() => moveItem(selected.id, item.id, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('studio_item_duplicate')} disabled={full}
                    onClick={() => duplicateItem(selected.id, item.id)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('studio_item_remove')}
                    onClick={() => {
                      if (openId === item.id) setOpenId(null);
                      removeItem(selected.id, item.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>

                {open && (
                  <div className="border-t px-2.5">
                    {def.fields.map(f => (
                      <FieldEditor
                        key={f.key}
                        studio={studio}
                        field={f}
                        item={item}
                        placeholderKey={PROMPTS[f.key]}
                      />
                    ))}
                    {def.icons.map(icon => (
                      <IconPicker
                        key={icon.slot}
                        labelKey={icon.labelKey}
                        value={item.icons[icon.slot]}
                        onChange={name => setIcon(icon.slot, name, item.id)}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A square action in the row. Labelled for screen readers, never by text. */
function IconButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}
