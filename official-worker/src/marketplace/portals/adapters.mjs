import { placege } from './adapters/placege.mjs';
import { brokeri } from './adapters/brokeri.mjs';
import { homege } from './adapters/homege.mjs';
import { allhome } from './adapters/allhome.mjs';

/** Find Property HTML portals run by this worker. Each idles until enabled.
 *  Not here: korter.ge (terms §5.3 forbid scraping — BLOCKED_BY_TERMS) and binebi.ge
 *  (Cloudflare challenge on every public page). */
export const PORTAL_ADAPTERS = [placege, homege, brokeri, allhome];
