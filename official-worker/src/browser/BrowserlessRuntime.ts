import { chromium } from 'playwright';
// Explicit node:url import: tsconfig.test.json builds without the DOM lib,
// where the ambient global URL type carries no .protocol/.searchParams.
import { URL } from 'node:url';

const DIRECT_TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const ENDPOINT = String(
  process.env.BROWSERLESS_WS_ENDPOINT ||
  'wss://production-sfo.browserless.io/chromium/stealth'
).trim();

const BRIDGE_URL = String(
  process.env.BROWSERLESS_TOKEN_BRIDGE_URL || ''
).trim();

const BRIDGE_KEY = String(
  process.env.BROWSERLESS_TOKEN_BRIDGE_KEY || ''
).trim();

/*
 * P0 INCIDENT 2026-09-08 (job 61496cf0-36de-4da9-acf7-7e2a75728043, cadastral
 * 01.18.06.019.055.03.01.601) — ROOT CAUSE #1.
 *
 * Proven from Browserless's own documentation (docs.browserless.io/
 * enterprise/private-deployment/timeouts, docs.browserless.io/baas/
 * session-management/standard-sessions): a connectOverCDP() session has an
 * ABSOLUTE lifetime deadline measured from the moment it connects — "When a
 * session reaches this limit, Browserless terminates it regardless of what
 * it is doing" — and once the deadline elapses "the browser is cleaned up"
 * unrecoverably ("attempting to reconnect after expiration will fail since
 * the browser instance no longer exists"). Without an explicit `timeout=`
 * query parameter on the connection URL, Browserless applies its own
 * default (documented as 300000ms) or the account plan's own lower cap
 * (Free tier: 120000ms) — neither of which this code was ever setting.
 *
 * Cadastral-mode research runs TAS_MAP first (ResearchContext.ts's
 * buildInitialSteps()). TAS_MAP is a long, retry-heavy workflow by design
 * (openParcelInfoWithRetry() alone retries up to 60 times; NAPR registration
 * document traversal adds a real page load + PDF fetch/parse per
 * registration) — comfortably long enough to approach or exceed a short
 * default session deadline. Production evidence for this exact incident:
 * TAS_MAP genuinely completed (sourcesCompleted:1) and the VERY NEXT
 * ctx.newPage() call (for the second source, `tas`) failed with
 * "browserContext.newPage: Target page, context or browser has been
 * closed" — precisely the documented Browserless timeout-teardown
 * signature, not a bug in this code's own context/page ownership (that
 * ownership was independently audited and confirmed correct: every source
 * closes only the page it opened, never the shared job-level context or
 * the browser — see ResearchOrchestrator.ts's runStep()).
 *
 * Fix: request an explicit, generous session lifetime up front so a normal
 * multi-source job finishes comfortably inside it. The exact right value
 * depends on the account's Browserless plan (Free/Prototyping/Starter/
 * Scale/Enterprise each cap it differently) which this code cannot query —
 * BROWSERLESS_SESSION_TIMEOUT_MS lets the operator tune it to their actual
 * plan without a code change. The default below (10 minutes) is chosen to
 * sit comfortably under the lowest realistic PAID tier's cap (Prototyping:
 * 15 minutes) while covering a worst-case single-source retry budget; it is
 * deliberately NOT the Browserless default (300s), which is already proven
 * too short. If the configured value exceeds what the account's plan
 * allows, Browserless rejects the connection outright with a distinct,
 * documented error ("Reconnect timeout (Xms) exceeds the maximum allowed
 * limit") — launchResearchBrowser() detects exactly that message and
 * retries once WITHOUT a timeout param (falling back to whatever the
 * account's own default/plan cap is) rather than permanently failing every
 * single job because of one misconfigured environment value.
 *
 * This raises the deadline; it does not remove it, and it cannot make a
 * session live forever. See researchContext()'s isContextAlive() and
 * BrowserDisconnectedError below for the second, independent half of this
 * fix: detecting and gracefully recovering from a session that dies anyway
 * (a real Browserless outage, a plan downgrade, a job that simply runs
 * longer than any configured budget) instead of trusting a cached
 * reference blindly.
 */
const DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_TIMEOUT_MS = (() => {
  const raw = Number(process.env.BROWSERLESS_SESSION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_TIMEOUT_MS;
})();

/** Thrown by researchContext() when the underlying Browserless browser/CDP
 * connection itself is confirmed gone (not merely its cached context) —
 * this module only knows how to work with a live `browser` it was handed,
 * not how to obtain a new one. Recovery policy (whether/how to relaunch and
 * retry the current step) is a job-level decision that belongs to
 * ResearchOrchestrator, which is why this is a distinct, catchable type
 * rather than a generic Error. */
export class BrowserDisconnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserDisconnectedError';
  }
}

/** Structured, secret-free lifecycle diagnostics (mandate: "make ownership
 * violations obvious" without ever logging a token/credential/authenticated
 * CDP URL). Every field here is a safe id, count, or boolean — never an env
 * var, never anything derived from BROWSERLESS_TOKEN/BRIDGE_KEY/WORKER_TOKEN
 * /SUPABASE secrets, never the connect URL. Kept as one small helper so
 * every call site is easy to audit for that invariant at a glance. */
export function logBrowserLifecycle(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), scope: 'browserless_lifecycle', event, ...fields }));
  } catch {
    // Diagnostics must never be able to break the research flow.
  }
}

async function browserlessToken(): Promise<string> {
  if (DIRECT_TOKEN) return DIRECT_TOKEN;

  if (!BRIDGE_URL || !BRIDGE_KEY) {
    throw new Error('remote browser bridge is not configured');
  }

  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_KEY}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `remote browser bridge unavailable (${response.status})`
    );
  }

  const body = (await response.json()) as any;
  const token = String(body?.token || '').trim();

  if (!token) {
    throw new Error('remote browser credential unavailable');
  }

  return token;
}

export function browserlessConfigured(): boolean {
  return !!DIRECT_TOKEN || (!!BRIDGE_URL && !!BRIDGE_KEY);
}

/** Exceeding the account's own Browserless plan cap is a distinct,
 * documented failure mode ("Reconnect timeout (Xms) exceeds the maximum
 * allowed limit") — never the same thing as Browserless/the bridge being
 * unreachable. Matched narrowly (on Browserless's own wording) so a
 * genuine outage still fails closed instead of silently retrying forever. */
// Exported (in addition to being used internally) so regression tests can
// exercise this exact matching logic directly, rather than only indirectly
// through a live/mocked chromium.connectOverCDP() call — no behavior change.
export function exceedsPlanTimeoutLimit(e: unknown): boolean {
  const message = String((e as any)?.message ?? e ?? '');

  return (
    /exceeds the maximum allowed/i.test(message) ||
    (
      /timeout/i.test(message) &&
      /between\s+1\s+and\s+[\d,]+/i.test(message) &&
      /maximum session time/i.test(message)
    )
  );
}

async function connectBrowserless(token: string, timeoutMs: number | null): Promise<any> {
  const sep = ENDPOINT.includes('?') ? '&' : '?';
  const url = timeoutMs
    ? `${ENDPOINT}${sep}token=${encodeURIComponent(token)}&timeout=${timeoutMs}`
    : `${ENDPOINT}${sep}token=${encodeURIComponent(token)}`;
  return chromium.connectOverCDP(url, { timeout: 30000 });
}

