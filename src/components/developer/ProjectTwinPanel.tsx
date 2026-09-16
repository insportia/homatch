import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Box, ExternalLink, Maximize2, Share2, CheckCircle2, CircleDashed, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Panel, EmptyState, LoadingRows, formatNumber } from './primitives';
import { SectionHead } from './visuals';
import { loadScene, experienceUrl, type TwinScene, type TwinSchematicFloor } from '@/services/developer/twin';
import {
  loadProjectTwinStatus, floorsFromUnits, type ProjectTwinStatus,
} from '@/services/developer/twinStatus';
import type { DevProject, DevUnit, DevWorkspace } from '@/services/developer/types';

/**
 * THE 3D OF A DEVELOPMENT, INSIDE THE PRODUCT THAT SELLS IT.
 *
 * The Digital Twin existed before this panel and was unreachable from the
 * Developer product: mounted on exactly one route, /p/:workspace/:project,
 * which is the page a BUYER opens. A developer had no way to see their own
 * building in three dimensions, no way to know whether a walkthrough had been
 * built for them, and no way to send one to anybody.
 *
 * WHAT IS REAL HERE, SAID PLAINLY
 *
 * With no uploaded assets at all, the canvas draws a SCHEMATIC of this
 * project — the real floors, the real apartment counts, the real availability,
 * from the same inventory the table shows. It is a massing diagram and it says
 * so in its own corner. That is a true 3D view of their building and it is not
 * a render.
 *
 * With geometry uploaded and a scene published by our 3D team, the same canvas
 * loads the model instead. Nothing on this panel changes; the mode does.
 *
 * WHAT THIS PANEL NEVER DOES: invent a walkthrough. Where no interior scene
 * has been authored, it says so and explains what would produce one. There is
 * no button here that opens a photo gallery and calls it 3D.
 */

const TwinCanvas = lazy(() => import('./TwinCanvas'));

const STAGE_TONE: Record<ProjectTwinStatus['stage'], string> = {
  NOT_CONFIGURED: 'border-border text-muted-foreground',
  IN_PROGRESS: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  READY: 'border-sky-600/40 text-sky-700 dark:text-sky-400',
  PUBLISHED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400',
};

const STAGE_ICON: Record<ProjectTwinStatus['stage'], React.ComponentType<{ className?: string }>> = {
  NOT_CONFIGURED: CircleDashed,
  IN_PROGRESS: Clock,
  READY: CheckCircle2,
  PUBLISHED: CheckCircle2,
};

