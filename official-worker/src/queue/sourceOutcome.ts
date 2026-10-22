// sourceOutcome.ts — what one official-source run actually established.
//
// A durable task may only be SUCCEEDED when usable, validated evidence was
// obtained. Production job 61c1c38c (2026-10-22): MyGov came back
// status:'BLOCKED' (reCAPTCHA budget exhausted, 65 of 164 documents read) and
// the task was SUCCEEDED anyway, because the executor completed every result
// that was not literally status:'FAILED'.
//
// Every result is classified into ONE outcome, carried in the task result
// (`sourceOutcome`, `outcomeReason`) and, for a failed task, in its error as
// `sourceOutcome=<X>` so the job side can read it without a result:
//
//   RETRIEVED            usable evidence, the search confirmed       SUCCEEDED
//   PARTIAL              some usable evidence, the rest unreachable  SUCCEEDED (what was read is kept)
//   NO_RECORD_CONFIRMED  a validated empty answer                    SUCCEEDED
//   CAPTCHA_BLOCKED      a verification gate stopped it, nothing read  FAILED
//   UNPARSEABLE          the source answered, the answer is unreadable FAILED
//   PROVIDER_UNAVAILABLE network / 5xx / timeout / crash             FAILED (retried)
//   RETRY_EXHAUSTED      set by the job side for a DEAD task         —
//   AUTH_REQUIRED        the source asked for a login                FAILED
//
// The existing status vocabulary (SEARCH_CONFIRMED, BLOCKED, WAITING_HUMAN,
// VERIFICATION_FAILED …) is unchanged: report code keeps reading `status`;
// the outcome is the precise, task-level verdict next to it. Pure.

export type SourceOutcome =
  | 'RETRIEVED'
  | 'PARTIAL'
  | 'NO_RECORD_CONFIRMED'
  | 'CAPTCHA_BLOCKED'
  | 'UNPARSEABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'RETRY_EXHAUSTED'
  | 'AUTH_REQUIRED';

/** The outcomes that complete a task. */
export const SUCCESS_OUTCOMES: ReadonlySet<SourceOutcome> = new Set(['RETRIEVED', 'PARTIAL', 'NO_RECORD_CONFIRMED']);

export interface SourceVerdict {
  outcome: SourceOutcome;
  /** Short machine reason (e.g. CAPTCHA_BUDGET_EXHAUSTED), never page text. */
  reason: string | null;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const code = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

/**
 * Documents a reader can use: marked complete by the source (MyGov), or, for
 * sources without that flag, carrying readable text and no error.
 */
export function usableDocumentCount(r: any): number {
  return arr(r?.documents).filter((d) => {
    if (!d || typeof d !== 'object') return false;
    if (d.complete === true) return true;
    if (d.complete === false || d.error) return false;
    const text = typeof d.fullText === 'string' && d.fullText ? d.fullText : typeof d.rawText === 'string' ? d.rawText : '';
    return text.trim().length > 20;
  }).length;
}

/** The last CAPTCHA outcome a worker recorded (NONE when it recorded none). */
export function lastCaptchaOutcome(r: any): string {
  const log = arr(r?.captchaResolution);
  return String(log.length ? log[log.length - 1]?.outcome ?? 'NONE' : 'NONE');
}

/** One worker result → its outcome. `keep` = the worker paused for a human. */
export function classifySourceOutcome(r: any, keep = false): SourceVerdict {
  const status = String(r?.status ?? '').toUpperCase();
  const usable = usableDocumentCount(r);
  const why = lastCaptchaOutcome(r);
  const gated = keep || status === 'WAITING_HUMAN' || status === 'CAPTCHA_REQUIRED' || status === 'SKIPPED_HUMAN_VERIFICATION';
  if (gated) return { outcome: 'CAPTCHA_BLOCKED', reason: `CAPTCHA_${code(why)}` };
  switch (status) {
    case 'SEARCH_CONFIRMED':
    case 'SOURCE_EXHAUSTED':
    case 'RESULTS_TRAVERSED':
    case 'DOCUMENTS_TRAVERSED':
    case 'COMPLETE': {
      if (r?.blocked === true) return usable ? { outcome: 'PARTIAL', reason: `CAPTCHA_${code(why)}` } : { outcome: 'CAPTCHA_BLOCKED', reason: `CAPTCHA_${code(why)}` };
      const ledger = r?.tasApi?.ledger;
      if (ledger && ledger.incomplete === true) return { outcome: 'PARTIAL', reason: arr(ledger.incompleteReasons).map(code).filter(Boolean).join(',') || 'PROCESSING_INCOMPLETE' };
      return { outcome: 'RETRIEVED', reason: null };
    }
    case 'NO_RESULT_CONFIRMED':
      return r?.noResultConfirmed === false ? { outcome: 'UNPARSEABLE', reason: 'NO_RESULT_NOT_VALIDATED' } : { outcome: 'NO_RECORD_CONFIRMED', reason: null };
    case 'BLOCKED': {
      // MyGov Service 176: records gated by NAPR's reCAPTCHA stayed closed.
      const reason = r?.captcha || r?.captchaRequired ? `CAPTCHA_${code(why)}` : 'BLOCKED';
      if (usable) return { outcome: 'PARTIAL', reason };
      return r?.captcha || r?.captchaRequired ? { outcome: 'CAPTCHA_BLOCKED', reason } : { outcome: 'PROVIDER_UNAVAILABLE', reason };
    }
    case 'AUTH_REQUIRED':
      return { outcome: 'AUTH_REQUIRED', reason: 'AUTH_REQUIRED' };
    case 'TIMEOUT':
      return usable ? { outcome: 'PARTIAL', reason: 'TIMEOUT' } : { outcome: 'PROVIDER_UNAVAILABLE', reason: 'TIMEOUT' };
    case 'FAILED':
    case 'TEMPORARILY_UNAVAILABLE':
      return { outcome: 'PROVIDER_UNAVAILABLE', reason: status };
    case 'SUBMITTED_UNCONFIRMED':
      // Searched, but nothing confirmed: what was read is kept as PARTIAL.
      return usable ? { outcome: 'PARTIAL', reason: 'UNCONFIRMED' } : { outcome: 'UNPARSEABLE', reason: 'UNCONFIRMED' };
    default: {
      // VERIFICATION_FAILED, SUBMITTED_UNPARSED, SEARCH_CONTROL_NOT_FOUND,
      // WRONG_SEARCH_CONTEXT, SUBMIT_FAILED, PARSE_FAILED, START, no status …
      const rs = r?.rsVerification && typeof r.rsVerification === 'object' ? r.rsVerification : null;
      if (rs && rs.serverOutcome === 'REJECTED') return { outcome: 'CAPTCHA_BLOCKED', reason: 'CAPTCHA_REJECTED' };
      return { outcome: 'UNPARSEABLE', reason: code(rs?.reason ?? status) || 'NO_STATUS' };
    }
  }
}
