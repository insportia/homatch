// WorkflowErrors.ts — the small set of internal error types the new
// deterministic architecture uses to "fail loudly internally" (mandate
// Section 4: "illegal transitions must fail loudly internally") instead of
// silently downgrading an unexpected situation into a generic status.
//
// IMPORTANT DISTINCTION (mandate Section 5, MSMAP): "If an assertion fails:
// do not silently downgrade it into generic SEARCH_CONFIRMED. Return the
// exact internal failure state." That is NOT the same thing as throwing —
// a failed assertion during a live research run (e.g. the info popup never
// appeared) is an ordinary, expected outcome of browsing a real website and
// must be represented as a legitimate stopped-here FSM state, not an
// exception. These error classes are reserved for genuine PROGRAMMER
// mistakes: a workflow trying to jump to a state that isn't a declared
// successor of its current state, or being invoked with a precondition that
// was never satisfied (e.g. running ENREG with neither an id-code nor a
// name). A workflow's run() loop catches AssertionFailedError/ordinary
// negative evidence itself and simply stops advancing the FSM — it never
// lets a normal "the page didn't do what we hoped" outcome escape as an
// unhandled exception.

export class IllegalTransitionError extends Error {
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly allowed: string[];
  constructor(source: string, from: string, to: string, allowed: string[]) {
    super(
      `[${source}] illegal state transition: ${from} -> ${to} (allowed from ${from}: ${
        allowed.length ? allowed.join(', ') : '<terminal, no further transitions declared>'
      })`
    );
    this.name = 'IllegalTransitionError';
    this.source = source;
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

/** A named, structured assertion failure — used internally by workflows to
 * decide "stop advancing here" without pretending anything more was proven.
 * Never thrown uncaught from a *Workflow.run(); always caught by that same
 * workflow and converted into "stay at the last legitimately-reached
 * state," recorded in BrowserTrace with actualOutcome=FAILED. */
export class AssertionFailedError extends Error {
  readonly source: string;
  readonly assertion: string;
  readonly detail?: string;
  constructor(source: string, assertion: string, detail?: string) {
    super(`[${source}] assertion failed: ${assertion}${detail ? ` — ${detail}` : ''}`);
    this.name = 'AssertionFailedError';
    this.source = source;
    this.assertion = assertion;
    this.detail = detail;
  }
}

/** Thrown when a workflow is invoked without the minimum input it needs to
 * run at all (mandate Section 11: "If no identifier is available ... ENREG
 * cannot run yet"). Distinct from a legitimate zero-result search — this
 * means the orchestrator should not have scheduled this step in the first
 * place, and is caught at the orchestrator boundary and recorded as
 * SOURCE_NOT_APPLICABLE, never as a searched-and-failed source. */
export class WorkflowPreconditionError extends Error {
  readonly source: string;
  constructor(source: string, message: string) {
    super(`[${source}] precondition not met: ${message}`);
    this.name = 'WorkflowPreconditionError';
    this.source = source;
  }
}
