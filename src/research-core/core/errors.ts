// HOMATCH RESEARCH CORE — failures.
//
// Every message here is an OPERATOR message. Nothing in this file is ever
// shown to a customer: Homatch's customer-facing strings are localized across
// six locales and pass through sanitizeCustomerReport/assertNoLeaks, and a
// core that emitted prose would be a seventh, unlocalized, unsanitized path
// into the report. Callers map a `code` onto their own localized text.
//
// A URL appears in `details`, never in the message, for the same reason: a
// URL can carry a token, and a message is the thing most likely to be logged.

export type ResearchErrorCode =
  | 'TIMEOUT'
  | 'ABORTED'
  | 'CIRCUIT_OPEN'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFIG_ERROR'
  | 'POLICY_DENIED'
  | 'NETWORK_DENIED'
  | 'ROBOTS_DENIED'
  | 'PROVIDER_ERROR'
  | 'BUDGET_EXCEEDED';

export class ResearchError extends Error {
  readonly code: ResearchErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: ResearchErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export class TimeoutError extends ResearchError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('TIMEOUT', message, { retryable: true, details });
  }
}

export class AbortError extends ResearchError {
  constructor(message = 'Aborted', details?: Record<string, unknown>) {
    super('ABORTED', message, { retryable: false, details });
  }
}

export class CircuitOpenError extends ResearchError {
  constructor(target: string, retryAfterMs: number) {
    super('CIRCUIT_OPEN', `Circuit open for ${target}`, {
      retryable: true,
      details: { target, retryAfterMs },
    });
  }
}

export class HttpError extends ResearchError {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, url: string, retryAfterMs: number | null = null) {
    super('HTTP_ERROR', `HTTP ${status}`, {
      // 408/429 and 5xx are worth retrying. Other 4xx (notably 404) are not:
      // a missing page stays missing, so we never retry it in a loop.
      retryable: status === 408 || status === 429 || status >= 500,
      details: { status, url, retryAfterMs },
    });
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ValidationError extends ResearchError {
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super('VALIDATION_ERROR', message, { details: { errors } });
    this.errors = errors;
  }
}

/**
 * The run was told what it may spend and reached it.
 *
 * Deliberately NOT retryable: retrying a budget refusal is how a partial
 * budget turns into a full one behind the customer's back.
 */
export class BudgetExceededError extends ResearchError {
  constructor(details: Record<string, unknown>) {
    super('BUDGET_EXCEEDED', 'Research budget exhausted', { retryable: false, details });
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AbortError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof ResearchError) return error.retryable;
  // Network-level failures (DNS, socket reset) are worth one more attempt.
  return error instanceof Error && /ECONN|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(error.message);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
