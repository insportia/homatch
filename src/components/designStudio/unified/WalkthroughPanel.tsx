// THE 3D WALKTHROUGH OF THIS DESIGN — Create → the real steps → Ready → Open.
//
// The server owns the work (design-studio-reconstruct/walkthrough.ts): the
// customer may close the page at any step and come back to it finished. The
// steps shown are the server's own states, never a percentage. Asking twice
// (a double click, a second tab) is the same walkthrough.
//
// It starts from what the project already has: a floor-plan design at once; a
// photo design on the project's floor plan, if it has one, else on a space the
// server reconstructs from the project's own pictures and generated designs
// (never a request to upload the property again). While that space is being
// reconstructed the panel says so and keeps following it (asking again is the
// same request; a closed page changes nothing). A tour walked on a
// reconstructed space carries a quiet note once it is ready.
//
// With a design picture, the 3D tour IS that picture made 3D (PhotoWalk), on
// the customer's own device — every element is the picture's own, nothing is
// rebuilt. The server-built walkthrough of the plan below is used only where
// there is no picture to step into.

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Check, Footprints, Info, Loader2, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { PROGRESS_STEPS, type ProgressStep } from '@/lib/designStudio/walkthrough/lifecycle';
import type { WalkPhoto } from './PhotoWalk';
import { createWalkthrough, retryWalkthrough, walkthroughHref, walkthroughStatus, type Walkthrough } from '@/services/designStudio/walkthrough';

// The same game as every long wait: it only watches the walkthrough's real state (this panel keeps following it).
const SnakeGame = lazy(() => import('@/components/games/SnakeGame'));
// Three.js and the depth model load only when a picture is entered.
const PhotoWalk = lazy(() => import('./PhotoWalk'));

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF]';
const DARK = cn('inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0C1119] px-5 text-[15px] font-semibold text-white disabled:opacity-60', RING);
const CHIP = cn('inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-[#0C1119] ring-1 ring-[#E1D9CC] hover:ring-[#0C1119] disabled:opacity-50', RING);
const STEP_KEY: Record<ProgressStep, string> = {
  PLANNING: 'dsx_walk_step_planning', BUILDING: 'dsx_walk_step_building', FINISHING: 'dsx_walk_step_finishing', READY: 'dsx_walk_step_ready',
};
const POLL_MS = 5000;
const working = (w: Walkthrough | null) => !!w && w.state !== 'READY' && w.state !== 'FAILED' && w.state !== 'CANCELLED';

/** The 3D tour of a picture design, made in one tap: every room's eye-level picture at once (DesignResult owns the runs). */
export interface TourControl {
  /** Rooms the tour still needs a picture of. */
  missing: number;
  /** Being made: how many rooms of how many are in (nothing else of the work is shown). */
  making: { total: number; done: number } | null;
  /** A room of the last tour did not come (asking again makes only the rooms still missing). */
  short: boolean;
  /** Changes when a tour has just been made: the tour opens by itself. */
  openRequest: number;
  canCreate: boolean;
  onCreate: () => void;
  onPlay: () => void;
}

/** How often a space being reconstructed is asked after (the same request: never a second reading). */
const SPACE_POLL_MS = 6000;

