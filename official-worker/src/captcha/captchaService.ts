// captchaService.ts — the ONE server-side CAPTCHA solving service for the
// official-source workers (NAPR/MyGov Service176, RS.ge).
//
// Built on the official 2Captcha SDK (@2captcha/captcha-solver). Every solve
// is gated, bounded and accounted:
//
//   gates     key configured · env kill switch (CAPTCHA_AUTO_SOLVE=off) ·
//             per-job policy from Admin (verify_captcha_auto_solve) ·
//             provider circuit breaker (bad key / zero balance)
//   bounds    attempts per provider per job · solves per job · solves per
//             day (process) · hard wall-clock timeout per solve
//   dedupe    one in-flight solve per (job, provider, site key, page)
//   ledger    outcome, latency, ESTIMATED cost — never the key, never a token
//
// A solve is only ever requested after a challenge was actually detected.
// A token returned by 2Captcha proves nothing by itself: the caller reports
// ACCEPTED only when the official source itself accepted it (record opened /
// result parsed), and REJECTED otherwise (sent to 2Captcha as a bad report).

import { Solver, APIError } from '@2captcha/captcha-solver';

export type CaptchaProvider = 'mygov' | 'rstax';

export interface CaptchaPolicy {
  enabled: boolean;
  providers: Record<CaptchaProvider, boolean>;
  maxAttemptsPerProvider: number;
  maxSolvesPerJob: number;
}

// On by default (owner decision 2026-10-08); Admin can turn it off per provider.
export const DEFAULT_CAPTCHA_POLICY: CaptchaPolicy = {
  enabled: true,
  providers: { mygov: true, rstax: true },
  maxAttemptsPerProvider: 2,
  maxSolvesPerJob: 3,
};

/** Admin setting → policy. Missing → the default (on); explicit enabled:false → off. Caps are clamped. */
export function parseCaptchaPolicy(raw: unknown): CaptchaPolicy {
  if (raw == null) return { ...DEFAULT_CAPTCHA_POLICY, providers: { ...DEFAULT_CAPTCHA_POLICY.providers } };
  const o = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const p = o.providers && typeof o.providers === 'object' ? o.providers : {};
  const clamp = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
  };
  return {
    enabled: o.enabled !== false,
    providers: { mygov: p.mygov !== false, rstax: p.rstax !== false },
    maxAttemptsPerProvider: clamp(o.maxAttemptsPerProvider, 1, 3, DEFAULT_CAPTCHA_POLICY.maxAttemptsPerProvider),
    maxSolvesPerJob: clamp(o.maxSolvesPerJob, 1, 6, DEFAULT_CAPTCHA_POLICY.maxSolvesPerJob),
  };
}

export type CaptchaOutcome =
  | 'ACCEPTED' // solved AND the official source accepted it
  | 'REJECTED' // solved, but the source refused the token (its warning re-rendered after the post-solve search)
  | 'NO_CHANGE' // solved, but the source showed no fresh response to the post-solve search (stale screen) — NOT a rejection
  | 'TIMEOUT'
  | 'UNSOLVABLE'
  | 'PROVIDER_ERROR'
  | 'BUDGET_EXHAUSTED'
  | 'DISABLED'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED'
  | 'SITEKEY_NOT_FOUND'
  | 'NO_CHALLENGE';

export interface CaptchaLedgerEntry {
  provider: CaptchaProvider;
  jobId: string;
  at: string;
  outcome: CaptchaOutcome;
  latencyMs: number;
  /** Estimated from CAPTCHA_RECAPTCHA_COST_USD; 2Captcha bills per solved task. */
  estCostUsd: number;
  /** Provider error code (e.g. ERROR_ZERO_BALANCE), never a message with secrets. */
  code?: string;
}

export interface SolveRequest {
  provider: CaptchaProvider;
  jobId: string;
  pageUrl: string;
  siteKey: string;
  invisible?: boolean;
  enterprise?: boolean;
}

