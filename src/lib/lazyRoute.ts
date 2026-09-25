// HOMATCH — a route whose code no longer exists on the server.
//
// THE BUG THIS FIXES
//
// Open Homatch, leave the tab, we deploy, come back, click anything. The page
// showed "Something went wrong on our side. Please refresh the page and try
// again." A refresh fixed it, every time, which is what made it look like a
// mystery instead of a build problem.
//
// It is neither mysterious nor a React bug. Routes are lazy, so the running
// tab holds a bundle that names its chunks by content hash —
// /assets/PricingPage-Ab12Cd34.js. A deploy replaces those files with new
// hashes. The old names are gone, and vercel.json rewrote EVERYTHING that did
// not match a file on disk to /index.html:
//
//     { "source": "/(.*)", "destination": "/index.html" }
//
// So the browser asked for a missing JavaScript module and was handed HTML
// with 200 OK. Measured against production on 2026-09-25:
//
//     GET /assets/DoesNotExist-abc12345.js  ->  200  text/html
//
// X-Content-Type-Options: nosniff is set, correctly, so the browser refuses
// it — "Expected a JavaScript module script but the server responded with a
// MIME type of text/html" — the import rejects, React.lazy throws, and the
// app-level ErrorBoundary renders its fallback. Refreshing loads the new
// index.html, which names chunks that do exist.
//
// The rewrite is fixed in vercel.json so a missing chunk is now an honest
// 404. That makes the failure diagnosable; it does not make it go away, and
// the customer must never see it either way.
//
// WHY A RELOAD IS THE FIX HERE AND NOT A DODGE
//
// A tab running a build the server no longer has cannot be repaired in place:
// the code it needs does not exist anywhere any more. Fetching it again
// cannot conjure it. The only correct recovery is to become the current
// build, which means one reload.
//
// So: one retry for an ordinary network blip, then ONE reload, guarded in
// sessionStorage so it can never become a loop — the same discipline the DOM
// self-heal in App.tsx already uses. If the chunk still will not load after
// that, the error is real and the boundary should show it rather than
// reloading forever.

import { lazy } from 'react';
import type { ComponentType } from 'react';

/** Set while a chunk-recovery reload is in flight. One per session, per tab. */
const RECOVERY_KEY = 'homatch-chunk-recovery';

/** Session storage is unavailable in some privacy modes. Never throw for it. */
function flag(action: 'get' | 'set' | 'clear'): boolean {
  try {
    if (action === 'get') return sessionStorage.getItem(RECOVERY_KEY) === '1';
    if (action === 'set') { sessionStorage.setItem(RECOVERY_KEY, '1'); return true; }
    sessionStorage.removeItem(RECOVERY_KEY);
    return true;
  } catch {
    /* No storage: the retry below still happens, the reload guard does not.
       Refusing to reload at all is the safe side of that trade. */
    return action === 'get';
  }
}

/**
 * Is this the browser saying "that module is not there"?
 *
 * Every engine words it differently and none of them use an error code, so
 * this matches on the phrases they actually produce. It is deliberately
 * narrow: a page that throws for its own reasons must reach the error
 * boundary and be seen, not be papered over with a reload.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name ?? '';
  if (name === 'ChunkLoadError') return true;
  const message = (error as { message?: string }).message ?? String(error);
  return /failed to fetch dynamically imported module/i.test(message)
    || /error loading dynamically imported module/i.test(message)
    || /importing a module script failed/i.test(message)
    || /expected a javascript module script/i.test(message)
    || /'text\/html' is not a valid javascript mime type/i.test(message);
}

/** Clears the guard once the app is running normally again. */
export function noteChunkRecoverySucceeded(): void {
  if (flag('get')) flag('clear');
}

/**
 * React.lazy, but survives a deploy that happened while the tab was open.
 *
 * Behaves exactly like lazy() for every error that is not a missing chunk.
 */
/*
 * `ComponentType<any>` mirrors React's own lazy() signature deliberately.
 * Narrowing it to `unknown` erases every page's props — a route rendered as
 * <SomePage embedded /> stops type-checking — so this is the constraint that
 * preserves them, exactly as @types/react declares it.
 */
// biome-ignore lint/suspicious/noExplicitAny: matches React.lazy's own constraint
export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  /* Injected by the tests. Production passes neither. */
  deps: { reload?: () => void; isRecovering?: () => boolean; markRecovering?: () => void } = {},
) {
  const reload = deps.reload ?? (() => { window.location.reload(); });
  const isRecovering = deps.isRecovering ?? (() => flag('get'));
  const markRecovering = deps.markRecovering ?? (() => { flag('set'); });

  return lazy(async () => {
    try {
      const mod = await load();
      noteChunkRecoverySucceeded();
      return mod;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;

      /* A blip costs one request to rule out, and is the common case on a
         flaky connection where nothing has been deployed at all. */
      try {
        const mod = await load();
        noteChunkRecoverySucceeded();
        return mod;
      } catch { /* the chunk is genuinely unreachable */ }

      if (isRecovering()) {
        /* Already reloaded once for this and it did not help. Something else
           is wrong and hiding it behind another reload would be a loop. */
        throw error;
      }
      markRecovering();
      reload();
      /* The reload is now in flight. Resolving or rejecting here would render
         something for the few frames before the document is replaced; a
         promise that never settles leaves the current page in place. */
      return new Promise<{ default: T }>(() => {});
    }
  });
}
