// HOMATCH DESIGN STUDIO — THE WORKSPACE.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ toolbar: back · project · version · truth · views · status   │
//   ├───────┬───────────────┬──────────────────────┬───────────────┤
//   │ modes │ library panel │     3D CANVAS        │   inspector   │
//   │ rail  │ (changes with │  plan navigator ↙    │ (what am I    │
//   │       │  the mode)    │  view controls ↓     │   editing?)   │
//   └───────┴───────────────┴──────────────────────┴───────────────┘
//
// The canvas is the product; everything else supports it. Below lg the
// panels leave the page and become sheets over a full-screen canvas.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Box as BoxIcon, Info, LayoutGrid, Maximize, PanelLeftClose, PanelLeftOpen, Scan, SquareDashed,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildSpaceModel, type SpaceModel } from '@/lib/designStudio/space';
import { provenanceLabel, type Rejection } from '@/lib/designStudio/spatialSource';
import type { CanonicalSpace, SpatialSourceRecord } from '@/lib/designStudio/types';
import { NavGlyphIcon } from '@/components/layouts/NavGlyph';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import type { ProjectBundle } from '@/services/designStudio/projects';
import { cn } from '@/lib/utils';
import { DesignCanvas } from '../canvas/DesignCanvas';
import type { PickTarget, SceneController } from '../canvas/SceneController';
import { developerUnitModelUrl, loadGltf } from '../canvas/modelLoader';
import { Inspector } from './Inspector';
import { PlanNavigator } from './PlanNavigator';
import { RoomsPanel } from './RoomsPanel';
import { roomNames } from './labels';

export interface DesignWorkspaceProps {
  bundle: ProjectBundle;
  source: SpatialSourceRecord;
  rejected: Rejection[];
  freshnessUnchecked: boolean;
  initialVersionId: string | null;
  onReload: () => void;
}

type LeftMode = 'ROOMS';

const MODES: Array<{ id: LeftMode; labelKey: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'ROOMS', labelKey: 'ds_panel_rooms', icon: LayoutGrid },
];

const TOOL_BUTTON =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[14px] font-medium text-white/85 transition-colors '
  + 'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] '
  + 'disabled:pointer-events-none disabled:opacity-40';

