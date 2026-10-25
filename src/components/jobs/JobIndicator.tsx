// HOMATCH — "2 tasks running", on every page (§33).
//
// The compact half of the job centre: a persistent control that appears the
// moment something is running and disappears when nothing is. It is what
// turns "I started a verification and then went to look at my documents" from
// a leap of faith into a visible fact.
//
// It is a floating control rather than a nav item because the navigation
// differs between the marketing shell, the app shell and the admin shell, and
// a status that is only present in one of them is a status a customer learns
// not to trust. Bottom-anchored and clear of the mobile tab bar.
//
// It also owns completion notifications (§34), because they belong to the
// same state and must appear wherever the customer happens to be standing.

import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useJobs } from '@/contexts/JobsContext';
import { JobCenter } from './JobCenter';
import { AlertTriangle, CheckCircle2, FileText, Loader2, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { isTerminal } from '@/jobs/jobState';
import { resolveJobDestination } from '@/jobs/destination';
import { claimAnnouncement, jobAnnouncementKeys } from '@/lib/notifications/announced';
import { pushPermission, subscribeToPush } from '@/lib/push';
import { ToastCard } from '@/components/notifications/ToastCard';
import type { BackgroundJob } from '@/services/backgroundJobs';

/* The one line under the title: what is waiting for the person. */
const RESULT_LINE: Record<string, string> = {
  VERIFY: 'jobdone_verify_body',
  DOCUMENT_ANALYSIS: 'jobdone_document_body',
  CONTRACT_ANALYSIS: 'jobdone_document_body',
  FIND_CLIENTS: 'jobdone_search_body',
};

const PRODUCT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  VERIFY: ShieldCheck,
  DOCUMENT_ANALYSIS: FileText,
  CONTRACT_ANALYSIS: FileText,
  FIND_CLIENTS: Users,
};

/**
 * Offer phone notifications inside the card, only while this device has never
 * been asked (or saw the soft offer and did not answer): the moment a task
 * finishes is the moment "tell me next time" makes sense. Never after "not now",
 * never after a browser refusal, never when already on.
 */
function PushOffer({ t, onDone }: { t: (k: string) => string; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{t('jobdone_push_offer')}</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await subscribeToPush();
          setBusy(false);
          onDone();
          if (r.ok) toast.success(t('jobdone_push_enabled'));
          else if (r.reason === 'denied') toast.info(t('notif_push_denied'));
          else if (r.reason === 'no-key') toast.info(t('notif_push_unavailable'));
        }}
        className="inline-flex min-h-9 items-center rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3 text-xs font-semibold text-[hsl(var(--gold-ink))] transition-colors hover:bg-[hsl(var(--gold-soft))]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-60"
      >
        {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        {t('jobdone_push_enable')}
      </button>
    </div>
  );
}

function offerPush(): boolean {
  const p = pushPermission();
  return p === 'NOT_ASKED' || p === 'SOFT_PROMPT_SHOWN';
}

const COMPLETION_KEY: Record<string, string> = {
  VERIFY: 'job_done_verify',
  DOCUMENT_ANALYSIS: 'job_done_document',
  FIND_CLIENTS: 'job_done_find_clients',
  MARKET_RESEARCH: 'job_done_generic',
  LOCATION_RESEARCH: 'job_done_generic',
  CONTRACT_ANALYSIS: 'job_done_document',
  AI_ENRICHMENT: 'job_done_generic',
  EMAIL_CAMPAIGN: 'job_done_generic',
  AI_CALL: 'job_done_generic',
};

