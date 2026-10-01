// BUILD THIS DESIGN AS A REALISTIC 3D HOME — a floor-plan design through the scene factory.
//
// The plan's architecture is the source (never changed here); furniture and
// finishes are the design's own choices. One factory pass builds, renders and
// exports it; deterministic checks (walkability, nothing standing in anything,
// the plan's scale) and a look against the plan drawing are kept with the run;
// the result is saved as a new version whose pieces wear the factory's models.

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import type { DesignState } from '@/lib/designStudio/designState';
import { copyState } from '@/lib/designStudio/versioning';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { CanonicalSpace, SpatialSourceRecord } from '@/lib/designStudio/types';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import { compileSceneSpec } from '@/lib/designStudio/hybrid/compileSpec';
import { designChecks } from '@/lib/designStudio/hybrid/designChecks';
import { runDesignBuild } from '@/lib/designStudio/hybrid/designBuild';
import { factoryStatus, startFactory, visualQa } from '@/services/designStudio/factory';
import { signedUrls } from '@/services/designStudio/files';
import { createVersion } from '@/services/designStudio/projects';
import { freshStages, GenerationStages, type StageStatus } from '../GenerationStages';

const PLAN_STAGES: readonly Stage[] = ['PLANNING', 'ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'CHECKING', 'PREPARING', 'FINALIZING'];
const BUTTON = 'inline-flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50';

/** Straight down over the whole plan, north up: the view a plan drawing is compared with. */
export function planCamera(space: SpaceModel) {
  const xs = space.rooms.flatMap((r) => r.polygon.map((p) => p.x));
  const ys = space.rooms.flatMap((r) => r.polygon.map((p) => p.y));
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  const w = Math.max(1, maxX - minX); const d = Math.max(1, maxY - minY);
  const aspect = Math.max(0.5, Math.min(2.5, w / d));
  const height = 120;
  const fov = (2 * Math.atan((Math.max(d, w / aspect) * 0.56) / height) * 180) / Math.PI;
  return {
    // three.js world (x, up, −north); a hair of tilt gives the camera its north.
    position: [cx, height, -cy] as [number, number, number], target: [cx, 0, -cy - 0.01] as [number, number, number],
    fov, near: 1, far: 400, aspect, background: '#ffffff', cut: null,
  };
}

export function FactoryBuildDialog({
  userId, projectId, source, versionId, versionName, space, state, assets, materials, onSaved, onClose,
}: {
  userId: string; projectId: string; source: SpatialSourceRecord; versionId: string; versionName: string;
  space: SpaceModel; state: DesignState; assets: ReadonlyMap<string, CatalogAsset>; materials: ReadonlyMap<string, CatalogMaterial>;
  onSaved: (versionId: string) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<'INTRO' | 'RUNNING' | 'DONE' | 'UNAVAILABLE' | 'FAILED'>('INTRO');
  const [stages, setStages] = useState<Record<Stage, StageStatus>>(freshStages);
  const [preview, setPreview] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const start = async () => {
    setPhase('RUNNING');
    const mark = (s: Stage, st: StageStatus) => { if (alive.current) setStages((cur) => ({ ...cur, [s]: st })); };
    const working = copyState(state);
    const canonical = (source.canonical as CanonicalSpace | null) ?? null;
    const checks = designChecks(space, working, assets, canonical);
    try {
      const result = await runDesignBuild({ state: working, checks: checks.dimensions }, {
        startFactory: (spec, pass) => startFactory({ projectId, versionId, pass, spec }),
        factoryStatus,
        compile: (s, outputs) => compileSceneSpec({
          space, state: s, assets, materials, camera: planCamera(space),
          source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, render: { edge: 1600, samples: 96 }, outputs,
        }),
        planQa: async (renderAssetId) => (source.floorplan_id ? visualQa({
          floorplanId: source.floorplan_id, renderAssetId,
          objects: [], rooms: space.rooms.map((r) => ({ key: r.id, kind: r.kind })),
        }) : null),
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
        now: () => Date.now(),
        onStage: mark,
      });
      if (result.factory === 'UNAVAILABLE') { setPhase('UNAVAILABLE'); return; }
      if (result.factory !== 'USED') { setPhase('FAILED'); return; }
      mark('FINALIZING', 'RUNNING');
      const created = await createVersion({
        userId, projectId, sourceId: source.id, parentId: versionId, origin: 'BRANCH',
        name: t('ds_factory_version_name', { name: versionName }).slice(0, 80),
        state: copyState(result.state) as unknown as Record<string, unknown>,
        changeSummary: [{
          kind: 'FACTORY_BUILD', jobId: result.jobId, verdict: result.verdict, persistedBytes: result.persistedBytes,
          dimensions: result.dimensions.map((d) => ({ name: d.name, gate: d.gate, value: d.value })), cost: result.cost,
          timings: result.timings, provenance: { architecture: 'SOURCE_DERIVED', furnishing: 'DESIGN_CHOICE' },
        }],
      });
      mark('FINALIZING', 'DONE');
      if (result.render) setPreview((await signedUrls([result.render.key], 900)).get(result.render.key) ?? null);
      setSavedId(created.id);
      setPhase('DONE');
    } catch {
      if (alive.current) setPhase('FAILED');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="ds-factory-title" data-testid="factory-dialog">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 text-[#0C1119] shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="ds-factory-title" className="text-[18px] font-semibold">{t('ds_factory_title')}</h2>
          <button type="button" onClick={onClose} disabled={phase === 'RUNNING'} className="grid h-8 w-8 place-items-center rounded-md hover:bg-[#F0F2F5] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" aria-label={t('general_close')}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {phase === 'INTRO' ? (
          <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-[#3D4450]">
            <p>{t('ds_factory_intro')}</p>
            <p className="text-[13px] text-[#5B6472]">{t('ds_factory_plan_note')}</p>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" className={`${BUTTON} ring-1 ring-[#D5D9E0]`} onClick={onClose}>{t('general_cancel')}</button>
              <button type="button" className={`${BUTTON} bg-[#0C1119] text-white`} onClick={() => { void start(); }} data-testid="factory-start">{t('ds_factory_start')}</button>
            </div>
          </div>
        ) : null}
        {phase === 'RUNNING' ? <div className="mt-4"><GenerationStages stages={stages} title={t('ds_factory_running')} only={PLAN_STAGES} /></div> : null}
        {phase === 'DONE' ? (
          <div className="mt-3 space-y-3">
            {preview ? <img src={preview} alt={t('ds_factory_preview')} className="w-full rounded-lg ring-1 ring-black/5" data-testid="factory-preview" /> : null}
            <p className="text-[14px] text-[#3D4450]">{t('ds_factory_done')}</p>
            <div className="flex justify-end">
              <button type="button" className={`${BUTTON} bg-[#0C1119] text-white`} onClick={() => savedId && onSaved(savedId)} data-testid="factory-open">{t('ds_factory_open')}</button>
            </div>
          </div>
        ) : null}
        {phase === 'UNAVAILABLE' || phase === 'FAILED' ? (
          <p role="alert" className="mt-3 rounded-lg border border-[hsl(0_66%_60%)]/40 bg-[hsl(0_66%_96%)] px-3 py-2 text-[14px]">{t(phase === 'UNAVAILABLE' ? 'ds_factory_unavailable' : 'ds_factory_failed')}</p>
        ) : null}
      </div>
    </div>
  );
}