export function DesignWorkspace({ bundle, source, initialVersionId }: DesignWorkspaceProps) {
  const { t } = useLanguage();
  const controllerRef = useRef<SceneController | null>(null);

  const space: SpaceModel | null = useMemo(() => {
    const canonical = source.canonical as CanonicalSpace | null;
    return canonical?.scene ? buildSpaceModel(canonical.scene) : null;
  }, [source]);

  const names = useMemo(() => (space ? roomNames(space, t) : new Map<string, string>()), [space, t]);
  const [selection, setSelection] = useState<PickTarget | null>(null);
  const [mode, setMode] = useState<LeftMode>('ROOMS');
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheet, setSheet] = useState<'library' | 'inspector' | null>(null);
  const [modelFailed, setModelFailed] = useState(false);

  const versions = bundle.versions.filter((v) => v.source_id === source.id);
  const version = versions.find((v) => v.id === initialVersionId) ?? versions[versions.length - 1] ?? null;
  const label = provenanceLabel(source);

  const activeRoomId = selection?.kind === 'room' ? selection.id
    : selection && 'roomId' in selection ? selection.roomId : null;

  const focusRoom = useCallback((roomId: string) => {
    const room = space?.rooms.find((r) => r.id === roomId);
    if (room) controllerRef.current?.focusRoom(room);
  }, [space]);

  const selectRoom = useCallback((roomId: string) => {
    setSelection({ kind: 'room', id: roomId });
    focusRoom(roomId);
  }, [focusRoom]);

  const onPick = useCallback((target: PickTarget | null) => {
    setSelection(target);
    if (target && window.matchMedia?.('(max-width: 1023px)').matches) setSheet('inspector');
  }, []);

  const loadModel = useMemo(() => {
    if (space) return undefined;
    return async (controller: SceneController) => {
      if (source.kind === 'DEVELOPER_UNIT' && source.dev_unit_id) {
        const current = await developerUnitModelUrl(source.dev_unit_id);
        // The pin is what this design was made against; a different
        // publication is never loaded in its place.
        if (!current || current.sceneId !== source.upstream?.scene_id || current.version !== String(source.upstream?.version)) {
          throw new Error('stale');
        }
        controller.setModel(await loadGltf(current.url, controller.renderer));
        return;
      }
      throw new Error('unsupported');
    };
  }, [space, source]);

  // Keyboard: Escape clears, F frames everything, T looks from above.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'Escape') setSelection(null);
      else if (e.key === 'f' || e.key === 'F') controllerRef.current?.frameAll();
      else if (e.key === 't' || e.key === 'T') controllerRef.current?.topView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const library = (
    <RoomsPanel
      space={space}
      names={names}
      state={source.geometry_state}
      activeRoomId={activeRoomId}
      onRoom={(id) => { selectRoom(id); setSheet(null); }}
    />
  );
  const inspector = (
    <Inspector
      source={source}
      space={space}
      names={names}
      selection={selection}
      onSelect={setSelection}
      onFocusRoom={focusRoom}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0C1119] text-white">
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-2 sm:px-3">
        <Link to="/design-studio" aria-label={t('ds_back_to_projects')} className={TOOL_BUTTON}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <span className="hidden h-7 w-7 shrink-0 place-items-center rounded-md bg-[#101623] text-white/85 ring-1 ring-white/10 sm:grid" aria-hidden="true">
          <NavGlyphIcon name="design_studio" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 sm:flex-none">
          <p className="truncate font-display text-[15px] font-semibold leading-tight">{bundle.project.name}</p>
          <p className="truncate text-2xs leading-tight text-white/60 sm:hidden">{version?.name}</p>
        </div>
        {version ? (
          <span className="hidden shrink-0 rounded-md border border-white/15 px-2 py-1 text-[13px] text-white/80 sm:inline">
            {version.name}
          </span>
        ) : null}
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] md:inline-flex',
            source.geometry_state === 'ESTIMATED' ? 'bg-[hsl(38_92%_54%)]/15 text-[hsl(38_92%_70%)]' : 'bg-white/5 text-white/70',
          )}
          title={t(source.geometry_state === 'ESTIMATED' ? 'ds_truth_estimated' : 'ds_truth_known')}
        >
          {t(label.originKey)} · {t(label.geometryKey)}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <button type="button" className={TOOL_BUTTON} onClick={() => controllerRef.current?.frameAll()} aria-label={t('ds_view_overview')}>
            <Maximize className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xl:inline">{t('ds_view_overview')}</span>
          </button>
          <button type="button" className={TOOL_BUTTON} onClick={() => controllerRef.current?.topView()} aria-label={t('ds_view_top')}>
            <SquareDashed className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xl:inline">{t('ds_view_top')}</span>
          </button>
          <button
            type="button"
            className={TOOL_BUTTON}
            disabled={!activeRoomId}
            onClick={() => activeRoomId && focusRoom(activeRoomId)}
            aria-label={t('ds_view_room')}
          >
            <Scan className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xl:inline">{t('ds_view_room')}</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Left: mode rail + library panel ─────────────────────── */}
        <nav aria-label={t('ds_panel_modes')} className="hidden w-14 shrink-0 flex-col items-center gap-1 border-e border-white/10 py-2 lg:flex">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id && panelOpen}
              onClick={() => { if (mode === m.id) setPanelOpen((o) => !o); else { setMode(m.id); setPanelOpen(true); } }}
              className={cn(
                'grid h-11 w-11 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                mode === m.id && panelOpen ? 'bg-white/10 text-[hsl(38_92%_62%)]' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
              title={t(m.labelKey)}
            >
              <m.icon className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{t(m.labelKey)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            className="mt-auto grid h-10 w-10 place-items-center rounded-lg text-white/60 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            aria-label={t(panelOpen ? 'ds_panel_collapse' : 'ds_panel_expand')}
          >
            {panelOpen
              ? <PanelLeftClose className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              : <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
          </button>
        </nav>
        {panelOpen ? (
          <aside aria-label={t(MODES.find((m) => m.id === mode)?.labelKey ?? 'ds_panel_rooms')} className="hidden w-[17rem] shrink-0 flex-col overflow-y-auto bg-white text-[#0C1119] lg:flex">
            <h2 className="border-b border-[#E4E6EA] px-4 py-3 font-display text-[15px] font-semibold">
              {t(MODES.find((m) => m.id === mode)?.labelKey ?? 'ds_panel_rooms')}
            </h2>
            {library}
          </aside>
        ) : null}

        {/* ── Center: the canvas ──────────────────────────────────── */}
        <main className="relative min-w-0 flex-1 bg-[#E9EBEE]">
          <DesignCanvas
            space={space}
            loadModel={loadModel}
            selection={selection}
            onPick={onPick}
            onReady={(c) => { controllerRef.current = c; }}
            onModelError={() => setModelFailed(true)}
            roomLabel={(id) => names.get(id) ?? ''}
          />
          {modelFailed ? (
            <div role="alert" className="absolute inset-x-4 top-4 mx-auto max-w-md rounded-lg bg-white px-4 py-3 text-[14px] text-[#0C1119] shadow-md ring-1 ring-black/10">
              {t('ds_model_failed')}
            </div>
          ) : null}
          {space ? (
            <PlanNavigator
              space={space}
              activeRoomId={activeRoomId}
              names={names}
              onRoom={selectRoom}
              label={t('ds_plan_navigator')}
              className="absolute bottom-20 start-3 w-36 sm:w-44 lg:bottom-4"
            />
          ) : null}
          <p className="pointer-events-none absolute end-3 top-3 hidden max-w-[22rem] rounded-md bg-white/80 px-2.5 py-1 text-end text-2xs leading-snug text-[#4A5263] ring-1 ring-black/5 backdrop-blur lg:block">
            {t('ds_preview_note')}
          </p>
        </main>

        {/* ── Right: the inspector ─────────────────────────────────── */}
        <aside aria-label={t('ds_inspector')} className="hidden w-[18.5rem] shrink-0 overflow-y-auto border-s border-white/10 bg-white text-[#0C1119] lg:block">
          {inspector}
        </aside>
      </div>

      {/* ── Phone: the canvas is the screen; panels are sheets ─────── */}
      <div className="flex shrink-0 items-stretch justify-around border-t border-white/10 bg-[#0C1119] pb-[env(safe-area-inset-bottom)] lg:hidden">
        <button type="button" onClick={() => setSheet('library')} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[13px] text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]">
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          {t('ds_panel_rooms')}
        </button>
        <button type="button" onClick={() => controllerRef.current?.frameAll()} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[13px] text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]">
          <BoxIcon className="h-5 w-5" aria-hidden="true" />
          {t('ds_view_overview')}
        </button>
        <button type="button" onClick={() => setSheet('inspector')} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[13px] text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]">
          <Info className="h-5 w-5" aria-hidden="true" />
          {t('ds_inspector')}
        </button>
      </div>
      <Drawer open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null); }}>
        <DrawerContent className="max-h-[70dvh] bg-white text-[#0C1119] lg:hidden">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t(sheet === 'library' ? 'ds_panel_rooms' : 'ds_inspector')}</DrawerTitle>
            <DrawerDescription>{t('ds_brand')}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {sheet === 'library' ? library : inspector}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