export async function launchResearchBrowser(): Promise<any> {
  /*
   * Production must fail closed if bridge configuration exists but
   * Browserless cannot be reached. We must NOT silently switch a production
   * Verify job to a different local browser/session.
   *
   * Local Chromium remains available only when no Browserless configuration
   * exists at all (developer/local environment).
   */
  if (!browserlessConfigured()) {
    return chromium.launch({
      headless: false,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
  }

  const token = await browserlessToken();

  let browser: any;
  let requestedTimeoutMs: number | 'account_default' = SESSION_TIMEOUT_MS;
  try {
    browser = await connectBrowserless(token, SESSION_TIMEOUT_MS);
  } catch (e) {
    if (!exceedsPlanTimeoutLimit(e)) throw e;
    // The configured BROWSERLESS_SESSION_TIMEOUT_MS exceeds what this
    // account's plan allows — fall back to the account's own default/cap
    // rather than permanently failing every job over one env value. Logged
    // so this is visible and correctable, never silently different every
    // run.
    requestedTimeoutMs = 'account_default';
    logBrowserLifecycle('session_timeout_rejected_by_plan', { requestedMs: SESSION_TIMEOUT_MS });
    browser = await connectBrowserless(token, null);
  }

  (browser as any).__homatchBrowserless = true;
  (browser as any).__homatchConnectedAt = Date.now();
  logBrowserLifecycle('browser_connected', { requestedTimeoutMs });
  return browser;
}

/**
 * Proves whether a CACHED context reference is still a genuinely live
 * remote BrowserContext, never just "the JS object still exists" (mandate:
 * "A cached object reference does NOT prove that the remote BrowserContext
 * is alive"). Three independent checks, cheapest first:
 *
 *  1. browser.isConnected() — catches a fully dead CDP/browser connection
 *     (e.g. a Browserless session-timeout teardown, see the module header).
 *  2. browser.contexts().includes(ctx) — catches a context that was closed
 *     (by us, by Browserless, or by a future bug) while the browser/CDP
 *     connection itself is still alive.
 *  3. ctx.pages() — a real round-trip against the remote target. This is
 *     the ONLY check that can distinguish "connected browser + genuinely
 *     live context" from "connected browser + this one context died some
 *     other way" (a stale/half-torn-down context can still show up in
 *     browser.contexts() depending on timing). Deliberately never treated
 *     as a liveness signal by its RESULT (`pages().length === 0` is a
 *     completely normal, healthy state between sources per the mandate's
 *     explicit warning) — only whether the call succeeds or throws matters
 *     here.
 */
// Exported (in addition to being used internally by researchContext()) so
// each of the three liveness checks below can be exercised in isolation by
// regression tests — no behavior change.
export async function isContextAlive(browser: any, ctx: any): Promise<boolean> {
  if (!ctx) return false;
  try {
    if (typeof browser.isConnected === 'function' && !browser.isConnected()) return false;
  } catch {
    return false;
  }
  try {
    const known = browser.contexts?.() || [];
    if (!known.includes(ctx)) return false;
  } catch {
    return false;
  }
  try {
    // Never `.length === 0` as the signal — success alone is the proof.
    ctx.pages();
    return true;
  } catch {
    return false;
  }
}

export async function researchContext(browser: any): Promise<any> {
  if ((browser as any).__homatchBrowserless) {
    /*
     * One Browserless BrowserContext belongs to the whole research job.
     *
     * connectOverCDP() does not guarantee that contexts()[0] exists for the
     * lifetime of the connection. Production proved that TAS_MAP could finish
     * successfully and the following TAS step could then observe zero default
     * contexts.
     *
     * Cache the adopted/created context on the Browser object itself so every
     * source transition reuses the same cookies/session. This is also required
     * for WAITING_HUMAN: CAPTCHA resume must continue in the exact context in
     * which the human completed the challenge. researchContext() is never
     * called while a WAITING_HUMAN session is active for a job — resume()/
     * skip() operate on the preserved SessionState's own `ctx`/`page`
     * directly and never re-derive them from here — so the invalidate/
     * recreate path below can never race a live human CAPTCHA session.
     */
    const cached = (browser as any).__homatchResearchContext;
    if (cached && (await isContextAlive(browser, cached))) return cached;

    if (cached) {
      // Confirmed dead — never blindly reuse it again. This is the fix for
      // the second half of the P0 incident: even once a session recovers
      // (a fresh browser after a reconnect, or Browserless adopting a new
      // default context), the old code would have kept returning this same
      // dead reference forever.
      logBrowserLifecycle('cached_context_invalidated', {});
      (browser as any).__homatchResearchContext = undefined;
    }

    if (typeof browser.isConnected === 'function' && !browser.isConnected()) {
      // The browser/CDP connection itself is gone, not just this context.
      // This module cannot obtain a new browser on its own — that is a
      // job-level recovery decision (see ResearchOrchestrator.runStep()'s
      // bounded, once-per-job reconnect).
      throw new BrowserDisconnectedError('Browserless browser connection is no longer alive');
    }

    const existing = browser.contexts?.() || [];
    const ctx =
      existing[0] ||
      (await browser.newContext({
        locale: 'ka-GE',
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      }));

    (browser as any).__homatchResearchContext = ctx;
    logBrowserLifecycle('research_context_ready', { adopted: !!existing[0] });
    return ctx;
  }

  return browser.newContext({
    locale: 'ka-GE',
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  });
}

/*
 * liveURL EXPOSURE SAFETY.
 *
 * Browserless's `Browserless.liveURL` returns a URL its own live-view UI is
 * served from. Its exact shape is account-, region- and version-dependent,
 * and this repository contains NO captured sample of one (checked: the
 * forensic archives record only `liveURL: true` booleans, never a URL), so
 * the format is deliberately NOT assumed here. It is classified at runtime,
 * on the actual string Browserless returned, immediately before anything is
 * exposed over HTTP.
 *
 * Only a URL proven to carry no credential is handed to the client directly
 * (e.g. embedded in the widely-polled GET /research/:id job document, which
 * research-agent stores and logs downstream). Anything else is withheld and
 * reached instead through the authenticated worker endpoint, so a
 * credential-bearing URL is only ever handed to a caller that already
 * authenticated for this specific job.
 *
 * Two independent checks, both fail-closed:
 *  1. Known-secret substring. The account's own BROWSERLESS_TOKEN /
 *     BROWSERLESS_TOKEN_BRIDGE_KEY / WORKER_TOKEN must never appear ANYWHERE
 *     in the URL — path, query or fragment. This is the strongest available
 *     guarantee because it compares against the real secret values rather
 *     than guessing at a format.
 *  2. Credential-shaped query parameter. A parameter named like a
 *     credential is treated as one even when its value matches no secret we
 *     hold (Browserless can mint a per-session token of its own). `t` is
 *     included deliberately: it is a plausible abbreviation for a token, and
 *     a false positive costs nothing but routing through the authenticated
 *     endpoint, while a false negative would publish a credential.
 *
 * An unparseable or non-https URL is also unsafe — never exposed, never
 * "probably fine".
 */
const CREDENTIAL_QUERY_KEY =
  /^(t|token|api[_-]?key|key|auth|authorization|access[_-]?token|id[_-]?token|refresh[_-]?token|jwt|secret|password|passwd|pwd|sig|signature|session[_-]?token|sessiontoken)$/i;

/** Secrets this process holds that must never leave it inside a URL. Read at
 * call time (not module load) so a test or a rotated env value is honoured,
 * and length-filtered so a short/blank value can never match everything. */
function knownSecretValues(): string[] {
  return [DIRECT_TOKEN, BRIDGE_KEY, String(process.env.WORKER_TOKEN || '').trim()]
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 8);
}

export function classifyLiveURLExposure(
  liveURL: string,
  secrets: string[] = knownSecretValues()
): { safe: boolean; reason: string } {
  const raw = String(liveURL || '').trim();
  if (!raw) return { safe: false, reason: 'empty' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { safe: false, reason: 'unparseable' };
  }
  if (parsed.protocol !== 'https:') return { safe: false, reason: 'not_https' };

  for (const secret of secrets) {
    if (raw.includes(secret)) return { safe: false, reason: 'contains_known_secret' };
  }

  for (const key of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEY.test(key)) return { safe: false, reason: 'credential_query_param' };
  }

  return { safe: true, reason: 'opaque_no_credential_detected' };
}

