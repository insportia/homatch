// What the browser worker can do on each portal, and how sure we are.
// Mirrors supabase/functions/publishing-engine/automation.ts BROWSER_CAPABILITIES
// (a parity test keeps them identical). Levels: NOT_EXPLORED < FIXTURE_TESTED <
// LIVE_NAVIGATION_VERIFIED < LIVE_OPERATION_VERIFIED. Never raise a level without
// the evidence that level names.

import { type Level, type OpKind, OP_KINDS } from './contract.js';

const NONE = Object.fromEntries(OP_KINDS.map((k) => [k, 'NOT_EXPLORED'])) as Record<OpKind, Level>;
const RECORDED: Record<OpKind, Level> = { ...NONE, CHECK_SESSION: 'FIXTURE_TESTED', CREATE: 'FIXTURE_TESTED', STATUS: 'FIXTURE_TESTED' };

export const CAPABILITIES: Record<string, Record<OpKind, Level>> = {
  myhome: RECORDED,
  ssge: RECORDED,
  placege: NONE, homege: NONE, brokeri: NONE, korter: NONE, binebi: NONE, allhome: NONE,
};
