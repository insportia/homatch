import React from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
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
  const {
    draft, selectedId, select, move, setEnabled, addSection, duplicateSection,
    removeSection, locale,
  } = studio;

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
          let worst: 'current' | 'needs_update' | 'ai_suggested' | 'reviewed' = 'current';
          const note = (state: typeof worst) => {
            if (state === 'needs_update') worst = 'needs_update';
            else if (state === 'ai_suggested' && worst !== 'needs_update') worst = 'ai_suggested';
          };
          for (const f of def?.fields ?? []) note(localeState(section, f.key, locale));
          /* The cards count too. A block whose every word lives in its
             children — a set of questions and answers — would otherwise
             always report itself as fine. */
          for (const item of section.items) {
            for (const f of def?.items?.fields ?? []) note(localeState(item, f.key, locale));
          }

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
                    className={`min-w-0 flex-1 truncate text-[16px] ${
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
                    <>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => duplicateSection(section.id)}
                        aria-label={t('studio_duplicate')}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => removeSection(section.id)}
                        aria-label={t('studio_delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
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
              className="w-full justify-start gap-2 text-[16px]"
              // Below the selected section when there is one, so the new
              // block lands where the admin is working rather than at
              // the bottom of a page they then have to scroll to.
              onClick={() => addSection(def.type, selectedId ?? undefined)}
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
