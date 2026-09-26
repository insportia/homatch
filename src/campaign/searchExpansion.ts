// HOMATCH — the app's one door onto the core's Expand Search logic.
//
// WHY A SEAM AND NOT A DIRECT IMPORT
//
// research-core is runtime-neutral and has one way in per consumer, and
// __tests__/runtimeNeutrality.test.mjs enforces it by name. Its own comment says
// the quiet part: "If a component ever appears in this list, that is the signal
// the seam has stopped being a seam."
//
// Same reasoning as searchLanguages.ts next door, and the same warning: the rule
// is not about this module, which is pure and harmless. It is about the next
// component, which would reach into the core for a fetch primitive and bypass
// the network policy, the rate limits and the cost accounting without anybody
// noticing until production.
//
// WHAT IS DELIBERATELY NOT RE-EXPORTED
//
// planExpansion. The screen must not decide whether an expansion is allowed or
// what it costs — the server does that, holding the campaign's real sweep
// history, and a client that computed its own answer would be a second opinion
// about money. What the screen gets is customerFacingHeadroom, whose whole job is
// to be the narrowest possible view: three numbers and a boolean, with nowhere to
// put a tier, an adapter id, a supplier name or a cost.
//
// The type is re-exported so a component can hold a headroom record it received
// from the server without describing its shape a second time.

export type {
  CustomerFacingHeadroom,
  DiscoveryHeadroom,
} from '@/research-core/discovery/search-expansion';
export { customerFacingHeadroom } from '@/research-core/discovery/search-expansion';
