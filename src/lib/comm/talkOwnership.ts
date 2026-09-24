/*
 * WHO OWNS THE MICROPHONE, AND WHY IT CANNOT BE A useRef.
 *
 * MEASURED, production 2026-09-24T18:21:35Z. One tap on AI TALK produced TWO
 * complete sessions 46 milliseconds apart:
 *
 *   c6e9e704   granted .326   cache warm   t1 at 18:22:03.826
 *   3db050f2   granted .377   cache warm   t1 at 18:21:51.701
 *
 * Both opened their own microphone, their own speech sockets (the grants
 * arrive in pairs 33-93 ms apart all through the session), their own prompt
 * cache warm-up, and each answered the SAME four-word sentence -- twelve
 * seconds apart. Both transcripts were identical, 20 characters, with
 * voiced_before_ready_ms = 0 on both: nothing was lost, everything was heard
 * twice. The visitor experienced that as a swallowed opening sentence,
 * because the panel is bound to one session and the other one was also
 * talking. One was ended by the visitor; the other leaked, ACTIVE, for sixty
 * billed seconds.
 *
 * THE GUARD THAT EXISTED WAS SOUND AND STILL LOST.
 *
 * AiTalkPanel already held `startInFlight`, a ref carrying the in-flight
 * activation promise, and within one component instance it is airtight:
 * start() has exactly one caller, and nothing can interleave between calling
 * startOnce() and storing its promise. But a ref belongs to a component
 * INSTANCE. Two instances get two refs, and two refs agree about nothing.
 *
 * So ownership moved here, to module scope, where it is one value per page
 * context no matter how many components ask.
 *
 * WHAT THIS CANNOT DO, STATED PLAINLY.
 *
 * Module scope is one JavaScript context. It does not span two browser tabs,
 * and it does not survive a reload. A visitor with the page open twice is
 * outside its reach entirely. That is not a gap to apologise for, it is the
 * reason the server carries its own guard: `perVisitorConcurrent` is 1 and
 * the edge collapses a duplicate to a single session before either can spend
 * anything. This layer stops the common case cheaply and immediately; that
 * layer stops the rest. Neither is sufficient alone.
 */

/** The live session this page context owns, if any. */
interface Ownership {
  sessionId: string;
  /** Which component instance is currently driving it. */
  instanceId: string;
  claimedAt: number;
  /** Stop the client pipeline and tell the server. Idempotent. */
  dispose: (reason: string) => Promise<void>;
}

/*
 * The in-flight activation, held as `unknown` because this file does not care
 * what an activation resolves to -- only that there is exactly one of them.
 * claimActivation is generic so callers keep their own return type.
 */
let activation: Promise<unknown> | null = null;
let owner: Ownership | null = null;
let releaseTimer: number | null = null;
/*
 * Instances that have already gone away.
 *
 * An unmount can land WHILE the activation is still in the air, and at that
 * moment there is no ownership to release -- the session does not exist yet.
 * Without this the activation would come home a moment later, take ownership
 * on behalf of a component that no longer exists, and hold a microphone open
 * that nothing would ever release. That is the original leak wearing a
 * different hat, and it is the case the regression suite caught rather than
 * production, which is the whole point of writing it down first.
 */
const departed = new Set<string>();

/*
 * HOW LONG A SESSION OUTLIVES THE COMPONENT THAT STARTED IT.
 *
 * A React remount is unmount-then-mount with nothing in between, and killing
 * a healthy conversation because its component was re-created would be a
 * worse defect than the one this file exists for -- the visitor would be cut
 * off mid-sentence by a re-render.
 *
 * So an unexplained unmount does not end anything immediately: it starts this
 * clock, and a new instance that mounts inside the window ADOPTS the running
 * session instead of starting a second one. Nothing is torn down and nothing
 * is duplicated.
 *
 * Deliberate endings do not wait: followDestination and the End button call
 * release() directly, which cancels the clock and disposes at once. This
 * window only ever covers an unmount nobody asked for.
 *
 * 1,200 ms is comfortably longer than a synchronous remount and far shorter
 * than a visitor would tolerate a microphone staying open after leaving.
 */
const ADOPTION_GRACE_MS = 1_200;

/*
 * Counts, never identities. Enough to answer "did this happen again, and
 * which way" from a production trace without putting a person in a log.
 */
const stats = {
  activationsStarted: 0,
  activationsDeduped: 0,
  ownershipAdopted: 0,
  staleStartsRejected: 0,
  /** Unmounts nobody came back for: the leak this file closes. */
  orphansDisposed: 0,
  /** Ends the visitor actually asked for. Not a leak, counted apart. */
  deliberateEndings: 0,
  releasesCancelled: 0,
};

