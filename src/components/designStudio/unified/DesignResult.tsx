// YOUR DESIGN — the Result of an OpenAI-first project (photos or a floor plan).
//
// The new design IS the page. Around it, one tap each:
//
//   Before / after   the customer's own photo (or plan) against the design
//   Edit             tap a piece or a surface in the picture and change it
//                    (render-edit, the stable edit pipeline: one priced,
//                    versioned change inside that target's own mask)
//   Another option   a VARIANT: the same space, style and quality, new details
//   Change style     a VARIANT in another style
//   Change quality   a VARIANT at another quality
//   Other rooms      a ROOM: that room's own photo (or the plan's room) in the
//                    same design identity, or in another style
//
// Every generation is server-owned (designRun.ts): priced first, confirmed by
// the customer, then made whether or not this page stays open; the page only
// follows it. A floor-plan design also offers its 3D walkthrough
// (WalkthroughPanel): made by the server, it carries on with the page closed.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Columns2, Download, Expand, Layers, Loader2, Pencil, RefreshCw, RotateCcw, Shuffle, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { LOOK_QUALITIES, LOOK_STYLES, lookPreferences, readLook, type LookQuality, type LookStyle } from '@/lib/designStudio/lookPresets';
import type { MapEntry, RenderProduct, RenderRecord } from '@/lib/designStudio/renders/contract';
import type { EditChoice } from '@/lib/designStudio/renders/edits';
import { colourChoices } from '@/lib/designStudio/renders/edits';
import { aiActionsFor, aiAppearanceEdit, aiWhat, isAiEntry } from '@/lib/designStudio/renders/aiEdits';
import type { DesignVersionRecord } from '@/lib/designStudio/types';
import { createVersion, setHeadVersion, type ProjectBundle } from '@/services/designStudio/projects';
import { editRender, listRenders, pollRenders, quoteRender, renderMapUrl, renderPictureUrls } from '@/services/designStudio/renders';
import { generationStep, isGenerated, stepGenerated } from '@/services/designStudio/generation';
import { runDesign, type RunStage } from '@/services/designStudio/designRun';
import { DesignStudioError } from '@/services/designStudio/errors';
import { signedUrls } from '@/services/designStudio/files';
import { RenderViewer } from '@/components/designStudio/renders/RenderViewer';
import { EditPanel } from '@/components/designStudio/renders/EditPanel';
import { STAGE_KEY } from './Screens';
import { WalkthroughPanel } from './WalkthroughPanel';

const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF]';
const ACTIVE: ReadonlySet<RenderRecord['status']> = new Set(['QUOTED', 'QUEUED', 'RENDERING', 'FINISHING']);
const CHIP = cn('inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-[#0C1119] ring-1 ring-[#E1D9CC] hover:ring-[#0C1119] disabled:opacity-50', RING);
const DARK = cn('inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0C1119] px-5 text-[15px] font-semibold text-white disabled:opacity-60', RING);

export interface ResultRoom { id: string; label: string; photoUrl: string | null }

export interface ResultData {
  bundle: ProjectBundle;
  head: DesignVersionRecord;
  sourceKind: 'PHOTO' | 'FLOOR_PLAN';
  rooms: ResultRoom[];
  /** The room the first design shows (photos), so it is not offered again as "another room". */
  heroRoomId: string | null;
}

/** What a pending paid action is, its price, and what Confirm does. */
interface Pending { title: string; body: string | null; credits: number; charged: boolean; run: () => Promise<void> }
/** A design being made right now (followed here; owned by the server). */
interface Working { label: string; stage: RunStage }

const pictureOf = (r: RenderRecord) => r.status === 'READY' && !!(r.final_key ?? r.base_key) && (isGenerated(r) || r.kind === 'EDIT');
const roomOf = (r: RenderRecord): string | null => (r.view?.kind === 'ROOM' ? (r.view.roomId ?? null) : null);

