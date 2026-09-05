// SourceState.ts — the generic finite-state-machine engine shared by every
// per-source workflow (MSMAP/TAS/MyGov/ENREG). Per mandate Section 4:
// "Every official source needs an explicit FSM ... illegal transitions must
// fail loudly internally ... no arbitrary status assignment."
//
// This class enforces only the GRAPH SHAPE ("you may not jump to a state
// that is not a declared successor of the current one") — it is
// deliberately NOT responsible for judging whether the real world actually
// supports advancing. That judgment belongs to each *Workflow.ts, which
// calls `transition()` only once it has real, asserted evidence the next
// step was reached, and otherwise simply stops calling transition() and
// returns whatever state it last legitimately reached (see each
// *Workflow.ts's run() loop and the AssertionFailedError handling there).
import { IllegalTransitionError } from '../errors/WorkflowErrors.js';

export interface TransitionRecord<S extends string> {
  from: S;
  to: S;
  at: string;
  reason?: string;
}

export type TransitionGraph<S extends string> = Partial<Record<S, S[]>>;

export class SourceStateMachine<S extends string> {
  readonly source: string;
  private readonly graph: TransitionGraph<S>;
  private current: S;
  private readonly startState: S;
  private readonly history: TransitionRecord<S>[] = [];

  constructor(source: string, graph: TransitionGraph<S>, start: S) {
    this.source = source;
    this.graph = graph;
    this.current = start;
    this.startState = start;
  }

  get state(): S {
    return this.current;
  }

  get trace(): TransitionRecord<S>[] {
    return this.history.slice();
  }

  /** Every state this machine ever reached, in order (start state included).
   * Used by hard invariants (state/transitions.ts) to check e.g. "was
   * NAPR_OPENED ever actually reached," independent of whatever the final
   * state ended up being. */
  get visitedStates(): S[] {
    return [this.startState, ...this.history.map((h) => h.to)];
  }

  /**
   * Move to `to`. Throws IllegalTransitionError if `to` is not a declared
   * successor of the current state — a hard internal/programmer error, per
   * the mandate's "illegal transitions must fail loudly internally." This
   * is intentionally strict: it is what makes "the old behavior that
   * treated map recenter as SOURCE_EXHAUSTED" structurally impossible now —
   * there is no edge in any real graph below from an early discovery state
   * straight to the terminal EXHAUSTED state.
   */
  transition(to: S, reason?: string): S {
    const allowed = this.graph[this.current] || ([] as S[]);
    if (!allowed.includes(to)) {
      throw new IllegalTransitionError(this.source, String(this.current), String(to), allowed.map(String));
    }
    this.history.push({ from: this.current, to, at: new Date().toISOString(), reason });
    this.current = to;
    return this.current;
  }

  /** True once `state` was reached at any point in this run (current state
   * or any earlier one) — NOT the same as "is the current state." */
  reached(state: S): boolean {
    return this.visitedStates.includes(state);
  }
}
