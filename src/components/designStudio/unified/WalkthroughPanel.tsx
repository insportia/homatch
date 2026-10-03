// THE 3D WALKTHROUGH OF THIS DESIGN — Create → the real steps → Ready → Open.
//
// The server owns the work (design-studio-reconstruct/walkthrough.ts): the
// customer may close the page at any step and come back to it finished. The
// steps shown are the server's own states, never a percentage. Asking twice
// (a double click, a second tab) is the same walkthrough.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Check, Loader2, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { PROGRESS_STEPS, type ProgressStep } from '@/lib/designStudio/walkthrough/lifecycle';
import { createWalkthrough, retryWalkthrough, walkthroughHref, walkthroughStatus, type Walkthrough } from '@/services/designStudio/walkthrough';

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF]';
const DARK = cn('inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0C1119] px-5 text-[15px] font-semibold text-white disabled:opacity-60', RING);
const CHIP = cn('inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-[#0C1119] ring-1 ring-[#E1D9CC] hover:ring-[#0C1119] disabled:opacity-50', RING);
const STEP_KEY: Record<ProgressStep, string> = {
  PLANNING: 'dsx_walk_step_planning', BUILDING: 'dsx_walk_step_building', FINISHING: 'dsx_walk_step_finishing', READY: 'dsx_walk_step_ready',
};
const POLL_MS = 5000;
const working = (w: Walkthrough | null) => !!w && w.state !== 'READY' && w.state !== 'FAILED' && w.state !== 'CANCELLED';

export function WalkthroughPanel({ projectId, designVersionId, renderId }: { projectId: string; designVersionId: string; renderId: string | null }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [walk, setWalk] = useState<Walkthrough | null>(null);
  const [history, setHistory] = useState<Walkthrough[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const read = useCallback(async (id?: string) => {
    const r = await walkthroughStatus(id ? { walkthroughId: id } : { designVersionId });
    if (!alive.current) return;
    if (!r.error) { setWalk(r.walkthrough); setHistory(r.history); }
    setLoaded(true);
  }, [designVersionId]);
  useEffect(() => { setWalk(null); setHistory([]); setLoaded(false); void read(); }, [read]);

  // Following it while it works (the page is only a watcher; the server carries on without it).
  useEffect(() => {
    if (!working(walk)) return;
    const id = walk!.id;
    const timer = setInterval(() => { void read(id); }, POLL_MS);
    return () => clearInterval(timer);
  }, [walk?.id, walk?.state, read]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (newRevision = false) => {
    if (asking) return;
    setAsking(true); setProblem(null);
    const revision = newRevision ? (history[0]?.revision ?? walk?.revision ?? 0) + 1 : (walk?.revision ?? 1);
    const r = await createWalkthrough({ designVersionId, renderId, newRevision, name: t('dsx_walk_version_name', { n: String(revision) }) });
    if (!alive.current) return;
    setAsking(false);
    if (r.walkthrough) { setWalk(r.walkthrough); void read(r.walkthrough.id); } else setProblem(t('dsx_walk_unavailable'));
  };
  const retry = async () => {
    if (!walk || asking) return;
    setAsking(true); setProblem(null);
    const r = await retryWalkthrough(walk.id);
    if (!alive.current) return;
    setAsking(false);
    if (r.walkthrough) setWalk(r.walkthrough); else setProblem(t('dsx_walk_unavailable'));
  };

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

      {!walk ? (
        <button type="button" onClick={() => { void start(false); }} disabled={asking} className={cn(DARK, 'mt-4')} data-testid="walk-create">
          {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('dsx_walk_create')}
        </button>
      ) : walk.state === 'READY' && walk.walkVersionId ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => navigate(walkthroughHref(projectId, walk.walkVersionId!))} className={DARK} data-testid="walk-open">{t('dsx_walk_open')}</button>
          <button type="button" onClick={() => { void start(true); }} disabled={asking} className={CHIP} data-testid="walk-again">{t('dsx_walk_again')}</button>
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
        </div>
      )}

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
