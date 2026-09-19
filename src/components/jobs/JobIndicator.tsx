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
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { isTerminal } from '@/jobs/jobState';
import { resolveJobDestination } from '@/jobs/destination';

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

      const label = job.subjectLabel ?? '';
      /*
       * The SAME resolver the drawer uses.
       *
       * This toast used to navigate to `job.resultRef` directly with its own
       * hardcoded 'Open result' label, so the two surfaces could disagree
       * about where one task goes — and both followed a stored path that
       * might not be a registered route (see jobs/destination.ts).
       */
      const destination = resolveJobDestination(job);
      const action = destination
        ? { label: t(destination.labelKey), onClick: () => navigate(destination.to) }
        : undefined;

      if (job.state === 'FAILED') {
        toast.error(t(job.userSafeError ?? 'job_failed_generic'), {
          description: label || undefined,
          action,
        });
      } else {
        toast.success(t(COMPLETION_KEY[job.productType] ?? 'job_done_generic'), {
          description: label || undefined,
          action,
        });
      }
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
           * STACKED ABOVE THE ASSISTANT BUTTON, NOT ON TOP OF IT.
           *
           * AIFloatingButton sits at `bottom-20 md:bottom-6` on the same
           * corner. This used to sit at `bottom-24 sm:bottom-6`, so the two
           * overlapped on every phone width -- and the breakpoints disagreed
           * as well (sm vs md), giving a second, different overlap between
           * 640 and 768px. These clear it at both sizes and follow the same
           * breakpoint, so the two controls stack instead of colliding.
           */
          className="fixed bottom-32 md:bottom-24 end-4 z-40 max-w-[calc(100vw-2rem)] inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur transition-colors hover:bg-accent"
          aria-label={t('job_center_title')}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium truncate">
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