export const JobIndicator: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { jobs, completions, dismissCompletion, setOpen } = useJobs();
  const location = useLocation();

  /*
   * A JOB THE CUSTOMER IS ALREADY WATCHING NEEDS NO FLOATING BADGE.
   *
   * Every job carries a resultRef -- the screen its result lives on, e.g.
   * `/verify?job=<id>`. Standing on that screen, the page itself is the
   * status: Verify draws a live progress bar, a stage and a percentage. The
   * pill then adds nothing and costs a great deal, because it is fixed to the
   * bottom-right where the AI assistant button already sits. Measured on a
   * real 320-430px Chrome it overlapped that button at every width, and sat
   * across the content above the tab bar.
   *
   * Matching on the resultRef's PATHNAME rather than a hardcoded route keeps
   * this true for every product that gains a result screen later, and keeps
   * the indicator's real job intact: anything running somewhere else is still
   * announced, which is the whole reason it exists.
   */
  const presentedHere = (job: { resultRef?: string | null }): boolean => {
    if (!job.resultRef) return false;
    try {
      // A relative ref needs a base; the origin is irrelevant to the compare.
      return new URL(job.resultRef, window.location.origin).pathname === location.pathname;
    } catch {
      return false;
    }
  };

  const active = jobs.filter((j) => !isTerminal(j.state) && !presentedHere(j));

  /*
   * COMPLETION NOTIFICATIONS.
   *
   * Raised here rather than in the provider so the provider stays free of
   * text, and announced exactly once: `announced` remembers what has already
   * been shown, because the completion list survives re-renders and a toast
   * per render would be unusable.
   *
   * Clicking opens the result directly (§34/§35) — the job carries a stable
   * resultRef, so this and the job centre land on the same screen.
   */
  const announced = useRef<Set<string>>(new Set());

  /*
   * THE CARD (owner, 2026-10-25: "no nice popup when a job finishes").
   *
   * It was sonner's default one-liner. Now it is the shared premium card: a
   * mark for the product, a real title, what it is about, one line of what is
   * waiting, and one Open button through the SAME resolver the drawer uses.
   * That resolver matters: this toast once navigated to `job.resultRef`
   * directly, so the two surfaces could disagree about where one task goes
   * and both could follow a stored path that is not a route (destination.ts).
   */
  const showCompletion = (job: BackgroundJob) => {
    const failed = job.state === 'FAILED';
    const destination = resolveJobDestination(job);
    const withOffer = !failed && offerPush();
    toast.custom((id) => (
      <ToastCard
        icon={failed ? AlertTriangle : PRODUCT_ICON[job.productType] ?? CheckCircle2}
        tone={failed ? 'alert' : 'accent'}
        title={failed
          ? t(job.userSafeError ?? 'job_failed_generic')
          : t(COMPLETION_KEY[job.productType] ?? 'job_done_generic')}
        subject={job.subjectLabel}
        body={failed ? t('jobdone_failed_body') : t(RESULT_LINE[job.productType] ?? 'jobdone_generic_body')}
        actionLabel={destination ? t(destination.labelKey) : null}
        onOpen={destination ? () => { toast.dismiss(id); navigate(destination.to); } : undefined}
        onDismiss={() => toast.dismiss(id)}
        dismissLabel={t('notif_dismiss')}
        footer={withOffer ? <PushOffer t={t} onDone={() => toast.dismiss(id)} /> : null}
      />
    ), {
      /* Long enough to read and act on; a failure stays a little longer. */
      duration: failed ? 12000 : withOffer ? 14000 : 9000,
      id: `job-${job.id}`,
    });
  };

  useEffect(() => {
    for (const c of completions) {
      if (announced.current.has(c.job.id)) continue;
      announced.current.add(c.job.id);

      const job = c.job;
      // A cancellation is the customer's own doing. Telling them about it is
      // noise, not news.
      if (job.state === 'CANCELLED') {
        dismissCompletion(job.id);
        continue;
      }

      /*
       * THE FALSE-EARLY "COMPLETED".
       *
       * background_jobs goes terminal when the PIPELINE finishes. The report
       * the customer actually reads is a separate fetch the result screen
       * makes, and that takes a second or three longer. Announcing here meant
       * the customer was told "Verification complete" while the page in front
       * of them was still finalising -- the backend's truth, delivered as if
       * it were the customer's.
       *
       * On the job's own result screen the announcement is redundant anyway:
       * the page shows the state, and src/verify/completion.ts decides when
       * that state is COMPLETE. So it is dismissed rather than raised, and
       * every job finishing ANYWHERE ELSE is announced exactly as before.
       */
      if (presentedHere(job)) {
        dismissCompletion(job.id);
        continue;
      }

      /* The live notification for this same task may have arrived first
         (lib/notifications/announced.ts): one card per finished thing. */
      if (!claimAnnouncement(jobAnnouncementKeys(job))) {
        dismissCompletion(job.id);
        continue;
      }

      showCompletion(job);
      dismissCompletion(job.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completions, dismissCompletion, navigate, t, location.pathname]);

  return (
    <>
      {active.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          /*
           * PHONE: A 44px BADGE IN THE ASSISTANT'S COLUMN, NEVER A PILL ACROSS
           * THE CONTENT. The wide pill sat over cards and text on every phone.
           * Below md it is a round spinner with the running count, just above
           * the bottom nav (its 3.75rem + safe-area + 0.75rem), at the screen
           * edge. The full sentence stays as the accessible name. (The floating
           * assistant button it used to sit on was removed on 2026-10-24.)
           * DESKTOP (md+): the compact pill in the corner.
           */
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] end-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/95 shadow-lg backdrop-blur transition-colors hover:bg-accent md:bottom-6 md:end-6 md:h-auto md:w-auto md:max-w-[calc(100vw-3rem)] md:gap-2 md:px-4 md:py-2.5"
          aria-label={active.length === 1
            ? t('job_indicator_one')
            : t('job_indicator_many').replace('{n}', String(active.length))}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-2xs font-bold tabular-nums text-primary-foreground md:hidden" aria-hidden="true">
            {active.length}
          </span>
          <span className="hidden truncate text-sm font-medium md:inline" aria-hidden="true">
            {active.length === 1
              ? t('job_indicator_one')
              : t('job_indicator_many').replace('{n}', String(active.length))}
          </span>
        </button>
      ) : null}
      <JobCenter />
    </>
  );
};
