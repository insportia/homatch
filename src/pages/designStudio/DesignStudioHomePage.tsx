// YOUR PLAN → YOUR DESIGNED HOME.
//
// What a customer comes back to after "Generate my home": their plan, the
// master design of the whole home (a picture they can touch and change),
// pictures of the rooms they choose, and the walkthrough — all of ONE home.
//
//   PLAN         the upload and HOMATCH's reading of it, side by side
//   3D DESIGN    the master design; tap a piece or a surface to change it
//   ROOMS        eye-level pictures of chosen rooms, as many as wanted
//   WALKTHROUGH  the same approved design, built by the factory, walked
//
// Every change here is a change to the design (a new version; Undo goes
// back), and the walkthrough is built from the design — so what was changed
// in a picture is what the customer walks through.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Footprints, Image as ImageIcon, Loader2, Map as MapIcon, RotateCcw, Sparkles } from 'lucide-react';
import { RouteGuard } from '@/components/common/RouteGuard';
import { DesignStudioGate } from '@/components/designStudio/DesignStudioGate';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { cn } from '@/lib/utils';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import { emptyDesignState, normalizeDesignState, type DesignState } from '@/lib/designStudio/designState';
import { buildSpaceModel, type SpaceModel } from '@/lib/designStudio/space';
import type { CanonicalSpace, DesignVersionRecord, SpatialSourceRecord } from '@/lib/designStudio/types';
import { copyState } from '@/lib/designStudio/versioning';
import { compileSceneSpec } from '@/lib/designStudio/hybrid/compileSpec';
import { designChecks } from '@/lib/designStudio/hybrid/designChecks';
import { runDesignBuild } from '@/lib/designStudio/hybrid/designBuild';
import { planMasterView, planRoomViews, maxRoomViews } from '@/lib/designStudio/renders/cameras';
import type { MapEntry, ObjectMap, PropertyDesignDNA, RenderProduct, RenderQuote, RenderRecord, SpecView } from '@/lib/designStudio/renders/contract';
import { compareMaps, type ConsistencyReport } from '@/lib/designStudio/renders/consistency';
import { actionsFor, applyEdit, colourChoices, replacements, type EditChoice } from '@/lib/designStudio/renders/edits';
import { REJECTION_KEY } from '@/lib/designStudio/rejectionKeys';
import { planCamera } from '@/components/designStudio/workspace/FactoryBuildDialog';
import { assetsByCode, listAssets, listMaterials } from '@/services/designStudio/catalog';
import { factoryStatus, startFactory, visualQa } from '@/services/designStudio/factory';
import { getFloorPlan, type FloorPlanRecord } from '@/services/designStudio/floorplans';
import { createVersion, getProject, getSourceFull, getVersion, setHeadVersion, type ProjectBundle } from '@/services/designStudio/projects';
import { editRender, listRenders, pollRenders, quoteRender, renderMapUrl, renderPictureUrls, saveDesignDna, startRenders } from '@/services/designStudio/renders';
import { RenderViewer } from '@/components/designStudio/renders/RenderViewer';
import { EditPanel } from '@/components/designStudio/renders/EditPanel';
import { PlanDrawing } from '@/components/designStudio/planToHome/PlanDrawing';
import { applyAnswers } from '@/lib/designStudio/planRead';
import { latestFlow } from '@/services/designStudio/planToHome';
import { signedUrls } from '@/services/designStudio/files';

export default function DesignStudioHomePage() {
  return (
    <RouteGuard>
      <DesignStudioGate>
        <Home />
      </DesignStudioGate>
    </RouteGuard>
  );
}

type Tab = 'PLAN' | 'DESIGN' | 'ROOMS' | 'WALK';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const ACTIVE: ReadonlySet<RenderRecord['status']> = new Set(['QUOTED', 'QUEUED', 'RENDERING', 'FINISHING']);

interface HomeData {
  bundle: ProjectBundle;
  head: DesignVersionRecord;
  state: DesignState;
  dna: PropertyDesignDNA | null;
  source: SpatialSourceRecord;
  space: SpaceModel;
  plan: FloorPlanRecord | null;
  assets: Map<string, CatalogAsset>;
  materials: Map<string, CatalogMaterial>;
}

