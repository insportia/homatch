import React from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { sectionDef } from '@/site/registry';
import { localeState } from '@/site/model';
import { ADDABLE, type StudioState } from './useStudioState';
import { StateDot } from './StateDot';

/**
 * The page as a list: order, visibility, and what needs attention.
 *
 * The list and the preview are two views of the same selection, so clicking
 * either one selects in both. Ordering lives here rather than as drag handles
 * in the preview because the preview is a page, and dragging a full-bleed
 * hero over a black section is a worse target than a row in a list. Buttons
 * also give keyboard users the same capability without a drag interaction.
 */
export function StructurePanel({ studio }: { studio: StudioState }) {
  const { t } = useLanguage();
  const { draft, selectedId, select, move, setEnabled, addSection, removeSection, locale } = studio;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t('studio_structure')}</h2>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {draft.sections.map((section, i) => {
          const def = sectionDef(section.type);
          const isSelected = section.id === selectedId;

          // Does anything in this section need a look in the language the
          // admin is currently editing? The dot is the whole answer.
          const worst = def?.fields.reduce<'current' | 'needs_update' | 'ai_suggested' | 'reviewed'>(
            (acc, f) => {
              const state = localeState(section, f.key, locale);
              if (state === 'needs_update') return 'needs_update';
              if (state === 'ai_suggested' && acc !== 'needs_update') return 'ai_suggested';
              return acc;
            }, 'current') ?? 'current';

          return (
            <li key={section.id}>
              <div
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
                  isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(section.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                >
                  <StateDot state={worst} />
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] ${
                      section.enabled ? '' : 'text-muted-foreground line-through'
                    }`}
                  >
                    {def ? t(def.labelKey) : section.type}
                  </span>
                </button>

                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => move(section.id, -1)}
                    disabled={i === 0}
                    aria-label={t('studio_move_up')}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => move(section.id, 1)}
                    disabled={i === draft.sections.length - 1}
                    aria-label={t('studio_move_down')}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { select(section.id); setEnabled(!section.enabled, section.id); }}
                    aria-label={t('studio_enabled')}
                  >
                    {section.enabled
                      ? <Eye className="h-3.5 w-3.5" />
                      : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                  {def?.repeatable && (
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => removeSection(section.id)}
                      aria-label={t('studio_delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Only the repeatable blocks can be added. The design's own regions
          are not a palette: they exist once, in code, and are hidden rather
          than duplicated. */}
      {ADDABLE.length > 0 && (
        <div className="border-t p-2">
          {ADDABLE.map(def => (
            <Button
              key={def.type}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-[13px]"
              onClick={() => addSection(def.type)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t(def.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
