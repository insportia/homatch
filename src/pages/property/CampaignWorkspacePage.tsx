// THE EXTERNAL MATCHING CAMPAIGN WORKSPACE — /property/:id/campaigns/:jobId
//
// Configure → Start → THIS PAGE → results. A run gets its own address the
// moment match-campaign returns its job id, so a refresh, Back/Forward or a
// shared tab lands on the same campaign. Everything on it is read from the
// server (find_buyers_my_campaign): the progress view while it runs, a
// completion that moves on to results by itself, and an honest outcome when it
// ends any other way. ?view=results is the results tab, so it is linkable too.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, History, Pencil, PlayCircle, SearchX, Sparkles, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, PageHero } from '@/components/customer/surface';
import { FRAMED_ACTION, GOLD_TEXT, NAVY_BAND, PRIMARY_ACTION } from '@/components/findBuyers/brand';
import { CampaignProgressPanel } from '@/components/campaignWorkspace/CampaignProgressPanel';
import { RunResults } from '@/components/campaignWorkspace/RunResults';
import { MessageAssistDialog } from '@/components/communication/MessageAssistDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCampaignRun } from '@/hooks/useCampaignRun';
import { type Outcome, campaignOutcome } from '@/findBuyers/campaignView';
import { counterpartFor } from '@/matching/presentation';
import { controlMatchingJob, pauseMatchingCampaign } from '@/services/api';
import { readProperty } from '@/services/propertyManagement';
import type { LibraryContact } from '@/services/contactLibrary';
import type { Property } from '@/types/types';

const AUTO_ADVANCE_S = 4;

