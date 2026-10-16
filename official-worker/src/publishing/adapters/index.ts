// The portal adapters the browser worker knows. A portal without an entry has no
// recorded workflow: nothing is attempted there (its operations stay with the
// HOMATCH admin queue). Place.ge, Home.ge, Brokeri.ge, Allhome.ge, Korter.ge and
// Binebi.ge are added here, independently, once their workflows are explored.

import type { PortalAdapter } from '../contract.js';
import { myhome } from './myhome.js';
import { ssge } from './ssge.js';

export const ADAPTERS: Record<string, PortalAdapter> = { myhome, ssge };
export const adapterFor = (portal: string): PortalAdapter | null => ADAPTERS[portal] ?? null;
