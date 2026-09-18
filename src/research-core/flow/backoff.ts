import { systemClock, type Clock } from '../core/clock.ts';
import { isRetryable, HttpError, ResearchError } from '../core/errors.ts';

export type JitterStrategy = 'none' | 'full' | 'equal' | 'decorrelated';

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  factor: number;
  jitter: JitterStrategy;
  /** Deterministic RNG hook so backoff is testable. */
  random?: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 250,
  maxMs: 30_000,
  factor: 2,
  jitter: 'full',
};

/**
 * Exponential backoff with jitter.
 *
 * Jitter is not optional in a fan-out engine: without it, 200 tasks that all
 * hit a 503 at the same moment retry at the same moment, and the thundering
 * herd is what keeps the provider down.
 */
export function computeBackoff(attempt: number, options: Partial<BackoffOptions> = {}): number {
  const opts = { ...DEFAULT_BACKOFF, ...options };
  const random = opts.random ?? Math.random;
  const exponential = Math.min(opts.maxMs, opts.baseMs * opts.factor ** Math.max(0, attempt - 1));

  switch (opts.jitter) {
    case 'none':
      return Math.round(exponential);
    case 'equal':
      return Math.round(exponential / 2 + random() * (exponential / 2));
    case 'decorrelated':
      return Math.round(Math.min(opts.maxMs, opts.baseMs + random() * (exponential * 3 - opts.baseMs)));
    case 'full':
    default:
      return Math.round(random() * exponential);
  }
}

/** Parse `Retry-After`, which may be seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);

  return null;
}

export interface RetryOptions extends Partial<BackoffOptions> {
  maxAttempts: number;
  clock?: Clock;
  /** Hard cap so a server-supplied Retry-After cannot park a task for an hour. */
  maxRetryAfterMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  signal?: AbortSignal;
  /** Override the retryability decision. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * Retry with adaptive backoff.
 *
 * Adaptive means: a server that tells us when to come back (`Retry-After`) is
 * obeyed in preference to our own exponential guess, and non-retryable errors
 * (404, validation) fail immediately instead of burning the attempt budget.
 */
export async function retry<T>(
  work: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const clock = options.clock ?? systemClock;
  const maxRetryAfter = options.maxRetryAfterMs ?? 60_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      lastError = error;

      const retryable = options.shouldRetry
        ? options.shouldRetry(error, attempt)
        : isRetryable(error);

      if (!retryable || attempt >= options.maxAttempts) throw error;

      // Server-directed delay wins over our exponential guess.
      const serverDelay = retryAfterFromError(error);
      const delayMs =
        serverDelay !== null
          ? Math.min(serverDelay, maxRetryAfter)
          : computeBackoff(attempt, options);

      options.onRetry?.({ attempt, delayMs, error });
      await clock.sleep(delayMs, options.signal);
    }
  }

  throw lastError;
}

function retryAfterFromError(error: unknown): number | null {
  if (error instanceof HttpError) return error.retryAfterMs;
  if (error instanceof ResearchError) {
    const hinted = error.details['retryAfterMs'];
    if (typeof hinted === 'number') return hinted;
  }
  return null;
}
