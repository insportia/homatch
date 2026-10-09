// implementation.ts — which TAS implementation runs, and what happens when
// it fails. Pure decisions + an in-process health ledger.
//
// The executable code of BOTH implementations ships in this image. Admin
// selects between already-deployed implementations by an audited setting
// (admin_settings.verify_tas_implementation) that research-agent forwards on
// each job; nothing executable is ever uploaded through Admin.
//
//   LEGACY    — the Playwright browser workflow (TasWorkflow.ts). Never deleted.
//   API_FIRST — the public DWR client (api/TasApiWorkflow.ts).
//
// Default while API_FIRST is unaccepted: active LEGACY. A failed API_FIRST run
// falls back to LEGACY inside the same step, so a customer's report never
// pays for a contract change on TAS's side.

export type TasImplementation = 'LEGACY' | 'API_FIRST';

export interface TasImplementationConfig {
  active: TasImplementation;
  fallback: TasImplementation | null;
}

export const DEFAULT_TAS_CONFIG: TasImplementationConfig = { active: 'LEGACY', fallback: null };

const IMPLS: TasImplementation[] = ['LEGACY', 'API_FIRST'];

export function parseTasConfig(raw: unknown): TasImplementationConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const active = IMPLS.includes(o.active as TasImplementation) ? (o.active as TasImplementation) : DEFAULT_TAS_CONFIG.active;
  const fb = IMPLS.includes(o.fallback as TasImplementation) ? (o.fallback as TasImplementation) : null;
  return { active, fallback: fb && fb !== active ? fb : null };
}

/** Whether an API_FIRST outcome must hand over to the fallback implementation. */
export function shouldFallBack(result: { status?: string; error?: string | null; workflowResult?: { state?: string } } | null): boolean {
  if (!result) return true;
  if (result.status === 'FAILED') return true;
  if (result.workflowResult?.state === 'FAILED') return true;
  return false;
}

export interface ImplementationHealth {
  implementation: TasImplementation;
  runs: number;
  successes: number;
  failures: number;
  fallbacksTriggered: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: string | null;
  lastDurationMs: number | null;
}

const ledger = new Map<TasImplementation, ImplementationHealth>();

function entry(impl: TasImplementation): ImplementationHealth {
  let e = ledger.get(impl);
  if (!e) {
    e = { implementation: impl, runs: 0, successes: 0, failures: 0, fallbacksTriggered: 0, lastSuccessAt: null, lastFailureAt: null, lastFailure: null, lastDurationMs: null };
    ledger.set(impl, e);
  }
  return e;
}

export function recordTasRun(impl: TasImplementation, ok: boolean, durationMs: number, error: string | null = null, at = new Date().toISOString()): void {
  const e = entry(impl);
  e.runs++;
  e.lastDurationMs = durationMs;
  if (ok) {
    e.successes++;
    e.lastSuccessAt = at;
  } else {
    e.failures++;
    e.lastFailureAt = at;
    e.lastFailure = error ? error.slice(0, 200) : 'failed';
  }
}

export function recordTasFallback(from: TasImplementation): void {
  entry(from).fallbacksTriggered++;
}

export function tasHealth(): ImplementationHealth[] {
  return IMPLS.map((i) => ({ ...entry(i) }));
}

/** Test hook. */
export function __resetTasHealth(): void {
  ledger.clear();
}
