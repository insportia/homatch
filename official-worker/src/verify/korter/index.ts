// Verify Korter provider — isolated, OFF by default. See access.ts (terms and
// robots check) and feed.ts (licensed-feed normaliser). Nothing here is
// called from the paid Verify job flow; a caller must first see
// status === 'AUTHORIZED_FEED'.
export * from './access.js';
export * from './feed.js';

import { checkKorterAccess, type KorterAccessResult } from './access.js';

/** The access check, cached in memory so a status page cannot hammer korter.ge. */
export function korterStatusCache(ttlMs = 60 * 60 * 1000, check: () => Promise<KorterAccessResult> = () => checkKorterAccess()) {
  let cached: { at: number; result: KorterAccessResult } | null = null;
  let inflight: Promise<KorterAccessResult> | null = null;
  return async (refresh = false): Promise<KorterAccessResult & { cached: boolean }> => {
    if (!refresh && cached && Date.now() - cached.at < ttlMs) return { ...cached.result, cached: true };
    if (!inflight) {
      inflight = check()
        .then((result) => {
          cached = { at: Date.now(), result };
          return result;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return { ...(await inflight), cached: false };
  };
}
