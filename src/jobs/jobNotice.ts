// HOMATCH — what a finished background job tells its owner.
//
// One pure decision, shared by the edge dispatcher (supabase/functions/
// _shared/jobNotify.ts, which imports this file) and by the tests, so "which
// finished jobs earn a notification, and where does it open" has one answer.
//
// THE OUTCOMES
//
//   VERIFY_DONE           a verification report is ready
//   DOCUMENT_DONE         a contract or document analysis is ready
//   SEARCH_DONE           a Find Buyers / Find Tenants search has finished
//   DOCUMENT_UNREADABLE   a scan with no text, or a format we cannot read:
//                         an expected outcome with something to do, so an
//                         in-app notice and no "something went wrong" email
//   FAILED                a task the person started could not complete
//   SKIP                  nothing to say (with the reason recorded)
//
// WHAT IS DELIBERATELY SKIPPED
//
//   A refusal for payment (doc_error_billing) is an action the person can
//   take on the page that asked, not a failure of ours.
//   Outreach campaigns (email, WhatsApp, calls, AI TALK) already announce
//   their own completion as CAMPAIGN_COMPLETED from the campaign workers, with
//   numbers this registry does not hold; a second notice would be a duplicate.
//   Products that have no job producer today (market and location research,
//   enrichment) are skipped rather than told something generic: a notice that
//   cannot name what finished is noise.

import { resolveJobDestination } from './destination.ts';
import type { JobState } from './jobState.ts';

export type JobNoticeKind =
  | 'VERIFY_DONE' | 'DOCUMENT_DONE' | 'SEARCH_DONE' | 'DOCUMENT_UNREADABLE' | 'FAILED' | 'SKIP';

export interface FinishedJob {
  jobId: string;
  productType: string;
  subjectType: string | null;
  subjectId: string | null;
  state: string;
  resultRef: string | null;
  userSafeError: string | null;
}

export interface JobNotice {
  kind: JobNoticeKind;
  /** An in-app path (single leading slash) or null for SKIP. */
  deepLink: string | null;
  /** Why nothing is sent, for the outbox record. */
  reason?: string;
}

/** Campaign products whose own workers already announce completion. */
const PRODUCER_OWNS_COMPLETION = new Set(['EMAIL_CAMPAIGN', 'WHATSAPP_CAMPAIGN', 'AI_CALL', 'AI_TALK']);

const UNREADABLE = new Set(['doc_error_requires_ocr', 'doc_error_unsupported']);

/** The deep link a finished job opens: the same resolver the job centre uses. */
export function jobDeepLink(job: FinishedJob): string {
  const destination = resolveJobDestination({
    productType: job.productType,
    subjectType: job.subjectType,
    subjectId: job.subjectId,
    state: job.state as JobState,
    resultRef: job.resultRef,
  });
  const to = destination?.to ?? '/activity';
  /* The notifications column accepts a plain path only (no '#', no spaces). */
  return /^\/(?!\/)[A-Za-z0-9/_%\-?=&.]*$/.test(to) ? to : '/activity';
}

export function jobNoticeFor(job: FinishedJob): JobNotice {
  if (job.state === 'FAILED') {
    if (job.userSafeError === 'doc_error_billing') return { kind: 'SKIP', deepLink: null, reason: 'BILLING_REFUSAL' };
    if (job.userSafeError && UNREADABLE.has(job.userSafeError)) {
      return { kind: 'DOCUMENT_UNREADABLE', deepLink: jobDeepLink(job) };
    }
    return { kind: 'FAILED', deepLink: jobDeepLink(job) };
  }
  if (job.state !== 'COMPLETED') return { kind: 'SKIP', deepLink: null, reason: 'NOT_A_NOTIFIED_STATE' };

  switch (job.productType) {
    case 'VERIFY':
      return { kind: 'VERIFY_DONE', deepLink: jobDeepLink(job) };
    case 'DOCUMENT_ANALYSIS':
    case 'CONTRACT_ANALYSIS':
      return { kind: 'DOCUMENT_DONE', deepLink: jobDeepLink(job) };
    case 'FIND_CLIENTS':
      return { kind: 'SEARCH_DONE', deepLink: jobDeepLink(job) };
    default:
      return {
        kind: 'SKIP',
        deepLink: null,
        reason: PRODUCER_OWNS_COMPLETION.has(job.productType) ? 'PRODUCER_OWNS_COMPLETION' : 'NO_NOTICE_FOR_PRODUCT',
      };
  }
}
