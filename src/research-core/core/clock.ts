export interface Clock {
  now(): number;
  iso(): string;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

/** Deterministic clock for tests. Time only moves when you move it. */
export class FixedClock implements Clock {
  private current: number;

  constructor(startMs = Date.parse('2026-01-01T00:00:00.000Z')) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }

  advance(ms: number): void {
    this.current += ms;
  }

  async sleep(ms: number): Promise<void> {
    this.current += ms;
  }
}