export function ProjectTwinPanel({
  workspace, project, units, onSelectUnit,
}: {
  workspace: DevWorkspace;
  project: DevProject;
  units: DevUnit[];
  onSelectUnit?: (unit: DevUnit) => void;
}) {
  const { t, lang: language } = useLanguage();
  const [status, setStatus] = useState<ProjectTwinStatus | null>(null);
  const [scene, setScene] = useState<TwinScene | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const floors: TwinSchematicFloor[] = useMemo(() => floorsFromUnits(units), [units]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const s = await loadProjectTwinStatus(workspace.id, project.id).catch(() => null);
      if (cancelled) return;
      setStatus(s);
      // The building scene, if our team has published one. Absent, the canvas
      // draws the schematic from `floors` instead — which is the usual case.
      const building = s?.published.find((row) => row.kind === 'BUILDING' || row.kind === 'MASTERPLAN');
      if (building) {
        const loaded = await loadScene(building.id).catch(() => null);
        if (!cancelled) setScene(loaded);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workspace.id, project.id]);

  useEffect(() => {
    if (level === null && floors.length) setLevel(floors[floors.length - 1].level);
  }, [floors, level]);

  const publicUrl = workspace.slug && project.slug
    ? experienceUrl({ workspaceSlug: workspace.slug, projectSlug: project.slug })
    : null;

  const stage = status?.stage ?? 'NOT_CONFIGURED';
  const StageIcon = STAGE_ICON[stage];
  const interiors = status?.byUnitType.size ?? 0;

  if (loading) return <LoadingRows rows={6} />;

  if (floors.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<Box className="h-7 w-7" />}
          title={t('dev_twin_no_inventory_title')}
          description={t('dev_twin_no_inventory_body')}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── The building itself ──────────────────────────────────────────
          Full width and tall, because this is the feature, not a thumbnail
          beside a table. The canvas is lazy: three.js is a megabyte and is
          never fetched by a developer who does not open this tab. */}
      <section
        className={cn(
          'overflow-hidden rounded-xl border border-border bg-card',
          expanded && 'fixed inset-3 z-50 flex flex-col shadow-2xl sm:inset-6',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{project.name}</p>
            <p className="truncate text-2xs text-muted-foreground">
              {t('dev_twin_floors_count')
                .replace('{floors}', formatNumber(floors.length, language))
                .replace('{units}', formatNumber(units.length, language))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium',
              STAGE_TONE[stage],
            )}>
              <StageIcon className="h-3 w-3" aria-hidden="true" />
              {t(`dev_twin_stage_${stage.toLowerCase()}`)}
            </span>
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              <Maximize2 className="mr-2 h-3.5 w-3.5" />
              {t(expanded ? 'dev_twin_exit_full' : 'dev_twin_full')}
            </Button>
          </div>
        </div>

        <Suspense fallback={(
          <div className="flex h-[26rem] items-center justify-center bg-sand/40 lg:h-[32rem]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        )}>
          <TwinCanvas
            scene={scene}
            floors={floors}
            activeLevel={level}
            onSelectLevel={setLevel}
            className={expanded ? 'h-full min-h-0 flex-1' : 'h-[26rem] lg:h-[32rem]'}
          />
        </Suspense>

        {/* The floor that is selected, as apartments you can actually open.
            This is the accessible path to everything the canvas does, and the
            reason picking a floor is a sales action rather than a camera move. */}
        {!expanded && level !== null && (
          <div className="border-t border-border p-4">
            <p className="mb-2.5 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('dev_twin_floor_label').replace('{level}', String(level))}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {units
                .filter((u) => Number(u.floor_level) === level)
                .map((unit) => (
                  <li key={unit.id}>
                    <button
                      type="button"
                      onClick={() => onSelectUnit?.(unit)}
                      className="rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:border-gold-border/70 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="tabular font-medium">{unit.unit_number}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Where the walkthrough stands ─────────────────────────────────
          The honest half. A developer is told what exists, what does not, and
          who produces the part that does not. */}
      <section>
        <SectionHead title={t('dev_twin_status_title')} sub={t('dev_twin_status_sub')} />
        <Panel className="divide-y divide-border">
          <StatusRow
            label={t('dev_twin_row_building')}
            value={scene ? t('dev_twin_value_model') : t('dev_twin_value_schematic')}
            good={Boolean(scene)}
            note={scene ? undefined : t('dev_twin_schematic_note')}
          />
          <StatusRow
            label={t('dev_twin_row_interiors')}
            value={interiors > 0
              ? t('dev_twin_value_interiors').replace('{n}', String(interiors))
              : t('dev_twin_value_none')}
            good={interiors > 0}
            note={interiors > 0 ? undefined : t('dev_twin_interiors_note')}
          />
          <StatusRow
            label={t('dev_twin_row_public')}
            value={status?.experience?.status === 'PUBLISHED'
              ? t('dev_twin_value_live') : t('dev_twin_value_not_live')}
            good={status?.experience?.status === 'PUBLISHED'}
            note={publicUrl ?? undefined}
          />
        </Panel>

        <div className="mt-4 flex flex-wrap gap-2">
          {publicUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                {t('dev_twin_open_public')}
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={`/developers/projects/${project.id}?view=share`}>
              <Share2 className="mr-2 h-3.5 w-3.5" />
              {t('dev_view_share')}
            </a>
          </Button>
        </div>

        <p className="mt-4 max-w-prose text-2xs leading-relaxed text-muted-foreground">
          {t('dev_twin_pipeline_note')}
        </p>
      </section>
    </div>
  );
}

function StatusRow({
  label, value, note, good,
}: { label: string; value: string; note?: string; good: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn(
        'text-sm font-medium',
        good ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
      )}>
        {value}
      </span>
      {note && <span className="w-full truncate text-2xs text-muted-foreground sm:w-auto">{note}</span>}
    </div>
  );
}