async function loadHome(projectId: string): Promise<HomeData | null> {
  const bundle = await getProject(projectId);
  if (!bundle?.project.head_version_id || !bundle.project.active_source_id) return null;
  const [head, source] = await Promise.all([getVersion(bundle.project.head_version_id), getSourceFull(bundle.project.active_source_id)]);
  const canonical = (source?.canonical as CanonicalSpace | null) ?? null;
  if (!head || !source || !canonical?.scene) return null;
  const state = normalizeDesignState(head.state ?? emptyDesignState());
  const [browse, referenced, materials, plan] = await Promise.all([
    listAssets({ limit: 500 }), assetsByCode([...new Set(state.objects.map((o) => o.assetId))]), listMaterials(),
    source.floorplan_id ? getFloorPlan(source.floorplan_id).catch(() => null) : Promise.resolve(null),
  ]);
  const assets = new Map<string, CatalogAsset>();
  for (const a of [...browse, ...referenced]) assets.set(a.code, a);
  return {
    bundle, head, state, source, plan, assets, materials: new Map(materials.map((m) => [m.id, m])),
    dna: ((head as unknown as { design_dna?: PropertyDesignDNA | null }).design_dna) ?? null,
    space: buildSpaceModel(canonical.scene),
  };
}

/** A pending paid action: what it is, its price, and what happens on "Confirm". */
interface Pending { title: string; credits: number; charged: boolean; run: () => Promise<void> }