export type SolveResult =
  | { ok: true; token: string; solveId: string; latencyMs: number }
  | { ok: false; outcome: CaptchaOutcome; latencyMs: number; code?: string };

/** The slice of the SDK this service uses — injectable for tests. */
export interface SolverLike {
  recaptcha(params: { pageurl: string; googlekey: string; invisible?: 0 | 1; enterprise?: 0 | 1 }): Promise<{ data: string; id: string }>;
  goodReport(id: string): Promise<void>;
  badReport(id: string): Promise<void>;
  balance(): Promise<number>;
}

/** Accepted environment names for the key (names only are ever reported). */
export const CAPTCHA_KEY_NAMES = [
  'TWOCAPTCHA_API_KEY', 'TWO_CAPTCHA_API_KEY', 'TWOCAPTCHA_KEY', 'TWO_CAPTCHA_KEY', 'CAPTCHA_2CAPTCHA_API_KEY',
  'APIKEY_2CAPTCHA', 'API_KEY_2CAPTCHA', 'CAPTCHA_API_KEY', 'CAPTCHA_KEY', 'RUCAPTCHA_KEY',
];

const PROVIDER_FATAL = new Set(['ERROR_WRONG_USER_KEY', 'ERROR_KEY_DOES_NOT_EXIST', 'ERROR_ZERO_BALANCE', 'ERROR_IP_NOT_ALLOWED', 'IP_BANNED']);
const BREAKER_MS = 30 * 60 * 1000;

export interface CaptchaServiceDeps {
  env?: Record<string, string | undefined>;
  solverFactory?: (apiKey: string) => SolverLike;
  now?: () => number;
  /** Hard wall-clock limit per solve (2Captcha reCAPTCHA is typically 15–60 s). */
  timeoutMs?: number;
}

export class CaptchaService {
  private env: Record<string, string | undefined>;
  private solverFactory: (apiKey: string) => SolverLike;
  private now: () => number;
  private timeoutMs: number;
  private solver: SolverLike | null = null;
  private inflight = new Map<string, Promise<SolveResult>>();
  private perJobProvider = new Map<string, number>();
  private perJob = new Map<string, number>();
  private day = '';
  private usedToday = 0;
  private breakerUntil = 0;
  private breakerCode: string | null = null;
  private ledger: CaptchaLedgerEntry[] = [];

  constructor(deps: CaptchaServiceDeps = {}) {
    this.env = deps.env ?? (process.env as Record<string, string | undefined>);
    this.solverFactory = deps.solverFactory ?? ((k) => new Solver(k, 5000) as unknown as SolverLike);
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? Number(this.env.CAPTCHA_SOLVE_TIMEOUT_MS ?? 120_000);
  }

  private keyName(): string | null {
    // CAPTCHA_KEY_VAR may name the variable explicitly (a name, not a value).
    const pointer = String(this.env.CAPTCHA_KEY_VAR ?? '').trim();
    const names = /^[A-Z][A-Z0-9_]{2,63}$/.test(pointer) ? [pointer, ...CAPTCHA_KEY_NAMES] : CAPTCHA_KEY_NAMES;
    return names.find((n) => typeof this.env[n] === 'string' && this.env[n]!.trim().length >= 16) ?? null;
  }

  private dailyCap(): number {
    const n = Number(this.env.CAPTCHA_DAILY_CAP ?? 50);
    return Number.isFinite(n) && n >= 0 ? n : 50;
  }

  private costUsd(): number {
    const n = Number(this.env.CAPTCHA_RECAPTCHA_COST_USD ?? 0.003);
    return Number.isFinite(n) && n >= 0 ? n : 0.003;
  }