/** A short, non-identifying id for one component instance. */
export function newInstanceId(): string {
  return `i${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run the activation, or join the one already running.
 *
 * THE PROMISE IS THE GUARD, NOT A BOOLEAN. A second caller does not get told
 * to go away -- it awaits the same activation the first one started, so it
 * still ends up with a session and there is still only one. That property is
 * what makes this safe to call from a retry, a second instance, or a double
 * tap without any of them needing to know about the others.
 */
export function claimActivation<T>(run: () => Promise<T>): Promise<T> {
  if (activation) {
    stats.activationsDeduped += 1;
    return activation as Promise<T>;
  }
  stats.activationsStarted += 1;
  const attempt = run().finally(() => { activation = null; });
  activation = attempt;
  return attempt;
}

/** Is an activation in flight right now? */
export function activationInFlight(): boolean {
  return activation !== null;
}

/**
 * This instance is now driving this session.
 *
 * Cancels any pending release, because a session being adopted is a session
 * nobody is abandoning.
 */
export function takeOwnership(
  instanceId: string,
  sessionId: string,
  dispose: Ownership['dispose'],
): boolean {
  /*
   * The component that asked for this is already gone. Refusing is not
   * enough -- the caller is told so, and disposes, because the session exists
   * on the server whether or not anybody is left to drive it.
   */
  if (departed.has(instanceId)) return false;
  cancelRelease();
  owner = { sessionId, instanceId, claimedAt: Date.now(), dispose };
  return true;
}

/**
 * Is this instance still the authority for this session?
 *
 * The question a start response has to answer before it does anything. A
 * request that was superseded while it was in flight must not open a
 * microphone: that is the second pipeline arriving late, and it is exactly as
 * damaging as the one that arrives early.
 */
export function isAuthoritative(instanceId: string, sessionId: string): boolean {
  return owner !== null && owner.instanceId === instanceId && owner.sessionId === sessionId;
}

/** The session this page context currently owns, if any. */
export function currentSessionId(): string | null {
  return owner?.sessionId ?? null;
}

/**
 * A start that finished after somebody else became authoritative.
 *
 * Counted and reported, because a session nobody owns is a session that will
 * leak -- the caller's job is to end it server-side, not to drop it.
 */
export function rejectStale(): void {
  stats.staleStartsRejected += 1;
}

/**
 * How a departing instance hands its session back.
 *
 *   ADOPTABLE       an unmount nobody asked for. Held for the grace window so
 *                   a remount can adopt it; disposed here if none comes.
 *   CALLER_DISPOSES a deliberate ending where the caller is already stopping
 *                   the pipeline and telling the server itself. Ownership is
 *                   dropped and NOTHING is disposed here -- disposing as well
 *                   would send the server a second `end` for the same session.
 */
export type ReleaseMode = 'ADOPTABLE' | 'CALLER_DISPOSES';

/**
 * A component that was driving a session has gone away.
 *
 * Deliberate endings -- the End button, navigation, an allowance refusal --
 * use CALLER_DISPOSES and take effect at once. Only an unexplained unmount
 * waits, and only because that is what a remount looks like from here.
 */
export function releaseOwnership(
  instanceId: string,
  reason: string,
  mode: ReleaseMode,
): void {
  /*
   * Recorded before the early return: an unmount that arrives before the
   * session does still has to be remembered, or takeOwnership will hand a
   * microphone to a component that no longer exists.
   */
  departed.add(instanceId);
  if (!owner || owner.instanceId !== instanceId) return;
  const leaving = owner;
  if (mode === 'CALLER_DISPOSES') {
    owner = null;
    cancelRelease();
    stats.deliberateEndings += 1;
    return;
  }
  cancelRelease();
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null;
    // Somebody adopted it inside the window: that was a remount, and the
    // conversation carried straight through it.
    if (owner !== leaving) return;
    owner = null;
    /*
     * Nobody came back for it. This is the case that used to leak: the
     * pipeline stopped and the server was never told, so the row stayed
     * ACTIVE and kept billing. dispose() closes both halves.
     */
    stats.orphansDisposed += 1;
    void leaving.dispose(reason);
  }, ADOPTION_GRACE_MS);
}

/**
 * A fresh instance takes over the session a departing one left running.
 *
 * Returns the session id it adopted, or null if there was nothing to adopt.
 * This is what turns a remount into a no-op instead of a second session.
 */
export function adoptExisting(instanceId: string): string | null {
  if (!owner) return null;
  cancelRelease();
  owner = { ...owner, instanceId, claimedAt: Date.now() };
  // A fresh instance is by definition not one that has left.
  departed.delete(instanceId);
  stats.ownershipAdopted += 1;
  return owner.sessionId;
}

function cancelRelease(): void {
  if (releaseTimer === null) return;
  window.clearTimeout(releaseTimer);
  releaseTimer = null;
  stats.releasesCancelled += 1;
}

/** The ownership ledger, for the turn trace. Counts only. */
export function ownershipStats(): Readonly<typeof stats> {
  return { ...stats };
}

/** Test seam. Never called by the product. */
export function __resetOwnershipForTests(): void {
  activation = null;
  owner = null;
  departed.clear();
  if (releaseTimer !== null) { clearTimeout(releaseTimer); releaseTimer = null; }
  for (const k of Object.keys(stats) as Array<keyof typeof stats>) stats[k] = 0;
}