function Home() {
  useSurfaceTheme('light');
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [data, setData] = useState<HomeData | null | undefined>(undefined);
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<Tab>('DESIGN');
  const [selected, setSelected] = useState<MapEntry | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [walkPrep, setWalkPrep] = useState<'IDLE' | 'BUILDING' | 'FAILED'>('IDLE');
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([loadHome(projectId).catch(() => null), listRenders(projectId)]);
    if (!alive.current) return;
    setData(d);
    setRenders(r);
    setUrls(await renderPictureUrls(r, 1800));
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const key = data?.plan?.object_key;
    if (key) signedUrls([key], 1800).then((m) => setPlanUrl(m.get(key) ?? null)).catch(() => {});
  }, [data?.plan?.object_key]);

  // Renders still on their way are followed until they arrive (each appears as soon as it is ready).
  const activeIds = useMemo(() => renders.filter((r) => ACTIVE.has(r.status)).map((r) => r.id), [renders]);
  useEffect(() => {
    if (!activeIds.length) return;
    const ctl = new AbortController();
    void pollRenders(activeIds, {
      signal: ctl.signal,
      onUpdate: async (rs) => {
        if (!alive.current) return;
        setRenders((cur) => cur.map((x) => rs.find((y) => y.id === x.id) ?? x));
        const ready = rs.filter((x) => x.status === 'READY');
        if (ready.length) { const more = await renderPictureUrls(ready, 1800); setUrls((u) => new Map([...u, ...more])); }
      },
    });
    return () => ctl.abort();
  }, [activeIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The versions that ARE this design: the head, and — through any factory builds on top of it (which
   * add the walkthrough's baked models and change nothing a picture shows) — the version it was built from.
   */
  const sameDesign = useMemo(() => {
    const out = new Set<string>();
    if (!data) return out;
    const byId = new Map(data.bundle.versions.map((v) => [v.id, v] as const));
    let v: DesignVersionRecord | undefined = byId.get(data.head.id) ?? data.head;
    while (v) {
      out.add(v.id);
      const built = (v.change_summary ?? []).some((c) => (c as { kind?: string })?.kind === 'FACTORY_BUILD');
      if (!built || !v.parent_id) break;
      v = byId.get(v.parent_id);
    }
    return out;
  }, [data]);

  /** The master design shown: the newest ready picture of the dollhouse view, this design's own first. */
  const master = useMemo(() => {
    const ms = renders.filter((r) => r.view?.id === 'master');
    const own = ms.filter((r) => sameDesign.has(r.version_id));
    return { ready: (own.find((r) => r.status === 'READY') ?? ms.find((r) => r.status === 'READY')) ?? null, working: own.find((r) => ACTIVE.has(r.status)) ?? ms.find((r) => ACTIVE.has(r.status)) ?? null, stale: !own.some((r) => r.status === 'READY') };
  }, [renders, sameDesign]);
  useEffect(() => {
    setMapUrl(null);
    if (master.ready) renderMapUrl(master.ready, 1800).then(setMapUrl).catch(() => {});
  }, [master.ready?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo(() => (data ? { space: data.space, assets: data.assets, materials: data.materials } : null), [data]);
  const editable = useCallback((e: MapEntry) => (data ? actionsFor(e, data.state, data.assets).length > 0 : false), [data]);
  const labelFor = useCallback((e: MapEntry) => {
    if (!data) return '';
    if (e.kind === 'OBJECT') {
      const o = data.state.objects.find((x) => x.instanceId === e.id);
      return (o && data.assets.get(o.assetId)?.name) ?? t('rend_piece');
    }
    const room = e.roomId ? data.space.rooms.find((r) => r.id === e.roomId) : null;
    const where = room ? t(`ds_room_${room.kind.toLowerCase()}`) : '';
    return `${t(e.kind === 'WALL' ? 'rend_wall' : e.kind === 'FLOOR' ? 'rend_floor' : e.kind === 'CEILING' ? 'rend_ceiling' : 'rend_door')}${where ? ` · ${where}` : ''}`;
  }, [data, t]);

  const reject = (code: string, placement?: Array<{ code: string }>) => {
    if (placement?.some((i) => i.code === 'THROUGH_WALL')) return t('ds_issue_through_wall');
    if (placement?.some((i) => i.code === 'OUTSIDE_ROOM')) return t('ds_issue_outside');
    if (placement?.some((i) => i.code === 'ON_STAIRS')) return t('ds_issue_on_stairs');
    return t(REJECTION_KEY[code] ?? 'ds_reject_op_generic');
  };

  /** Ask the server for the price of one action, then let the customer confirm it. */
  const confirmPrice = async (product: RenderProduct, views: number, title: string, run: (q: RenderQuote) => Promise<void>) => {
    if (!data) return;
    const q = await quoteRender({ projectId, versionId: data.head.id, product, views });
    if (!q.quote) { setError(t('rend_error_quote')); return; }
    setPending({ title, credits: q.quote.credits, charged: q.quote.charged, run: () => run(q.quote!) });
  };

  /** A new version of the design (the change), made head; the DNA travels with it. */
  const commitVersion = async (state: DesignState, label: string, summary: Record<string, unknown>) => {
    if (!data || !homatchUser) throw new Error('no data');
    const v = await createVersion({
      userId: homatchUser.id, projectId, sourceId: data.source.id, parentId: data.head.id, origin: 'USER',
      name: label.slice(0, 80), state: copyState(state) as unknown as Record<string, unknown>, changeSummary: [summary],
    });
    if (data.dna) await saveDesignDna(v.id, data.dna);
    return v;
  };

  const onChoice = async (choice: EditChoice, label: string) => {
    if (!data || !ctx || !selected || !master.ready) return;
    setError(null);
    const r = applyEdit(selected, choice, data.state, ctx, label);
    if (!r.ok) { setError(reject(r.rejection.code, (r.rejection as { placement?: Array<{ code: string }> }).placement)); return; }
    const title = labelFor(selected);
    if (r.kind === 'APPEARANCE') {
      await confirmPrice('DS_RENDER_EDIT', 1, t('rend_confirm_appearance', { what: title }), async (shown) => {
        const v = await commitVersion(r.state, t('rend_version_edit', { what: title }), { kind: 'RENDER_EDIT', edit: r.edit });
        const q = await quoteRender({ projectId, versionId: v.id, product: 'DS_RENDER_EDIT', views: 1 });
        if (!q.quote || q.quote.credits !== shown.credits) throw new Error('DS_PRICE_CHANGED');
        const e = await editRender({ renderId: master.ready!.id, edit: r.edit as Extract<typeof r.edit, { type: 'APPEARANCE' }>, newVersionId: v.id, quote: q.quote, idempotencyKey: `edit-${v.id}` });
        if (!e.render) throw new Error(e.error ?? 'EDIT_FAILED');
      });
    } else {
      await confirmPrice('DS_MASTER_RENDER', 1, t('rend_confirm_spatial', { what: title }), async (shown) => {
        const v = await commitVersion(r.state, t('rend_version_edit', { what: title }), { kind: 'RENDER_EDIT', edit: r.edit });
        await renderViews(v.id, r.state, [master.ready!.view ?? planMasterView(data.space)], 'DS_MASTER_RENDER', shown.credits);
      });
    }
  };

  /** Render views of a design version through the factory (one pass for all of them). */
  const renderViews = async (versionId: string, state: DesignState, views: SpecView[], product: RenderProduct, confirmed: number) => {
    if (!data) return;
    for (const o of state.objects) if (!data.assets.has(o.assetId)) for (const a of await assetsByCode([o.assetId])) data.assets.set(a.code, a);
    const spec = compileSceneSpec({
      space: data.space, state, assets: data.assets, materials: data.materials, camera: null, views,
      source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, outputs: { render: false, scene: false, objects: false },
    });
    const q = await quoteRender({ projectId, versionId, product, views: views.length });
    if (!q.quote || q.quote.credits !== confirmed) throw new Error('DS_PRICE_CHANGED');
    const s = await startRenders({ quote: q.quote, projectId, versionId, views, spec, idempotencyKey: `views-${versionId}-${views.map((v) => v.id).join('.')}` });
    if (!s.renders.length) throw new Error(s.error ?? 'RENDER_FAILED');
  };

  const runPending = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await pending.run();
      setPending(null);
      setSelected(null);
      await reload();
    } catch (e) {
      setError(t(String((e as Error).message) === 'DS_PRICE_CHANGED' ? 'p2h_error_price_changed' : 'rend_error_generic'));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!data?.head.parent_id || busy) return;
    setBusy(true);
    try { await setHeadVersion(projectId, data.head.parent_id); setSelected(null); await reload(); } finally { setBusy(false); }
  };

  /** The walkthrough is the approved design built by the factory: build this version if it has not been. */
  const walk = async () => {
    if (!data || walkPrep === 'BUILDING') return;
    const built = (data.head.change_summary ?? []).some((c) => (c as { kind?: string })?.kind === 'FACTORY_BUILD');
    if (built || !homatchUser) { navigate(`/design-studio/${projectId}/walkthrough`); return; }
    setWalkPrep('BUILDING');
    const approved = master.ready && sameDesign.has(master.ready.version_id) ? master.ready : null;
    const approvedView = approved?.view ?? null;
    try {
      const canonical = data.source.canonical as CanonicalSpace;
      const checks = designChecks(data.space, data.state, data.assets, canonical);
      const result = await runDesignBuild({ state: copyState(data.state), checks: checks.dimensions }, {
        startFactory: (spec, pass) => startFactory({ projectId, versionId: data.head.id, pass, spec }),
        factoryStatus,
        // The approved master camera again, with its object map: the build is checked against the approved picture.
        compile: (s, outputs) => compileSceneSpec({
          space: data.space, state: s, assets: data.assets, materials: data.materials, camera: planCamera(data.space),
          views: approvedView ? [{ ...approvedView, id: 'check', samples: 16, width: 800, height: Math.round(800 / approvedView.aspect), objectMap: true }] : undefined,
          source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, render: { edge: 1200, samples: 48 }, outputs,
        }),
        planQa: async (renderAssetId) => (data.source.floorplan_id ? visualQa({ floorplanId: data.source.floorplan_id, renderAssetId, objects: [], rooms: data.space.rooms.map((r) => ({ key: r.id, kind: r.kind })) }).catch(() => null) : null),
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)), now: () => Date.now(),
      });
      if (result.factory === 'USED') {
        let consistency: ConsistencyReport | null = null;
        if (approved?.legend && result.jobId) {
          const poll = await factoryStatus(result.jobId).catch(() => null);
          const ref = (poll?.outputs as { views?: Record<string, { legend?: { key: string } | null }> } | undefined)?.views?.check?.legend;
          if (ref?.key) {
            const url = (await signedUrls([ref.key], 300)).get(ref.key);
            const built = url ? await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
            if (built?.entries) consistency = compareMaps(approved.legend, built as ObjectMap);
          }
        }
        const v = await createVersion({
          userId: homatchUser.id, projectId, sourceId: data.source.id, parentId: data.head.id, origin: 'BRANCH',
          name: t('p2h_version_factory'), state: copyState(result.state) as unknown as Record<string, unknown>,
          changeSummary: [{ kind: 'FACTORY_BUILD', jobId: result.jobId, verdict: result.verdict, persistedBytes: result.persistedBytes, cost: result.cost, timings: result.timings, consistency, provenance: { architecture: 'SOURCE_DERIVED', furnishing: 'DESIGN_CHOICE' } }],
        });
        if (data.dna) await saveDesignDna(v.id, data.dna);
      }
      navigate(`/design-studio/${projectId}/walkthrough`);
    } catch {
      setWalkPrep('FAILED');
    }
  };

  if (data === undefined) return <div className="grid h-[100dvh] place-items-center bg-[#0C1119] text-white"><Loader2 className="h-6 w-6 animate-spin" aria-label={t('ds_loading_project')} /></div>;
  if (data === null) {
    return (
      <div className="grid h-[100dvh] place-items-center px-4 text-center">
        <div>
          <p className="text-[15px]">{t('rend_home_missing')}</p>
          <Link to={`/design-studio/${projectId}`} className="mt-3 inline-flex text-sm font-medium underline">{t('rend_open_editor')}</Link>
        </div>
      </div>
    );
  }

  const selObj = selected?.kind === 'OBJECT' ? data.state.objects.find((o) => o.instanceId === selected.id) ?? null : null;
  const selAsset = selObj ? data.assets.get(selObj.assetId) : undefined;
  const actions = selected ? actionsFor(selected, data.state, data.assets) : [];
  const fittingMaterials = selected ? [...data.materials.values()].filter((m) => m.active && (m.appliesTo ?? []).includes(selected.kind === 'FLOOR' ? 'FLOOR' : 'WALL')) : [];
  const doc = data.plan?.interpretation?.doc ? applyAnswers(data.plan.interpretation.doc, latestFlow(data.plan)?.answers ?? []) : null;
  const tabs: Array<[Tab, string, React.ComponentType<{ className?: string }>]> = [
    ['PLAN', 'rend_tab_plan', MapIcon], ['DESIGN', 'rend_tab_design', Sparkles], ['ROOMS', 'rend_tab_rooms', ImageIcon], ['WALK', 'rend_tab_walk', Footprints],
  ];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F4F5F7] text-[#0C1119]" data-testid="design-home">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 bg-[#0C1119] px-3 text-white">
        <Link to="/design-studio" aria-label={t('ds_back_to_projects')} className={cn('grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10', RING)}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <p className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{data.bundle.project.name}</p>
        {data.head.parent_id ? (
          <button type="button" onClick={() => { void undo(); }} disabled={busy} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-50', RING)} data-testid="home-undo">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('rend_undo')}</span>
          </button>
        ) : null}
        <Link to={`/design-studio/${projectId}`} className={cn('hidden h-9 items-center rounded-lg px-2.5 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10 sm:inline-flex', RING)}>{t('rend_open_editor')}</Link>
      </header>
      <nav className="sticky top-14 z-10 flex gap-1 overflow-x-auto border-b border-[#E1E4E8] bg-white px-2 py-2 sm:justify-center" role="tablist" aria-label={t('rend_tabs')}>
        {tabs.map(([k, key, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelected(null); }}
            className={cn('inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold', RING, tab === k ? 'bg-[#0C1119] text-white' : 'text-[#0C1119] hover:bg-[#F1F3F6]')}
            data-testid={`home-tab-${k.toLowerCase()}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{t(key)}
          </button>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-6">
        {error ? <p role="alert" className="mb-3 rounded-lg bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}

        {tab === 'PLAN' ? (
          <section className="grid gap-4 md:grid-cols-2" aria-label={t('rend_tab_plan')}>
            {doc ? (
              <>
                <figure className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
                  <PlanDrawing doc={doc} imageUrl={planUrl} mode="ORIGINAL" />
                  <figcaption className="px-4 py-2 text-[13px] text-[#4A5263]">{t('p2h_compare_original')}</figcaption>
                </figure>
                <figure className="overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
                  <PlanDrawing doc={doc} imageUrl={planUrl} mode="CLEAN" rejected={new Set((data.plan?.corrections ?? [])[(data.plan?.corrections ?? []).length - 1]?.decisions?.rejected ?? [])} roomLabel={(r) => ({ name: t(`ds_room_${r.kind.toLowerCase()}`), size: null })} />
                  <figcaption className="px-4 py-2 text-[13px] text-[#4A5263]">{t('p2h_compare_homatch')}</figcaption>
                </figure>
              </>
            ) : <p className="text-[14px] text-[#4A5263]">{t('rend_plan_none')}</p>}
          </section>
        ) : null}

        {tab === 'DESIGN' ? (
          <section aria-label={t('rend_tab_design')}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="font-display text-2xl font-semibold">{t('rend_master_title')}</h1>
                <p className="text-[14px] text-[#4A5263]">{t(master.ready ? 'rend_master_hint' : 'rend_master_wait')}</p>
              </div>
              {master.ready?.finish && master.ready.finish.provider === 'BLENDER' && master.ready.finish.check && !master.ready.finish.check.accepted ? (
                <p className="text-2xs text-[#5B6472]">{t('rend_finish_refused')}</p>
              ) : null}
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              {master.ready && urls.get(master.ready.id) ? (
                <RenderViewer
                  imageUrl={urls.get(master.ready.id)!} idsUrl={master.stale ? null : mapUrl} legend={master.stale ? null : master.ready.legend}
                  editable={editable} selectedId={selected?.id ?? null} onSelect={(e) => { setError(null); setSelected(e); }}
                  alt={t('rend_master_alt')} labelFor={labelFor}
                />
              ) : (
                <div className="grid aspect-[16/10] place-items-center bg-[radial-gradient(circle_at_50%_40%,#ffffff,#eceff3)]" role="status" aria-live="polite" data-testid="master-working">
                  <div className="text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#4A5263]" aria-hidden="true" />
                    <p className="mt-3 text-[15px] font-medium">{t(master.working?.status === 'FINISHING' ? 'rend_status_finishing' : master.working?.status === 'RENDERING' ? 'rend_status_rendering' : master.working ? 'rend_status_queued' : 'rend_status_none')}</p>
                  </div>
                </div>
              )}
              {master.working && master.ready ? (
                <p className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-2xs font-medium shadow" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('rend_updating')}</p>
              ) : null}
              {selected && actions.length ? (
                <EditPanel
                  entry={selected} title={labelFor(selected)} actions={actions}
                  colors={colourChoices(data.dna?.palette ?? data.state.palette, selObj?.colorOverride ?? data.state.surfaces[selected.id]?.color ?? null)}
                  materials={fittingMaterials} variants={selAsset?.variants ?? []} replacements={selAsset ? replacements(selAsset, [...data.assets.values()]) : []}
                  position={selObj ? { x: selObj.position.x, y: selObj.position.z } : null} rotation={selObj?.rotationY ?? null}
                  busy={busy} error={error}
                  onChoice={(c, l) => { void onChoice(c, l); }} onClose={() => setSelected(null)}
                />
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setTab('ROOMS')} className={cn('inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold ring-1 ring-[#D5D9E0] hover:ring-[#0C1119]', RING)}>
                <ImageIcon className="h-4 w-4" aria-hidden="true" />{t('rend_cta_rooms')}
              </button>
              <button type="button" onClick={() => { void walk(); }} disabled={walkPrep === 'BUILDING'} className={cn('inline-flex h-11 items-center gap-2 rounded-xl bg-[hsl(38_92%_56%)] px-4 text-[15px] font-semibold text-[#0C1119] hover:bg-[hsl(38_92%_50%)] disabled:opacity-60', RING)} data-testid="home-walk">
                {walkPrep === 'BUILDING' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Footprints className="h-4 w-4" aria-hidden="true" />}
                {t(walkPrep === 'BUILDING' ? 'rend_walk_preparing' : 'rend_cta_walk')}
              </button>
            </div>
          </section>
        ) : null}

        {tab === 'ROOMS' ? <RoomsTab data={data} renders={renders} urls={urls} onOrder={async (views, confirmed) => { await renderViews(data.head.id, data.state, views, 'DS_ROOM_RENDER', confirmed); await reload(); }} quote={(n) => quoteRender({ projectId, versionId: data.head.id, product: 'DS_ROOM_RENDER', views: n })} /> : null}

        {tab === 'WALK' ? (
          <section className="mx-auto max-w-xl rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5" aria-label={t('rend_tab_walk')}>
            <Footprints className="mx-auto h-8 w-8" aria-hidden="true" />
            <h2 className="mt-3 font-display text-xl font-semibold">{t('rend_walk_title')}</h2>
            <p className="mt-2 text-[14px] text-[#4A5263]">{t('rend_walk_body')}</p>
            <button type="button" onClick={() => { void walk(); }} disabled={walkPrep === 'BUILDING'} className={cn('mt-5 inline-flex h-12 items-center gap-2 rounded-xl bg-[#0C1119] px-6 text-[16px] font-semibold text-white disabled:opacity-60', RING)} data-testid="home-walk-start">
              {walkPrep === 'BUILDING' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
              {t(walkPrep === 'BUILDING' ? 'rend_walk_preparing' : 'rend_cta_walk')}
            </button>
            {walkPrep === 'FAILED' ? <p role="alert" className="mt-3 text-[14px] text-[hsl(0_66%_34%)]">{t('rend_walk_failed')}</p> : null}
          </section>
        ) : null}
      </main>

      {pending ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="home-confirm-title">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl">
            <h2 id="home-confirm-title" className="text-[17px] font-semibold">{pending.title}</h2>
            <p className="mt-2 text-[15px]" data-testid="confirm-price">{t(pending.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: String(pending.credits) })}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setPending(null)} disabled={busy} className={cn('h-11 flex-1 rounded-xl border border-[#D5D9E0] text-[15px] font-medium', RING)}>{t('general_cancel')}</button>
              <button type="button" onClick={() => { void runPending(); }} disabled={busy} className={cn('inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#0C1119] text-[15px] font-semibold text-white disabled:opacity-60', RING)} data-testid="confirm-run">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('rend_confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoomsTab({ data, renders, urls, onOrder, quote }: {
  data: HomeData;
  renders: RenderRecord[];
  urls: Map<string, string>;
  onOrder: (views: SpecView[], confirmed: number) => Promise<void>;
  quote: (n: number) => Promise<{ quote: RenderQuote | null; error: string | null }>;
}) {
  const { t } = useLanguage();
  const design = useMemo(() => ({ state: data.state, assets: data.assets }), [data]);
  const rooms = data.space.rooms;
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [offer, setOffer] = useState<{ views: SpecView[]; credits: number; charged: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<RenderRecord | null>(null);
  const max = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, Math.max(1, maxRoomViews(data.space, r.id, design))])), [rooms, data.space, design]);
  const views = useMemo(() => Object.entries(chosen).flatMap(([roomId, n]) => planRoomViews(data.space, roomId, n, design)), [chosen, data.space, design]);
  const roomShots = renders.filter((r) => r.view?.kind === 'ROOM');

  const ask = async () => {
    setErr(null);
    if (!views.length) return;
    const q = await quote(views.length);
    if (!q.quote) { setErr(t('rend_error_quote')); return; }
    setOffer({ views, credits: q.quote.credits, charged: q.quote.charged });
  };
  const go = async () => {
    if (!offer || busy) return;
    setBusy(true);
    try { await onOrder(offer.views, offer.credits); setOffer(null); setChosen({}); } catch (e) { setErr(t(String((e as Error).message) === 'DS_PRICE_CHANGED' ? 'p2h_error_price_changed' : 'rend_error_generic')); } finally { setBusy(false); }
  };

  return (
    <section aria-label={t('rend_tab_rooms')}>
      <h1 className="font-display text-2xl font-semibold">{t('rend_rooms_title')}</h1>
      <p className="mt-1 text-[14px] text-[#4A5263]">{t('rend_rooms_body')}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((r) => {
          const n = chosen[r.id] ?? 0;
          return (
            <li key={r.id} className={cn('rounded-xl bg-white p-3 ring-1', n ? 'ring-[#0C1119]' : 'ring-[#E1E4E8]')} data-testid="room-pick">
              <p className="text-[15px] font-semibold">{t(`ds_room_${r.kind.toLowerCase()}`)}{r.label ? <span className="ms-1 font-normal text-[#5B6472]">· {r.label}</span> : null}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('rend_views_for', { room: t(`ds_room_${r.kind.toLowerCase()}`) })}>
                {[0, 1, 3, 5].filter((k) => k <= max[r.id]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={n === k} onClick={() => setChosen((c) => ({ ...c, [r.id]: k }))}
                    className={cn('h-9 min-w-9 rounded-full px-3 text-[13px] font-semibold', RING, n === k ? 'bg-[#0C1119] text-white' : 'bg-[#F1F3F6]')}>
                    {k === 0 ? t('rend_none') : k}
                  </button>
                ))}
                {max[r.id] > 5 ? (
                  <input type="number" min={1} max={max[r.id]} inputMode="numeric" aria-label={t('rend_custom_views')} value={n > 5 ? n : ''} placeholder={t('rend_custom')}
                    onChange={(e) => { const v = Math.max(0, Math.min(max[r.id], Number(e.target.value) || 0)); setChosen((c) => ({ ...c, [r.id]: v })); }}
                    className="h-9 w-20 rounded-full border border-[#D5D9E0] px-3 text-[13px]" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => { void ask(); }} disabled={!views.length || busy} className={cn('inline-flex h-11 items-center gap-2 rounded-xl bg-[#0C1119] px-5 text-[15px] font-semibold text-white disabled:opacity-50', RING)} data-testid="rooms-quote">
          <Sparkles className="h-4 w-4" aria-hidden="true" />{t('rend_rooms_cta', { n: String(views.length) })}
        </button>
        {err ? <p role="alert" className="text-[14px] text-[hsl(0_66%_34%)]">{err}</p> : null}
      </div>
      {offer ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-[#0C1119]" data-testid="rooms-offer">
          <p className="flex-1 text-[15px]">{t(offer.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: String(offer.credits) })}</p>
          <button type="button" onClick={() => setOffer(null)} className={cn('h-10 rounded-lg border border-[#D5D9E0] px-4 text-[14px]', RING)}>{t('general_cancel')}</button>
          <button type="button" onClick={() => { void go(); }} disabled={busy} className={cn('inline-flex h-10 items-center gap-2 rounded-lg bg-[#0C1119] px-4 text-[14px] font-semibold text-white disabled:opacity-50', RING)} data-testid="rooms-confirm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('rend_confirm')}
          </button>
        </div>
      ) : null}

      {roomShots.length ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('rend_rooms_gallery')}>
          {roomShots.map((r) => {
            const room = rooms.find((x) => x.id === r.view.roomId);
            const url = urls.get(r.id);
            return (
              <li key={r.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-black/5" data-testid="room-shot" data-status={r.status}>
                {url ? (
                  <button type="button" onClick={() => setOpen(r)} className={cn('block w-full', RING)} aria-label={t('rend_open_view')}>
                    <img src={url} alt={room ? t(`ds_room_${room.kind.toLowerCase()}`) : ''} className="aspect-[3/2] w-full object-cover" loading="lazy" />
                  </button>
                ) : (
                  <div className="grid aspect-[3/2] place-items-center bg-[#F1F3F6]" role="status">
                    {r.status === 'FAILED' ? <p className="px-3 text-center text-[13px] text-[hsl(0_66%_34%)]">{t('rend_status_failed')}</p>
                      : <p className="inline-flex items-center gap-2 text-[13px] text-[#4A5263]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t(r.status === 'FINISHING' ? 'rend_status_finishing' : r.status === 'RENDERING' ? 'rend_status_rendering' : 'rend_status_queued')}</p>}
                  </div>
                )}
                <p className="px-3 py-2 text-[13px] text-[#4A5263]">{room ? t(`ds_room_${room.kind.toLowerCase()}`) : ''} · {t(`rend_purpose_${String(r.view.purpose).toLowerCase()}`)}</p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open && urls.get(open.id) ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/80 p-3" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <img src={urls.get(open.id)} alt="" className="max-h-[90dvh] max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
    </section>
  );
}
