// HOMATCH RESEARCH CORE — "do this exactly once".
//
// Used for work that must happen once GLOBALLY rather than once per process:
// refreshing a stale cached document is the motivating case. In-process
// single-flight collapses a hundred concurrent requests inside one worker down
// to one refresh; it does nothing about the other workers doing the same thing
// at the same moment, which is how a popular stale entry becomes a stampede.
//
// WHAT IS HERE AND WHAT IS NOT
//
// The interface, and the single-process implementation. There is deliberately
// no Redis implementation: Homatch has no Redis, and adding one would be new
// infrastructure nobody asked for. When cross-process exclusion is genuinely
// needed, the right implementation for this stack is a Postgres advisory lock
// (`pg_try_advisory_lock`) behind this same interface — the callers do not
// change, which is the point of there being an interface at all.

import { newId } from '../core/ids.ts';

export interface LockHandle {
  key: string;
  /** Fencing token. Release only succeeds if the lock still carries it. */
  token: string;
  release(): Promise<void>;
  /** Extend the lease for long-running work. False if the lock was lost. */
  extend(ttlMs: number): Promise<boolean>;
}

export interface SingleFlightLock {
  readonly name: string;
  /** Returns null when someone else holds the lock. Never blocks. */
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
  isHeld(key: string): Promise<boolean>;
}

/**
 * Single-process lock. The default, and correct for a single-worker path.
 *
 * Leases still expire, so a crashed holder cannot wedge a key forever — the
 * same failure mode a cross-process implementation has to handle, made
 * explicit here so both behave the same way.
 */
export class InProcessLock implements SingleFlightLock {
  readonly name = 'in-process';
  private readonly held = new Map<string, { token: string; expiresAt: number }>();

  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const existing = this.held.get(key);
    if (existing && existing.expiresAt > this.now()) return null;

    const token = newId('lock');
    this.held.set(key, { token, expiresAt: this.now() + ttlMs });

    return {
      key,
      token,
      release: async () => {
        const current = this.held.get(key);
        // Only the current holder may release, or a slow task could release a
        // lock that has since been re-acquired by someone else.
        if (current?.token === token) this.held.delete(key);
      },
      extend: async (extendMs: number) => {
        const current = this.held.get(key);
        if (current?.token !== token) return false;
        current.expiresAt = this.now() + extendMs;
        return true;
      },
    };
  }

  async isHeld(key: string): Promise<boolean> {
    const existing = this.held.get(key);
    return existing !== undefined && existing.expiresAt > this.now();
  }

  /** Test hook. */
  clear(): void {
    this.held.clear();
  }
}
