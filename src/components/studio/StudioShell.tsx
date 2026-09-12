import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { StructurePanel } from './StructurePanel';
import { Inspector } from './Inspector';
import { HistoryPanel } from './HistoryPanel';
import { StudioToolbar } from './StudioToolbar';
import { StudioPreview, type DeviceKey } from './StudioPreview';
import type { SectionControlsApi } from './SectionControls';
import { sectionDef } from '@/site/registry';
import { ADDABLE, useStudioState } from './useStudioState';

/**
 * HOMATCH SITE STUDIO
 *
 * Three columns: what is on the page, what it looks like, what the selected
 * thing says. The middle column is the actual website, not a representation
 * of it.
 *
 * WHAT THIS EDITOR DELIBERATELY CANNOT DO
 *
 * There is no free canvas, no drag-anywhere, no colour picker, no font size
 * and no HTML field. §11 asked for that and it is also the only way an editor
 * stays safe to hand over: every control here maps to something the design
 * system already supports, so there is no combination of clicks that produces
 * a page the designers would not recognise. What an admin changes is the
 * words, the order, the visibility, the photographs, and a choice from a list
 * of layouts the components actually implement.
 */
export function StudioShell() {
  const { t } = useLanguage();
  const studio = useStudioState();
  const [device, setDevice] = useState<DeviceKey>('desktop');
  const [forceRTL, setForceRTL] = useState(false);
  const [inlineEdit, setInlineEdit] = useState(true);

  /*
   * The floating controls for whichever section is selected.
   *
   * Assembled here because this is where the state lives; the preview's
   * job is to position them over the right block, not to know what a
   * section is. Every action is one the structure list already offers,
   * so there is one set of rules about what may be deleted and what may
   * only be hidden.
   */
  const index = studio.draft.sections.findIndex(x => x.id === studio.selectedId);
  const section = index === -1 ? null : studio.draft.sections[index];
  const addable = ADDABLE[0] ?? null;

  const controls: SectionControlsApi | null = useMemo(() => {
    if (!section || studio.unavailable) return null;
    return {
      canMoveUp: index > 0,
      canMoveDown: index < studio.draft.sections.length - 1,
      repeatable: Boolean(sectionDef(section.type)?.repeatable),
      enabled: section.enabled,
      addLabel: addable ? t(addable.labelKey) : '',
      labels: {
        edit: t('studio_edit_text'), addBelow: t('studio_add_below'),
        moveUp: t('studio_move_up'), moveDown: t('studio_move_down'),
        duplicate: t('studio_duplicate'), hide: t('studio_hide'),
        show: t('studio_show'), delete: t('studio_delete'),
      },
      // Arming the mode is this component's business; putting the caret
      // in the right word is the control's, which already holds the
      // element. See SectionControls.
      onEdit: () => setInlineEdit(true),
      onAddBelow: () => { if (addable) studio.addSection(addable.type, section.id); },
      onMoveUp: () => studio.move(section.id, -1),
      onMoveDown: () => studio.move(section.id, 1),
      onDuplicate: () => studio.duplicateSection(section.id),
      onToggleEnabled: () => studio.setEnabled(!section.enabled, section.id),
      onDelete: () => studio.removeSection(section.id),
    };
  }, [section, index, studio, addable, t]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-baseline gap-3 px-3 pb-1 pt-2">
        <h1 className="text-base font-semibold">{t('studio_title')}</h1>
        <p className="text-[15px] text-muted-foreground">{t('studio_subtitle')}</p>
      </div>

      <StudioToolbar
        studio={studio}
        device={device}
        setDevice={setDevice}
        forceRTL={forceRTL}
        setForceRTL={setForceRTL}
        inlineEdit={inlineEdit}
        setInlineEdit={setInlineEdit}
      />

      {/* The editor is usable with the backend absent: the admin can see the
          page and its structure, and is told plainly why nothing saves. */}
      {studio.unavailable && (
        <p className="border-b bg-amber-500/10 px-4 py-2 text-[15px] text-amber-800">
          {t('studio_unavailable')}
        </p>
      )}

      <p className="border-b bg-muted/50 px-4 py-1.5 text-[14px] text-muted-foreground">
        {t('studio_draft_only')} {t('studio_mode_hint')}
      </p>

      {studio.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[16px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('studio_loading')}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,21rem)]">
          <aside className="hidden min-h-0 border-e lg:block">
            <StructurePanel studio={studio} />
          </aside>

          <main className="min-h-0 overflow-hidden">
            <StudioPreview
              slug={studio.slug}
              content={studio.draft}
              locale={studio.locale}
              device={device}
              forceRTL={forceRTL}
              selectedId={studio.selectedId}
              onSelect={studio.select}
              editing={inlineEdit && !studio.unavailable}
              onInlineEdit={studio.editSectionField}
              controls={inlineEdit ? controls : null}
            />
          </main>

          <aside className="hidden min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] border-s lg:grid">
            <div className="min-h-0 overflow-hidden">
              <Inspector studio={studio} />
            </div>
            <div className="min-h-0 overflow-hidden border-t">
              <HistoryPanel studio={studio} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default StudioShell;