/** One generation the Result asks for (a variant, a style, a quality, a room): its key is its identity on the server. */
interface GenInput {
  mode: 'VARIANT' | 'ROOM'; key: string; label: string; credits: number;
  style?: LookStyle | null; quality?: LookQuality | null; roomId?: string | null; parentRenderId?: string | null;
}

export function DesignResult({ data, onReload }: { data: ResultData; onReload: () => Promise<void> }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { homatchUser } = useAuth();
  const projectId = data.bundle.project.id;
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [heroId, setHeroId] = useState<string | null>(null);
  const [mode, setMode] = useState<'VIEW' | 'COMPARE' | 'EDIT'>('VIEW');
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapEntry | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sheet, setSheet] = useState<'STYLE' | 'QUALITY' | { roomId: string } | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A generation that did not finish: asked again with the SAME key, so the server resumes it (a recorded
  // specification and design are reused, never paid again). Kept per project in this browser across a reload.
  const failedKey = `hm-ds-failed-run:${projectId}`;
  const [failedRun, setFailedRun] = useState<GenInput | null>(() => {
    try { const v = window.localStorage.getItem(failedKey); return v ? JSON.parse(v) as GenInput : null; } catch { return null; }
  });
  const keepFailed = useCallback((run: GenInput | null) => {
    setFailedRun(run);
    try { if (run) window.localStorage.setItem(failedKey, JSON.stringify(run)); else window.localStorage.removeItem(failedKey); } catch { /* private mode */ }
  }, [failedKey]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    const r = await listRenders(projectId);
    if (!alive.current) return;
    setRenders(r);
    const pics = r.filter(pictureOf);
    const more = await renderPictureUrls(pics, 1800);
    if (alive.current) setUrls((u) => new Map([...u, ...more]));
  }, [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const pictures = useMemo(() => renders.filter(pictureOf), [renders]);
  // The hero: the picture of the head version (an edit or a variant made head), else the newest master.
  const hero = useMemo(() => {
    if (heroId) { const h = pictures.find((r) => r.id === heroId); if (h) return h; }
    return pictures.find((r) => r.version_id === data.head.id && !roomOf(r)) ?? pictures.find((r) => r.view?.id === 'master') ?? pictures[0] ?? null;
  }, [pictures, heroId, data.head.id]);
  const masters = useMemo(() => {
    const seen = new Set<string>();
    return pictures.filter((r) => !roomOf(r)).filter((r) => (seen.has(r.version_id) ? false : (seen.add(r.version_id), true))).slice(0, 12);
  }, [pictures]);
  const roomShots = useMemo(() => {
    const m = new Map<string, RenderRecord>();
    for (const r of pictures) { const id = roomOf(r); if (id && !m.has(id)) m.set(id, r); }
    return m;
  }, [pictures]);
  const active = useMemo(() => renders.filter((r) => ACTIVE.has(r.status)), [renders]);
  const look = useMemo(() => readLook((hero?.finish as unknown as { look?: unknown } | null)?.look ?? null), [hero]);

  // Work in progress (made here, or found on return): follow it until it lands.
  useEffect(() => {
    if (!active.length) return;
    const ctl = new AbortController();
    const generated = active.filter((r) => isGenerated(r)).map((r) => r.id);
    const edits = active.filter((r) => !isGenerated(r)).map((r) => r.id);
    let stop = false;
    const loop = async () => {
      while (!stop && generated.length) {
        const rows = await stepGenerated(generated).catch(() => null);
        if (stop) return;
        if (rows) {
          const step = generationStep(rows[0] ?? null);
          setWorking((w) => w ?? { label: t('dsx_gen_eyebrow'), stage: step === 'QUEUED' || step === 'IMAGE' ? 'IMAGE' : 'RESULT' });
          if (rows.every((r) => !ACTIVE.has(r.status))) { await refresh(); setWorking(null); return; }
        }
        await new Promise((ok) => setTimeout(ok, 3000));
      }
    };
    void loop();
    if (edits.length) void pollRenders(edits, { signal: ctl.signal, onUpdate: async (rs) => { if (rs.every((r) => !ACTIVE.has(r.status))) await refresh(); } });
    return () => { stop = true; ctl.abort(); };
  }, [active.map((r) => r.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The "before" picture: the customer's own photo of this view (or the plan).
  useEffect(() => {
    const key = (hero?.finish as unknown as { sourceKey?: string } | null)?.sourceKey;
    setBeforeUrl(null);
    if (key) signedUrls([key], 1800).then((m) => setBeforeUrl(m.get(key) ?? null)).catch(() => {});
  }, [hero?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMapUrl(null);
    if (hero && mode === 'EDIT') renderMapUrl(hero, 1800).then(setMapUrl).catch(() => {});
  }, [hero?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const roomLabel = useCallback((id: string | null | undefined) => data.rooms.find((r) => r.id === id)?.label ?? null, [data.rooms]);
  const labelFor = useCallback((e: MapEntry) => {
    const what = isAiEntry(e) ? t(`sf_obj_${aiWhat(e) ?? 'other'}`) : t('rend_piece');
    const room = roomLabel(e.roomId);
    return room ? `${what} · ${room}` : what;
  }, [t, roomLabel]);

  const fail = (e: unknown) => {
    const code = e instanceof DesignStudioError ? e.code : String((e as Error)?.message ?? '');
    setError(t(code === 'DS_PRICE_CHANGED' ? 'dsx_price_changed' : code === 'DS_INSUFFICIENT_CREDITS' ? 'dsx_no_credits' : 'dsx_fail_title'));
  };

  /** Price first: the customer sees it and confirms; nothing is spent before that. */
  const offer = async (product: RenderProduct, versionId: string, title: string, body: string | null, run: (credits: number) => Promise<void>) => {
    setError(null);
    const q = await quoteRender({ projectId, versionId, product, views: 1 });
    if (!q.quote) { setError(t('rend_error_quote')); return; }
    setPending({ title, body, credits: q.quote.credits, charged: q.quote.charged, run: () => run(q.quote!.credits) });
  };

  /** One server-owned generation, followed here (and picked up again on return). */
  const generate = async (input: GenInput, retry = false) => {
    if (!hero) return;
    keepFailed(null);
    setError(null);
    const base = look ?? { style: 'MODERN', quality: 'HIGH_QUALITY' };
    const style = (input.style ?? base.style) as LookStyle;
    const quality = (input.quality ?? base.quality) as LookQuality;
    setWorking({ label: input.label, stage: 'DESIGN' });
    try {
      const result = await runDesign({
        projectId, versionId: data.head.id, mode: input.mode, key: input.key, look: { style, quality }, preferences: lookPreferences(style, quality),
        roomId: input.roomId ?? null, parentRenderId: input.parentRenderId ?? hero.id, confirmedCredits: input.credits, versionName: t('p2h_version_design'), retry,
        change: input.style || input.quality ? { style: input.style ?? null, quality: input.quality ?? null } : null,
        onStage: (stage) => { if (alive.current) setWorking({ label: input.label, stage }); },
      });
      if (!alive.current) return;
      await onReload();
      await refresh();
      setHeroId(result.render.id);
      setMode('VIEW');
    } catch (e) {
      if (e instanceof DesignStudioError && (e.code === 'DS_STILL_WORKING' || e.code === 'DS_WATCH_STOPPED')) return;
      if (!alive.current) return;
      const code = e instanceof DesignStudioError ? e.code : '';
      // A price that moved or missing credits is the customer's to decide; anything else is ours to resume.
      if (code === 'DS_PRICE_CHANGED' || code === 'DS_INSUFFICIENT_CREDITS') fail(e);
      else keepFailed({ ...input, parentRenderId: input.parentRenderId ?? hero.id });
    } finally {
      if (alive.current) setWorking(null);
    }
  };

  const nonce = () => Math.random().toString(36).slice(2, 10);
  const retryFailed = () => { if (failedRun && !working) void generate(failedRun, true); };
  const askVariant = () => offer('DS_MASTER_RENDER', data.head.id, t('dsx_variant'), t('dsx_variant_body'), async (credits) => {
    void generate({ mode: 'VARIANT', key: `var-${hero!.id}-${nonce()}`, label: t('dsx_variant'), credits });
  });
  const askStyle = (style: LookStyle) => offer('DS_MASTER_RENDER', data.head.id, `${t('dsx_change_style')} · ${t(`sf_style_${style.toLowerCase()}`)}`, null, async (credits) => {
    void generate({ mode: 'VARIANT', key: `sty-${hero!.id}-${style}-${nonce()}`, label: t('dsx_change_style'), credits, style });
  });
  const askQuality = (quality: LookQuality) => offer('DS_MASTER_RENDER', data.head.id, `${t('dsx_change_quality')} · ${t(`sf_quality_${quality.toLowerCase()}`)}`, null, async (credits) => {
    void generate({ mode: 'VARIANT', key: `qly-${hero!.id}-${quality}-${nonce()}`, label: t('dsx_change_quality'), credits, quality });
  });
  const askRoom = (roomId: string, style: LookStyle | null) => offer('DS_ROOM_RENDER', data.head.id, `${t('dsx_room_create')} · ${roomLabel(roomId) ?? ''}`, null, async (credits) => {
    // The same room in the same style is the same picture: asking twice never pays twice.
    void generate({ mode: 'ROOM', key: `room-${data.head.id}-${roomId}-${style ?? 'same'}`, label: roomLabel(roomId) ?? t('dsx_other_room'), credits, roomId, style });
  });

  /** An edit inside one target's own mask (the stable edit pipeline). The design's picture changes; nothing moves. */
  const onChoice = async (choice: EditChoice, label: string) => {
    if (!selected || !hero || !homatchUser) return;
    const edit = aiAppearanceEdit(selected, choice, label);
    if (!edit) return;
    const what = labelFor(selected);
    await offer('DS_RENDER_EDIT', data.head.id, t('rend_confirm_appearance', { what }), null, async (shown) => {
      const v = await createVersion({
        userId: homatchUser.id, projectId, sourceId: data.head.source_id, parentId: data.head.id, origin: 'USER',
        name: t('rend_version_edit', { what }).slice(0, 80), state: (data.head.state ?? {}) as Record<string, unknown>,
        changeSummary: [{ kind: 'RENDER_EDIT', edit, generator: 'OPENAI_FIRST' }],
      });
      const q = await quoteRender({ projectId, versionId: v.id, product: 'DS_RENDER_EDIT', views: 1 });
      if (!q.quote || q.quote.credits !== shown) throw new DesignStudioError('DS_PRICE_CHANGED');
      const e = await editRender({ renderId: hero.id, edit, newVersionId: v.id, quote: q.quote, idempotencyKey: `edit-${v.id}` });
      if (!e.render) throw new DesignStudioError('DS_EDIT_FAILED');
      setSelected(null);
      await onReload();
      await refresh();
    });
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try { await pending.run(); setPending(null); } catch (e) { fail(e); setPending(null); } finally { setBusy(false); }
  };
  const showVersion = async (r: RenderRecord) => {
    setHeroId(r.id);
    setMode('VIEW');
    setSelected(null);
    if (r.version_id !== data.head.id && !roomOf(r)) { await setHeadVersion(projectId, r.version_id).catch(() => {}); await onReload(); }
  };
  const undo = async () => {
    if (!data.head.parent_id || busy) return;
    setBusy(true);
    try { await setHeadVersion(projectId, data.head.parent_id); setHeroId(null); await onReload(); } finally { setBusy(false); }
  };

  const heroUrl = hero ? urls.get(hero.id) ?? null : null;
  // The picture is in private storage behind a short-lived link: fetched and saved as a file (a cross-origin
  // link cannot be given a file name); if that is refused, it opens in a new tab to be saved from there.
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!heroUrl || downloading) return;
    setDownloading(true);
    try {
      const blob = await (await fetch(heroUrl)).blob();
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `homatch-design-${(hero?.id ?? 'picture').slice(0, 8)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      window.open(heroUrl, '_blank', 'noopener');
    } finally {
      setDownloading(false);
    }
  };
  const heroRoom = hero ? roomOf(hero) ?? data.heroRoomId : data.heroRoomId;
  const others = data.rooms.filter((r) => r.id !== (data.heroRoomId ?? ''));

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F7F4EF] text-[#0C1119]" data-testid="design-home" data-view="HOME" data-source={data.sourceKind}>
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1 bg-[#F7F4EF]/95 px-2 backdrop-blur sm:px-6">
        <Link to="/design-studio" aria-label={t('ds_back_to_projects')} className={cn('grid h-11 w-11 place-items-center rounded-full hover:bg-black/5', RING)}>
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <p className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{data.bundle.project.name}</p>
        {data.head.parent_id ? (
          <button type="button" onClick={() => { void undo(); }} disabled={busy} aria-label={t('rend_undo')} className={cn('inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[#4A5263] hover:bg-black/5 hover:text-[#0C1119] disabled:opacity-50', RING)} data-testid="home-undo">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('rend_undo')}</span>
          </button>
        ) : null}
        {data.sourceKind === 'FLOOR_PLAN' ? (
          <Link to={`/design-studio/${projectId}?editor=1`} className={cn('inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[#4A5263] hover:bg-black/5 hover:text-[#0C1119]', RING)} data-testid="home-advanced">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t('sf_advanced')}</span><span className="sr-only sm:hidden">{t('sf_advanced')}</span>
          </Link>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-2 sm:px-8 sm:pt-6">
        <div className="mb-4 sm:mb-6">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(36_60%_32%)]" data-testid="home-look">
            {t('dsx_res_eyebrow')}{look ? ` · ${t(`sf_style_${look.style.toLowerCase()}`)} · ${t(`sf_quality_${look.quality.toLowerCase()}`)}` : ''}
          </p>
          <h1 className="mt-1 text-balance font-display text-[28px] font-semibold leading-tight sm:text-[40px]">{t('dsx_res_title')}</h1>
        </div>
        {error ? <p role="alert" className="mb-3 rounded-2xl bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}

        {/* ── The hero ───────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[22px] bg-white shadow-[0_24px_60px_-30px_rgba(12,17,25,0.35)] sm:rounded-[28px]" data-testid="home-render">
          {!hero || !heroUrl ? (
            <div className="grid aspect-[4/3] place-items-center bg-[#FBFAF7] sm:aspect-[16/10]" role="status" aria-live="polite" data-testid="master-working">
              <div className="px-6 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#5B6472]" aria-hidden="true" />
                <p className="mt-3 text-[16px] font-medium">{t(working ? STAGE_KEY[working.stage] : 'dsx_gen_eyebrow')}</p>
              </div>
            </div>
          ) : mode === 'COMPARE' && beforeUrl ? (
            <CompareSlider before={beforeUrl} after={heroUrl} />
          ) : mode === 'EDIT' ? (
            <RenderViewer imageUrl={heroUrl} idsUrl={mapUrl} legend={hero.legend} editable={(e) => isAiEntry(e) && aiActionsFor(e).length > 0}
              selectedId={selected?.id ?? null} onSelect={(e) => { setError(null); setSelected(e); }} alt={t('rend_master_alt')} labelFor={labelFor} />
          ) : (
            <img src={heroUrl} alt={t('rend_master_alt')} className="block w-full" data-testid="render-viewer" />
          )}
          {mode === 'EDIT' ? (
            <p className="pointer-events-none absolute inset-x-3 top-3 mx-auto w-fit rounded-full bg-[#0C1119]/85 px-4 py-2 text-[13px] font-medium text-white" data-testid="edit-hint">{t('dsx_edit_body')}</p>
          ) : null}
          {mode === 'EDIT' && selected && hero ? (
            <EditPanel entry={selected} title={labelFor(selected)} actions={aiActionsFor(selected)} colors={colourChoices(((data.head as unknown as { design_dna?: { palette?: string[] } | null }).design_dna?.palette) ?? [], null)}
              materials={[]} replacements={[]} position={null} rotation={null} busy={busy} error={error}
              onChoice={(c, l) => { void onChoice(c, l); }} onClose={() => setSelected(null)} />
          ) : null}
        </div>

        {/* ── Ways to look ───────────────────────────────────────────── */}
        {hero && heroUrl ? (
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="home-modes">
            {beforeUrl ? (
              <button type="button" onClick={() => { setMode(mode === 'COMPARE' ? 'VIEW' : 'COMPARE'); setSelected(null); }} aria-pressed={mode === 'COMPARE'} className={cn(CHIP, mode === 'COMPARE' && 'ring-2 ring-[#0C1119]')} data-testid="home-compare">
                <Columns2 className="h-4 w-4" aria-hidden="true" />{t('dsx_before')} / {t('dsx_after')}
              </button>
            ) : null}
            {hero.legend ? (
              <button type="button" onClick={() => { setMode(mode === 'EDIT' ? 'VIEW' : 'EDIT'); setSelected(null); }} aria-pressed={mode === 'EDIT'} className={cn(CHIP, mode === 'EDIT' && 'ring-2 ring-[#0C1119]')} data-testid="home-edit">
                {mode === 'EDIT' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}{t(mode === 'EDIT' ? 'dsx_edit_done' : 'dsx_edit')}
              </button>
            ) : null}
            <button type="button" onClick={() => window.open(heroUrl, '_blank', 'noopener')} className={CHIP} data-testid="home-open">
              <Expand className="h-4 w-4" aria-hidden="true" />{t('dsx_open_full')}
            </button>
            <button type="button" onClick={() => { void download(); }} disabled={downloading} className={CHIP} data-testid="home-download">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}{t('dsx_download')}
            </button>
            {heroRoom && roomLabel(heroRoom) ? <span className="ms-auto text-[13px] text-[#5B6472]">{roomLabel(heroRoom)}</span> : null}
          </div>
        ) : null}

        {/* ── What to make next ──────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap gap-2" data-testid="home-actions">
          <button type="button" onClick={() => { void askVariant(); }} disabled={!hero || !!working} className={CHIP} data-testid="home-variant"><Shuffle className="h-4 w-4" aria-hidden="true" />{t('dsx_variant')}</button>
          <button type="button" onClick={() => setSheet('STYLE')} disabled={!hero || !!working} className={CHIP} data-testid="home-style"><Sparkles className="h-4 w-4" aria-hidden="true" />{t('dsx_change_style')}</button>
          <button type="button" onClick={() => setSheet('QUALITY')} disabled={!hero || !!working} className={CHIP} data-testid="home-quality"><Layers className="h-4 w-4" aria-hidden="true" />{t('dsx_change_quality')}</button>
          {others.length ? (
            <button type="button" onClick={() => document.getElementById('ds-rooms')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={CHIP} data-testid="home-rooms">{t('dsx_other_room')}</button>
          ) : null}
        </div>

        {working ? (
          <section className="mt-5 flex flex-wrap items-center gap-3 rounded-[22px] bg-[#0C1119] p-4 text-white sm:p-5" role="status" aria-live="polite" data-testid="home-working">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(38_92%_62%)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{t('dsx_working_on', { what: working.label })}</p>
              <p className="text-[13px] text-white/70">{t(STAGE_KEY[working.stage])} · {t('dsx_leave_ok')}</p>
            </div>
            <button type="button" onClick={() => setPlaying(true)} className={cn('h-11 rounded-full bg-[hsl(38_92%_56%)] px-4 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="snake-play">{t('dsx_sn_play')}</button>
          </section>
        ) : null}

        {failedRun && !working ? (
          <section className="mt-5 rounded-[22px] bg-white p-4 ring-1 ring-[#E7E1D8] sm:p-5" role="alert" data-testid="home-recovery">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(38_92%_56%)]/15 text-[hsl(36_60%_32%)]" aria-hidden="true"><RotateCcw className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{t('dsx_rec_title')} · {failedRun.label}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-[#4A5263]">{t('dsx_rec_result_body')}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => keepFailed(null)} className={cn('inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[14px] font-medium ring-1 ring-[#D9D1C4] hover:ring-[#0C1119]', RING)} data-testid="home-recovery-later">{t('dsx_later')}</button>
              <button type="button" onClick={retryFailed} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[hsl(38_92%_56%)] px-5 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="home-recovery-retry">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('dsx_retry')}
              </button>
            </div>
          </section>
        ) : null}

        {/* ── The 3D walkthrough of the design shown (a floor plan has rooms to walk) ── */}
        {data.sourceKind === 'FLOOR_PLAN' && hero ? (
          <WalkthroughPanel projectId={projectId} designVersionId={hero.version_id ?? data.head.id} renderId={hero.id} />
        ) : null}

        {/* ── Your options ───────────────────────────────────────────── */}
        {masters.length > 1 ? (
          <section className="mt-8" aria-labelledby="ds-variants-title">
            <h2 id="ds-variants-title" className="font-display text-[20px] font-semibold">{t('dsx_variants')}</h2>
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-2" data-testid="home-variants">
              {masters.map((r) => (
                <li key={r.id} className="shrink-0">
                  <button type="button" onClick={() => { void showVersion(r); }} aria-pressed={hero?.id === r.id}
                    className={cn('block w-40 overflow-hidden rounded-[16px] bg-white sm:w-48', RING, hero?.id === r.id ? 'ring-2 ring-[#0C1119]' : 'ring-1 ring-[#E7E1D8]')}>
                    {urls.get(r.id) ? <img src={urls.get(r.id)} alt="" className="aspect-[3/2] w-full object-cover" loading="lazy" /> : <span className="block aspect-[3/2] bg-[#EFEAE2]" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── Other rooms ────────────────────────────────────────────── */}
        {others.length ? (
          <section id="ds-rooms" className="mt-8 scroll-mt-16" aria-labelledby="ds-rooms-title" data-testid="home-rooms-list">
            <h2 id="ds-rooms-title" className="font-display text-[20px] font-semibold">{t('dsx_rooms_title')}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((room) => {
                const shot = roomShots.get(room.id);
                const img = shot ? urls.get(shot.id) : room.photoUrl;
                return (
                  <li key={room.id} className="overflow-hidden rounded-[20px] bg-white ring-1 ring-[#E7E1D8]" data-testid="room-card">
                    {img ? <img src={img} alt="" className="aspect-[3/2] w-full object-cover" loading="lazy" /> : <div className="aspect-[3/2] bg-[#EFEAE2]" />}
                    <div className="flex flex-wrap items-center gap-2 p-3">
                      <p className="min-w-0 flex-1 text-[15px] font-semibold">{room.label}</p>
                      {shot ? (
                        <button type="button" onClick={() => { void showVersion(shot); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={cn(CHIP, 'min-h-10')} data-testid="room-view">{t('dsx_view')}</button>
                      ) : (
                        <button type="button" onClick={() => setSheet({ roomId: room.id })} disabled={!hero || !!working} className={cn(DARK, 'min-h-10 px-4 text-[14px]')} data-testid="room-create">{t('dsx_room_create')}</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </main>

      {/* ── Sheets: style, quality, a room's style ───────────────────── */}
      {sheet ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="ds-sheet-title" onClick={() => setSheet(null)}>
          <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h2 id="ds-sheet-title" className="min-w-0 flex-1 text-[18px] font-semibold">
                {sheet === 'STYLE' ? t('dsx_change_style') : sheet === 'QUALITY' ? t('dsx_change_quality') : `${t('dsx_room_create')} · ${roomLabel(sheet.roomId) ?? ''}`}
              </h2>
              <button type="button" onClick={() => setSheet(null)} aria-label={t('general_cancel')} className={cn('grid h-11 w-11 place-items-center rounded-full hover:bg-black/5', RING)}><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <div className="mt-4 grid gap-2" data-testid="home-sheet">
              {sheet === 'STYLE' ? LOOK_STYLES.filter((s) => s !== look?.style).map((s) => (
                <button key={s} type="button" onClick={() => { setSheet(null); void askStyle(s); }} className={cn(CHIP, 'justify-start')} data-testid={`sheet-style-${s}`}>{t(`sf_style_${s.toLowerCase()}`)}</button>
              )) : null}
              {sheet === 'QUALITY' ? LOOK_QUALITIES.filter((q) => q !== look?.quality).map((q) => (
                <button key={q} type="button" onClick={() => { setSheet(null); void askQuality(q); }} className={cn(CHIP, 'justify-start')} data-testid={`sheet-quality-${q}`}>{t(`sf_quality_${q.toLowerCase()}`)}</button>
              )) : null}
              {sheet !== 'STYLE' && sheet !== 'QUALITY' ? (
                <>
                  <button type="button" onClick={() => { const id = sheet.roomId; setSheet(null); void askRoom(id, null); }} className={cn(DARK, 'justify-start')} data-testid="room-same-style">{t('dsx_same_style')}</button>
                  {data.sourceKind === 'PHOTO' ? (
                    <>
                      <p className="mt-2 text-[13px] font-semibold text-[#5B6472]">{t('dsx_other_style')}</p>
                      {LOOK_STYLES.filter((s) => s !== look?.style).map((s) => (
                        <button key={s} type="button" onClick={() => { const id = sheet.roomId; setSheet(null); void askRoom(id, s); }} className={cn(CHIP, 'justify-start')} data-testid={`room-style-${s}`}>{t(`sf_style_${s.toLowerCase()}`)}</button>
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── The price, confirmed before anything is spent ────────────── */}
      {pending ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="home-confirm-title">
          <div className="w-full max-w-md rounded-t-[24px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-[24px]">
            <h2 id="home-confirm-title" className="text-[17px] font-semibold">{pending.title}</h2>
            {pending.body ? <p className="mt-2 text-[15px] leading-relaxed text-[#4A5263]">{pending.body}</p> : null}
            <p className="mt-3 text-[15px] font-medium" data-testid="confirm-price">{t(pending.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: String(pending.credits) })}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setPending(null)} disabled={busy} className={cn('h-12 flex-1 rounded-full border border-[#D5D9E0] text-[15px] font-medium', RING)}>{t('general_cancel')}</button>
              <button type="button" onClick={() => { void confirm(); }} disabled={busy} className={cn(DARK, 'flex-1')} data-testid="confirm-run">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('dsx_price_confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {playing ? (
        <Suspense fallback={null}>
          <SnakeGame status={working ? 'PROCESSING' : failedRun ? 'FAILED' : 'READY'} stageLabel={t(STAGE_KEY[working?.stage ?? 'RESULT'])}
            onView={() => { setPlaying(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onClose={() => setPlaying(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Before and after, one picture: drag (or use the arrow keys on) the divider. */
function CompareSlider({ before, after }: { before: string; after: string }) {
  const { t } = useLanguage();
  const [pct, setPct] = useState(50);
  return (
    <div className="relative select-none" data-testid="compare">
      <img src={after} alt={t('dsx_after')} className="block w-full" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <img src={before} alt={t('dsx_before')} className="block h-full w-full object-cover" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(12,17,25,0.25)]" style={{ left: `${pct}%` }} aria-hidden="true" />
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[#0C1119]/80 px-3 py-1 text-2xs font-semibold text-white">{t('dsx_before')}</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-2xs font-semibold text-[#0C1119]">{t('dsx_after')}</span>
      <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label={t('dsx_compare')} dir="ltr"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" data-testid="compare-range" />
    </div>
  );
}
