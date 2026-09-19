/**
 * ONE ANSWER TO "IS THIS VERIFICATION FINISHED?"
 *
 * There were two, and they disagreed for a few seconds on every run.
 *
 * `research_jobs.status` reaching COMPLETE means the PIPELINE finished. It
 * does not mean the customer can read anything: the synthesised report is
 * fetched separately, and that round trip takes a second or three — longer
 * when the edge function is cold. In that window the page was still working
 * while the global job indicator had already announced "Verification
 * complete", because it watches the background job's terminal state and knows
 * nothing about the screen.
 *
 * So the customer was told the thing was done, and then watched it carry on
 * finishing. That is the whole defect, and it is a contract problem rather
 * than a timing one: nothing here should be solved with a delay.
 *
 * The rule is stated once, in code, and both surfaces read it:
 *
 *   COMPLETE requires the pipeline to be done AND the customer-visible report
 *   to have SETTLED — either it arrived, or the attempt to fetch it finished
 *   and failed. Anything else that is still moving is FINALIZING, which is a
 *   calm state with a name, not a success.
 *
 * "Settled, or failed" rather than "arrived" matters: a synthesis that cannot
 * be produced must still end the run, or a degraded verification would sit in
 * FINALIZING for ever. The page falls back to the evidence view in that case,
 * which is a real, readable result — just not the synthesised one.
 */

export type VerifyCustomerState =
  /** Nothing started yet on this screen. */
  | 'IDLE'
  /** Research is running. */
  | 'RESEARCHING'
  /** The pipeline is done or nearly done; the readable report is not. */
  | 'FINALIZING'
  /** A human has to do something before this can continue. */
  | 'NEEDS_HUMAN'
  /** The customer stopped it. */
  | 'STOPPED'
  /** It ended without a result. */
  | 'FAILED'
  /** The customer-visible report is final. Only now. */
  | 'COMPLETE';

export interface VerifyCompletionInput {
  /** research_jobs.status as last polled. */
  jobStatus?: string | null;
  /** research_jobs.stage as last polled. */
  stage?: string | null;
  /** result_json is present — the evidence exists. */
  hasReport: boolean;
  /** The persisted customer-facing synthesis, once fetched. */
  synthesis: unknown | null;
  /** A fetch of that synthesis is in flight. */
  synthesisLoading: boolean;
  /**
   * A fetch has completed at least once for THIS job, whatever its outcome.
   * Without this, "no synthesis yet" and "no synthesis, and there never will
   * be" look identical, and the second one would finalise for ever.
   */
  synthesisSettled: boolean;
  /** An anonymous run waiting for the visitor to create an account. */
  awaitingSignIn?: boolean;
}

/** Stages after which nothing more is coming from research itself. */
const FINALIZING_STAGES = new Set([
  'SYNTHESIS',
  'SYNTHESIS_READY',
  'RECONCILIATION_CHECK_PENDING',
]);

export function verifyCustomerState(input: VerifyCompletionInput): VerifyCustomerState {
  const status = String(input.jobStatus ?? '').toUpperCase();
  const stage = String(input.stage ?? '').toUpperCase();

  // The states a customer has to act on, or that ended the run, come first:
  // none of them is a completion and none is a wait.
  if (status === 'WAITING_HUMAN' || stage === 'CAPTCHA_REQUIRED') return 'NEEDS_HUMAN';
  if (status === 'CANCELLED') return 'STOPPED';
  if (status === 'FAILED') return 'FAILED';
  if (input.awaitingSignIn) return 'FINALIZING';

  if (status === 'COMPLETE') {
    // THE LINE THIS MODULE EXISTS FOR.
    //
    // The pipeline is done. The customer's report is a separate fetch, and
    // until that has settled there is nothing final to show — so this is not
    // yet a completion, however finished the backend is.
    const settled = input.synthesisSettled && !input.synthesisLoading;
    if (!settled) return 'FINALIZING';
    if (!input.hasReport) return 'FAILED';
    return 'COMPLETE';
  }

  if (!status && !input.hasReport) return 'IDLE';
  if (FINALIZING_STAGES.has(stage)) return 'FINALIZING';
  return 'RESEARCHING';
}

/**
 * The only thing any surface should ask before saying "done" to a customer,
 * or before counting a run as finished in a progress readout.
 */
export function isVerifyCustomerComplete(input: VerifyCompletionInput): boolean {
  return verifyCustomerState(input) === 'COMPLETE';
}

/** Still moving, and the customer should be told so calmly. */
export function isVerifyFinalizing(input: VerifyCompletionInput): boolean {
  return verifyCustomerState(input) === 'FINALIZING';
}