function OutcomeCard({ outcome, results, propertyId, onResults, autoIn, onCancelAuto }: {
  outcome: Outcome;
  results: number;
  propertyId: string;
  onResults: () => void;
  autoIn: number | null;
  onCancelAuto: () => void;
}) {
  const { t } = useLanguage();
  if (outcome === 'running' || outcome === 'paused') return null;
  const success = outcome === 'results' || outcome === 'partial';
  const Icon = success ? Sparkles : outcome === 'empty' ? SearchX : AlertTriangle;
  const titleKey = {
    results: 'cw_done_title', partial: 'cw_partial_title', empty: 'cw_empty_title',
    failed: 'cw_failed_title', cancelled: 'cw_cancelled_title',
  }[outcome];
  const bodyKey = {
    results: 'cw_done_body', partial: 'cw_partial_body', empty: 'cw_empty_body',
    failed: 'cw_failed_body', cancelled: 'cw_cancelled_body',
  }[outcome];
  return (
    <section role="status" aria-live="polite"
      className={cn('overflow-hidden rounded-3xl bg-white ring-1 ring-inset shadow-[0_20px_48px_-30px_hsl(218_60%_15%/0.6)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500',
        success ? 'ring-[hsl(40_80%_70%)]' : 'ring-[hsl(40_70%_84%)]')}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <span className={cn('grid h-14 w-14 shrink-0 place-items-center rounded-2xl', success ? cn(NAVY_BAND, GOLD_TEXT) : 'bg-[hsl(42_100%_95%)] text-[hsl(34_90%_34%)]')}>
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-display text-lg font-semibold text-[hsl(218_45%_14%)] break-words">{t(titleKey, { n: String(results) })}</h2>
          <p className="text-sm leading-relaxed text-[hsl(218_28%_38%)] break-words">{t(bodyKey, { n: String(results) })}</p>
          {autoIn != null && (
            <p className="text-2xs text-[hsl(218_28%_38%)]">
              {t('cw_auto_advance', { s: String(autoIn) })}{' '}
              <button type="button" onClick={onCancelAuto} className="font-semibold underline underline-offset-4">{t('cw_stay_here')}</button>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-[hsl(40_70%_90%)] bg-[hsl(42_100%_98%)] px-5 py-3.5 sm:px-6">
        {success && (
          <button type="button" onClick={onResults} className={cn(PRIMARY_ACTION, 'text-sm')}>
            <Users className="h-4 w-4" aria-hidden="true" />{t('cw_view_matches', { n: String(results) })}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        )}
        {!success && (
          <Link to={`/property/${propertyId}/edit`} className={cn(FRAMED_ACTION, 'text-sm')}>
            <Pencil className="h-4 w-4" aria-hidden="true" />{t('cw_adjust_details')}
          </Link>
        )}
        <Link to={`/property/${propertyId}/matches?launch=1`} className={cn(success ? FRAMED_ACTION : PRIMARY_ACTION, 'text-sm')}>
          <PlayCircle className="h-4 w-4" aria-hidden="true" />{t('cw_start_another')}
        </Link>
        <Link to={`/property/${propertyId}/campaigns`} className={cn(FRAMED_ACTION, 'text-sm')}>
          <History className="h-4 w-4" aria-hidden="true" />{t('cw_history')}
        </Link>
      </div>
    </section>
  );
}

function WorkspaceContent() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const { id: propertyId, jobId } = useParams<{ id: string; jobId: string }>();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'results' ? 'results' : 'progress';
  const { run, loaded, missing, refresh } = useCampaignRun(jobId);
  const [property, setProperty] = useState<Property | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'pause' | 'stop' | null>(null);
  const [autoIn, setAutoIn] = useState<number | null>(null);
  const [messageTo, setMessageTo] = useState<LibraryContact[] | null>(null);
  const prevOutcome = useRef<Outcome | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    readProperty(propertyId).then(setProperty).catch(() => setProperty(null));
  }, [propertyId]);

  const c = run?.status.campaign ?? null;
  const outcome = c ? campaignOutcome(c.state, c.newResults) : null;
  const setView = useCallback((next: 'progress' | 'results', replace = false) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'results') p.set('view', 'results'); else p.delete('view');
      return p;
    }, { replace });
  }, [setParams]);

  /*
   * MOVING ON TO RESULTS. A run that finishes WHILE it is being watched gets a
   * short, cancellable countdown. A run that had already finished when the page
   * opened (a bookmark, a notification link) goes straight to its results, unless
   * the address asked for the progress view explicitly.
   */
  useEffect(() => {
    if (!outcome) return;
    const before = prevOutcome.current;
    prevOutcome.current = outcome;
    const hasResults = outcome === 'results' || outcome === 'partial';
    if (before === null && hasResults && !params.has('view') && !params.has('progress')) { setView('results', true); return; }
    if ((before === 'running' || before === 'paused') && hasResults && view === 'progress') setAutoIn(AUTO_ADVANCE_S);
  }, [outcome, params, setView, view]);

  useEffect(() => {
    if (autoIn == null) return undefined;
    if (autoIn <= 0) { setAutoIn(null); setView('results'); return undefined; }
    const id = window.setTimeout(() => setAutoIn((s) => (s == null ? null : s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [autoIn, setView]);

  if (!propertyId || !jobId) return <Navigate to="/property" replace />;
  /* A run belongs to one property; a mistyped property in the address is corrected, not trusted. */
  if (run && run.propertyId !== propertyId) return <Navigate to={`/property/${run.propertyId}/campaigns/${jobId}${window.location.search}`} replace />;

  const counterpartWord = counterpartFor(property?.transaction_type);
  const counterpart = counterpartWord === 'TENANT' ? 'TENANT' : counterpartWord === 'BUYER' ? 'BUYER' : null;
  const propertyLabel = property?.title || null;

  const act = async (action: 'pause' | 'resume' | 'stop') => {
    if (!homatchUser || !c) return;
    setBusy(true);
    try {
      if (action === 'pause') await pauseMatchingCampaign(propertyId, homatchUser.id, c.jobId);
      else await controlMatchingJob(propertyId, c.jobId, action);
      if (action !== 'pause') toast.success(t(action === 'resume' ? 'p2d_resumed_toast' : 'p2d_stopping_toast'));
    } catch {
      toast.error(t(action === 'pause' ? 'matches_pause_error' : 'p2d_control_error'));
    } finally {
      setConfirm(null);
      await refresh();
      setBusy(false);
    }
  };

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="space-y-5 pb-28">
        <nav className="flex flex-wrap items-center gap-2 pt-4 text-2xs font-semibold" aria-label={t('cw_breadcrumb')}>
          <Link to={`/property/${propertyId}/campaigns`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_95%)]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('cw_history')}
          </Link>
          <span aria-hidden="true" className="text-[hsl(218_28%_60%)]">/</span>
          <Link to={`/property/${propertyId}/matches`} className="inline-flex min-h-9 min-w-0 items-center rounded-lg px-2 text-[hsl(218_28%_38%)] hover:bg-[hsl(42_100%_95%)]">
            <span className="truncate">{t('cw_all_matches')}</span>
          </Link>
        </nav>

        <PageHero compact eyebrow={propertyLabel} title={t('cw_title')}
          subtitle={c ? t('cw_started_on', { date: new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }) : null} />

        {!loaded ? (
          <div className="h-72 animate-pulse rounded-3xl bg-[hsl(218_52%_11%/0.85)]" aria-busy="true" />
        ) : missing || !run || !c ? (
          <section className="rounded-3xl bg-white p-6 text-center ring-1 ring-inset ring-[hsl(40_70%_84%)]">
            <SearchX className="mx-auto h-8 w-8 text-[hsl(34_90%_40%)]" aria-hidden="true" />
            <h2 className="mt-2 font-display text-lg font-semibold text-[hsl(218_45%_14%)]">{t('cw_not_found_title')}</h2>
            <p className="mt-1 text-sm text-[hsl(218_28%_38%)]">{t('cw_not_found_body')}</p>
            <button type="button" onClick={() => navigate(`/property/${propertyId}/campaigns`)} className={cn(FRAMED_ACTION, 'mx-auto mt-4 text-sm')}>{t('cw_history')}</button>
          </section>
        ) : (
          <>
            <div role="tablist" aria-label={t('cw_tabs_label')} className="grid max-w-md grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-inset ring-[hsl(40_70%_82%)]">
              {(['progress', 'results'] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { setAutoIn(null); setView(v); }}
                  className={cn('flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                    view === v ? cn(NAVY_BAND, GOLD_TEXT) : 'text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_97%)]')}>
                  <span className="truncate">{t(v === 'progress' ? 'cw_tab_progress' : 'cw_tab_results')}</span>
                  {v === 'results' && c.newResults > 0 && (
                    <span className="rounded-full bg-[hsl(40_94%_64%)] px-2 text-2xs font-bold tabular-nums text-[hsl(218_52%_11%)]">{c.newResults}</span>
                  )}
                </button>
              ))}
            </div>

            {view === 'progress' ? (
              <div className="space-y-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
                <CampaignProgressPanel status={run.status} counterpart={counterpart} busy={busy}
                  onPause={() => setConfirm('pause')} onResume={() => void act('resume')} onStop={() => setConfirm('stop')} />
                {outcome && (
                  <OutcomeCard outcome={outcome} results={c.newResults} propertyId={propertyId}
                    onResults={() => { setAutoIn(null); setView('results'); }}
                    autoIn={autoIn} onCancelAuto={() => setAutoIn(null)} />
                )}
              </div>
            ) : (
              <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
                <RunResults jobId={jobId} propertyId={propertyId} propertyTitle={propertyLabel} counterpart={counterpart}
                  refreshSignal={c.newResults} onPrepareMessage={setMessageTo} />
              </div>
            )}
          </>
        )}
      </CustomerSurface>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirm === 'stop' ? 'cw_stop_confirm' : 'matches_pause_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t(confirm === 'stop' ? 'cw_stop_confirm_desc' : 'fbl_pause_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('general_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act(confirm === 'stop' ? 'stop' : 'pause')}
              className="bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] hover:bg-[hsl(218_52%_16%)]">
              {t(confirm === 'stop' ? 'fbl_stop' : 'fbl_pause')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {messageTo && (
        <MessageAssistDialog open recipients={messageTo} propertyId={propertyId} onClose={() => setMessageTo(null)} />
      )}
    </AppLayout>
  );
}

export default function CampaignWorkspacePage() {
  return (
    <RouteGuard>
      <WorkspaceContent />
    </RouteGuard>
  );
}
