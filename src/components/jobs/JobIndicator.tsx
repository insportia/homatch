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
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useJobs } from '@/contexts/JobsContext';
import { JobCenter } from './JobCenter';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { isTerminal } from '@/jobs/jobState';

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

  const active = jobs.filter((j) => !isTerminal(j.state));

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

      const label = job.subjectLabel ?? '';
      if (job.state === 'FAILED') {
        toast.error(t(job.userSafeError ?? 'job_failed_generic'), {
          description: label || undefined,
          action: job.resultRef
            ? { label: t('job_open_result'), onClick: () => navigate(job.resultRef as string) }
            : undefined,
        });
      } else {
        toast.success(t(COMPLETION_KEY[job.productType] ?? 'job_done_generic'), {
          description: label || undefined,
          action: job.resultRef
            ? { label: t('job_open_result'), onClick: () => navigate(job.resultRef as string) }
            : undefined,
        });
      }
      dismissCompletion(job.id);
    }
  }, [completions, dismissCompletion, navigate, t]);

  return (
    <>
      {active.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // bottom-24 clears the mobile tab bar; inset-x gives a long label
          // room to sit without ever reaching the edge of a 320px screen.
          className="fixed bottom-24 sm:bottom-6 end-4 z-40 max-w-[calc(100vw-2rem)] inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur transition-colors hover:bg-accent"
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
