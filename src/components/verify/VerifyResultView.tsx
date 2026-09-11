// HOMATCH — the screen a verification result is shown on, in every state it
// can be in.
//
// The old case page had two states: "generating" and "done". Everything else
// — queued, running, half-finished, failed, cancelled, unreadable — arrived
// as either an indefinite spinner or a crashed page. A customer who had paid
// for a check and come back to read it got a grey screen and a JavaScript
// message.
//
// So the states are explicit and each one has a screen (PART A §3). The two
// that matter most are the ones that did not exist before:
//
//   PARTIAL   the research is still running and there is ALREADY something
//             worth reading. Show it, say what is still coming, and keep
//             refreshing. Not a spinner over the top of real findings.
//
//   FAILED    say so in the customer's language, offer the re-run, and show
//             whatever the run DID produce — they paid for the stages that
//             completed and throwing those away helps nobody.
//
// The report itself is rendered by VerifyReport, unchanged: it is the same
// component the Verification Centre uses, so a report cannot look like two
// different things depending on which door you came in through. That was the
// original bug.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCw, AlertTriangle, Ban } from 'lucide-react';
import { SectionBoundary } from '@/components/common/SectionBoundary';
import {
  VerifyReport,
  type VerifySynthesis,
  type PropertySnapshot,
  type MarketBlock,
  type LocationBlock,
  type PersonBlock,
  type SelfCheck,
  type EvidenceRef,
  type BuyerIntelligence,
} from '@/components/verify/VerifyReport';
import { estimateProgress, phaseFor } from '@/verify/progress';
import type { NormalizedVerifyResult, NormalVerifyResult } from '@/verify/resultNormalizer';

/**
 * The one cast in the chain, and where it belongs.
 *
 * The normaliser guarantees at RUNTIME that every array exists and every
 * block is either complete or null; it describes the pass-through blocks
 * structurally because it is a pure module and must not import a component.
 * Naming the real types here — at the boundary where they are defined — is
 * what keeps that cast honest and local instead of spread through the page.
 */
export function toVerifySynthesis(r: NormalVerifyResult): VerifySynthesis {
  return {
    report: r.report as unknown as BuyerIntelligence | null,
    evidence: r.evidence as unknown as EvidenceRef[],
    snapshot: (r.snapshot ?? undefined) as PropertySnapshot | undefined,
    market: r.market as unknown as MarketBlock | null,
    location: r.location as unknown as LocationBlock | null,
    people: (r.people ?? undefined) as { people?: PersonBlock[]; representationNote?: string } | undefined,
    selfChecks: r.selfChecks as unknown as SelfCheck[],
    mode: r.mode,
    empty: r.empty,
  };
}

/* ------------------------------------------------------------------ *
 * Progress                                                            *
 * ------------------------------------------------------------------ */

/**
 * Truthful progress, borrowed rather than reinvented.
 *
 * verify/progress.ts already reconstructs the number from the server's own
 * `created_at` and `stage` on every render — nothing is stored client-side,
 * so the same run reads the same percentage in any tab after any refresh, and
 * a stopped run stops moving. That is exactly what PART C §48 asks for, and
 * writing a second progress model beside it would have produced two numbers
 * for one job.
 *
 * The label is the customer-facing PHASE, never research-agent's internal
 * stage token.
 */
