import { placege } from './adapters/placege.mjs';
import { korter } from './adapters/korter.mjs';
import { brokeri } from './adapters/brokeri.mjs';

/** Find Property HTML portals run by this worker. Each idles until enabled. */
export const PORTAL_ADAPTERS = [placege, korter, brokeri];
