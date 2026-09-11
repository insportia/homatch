// HOMATCH — the global job centre.
//
// One control, on every page, that answers "is anything still happening?".
//
// Before this, the answer lived on whichever page had started the work, so
// navigating away made a running verification indistinguishable from one that
// had never been started. The customer's only recourse was to start it again,
// which bought the same research twice.
//
// THE COUNTDOWN IS A RENDERING, NOT A TIMER
//
// The seconds tick locally so the number moves smoothly, but what they count
// down to is `cancelDeadlineAt` — a server timestamp. The button's existence
// is gated on `canCancel`, which the server recomputes on every read. So a
// clock-skewed browser can show a second too many and still not be able to
// cancel, because the refusal is in Postgres (§26). The two can disagree; only
// one of them decides.
//
// AND AFTERWARDS THE BUTTON GOES AWAY
//
// Not disabled with a tooltip nobody opens. Past the deadline Homatch has
// begun buying provider time, and the honest thing to show is that the work
// has started — not a control that looks available and refuses (§49).

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useJobs } from '@/contexts/JobsContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Ban, ExternalLink, AlertTriangle } from 'lucide-react';
import { cancelSecondsRemaining, isTerminal } from '@/jobs/jobState';
import { phaseFor } from '@/verify/progress';
import type { BackgroundJob } from '@/services/backgroundJobs';
import { toast } from 'sonner';

const PRODUCT_KEY: Record<string, string> = {
  VERIFY: 'job_product_verify',
  DOCUMENT_ANALYSIS: 'job_product_document',
  FIND_CLIENTS: 'job_product_find_clients',
  MARKET_RESEARCH: 'job_product_market',
  LOCATION_RESEARCH: 'job_product_location',
  CONTRACT_ANALYSIS: 'job_product_contract',
  AI_ENRICHMENT: 'job_product_enrichment',
  EMAIL_CAMPAIGN: 'job_product_email',
  AI_CALL: 'job_product_call',
};

const STATE_KEY: Record<string, string> = {
  QUEUED: 'job_state_queued',
  STARTING: 'job_state_starting',
  CANCELLABLE: 'job_state_cancellable',
  COMMITTED: 'job_state_committed',
  PROCESSING: 'job_state_processing',
  PARTIAL: 'job_state_partial',
  COMPLETED: 'job_state_completed',
  FAILED: 'job_state_failed',
  CANCELLED: 'job_state_cancelled',
};

/** Fails closed: an unrecognised product or stage reads as generic work
 *  rather than leaking an internal token to a paying customer. */
const productKey = (p: string) => PRODUCT_KEY[p] ?? 'job_product_generic';
const stateKey = (s: string) => STATE_KEY[s] ?? 'job_state_processing';

/**
 * THE STAGE LINE, AND WHY IT IS NOT `job.currentStage`.
 *
 * current_stage holds whatever the subject pipeline calls its own position:
 * EXTRACTING and ANALYZING for a document, MARKET and SYNTHESIS for a
 * verification, a matching step name for a search. Those are selector names,
 * and rendering one put the literal word "ANALYZING" in front of a customer
 * on the live job centre — the exact failure verify/phaseLabels was written
 * to prevent one screen over, reintroduced here because this component was
 * printing a different column.
 *
 * Each product's vocabulary is translated through its OWN map, and anything
 * unrecognised returns null so the row falls back to its state badge. A
 * vaguer line costs nothing; a leaked token costs the customer's confidence
 * in a report they paid for.
 */
const DOCUMENT_STAGE_KEY: Record<string, string> = {
  QUEUED: 'doc_status_queued',
  EXTRACTING: 'doc_status_extracting',
  ANALYZING: 'doc_status_analyzing',
  RUNNING: 'doc_status_extracting',
  DONE: 'doc_status_ready',
};

