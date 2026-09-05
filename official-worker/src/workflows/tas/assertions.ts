// assertions.ts (TAS) — pure, unit-testable predicates. The single most
// important one is re-exported from state/transitions.ts
// (canMarkTasExhausted) since it IS the mandate's own literal Section 18
// example ("18 discovered, 16 visited MUST make TAS_EXHAUSTED
// impossible") — kept in one place rather than duplicated.
export { canMarkTasExhausted } from '../../state/transitions.js';

export function assertSearchSubmitted(submitted: boolean, networkConfirmed: boolean): boolean {
  // Text-only proof can't tell "a real search that found 0" apart from
  // "nothing happened yet" when the answer is 0 either way — the DWR
  // network call is the actual causal proof (mandate/prior-session finding).
  return submitted || networkConfirmed;
}

export function assertResultSetCaptured(resultsDiscovered: number | null): boolean {
  return resultsDiscovered !== null;
}

export function assertAllChildrenVisited(childrenDiscovered: number, childrenVisited: number, skipped: number): boolean {
  return childrenVisited + skipped >= childrenDiscovered;
}