/**
 * The plan's own maximum, read out of Browserless's own rejection message.
 *
 * PRODUCTION INCIDENT 2026-09-08 (job aaf11509-391c-4799-b0af-2d074594d49a):
 * Browserless answered Browserless.liveURL with
 *
 *   The 'timeout' value must be a whole number of milliseconds between
 *   1 and 120,000 (your plan's maximum session time). Received "900000".
 *
 * That message states the account's real ceiling, so the fallback below uses
 * THAT number rather than a constant compiled into this worker — a plan
 * change moves the ceiling with no code change. Returns null when the
 * message carries no parseable limit, in which case the caller omits the
 * field entirely and lets Browserless apply its own default. Never assumes
 * 120000: that value is this one account's current plan, not a universal.
 */
export function planTimeoutLimitMs(e: unknown): number | null {
  const message = String((e as any)?.message ?? e ?? '');
  const match = message.match(/between\s+1\s+and\s+([\d,]+)/i);
  if (!match) return null;
  const parsed = Number(String(match[1]).replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/* ============================================================== *
 * TRUSTED BROWSERLESS LIVE CAPABILITY
 *
 * PRODUCTION INCIDENT 2026-09-08, job 785134fd-5210-4bf2-8315-6a927403c2dd.
 * Browserless minted a real interactive live view and the watch attached at
 * generation=1, but the URL Browserless itself returned carries an
 * authentication/capability query parameter, so classifyLiveURLExposure()
 * — correctly, for an arbitrary URL — reported credential_query_param and
 * the job document withheld it.
 *
 * A live URL returned BY Browserless is not "a URL that happens to contain a
 * token": it is an ephemeral capability Browserless issued to us, for one
 * page, for a bounded lifetime. The distinction that makes it exposable is
 * PROVENANCE, not the shape of the string — so trust is carried by an object
 * that only this module can create, never re-derived from a naked string.
 *
 * The registry below is a module-private WeakSet. There is no exported mint
 * function: the ONLY way an object gets into it is a successful
 * Browserless.liveURL round trip inside createHumanLiveURL(). A hand-built
 * object, a value parsed from JSON, a string copied out of a log or a job
 * document can never be a member, so none of them can ever be exposed
 * through the capability path — they fall through to the unchanged generic
 * classifier and are refused exactly as before.
 * ============================================================== */

export interface LiveCapability {
  readonly liveURL: string;
  readonly liveURLId: string | null;
  readonly origin: string;
  readonly issuedAt: number;
  /** Deadline derived from the timeout Browserless actually ACCEPTED. null
   * when no timeout was sent (Browserless applied its own default), in which
   * case this worker cannot know the deadline and the underlying Browserless
   * session lifetime is the only bound. */
  readonly expiresAt: number | null;
  /** What the generic classifier says about this URL — recorded for
   * diagnostics only, never as the exposure decision. True for the
   * production URL above. */
  readonly carriesCredentialParam: boolean;
}

const TRUSTED_LIVE_CAPABILITIES = new WeakSet<object>();

/** Provenance test: was this exact object minted by a successful
 * Browserless.liveURL call in this process? Nothing else can be. */
export function isTrustedLiveCapability(candidate: unknown): candidate is LiveCapability {
  return typeof candidate === 'object' && candidate !== null && TRUSTED_LIVE_CAPABILITIES.has(candidate as object);
}

/** Extra live-view origins, when an account serves live views from a host
 * other than its CDP endpoint. Comma-separated hostnames or origins. */
const EXTRA_LIVE_ORIGINS = String(process.env.BROWSERLESS_LIVE_ORIGINS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function configuredBrowserlessHost(): string | null {
  try {
    return new URL(ENDPOINT).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Allowed live-view origins come from CONFIGURATION — the account's own
 * Browserless endpoint (and its registrable domain, since live views may be
 * served from a sibling host of the same deployment) plus an explicit
 * operator allowlist. Never a hardcoded blanket "any browserless.io URL":
 * this check only ever RESTRICTS an already-trusted capability further, and
 * grants nothing on its own. */
export function isAllowedLiveOrigin(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (EXTRA_LIVE_ORIGINS.includes(host) || EXTRA_LIVE_ORIGINS.includes(parsed.origin.toLowerCase())) return true;

  const configured = configuredBrowserlessHost();
  if (!configured) return false;
  if (host === configured) return true;

  const parts = configured.split('.');
  const registrable = parts.length <= 2 ? configured : parts.slice(-2).join('.');
  return host === registrable || host.endsWith(`.${registrable}`);
}

/**
 * The narrow trust boundary. A capability may be handed to an authenticated
 * caller only when ALL of these hold — provenance first, so a URL that merely
 * looks right can never qualify:
 *   1. it was minted by our own trusted Browserless.liveURL round trip;
 *   2. https;
 *   3. its origin is an allowed Browserless live-view origin (config);
 *   4. it does not contain one of THIS account's own secrets (a Browserless
 *      capability token is Browserless's to issue; our BROWSERLESS_TOKEN /
 *      bridge key / WORKER_TOKEN must never leave the process either way);
 *   5. it has not expired.
 * A Browserless-issued capability query parameter alone never disqualifies.
 */
export function classifyLiveCapabilityExposure(candidate: unknown, now: number = Date.now()): { safe: boolean; reason: string } {
  if (!isTrustedLiveCapability(candidate)) return { safe: false, reason: 'untrusted_provenance' };

  let parsed: URL;
  try {
    parsed = new URL(candidate.liveURL);
  } catch {
    return { safe: false, reason: 'unparseable' };
  }
  if (parsed.protocol !== 'https:') return { safe: false, reason: 'not_https' };
  if (!isAllowedLiveOrigin(parsed)) return { safe: false, reason: 'origin_not_allowed' };
  for (const secret of knownSecretValues()) {
    if (candidate.liveURL.includes(secret)) return { safe: false, reason: 'contains_known_secret' };
  }
  if (candidate.expiresAt !== null && now >= candidate.expiresAt) return { safe: false, reason: 'expired' };

  return { safe: true, reason: 'trusted_browserless_capability' };
}

/**
 * The ONE decision point for handing a live URL to an authenticated caller.
 *
 * A trusted capability is judged by the capability rules above. ANYTHING
 * else — a naked string from a job document, a source page, a request body,
 * the database, a log line — is judged by the UNCHANGED generic classifier,
 * so a credential-bearing URL from any untrusted origin still fails closed
 * exactly as it did before this incident.
 */
export function exposableLiveURL(candidate: unknown, now: number = Date.now()): { liveURL: string | null; reason: string } {
  if (isTrustedLiveCapability(candidate)) {
    const verdict = classifyLiveCapabilityExposure(candidate, now);
    return { liveURL: verdict.safe ? candidate.liveURL : null, reason: verdict.reason };
  }
  const raw = typeof candidate === 'string' ? candidate : String((candidate as any)?.liveURL ?? '');
  const generic = classifyLiveURLExposure(raw);
  return { liveURL: generic.safe ? raw : null, reason: generic.safe ? generic.reason : `untrusted_${generic.reason}` };
}

function mintLiveCapability(liveURL: string, liveURLId: string | null, effectiveTimeoutMs: number | null): LiveCapability {
  const issuedAt = Date.now();
  let origin = '';
  try {
    origin = new URL(liveURL).origin;
  } catch {
    origin = '';
  }
  const capability: LiveCapability = {
    liveURL,
    liveURLId,
    origin,
    issuedAt,
    expiresAt: effectiveTimeoutMs === null ? null : issuedAt + effectiveTimeoutMs,
    carriesCredentialParam: !classifyLiveURLExposure(liveURL).safe,
  };
  TRUSTED_LIVE_CAPABILITIES.add(capability);
  return capability;
}

/** One Browserless.liveURL round trip. `timeoutMs === null` omits the field
 * entirely so Browserless applies the account default. Normalizes both
 * failure shapes (a thrown CDP error and a `{ error }` payload) into a
 * thrown Error, so one matcher — exceedsPlanTimeoutLimit() — can classify
 * either. */
async function sendLiveURL(cdp: any, timeoutMs: number | null): Promise<{ liveURL: string; liveURLId: string | null }> {
  const params: Record<string, unknown> = {
    interactable: true,
    resizable: true,
    showBrowserInterface: false,
    quality: 75,
    type: 'jpeg',
    compressed: true,
    emulateComponents: true,
  };
  if (timeoutMs !== null) params.timeout = timeoutMs;

  const result: any = await cdp.send('Browserless.liveURL', params);

  if (result?.error || !result?.liveURL) {
    throw new Error(result?.error || 'live browser URL unavailable');
  }

  return { liveURL: result.liveURL, liveURLId: result.liveURLId || null };
}

/**
 * Mints the interactive live view for a page — the WAITING_HUMAN CAPTCHA
 * session and the opt-in visual watch both come through here, so both get
 * identical plan handling.
 *
 * PLAN-TIMEOUT FALLBACK (production incident aaf11509, above). Callers ask
 * for a generous live-view lifetime (the human-session TTL, 15 minutes).
 * On a plan whose maximum session time is lower — currently 120,000ms —
 * Browserless rejects the request OUTRIGHT, and before this fix that single
 * rejection made the whole feature unavailable: visual_watch_unavailable at
 * generation 0, and POST /research/:id/live answering 404 for the entire
 * job.
 *
 * This is the exact situation launchResearchBrowser() already handles for
 * the CDP CONNECTION, and it is handled the same way here, reusing the same
 * exceedsPlanTimeoutLimit() matcher (verified against the production wording
 * above) rather than adding a second fragile message matcher: on a
 * plan-limit rejection, retry EXACTLY ONCE with the plan's own maximum as
 * Browserless reported it, or with no timeout field at all when the message
 * carries no parseable limit.
 *
 * Bounded to one fallback, and only for that one specific rejection. Every
 * other failure — Browserless down, the page gone, the session already
 * expired — is thrown on the first attempt exactly as before, and the caller
 * (HumanLiveSession.openHumanLiveSession) turns it into a non-fatal
 * "unavailable": research continues, no property evidence is affected.
 */
export async function createHumanLiveURL(
  page: any,
  timeoutMs = 12 * 60 * 1000
): Promise<{ liveURL: string; liveURLId: string | null; capability: LiveCapability }> {
  if (!(page?.context?.())) {
    throw new Error('remote live browser session is unavailable');
  }

  const ctx = page.context();
  const cdp = await ctx.newCDPSession(page);

  try {
    try {
      const first = await sendLiveURL(cdp, timeoutMs);
      // Minted HERE and only here: this value came straight off a successful
      // Browserless.liveURL round trip, which is what makes it trusted.
      return { ...first, capability: mintLiveCapability(first.liveURL, first.liveURLId, timeoutMs) };
    } catch (e) {
      if (!exceedsPlanTimeoutLimit(e)) throw e;

      const planLimitMs = planTimeoutLimitMs(e);
      // Never the URL, never a token, never the liveURLId — only the numbers
      // needed to see and correct a plan/timeout mismatch in production.
      logBrowserLifecycle('live_url_timeout_rejected_by_plan', {
        requestedMs: timeoutMs,
        fallbackMs: planLimitMs ?? 'account_default',
      });
      // Exactly one fallback attempt. If this one fails too, it throws and
      // the caller fails closed.
      const fallback = await sendLiveURL(cdp, planLimitMs);
      // The capability's deadline follows the timeout Browserless ACCEPTED,
      // not the one we asked for.
      return { ...fallback, capability: mintLiveCapability(fallback.liveURL, fallback.liveURLId, planLimitMs) };
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

export async function closeHumanLiveURL(
  page: any,
  liveURLId: string | null | undefined
): Promise<void> {
  if (!liveURLId) return;

  let cdp: any = null;

  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Browserless.closeLiveURL', { liveURLId });
  } catch {
    // Best-effort cleanup only.
  } finally {
    await cdp?.detach?.().catch(() => {});
  }
}
