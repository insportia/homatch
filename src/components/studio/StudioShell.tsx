import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { StructurePanel } from './StructurePanel';
import { Inspector } from './Inspector';
import { HistoryPanel } from './HistoryPanel';
import { StudioToolbar } from './StudioToolbar';
import { StudioPreview, type DeviceKey } from './StudioPreview';
import { useStudioState } from './useStudioState';

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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-baseline gap-3 px-3 pb-1 pt-2">
        <h1 className="text-base font-semibold">{t('studio_title')}</h1>
        <p className="text-[12px] text-muted-foreground">{t('studio_subtitle')}</p>
      </div>

      <StudioToolbar
        studio={studio}
        device={device}
        setDevice={setDevice}
        forceRTL={forceRTL}
        setForceRTL={setForceRTL}
      />

      {/* The editor is usable with the backend absent: the admin can see the
          page and its structure, and is told plainly why nothing saves. */}
      {studio.unavailable && (
        <p className="border-b bg-amber-500/10 px-4 py-2 text-[12px] text-amber-800">
          {t('studio_unavailable')}
        </p>
      )}

      <p className="border-b bg-muted/50 px-4 py-1.5 text-[11px] text-muted-foreground">
        {t('studio_draft_only')} {t('studio_mode_hint')}
      </p>

      {studio.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
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