const StageProgress: React.FC<{
  stage: string | null;
  status?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  reportReady?: boolean;
}> = ({ stage, status, createdAt, completedAt, reportReady }) => {
  const { t } = useLanguage();
  const pct = estimateProgress({ status, stage, createdAt, completedAt, reportReady });
  const label = t(`verify_pstep_${phaseFor(stage).toLowerCase()}`);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm leading-relaxed break-words min-w-0">{label}</p>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * The view                                                            *
 * ------------------------------------------------------------------ */

export interface VerifyResultViewProps {
  /** Already canonicalised. This component never sees a raw payload. */
  normalized: NormalizedVerifyResult | null;
  /** True only before the first read lands. Afterwards `normalized.state` is
   *  the authority, so a background refresh never blanks a visible report. */
  initialLoading?: boolean;
  stage?: string | null;
  /** research_jobs facts, so progress is reconstructed rather than remembered. */
  status?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  subjectId?: string | null;
  /** Re-run the research. Absent where the caller cannot start one. */
  onRetry?: () => void;
  retryBusy?: boolean;
  /** The full research detail, behind the report's own disclosure. */
  evidence?: React.ReactNode;
  onUploadContract?: () => void;
}

export const VerifyResultView: React.FC<VerifyResultViewProps> = ({
  normalized,
  initialLoading,
  stage = null,
  status = null,
  createdAt = null,
  completedAt = null,
  subjectId = null,
  onRetry,
  retryBusy,
  evidence,
  onUploadContract,
}) => {
  const { t } = useLanguage();

  if (initialLoading || !normalized) {
    return (
      <Card>
        <CardContent className="pt-6">
          <StageProgress stage={stage} status={status} createdAt={createdAt} completedAt={completedAt} />
        </CardContent>
      </Card>
    );
  }

  const { state, result, errorKey } = normalized;
  const hasReport = !!result.report;

  /* Nothing readable yet, and nothing wrong. */
  if ((state === 'QUEUED' || state === 'STARTING' || state === 'CANCELLABLE' ||
       state === 'COMMITTED' || state === 'PROCESSING') && !hasReport) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <StageProgress stage={stage} status={status} createdAt={createdAt} completedAt={completedAt} />
          <p className="text-sm text-muted-foreground leading-relaxed break-words">
            {t('verify_result_keeps_running')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === 'CANCELLED') {
    return (
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-2.5">
            <Ban className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm leading-relaxed break-words min-w-0">{t('verify_result_cancelled')}</p>
          </div>
          {onRetry ? (
            <Button variant="outline" onClick={onRetry} disabled={retryBusy} className="w-full sm:w-auto gap-2">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t('verify_result_retry')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Still working, but there is already something to read. */}
      {state === 'PARTIAL' ? (
        <Card className="border-dashed">
          <CardContent className="pt-5 space-y-3">
            <StageProgress stage={stage} status={status} createdAt={createdAt} completedAt={completedAt} />
            <p className="text-sm text-muted-foreground leading-relaxed break-words">
              {t('verify_result_partial_hint')}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Something went wrong, said once, in the customer's language. The
          raw reason is in the log and nowhere near this element. */}
      {errorKey ? (
        <Card className="border-amber-300/70 dark:border-amber-800">
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium break-words">{t(errorKey)}</p>
                {hasReport ? (
                  <p className="text-sm text-muted-foreground leading-relaxed break-words">
                    {t('verify_result_partial_kept')}
                  </p>
                ) : null}
              </div>
            </div>
            {onRetry ? (
              <Button variant="outline" onClick={onRetry} disabled={retryBusy} className="w-full sm:w-auto gap-2">
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                {t('verify_result_retry')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* The report. Contained, so a block that disagrees with its data
          costs the customer that block and nothing else. */}
      {hasReport || result.empty ? (
        <SectionBoundary
          name="VerifyReport"
          context={{ subjectType: 'RESEARCH_JOB', subjectId, payloadVersion: normalized.payloadVersion }}
        >
          <VerifyReport
            synthesis={toVerifySynthesis(result)}
            evidence={evidence}
            onUploadContract={onUploadContract}
          />
        </SectionBoundary>
      ) : null}

      {/* v1 reports carried this and nothing since has. Coverage, stated as
          coverage: a source we could not reach says nothing about the
          property, and colouring it as a risk is how a technical failure
          starts reading as a defect. */}
      {result.incompleteSources.length > 0 ? (
        <SectionBoundary name="VerifyIncompleteSources" context={{ subjectType: 'RESEARCH_JOB', subjectId }}>
          <Card>
            <CardContent className="pt-5 space-y-2">
              <h3 className="text-sm font-medium break-words">{t('verify_report_incomplete')}</h3>
              <p className="text-sm text-muted-foreground break-words">
                {result.incompleteSources.join(' · ')}
              </p>
              <p className="text-sm text-muted-foreground/90 leading-relaxed break-words">
                {t('verify_report_incomplete_note')}
              </p>
            </CardContent>
          </Card>
        </SectionBoundary>
      ) : null}
    </div>
  );
};