export function WalkthroughPanel({ projectId, designVersionId, renderId, photos = [], needsRoomPhotos = false, tour = null }: {
  projectId: string; designVersionId: string; renderId: string | null;
  /** The design's eye-level room pictures to step into (the room shown first). */
  photos?: WalkPhoto[];
  /** A picture design: its tour walks its rooms' eye-level pictures — when it has none yet, the card says how to make them. */
  needsRoomPhotos?: boolean;
  /** One tap makes every room's picture, then the tour opens through them. */
  tour?: TourControl | null;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [walk, setWalk] = useState<Walkthrough | null>(null);
  const [history, setHistory] = useState<Walkthrough[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [reconstructing, setReconstructing] = useState(false);
  const [inside, setInside] = useState(false);
  // One request per tap: a second tap before the first answer is the same tap.
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const read = useCallback(async (id?: string) => {
    const r = await walkthroughStatus(id ? { walkthroughId: id } : { designVersionId });
    if (!alive.current) return;
    if (!r.error) { setWalk(r.walkthrough); setHistory(r.history); }
    setLoaded(true);
  }, [designVersionId]);
  // With a picture to step into there is nothing to ask the server.
  const photoTour = photos.length > 0 || needsRoomPhotos;
  // A tour just made opens by itself: the customer sees the result, not the work.
  const opened = useRef(tour?.openRequest ?? 0);
  useEffect(() => {
    if (!tour?.openRequest || tour.openRequest === opened.current || !photos.length) return;
    opened.current = tour.openRequest;
    setInside(true);
  }, [tour?.openRequest, photos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWalk(null); setHistory([]); setLoaded(false); if (!photoTour) void read(); }, [read, photoTour]);

  // Following it while it works (the page is only a watcher; the server carries on without it).
  useEffect(() => {
    if (!working(walk)) return;
    const id = walk!.id;
    const timer = setInterval(() => { void read(id); }, POLL_MS);
    return () => clearInterval(timer);
  }, [walk?.id, walk?.state, read]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (newRevision = false) => {
    if (asking || inFlight.current) return;
    inFlight.current = true;
    setAsking(true); setProblem(null);
    const revision = newRevision ? (history[0]?.revision ?? walk?.revision ?? 0) + 1 : (walk?.revision ?? 1);
    const r = await createWalkthrough({ designVersionId, renderId, newRevision, name: t('dsx_walk_version_name', { n: String(revision) }) }).finally(() => { inFlight.current = false; });
    if (!alive.current) return;
    setAsking(false);
    if (r.walkthrough) { setReconstructing(false); setWalk(r.walkthrough); void read(r.walkthrough.id); }
    else if (r.reconstructing) setReconstructing(true);
    else { setReconstructing(false); setProblem(t('dsx_walk_unavailable')); }
  };
  // The space is being reconstructed on the server: the same request again until the walkthrough exists.
  useEffect(() => {
    if (!reconstructing || walk) return;
    const timer = setInterval(() => { void start(false); }, SPACE_POLL_MS);
    return () => clearInterval(timer);
  }, [reconstructing, walk]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back on the page while the server reconstructs the space (or with the tour already asked): picked up again.
  useEffect(() => {
    if (!loaded || walk) return;
    try { if (window.sessionStorage.getItem(`hm-ds-walk:${designVersionId}`) === '1') void start(false); } catch { /* private mode */ }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { if (reconstructing) window.sessionStorage.setItem(`hm-ds-walk:${designVersionId}`, '1'); else if (walk) window.sessionStorage.removeItem(`hm-ds-walk:${designVersionId}`); } catch { /* private mode */ }
  }, [reconstructing, walk, designVersionId]);
  const retry = async () => {
    if (!walk || asking) return;
    setAsking(true); setProblem(null);
    const r = await retryWalkthrough(walk.id);
    if (!alive.current) return;
    setAsking(false);
    if (r.walkthrough) setWalk(r.walkthrough); else setProblem(t('dsx_walk_unavailable'));
  };

  if (photoTour) {
    return (
      <section className="mt-8 rounded-[22px] bg-white p-4 ring-1 ring-[#E7E1D8] sm:p-6" aria-labelledby="ds-walk-title" data-testid="walk-panel">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0C1119] text-white"><Box className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="ds-walk-title" className="font-display text-[20px] font-semibold">{t('dsx_walk_title')}</h2>
            <p className="mt-1 text-[14px] text-[#5B6472]">{t('dsx_tour_body')}</p>
          </div>
        </div>
        {tour?.making ? (
          <div className="mt-4 rounded-2xl bg-[#0C1119] p-4 text-white" role="status" aria-live="polite" data-testid="tour-making">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(38_92%_62%)]" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[15px] font-semibold">{t('dsx_tour_making')}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              <div className="h-full rounded-full bg-[hsl(38_92%_56%)] transition-[width] duration-700" style={{ width: `${Math.round(((tour.making.done + 0.35) / (tour.making.total + 0.35)) * 100)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-white/70">{t('dsx_tour_making_body')}</p>
              <button type="button" onClick={tour.onPlay} className={cn('h-11 rounded-full bg-[hsl(38_92%_56%)] px-4 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="tour-snake">{t('dsx_sn_play')}</button>
            </div>
          </div>
        ) : tour && tour.missing > 0 ? (
          <div className="mt-4" data-testid="tour-create-block">
            {tour.short ? <p className="mb-3 rounded-2xl bg-[hsl(38_92%_56%)]/12 px-4 py-3 text-[14px] text-[#0C1119]" role="alert" data-testid="tour-short">{t('dsx_tour_partial')}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={tour.onCreate} disabled={!tour.canCreate} className={DARK} data-testid="tour-create">
                <Box className="h-4 w-4" aria-hidden="true" />{t(photos.length ? 'dsx_tour_more' : 'dsx_tour_create', { n: String(tour.missing) })}
              </button>
              {photos.length ? (
                <button type="button" onClick={() => setInside(true)} className={CHIP} data-testid="photo3d-enter">
                  <Footprints className="h-4 w-4" aria-hidden="true" />{t('dsx_walk_open')}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#5B6472]">{t('dsx_tour_create_body')}</p>
          </div>
        ) : photos.length ? (
          <div className="mt-4" data-testid="photo3d-entry">
            <button type="button" onClick={() => setInside(true)} className={DARK} data-testid="photo3d-enter">
              <Footprints className="h-4 w-4" aria-hidden="true" />{t('dsx_walk_open')}
            </button>
          </div>
        ) : (
          // No room to stand in yet and none to make (a photo design whose rooms are not read yet): the rooms first.
          <div className="mt-4" data-testid="photo3d-rooms-needed">
            <p className="text-[14px] leading-relaxed text-[#0C1119]">{t('dsx_photo3d_rooms_needed')}</p>
            <button type="button" onClick={() => (document.getElementById('ds-rooms') ?? document.getElementById('ds-find-rooms-title'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn(DARK, 'mt-3')} data-testid="photo3d-rooms-cta">{t('dsx_photo3d_rooms_cta')}</button>
          </div>
        )}
        {inside && photos.length ? (
          <Suspense fallback={null}>
            <PhotoWalk photos={photos} initialId={photos[0].id} onClose={() => setInside(false)} />
          </Suspense>
        ) : null}
      </section>
    );
  }
  if (!loaded) return null;
  const current = walk?.progress && walk.progress !== 'FAILED' && walk.progress !== 'CANCELLED' ? PROGRESS_STEPS.indexOf(walk.progress) : -1;
  const earlier = history.filter((h) => h.id !== walk?.id && h.state === 'READY' && h.walkVersionId);

  return (
    <section className="mt-8 rounded-[22px] bg-white p-4 ring-1 ring-[#E7E1D8] sm:p-6" aria-labelledby="ds-walk-title" data-testid="walk-panel">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0C1119] text-white"><Box className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="ds-walk-title" className="font-display text-[20px] font-semibold">{t('dsx_walk_title')}</h2>
          <p className="mt-1 text-[14px] text-[#5B6472]">{t('dsx_walk_body')}</p>
        </div>
      </div>

      {problem ? <p role="alert" className="mt-3 rounded-2xl bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{problem}</p> : null}

      {!walk && reconstructing ? (
        <div className="mt-4" role="status" aria-live="polite" data-testid="walk-reconstructing">
          <ol className="space-y-2">
            <li className="flex items-center gap-2 text-[15px] font-semibold text-[#0C1119]" aria-current="step" data-testid="walk-step-space"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('dsx_walk_step_space')}</li>
            {PROGRESS_STEPS.filter((s) => s !== 'READY').map((s) => (
              <li key={s} className="flex items-center gap-2 text-[15px] text-[#9AA1AC]"><span className="inline-block h-4 w-4" aria-hidden="true" />{t(STEP_KEY[s])}</li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] text-[#5B6472]">{t('dsx_walk_leave_ok')}</p>
        </div>
      ) : !walk ? (
        <button type="button" onClick={() => { void start(false); }} disabled={asking} className={cn(DARK, 'mt-4')} data-testid="walk-create">
          {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('dsx_walk_create')}
        </button>
      ) : walk.state === 'READY' && walk.walkVersionId ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => navigate(walkthroughHref(projectId, walk.walkVersionId!))} className={DARK} data-testid="walk-open">{t('dsx_walk_open')}</button>
            <button type="button" onClick={() => { void start(true); }} disabled={asking} className={CHIP} data-testid="walk-again">{t('dsx_walk_again')}</button>
          </div>
          {walk.inferred ? (
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-[#5B6472]" data-testid="walk-inferred-note"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('dsx_walk_inferred_note')}</p>
          ) : null}
        </div>
      ) : walk.state === 'FAILED' || walk.state === 'CANCELLED' ? (
        <div className="mt-4" role="alert" data-testid="walk-failed">
          <p className="text-[15px] font-semibold">{t('dsx_walk_failed')}</p>
          <p className="mt-1 text-[14px] text-[#5B6472]">{t(walk.retryable ? 'dsx_walk_failed_retry' : 'dsx_walk_failed_final')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {walk.retryable ? (
              <button type="button" onClick={() => { void retry(); }} disabled={asking} className={DARK} data-testid="walk-retry"><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('dsx_walk_retry')}</button>
            ) : (
              <button type="button" onClick={() => { void start(true); }} disabled={asking} className={CHIP} data-testid="walk-again">{t('dsx_walk_again')}</button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4" role="status" aria-live="polite" data-testid="walk-working">
          <ol className="space-y-2">
            {PROGRESS_STEPS.filter((s) => s !== 'READY').map((s, i) => (
              <li key={s} className={cn('flex items-center gap-2 text-[15px]', i < current ? 'text-[#5B6472]' : i === current ? 'font-semibold text-[#0C1119]' : 'text-[#9AA1AC]')} data-testid={`walk-step-${s.toLowerCase()}`} aria-current={i === current ? 'step' : undefined}>
                {i < current ? <Check className="h-4 w-4" aria-hidden="true" /> : i === current ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="inline-block h-4 w-4" aria-hidden="true" />}
                {t(STEP_KEY[s])}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] text-[#5B6472]">{t('dsx_walk_leave_ok')}</p>
          <button type="button" onClick={() => setPlaying(true)} className={cn('mt-4 inline-flex h-11 items-center rounded-full bg-[hsl(38_92%_56%)] px-5 text-[14px] font-semibold text-[#0C1119]', RING)} data-testid="walk-snake-play">{t('dsx_sn_play')}</button>
        </div>
      )}

      {playing && walk ? (
        <Suspense fallback={null}>
          <SnakeGame
            status={walk.state === 'READY' ? 'READY' : walk.state === 'FAILED' || walk.state === 'CANCELLED' ? 'FAILED' : 'PROCESSING'}
            stageLabel={walk.progress && walk.progress !== 'FAILED' && walk.progress !== 'CANCELLED' ? t(STEP_KEY[walk.progress]) : t('dsx_walk_title')}
            onView={() => { setPlaying(false); if (walk.state === 'READY' && walk.walkVersionId) navigate(walkthroughHref(projectId, walk.walkVersionId)); }}
            onClose={() => setPlaying(false)} />
        </Suspense>
      ) : null}

      {earlier.length ? (
        <div className="mt-5 border-t border-[#EFEAE2] pt-4">
          <h3 className="text-[14px] font-semibold text-[#5B6472]">{t('dsx_walk_previous')}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {earlier.map((h) => (
              <li key={h.id}><button type="button" onClick={() => navigate(walkthroughHref(projectId, h.walkVersionId!))} className={CHIP} data-testid="walk-earlier">{t('dsx_walk_rev', { n: String(h.revision) })}</button></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