function stageKey(job: BackgroundJob): string | null {
  const stage = String(job.currentStage ?? '').trim();
  if (!stage) return null;
  if (job.productType === 'DOCUMENT_ANALYSIS' || job.productType === 'CONTRACT_ANALYSIS') {
    return DOCUMENT_STAGE_KEY[stage.toUpperCase()] ?? null;
  }
  if (job.productType === 'VERIFY') {
    // The customer-facing phase, resolved by the same module the Verify
    // progress bar uses, so one run cannot be described two ways.
    return `verify_pstep_${phaseFor(stage).toLowerCase()}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Countdown                                                           *
 * ------------------------------------------------------------------ */

const Countdown: React.FC<{ job: BackgroundJob; onCancel: () => void; busy: boolean }> = ({
  job, onCancel, busy,
}) => {
  const { t } = useLanguage();
  const [left, setLeft] = useState(() => cancelSecondsRemaining(job.cancelDeadlineAt));

  useEffect(() => {
    setLeft(cancelSecondsRemaining(job.cancelDeadlineAt));
    const id = setInterval(() => setLeft(cancelSecondsRemaining(job.cancelDeadlineAt)), 250);
    return () => clearInterval(id);
  }, [job.cancelDeadlineAt]);

  // The server's answer gates the control. `left` only decides the number
  // printed on it.
  if (!job.canCancel || left <= 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCancel}
      disabled={busy}
      className="w-full sm:w-auto gap-2"
    >
      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="break-words">{t('job_cancel_action')}</span>
      <span className="tabular-nums text-muted-foreground">{t('job_cancel_seconds').replace('{s}', String(left))}</span>
    </Button>
  );
};

/* ------------------------------------------------------------------ *
 * One row                                                             *
 * ------------------------------------------------------------------ */

const StateIcon: React.FC<{ state: string }> = ({ state }) => {
  if (state === 'COMPLETED') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  if (state === 'FAILED') return <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />;
  if (state === 'CANCELLED') return <Ban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
};

const JobRow: React.FC<{ job: BackgroundJob; onClose: () => void }> = ({ job, onClose }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { cancel } = useJobs();
  const [busy, setBusy] = useState(false);

  const done = isTerminal(job.state);

  const onCancel = async () => {
    setBusy(true);
    try {
      const outcome = await cancel(job.id);
      if (!outcome.ok && outcome.reason === 'COMMITTED') {
        // The expected answer after fifteen seconds, said plainly. Not an
        // error dialog — nothing went wrong.
        toast.info(t('job_cancel_too_late'));
      }
    } finally {
      setBusy(false);
    }
  };

  const openResult = () => {
    if (!job.resultRef) return;
    onClose();
    navigate(job.resultRef);
  };

  return (
    <li className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <StateIcon state={job.state} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-medium break-words">{t(productKey(job.productType))}</p>
            <Badge variant="outline" className="font-normal">{t(stateKey(job.state))}</Badge>
          </div>
          {/* A cadastral code or a filename. Long and unbreakable, so it wraps. */}
          {job.subjectLabel ? (
            <p className="text-sm text-muted-foreground break-words">{job.subjectLabel}</p>
          ) : null}
          {!done && stageKey(job) ? (
            <p className="text-sm text-muted-foreground break-words">{t(stageKey(job)!)}</p>
          ) : null}
          {job.userSafeError ? (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="min-w-0 break-words">{t(job.userSafeError)}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Progress, from work finished rather than from a timer (§48). */}
      {!done ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t(stateKey(job.state))}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${job.progress}%` }} />
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Countdown job={job} onCancel={onCancel} busy={busy} />
        {/* Once the window closes, this is what replaces the button. */}
        {!done && !job.canCancel ? (
          <p className="text-sm text-muted-foreground break-words">{t('job_started_no_cancel')}</p>
        ) : null}
        {job.resultRef && (job.state === 'COMPLETED' || job.state === 'PARTIAL') ? (
          <Button variant="ghost" size="sm" onClick={openResult} className="w-full sm:w-auto gap-2">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {t('job_open_result')}
          </Button>
        ) : null}
      </div>
    </li>
  );
};

/* ------------------------------------------------------------------ *
 * The drawer                                                          *
 * ------------------------------------------------------------------ */

export const JobCenter: React.FC = () => {
  const { t } = useLanguage();
  const { jobs, open, setOpen } = useJobs();

  const active = jobs.filter((j) => !isTerminal(j.state));
  const recent = jobs.filter((j) => isTerminal(j.state)).slice(0, 12);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Full width on a phone so a long filename has room to wrap. */}
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="break-words">{t('job_center_title')}</SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-medium break-words">{t('job_center_running')}</h3>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground break-words">{t('job_center_none_running')}</p>
            ) : (
              <ul className="space-y-3">
                {active.map((j) => <JobRow key={j.id} job={j} onClose={() => setOpen(false)} />)}
              </ul>
            )}
          </section>

          {recent.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-medium break-words">{t('job_center_recent')}</h3>
              <ul className="space-y-3">
                {recent.map((j) => <JobRow key={j.id} job={j} onClose={() => setOpen(false)} />)}
              </ul>
            </section>
          ) : null}

          <p className="text-sm text-muted-foreground leading-relaxed break-words">
            {t('job_center_note')}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
};