  private rollDay(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.usedToday = 0;
    }
  }

  /** Safe for /health and Admin: booleans, counts and the variable NAME only. */
  status() {
    this.rollDay();
    const keyName = this.keyName();
    return {
      provider: '2captcha',
      sdk: '@2captcha/captcha-solver',
      configured: !!keyName,
      keyVariable: keyName,
      killSwitch: String(this.env.CAPTCHA_AUTO_SOLVE ?? '').toLowerCase() === 'off',
      dailyCap: this.dailyCap(),
      usedToday: this.usedToday,
      breakerOpen: this.breakerUntil > this.now(),
      breakerCode: this.breakerUntil > this.now() ? this.breakerCode : null,
      estCostPerSolveUsd: this.costUsd(),
      recent: this.ledger.slice(-20),
    };
  }

  ledgerFor(jobId: string): CaptchaLedgerEntry[] {
    return this.ledger.filter((e) => e.jobId === jobId);
  }

  /** Every gate except the challenge itself. No external call, no spend. */
  gate(policy: CaptchaPolicy | null | undefined, provider: CaptchaProvider, jobId: string): CaptchaOutcome | null {
    this.rollDay();
    if (!policy?.enabled || !policy.providers[provider]) return 'DISABLED';
    if (String(this.env.CAPTCHA_AUTO_SOLVE ?? '').toLowerCase() === 'off') return 'DISABLED';
    if (!this.keyName()) return 'NOT_CONFIGURED';
    if (this.breakerUntil > this.now()) return 'PROVIDER_ERROR';
    if ((this.perJobProvider.get(`${jobId}|${provider}`) ?? 0) >= policy.maxAttemptsPerProvider) return 'BUDGET_EXHAUSTED';
    if ((this.perJob.get(jobId) ?? 0) >= policy.maxSolvesPerJob) return 'BUDGET_EXHAUSTED';
    if (this.usedToday >= this.dailyCap()) return 'BUDGET_EXHAUSTED';
    return null;
  }

  record(entry: Omit<CaptchaLedgerEntry, 'at'>): void {
    this.ledger.push({ ...entry, at: new Date(this.now()).toISOString() });
    if (this.ledger.length > 500) this.ledger.splice(0, this.ledger.length - 500);
    // Redacted operational log: no key, no token, no page content.
    console.log(`[captcha] ${entry.provider} job=${entry.jobId.slice(0, 8)} outcome=${entry.outcome} ms=${entry.latencyMs}${entry.code ? ` code=${entry.code}` : ''}`);
  }

  /** reCAPTCHA v2 (incl. invisible / Enterprise v2). Call only for a detected challenge. */
  async solveRecaptchaV2(req: SolveRequest, policy: CaptchaPolicy | null | undefined): Promise<SolveResult> {
    const blocked = this.gate(policy, req.provider, req.jobId);
    if (blocked) {
      this.record({ provider: req.provider, jobId: req.jobId, outcome: blocked, latencyMs: 0, estCostUsd: 0 });
      return { ok: false, outcome: blocked, latencyMs: 0 };
    }
    if (!/^[0-9A-Za-z_-]{20,64}$/.test(req.siteKey) || !/^https:\/\//.test(req.pageUrl)) {
      this.record({ provider: req.provider, jobId: req.jobId, outcome: 'SITEKEY_NOT_FOUND', latencyMs: 0, estCostUsd: 0 });
      return { ok: false, outcome: 'SITEKEY_NOT_FOUND', latencyMs: 0 };
    }
    // Duplicate challenge prevention: the same challenge is solved once.
    const dedupeKey = `${req.jobId}|${req.provider}|${req.siteKey}|${req.pageUrl}`;
    const existing = this.inflight.get(dedupeKey);
    if (existing) return existing;
    // Budget is spent at submission, whatever the result.
    this.perJobProvider.set(`${req.jobId}|${req.provider}`, (this.perJobProvider.get(`${req.jobId}|${req.provider}`) ?? 0) + 1);
    this.perJob.set(req.jobId, (this.perJob.get(req.jobId) ?? 0) + 1);
    this.usedToday++;
    const p = this.runSolve(req).finally(() => this.inflight.delete(dedupeKey));
    this.inflight.set(dedupeKey, p);
    return p;
  }

  private async runSolve(req: SolveRequest): Promise<SolveResult> {
    const started = this.now();
    if (!this.solver) this.solver = this.solverFactory(this.env[this.keyName()!]!.trim());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        this.solver.recaptcha({
          pageurl: req.pageUrl,
          googlekey: req.siteKey,
          ...(req.invisible ? { invisible: 1 as const } : {}),
          ...(req.enterprise ? { enterprise: 1 as const } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('CAPTCHA_SOLVE_TIMEOUT')), this.timeoutMs);
        }),
      ]);
      const token = String(answer?.data ?? '');
      if (!token) throw new APIError('ERROR_EMPTY_ANSWER');
      // Outcome of the SOLVE only; acceptance is recorded by reportAcceptance().
      return { ok: true, token, solveId: String(answer.id), latencyMs: this.now() - started };
    } catch (e) {
      const latencyMs = this.now() - started;
      const code = e instanceof APIError ? String((e as any).err ?? e.message).slice(0, 60) : e instanceof Error && e.message === 'CAPTCHA_SOLVE_TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
      const outcome: CaptchaOutcome = code === 'TIMEOUT' ? 'TIMEOUT' : /UNSOLVABLE/.test(code) ? 'UNSOLVABLE' : 'PROVIDER_ERROR';
      if (PROVIDER_FATAL.has(code)) {
        // A bad key or empty balance fails every solve: stop spending attempts on it.
        this.breakerUntil = this.now() + BREAKER_MS;
        this.breakerCode = code;
      }
      this.record({ provider: req.provider, jobId: req.jobId, outcome, latencyMs, estCostUsd: 0, code });
      return { ok: false, outcome, latencyMs, code };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Record whether the official SOURCE accepted the token, and tell 2Captcha
   * (good/bad report — a bad report is refunded by the provider). Never throws.
   */
  async reportAcceptance(req: Pick<SolveRequest, 'provider' | 'jobId'>, solved: { solveId: string; latencyMs: number }, accepted: boolean): Promise<void> {
    this.record({ provider: req.provider, jobId: req.jobId, outcome: accepted ? 'ACCEPTED' : 'REJECTED', latencyMs: solved.latencyMs, estCostUsd: accepted ? this.costUsd() : 0 });
    try {
      if (!this.solver) return;
      if (accepted) await this.solver.goodReport(solved.solveId);
      else await this.solver.badReport(solved.solveId);
    } catch {
      /* reporting is best effort */
    }
  }

  /**
   * The source neither accepted nor refused the token: the post-solve search
   * produced no fresh render at all (stale screen). That is no evidence about
   * the token, so 2Captcha gets no bad report and the solve stays billed
   * (estimated cost recorded). Never throws.
   */
  reportNoChange(req: Pick<SolveRequest, 'provider' | 'jobId'>, solved: { solveId: string; latencyMs: number }): void {
    try {
      this.record({ provider: req.provider, jobId: req.jobId, outcome: 'NO_CHANGE', latencyMs: solved.latencyMs, estCostUsd: this.costUsd() });
    } catch {
      /* ledger is best effort */
    }
  }

  /** Account balance for Admin (a free API call). Null when unavailable. */
  async balance(): Promise<number | null> {
    if (!this.keyName()) return null;
    try {
      if (!this.solver) this.solver = this.solverFactory(this.env[this.keyName()!]!.trim());
      return await this.solver.balance();
    } catch {
      return null;
    }
  }
}

/** The process-wide instance used by the workers. */
export const captchaService = new CaptchaService();

/** Per-job context handed to a worker. */
export interface CaptchaContext {
  service: CaptchaService;
  policy: CaptchaPolicy;
  jobId: string;
}

/** What a worker reports about its CAPTCHA handling — no tokens, no key. */
export interface CaptchaResolution {
  challengeDetected: boolean;
  type: string | null;
  attempts: number;
  outcome: CaptchaOutcome | 'HUMAN_FALLBACK';
  latencyMs: number;
}
