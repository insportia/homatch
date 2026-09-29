// LIVE HERE — small moments in a home, made from what is actually in it.
//
// An experience is a short sequence of steps — use something, sit down,
// let the evening come — built ONLY on the living engine's machines and
// seats. It is offered when the home's own pieces can do every required
// step, and never otherwise: a home without a coffee machine offers no
// coffee. There is no separate game engine: each step is the same action a
// visitor could take by hand, and the visitor can take over at any moment.
//
// Pure: the page runs it against the scene's facts.

import type { ActionCode, InteractionRole } from './interactions.ts';

export type TimeOfDayEnv = 'DAY' | 'SUNSET' | 'EVENING' | 'NIGHT';

export type LiveStep =
  | { kind: 'ACT'; roles: InteractionRole[]; action: ActionCode; optional?: boolean }
  | { kind: 'SEAT'; posture: 'SIT' | 'LIE'; near?: InteractionRole; outdoor?: boolean; optional?: boolean }
  | { kind: 'ENV'; env: TimeOfDayEnv };

export interface Experience { id: string; titleKey: string; steps: LiveStep[] }

export const EXPERIENCES: Experience[] = [
  { id: 'coffee', titleKey: 'ds_live_coffee', steps: [
    { kind: 'ACT', roles: ['COFFEE'], action: 'MAKE_COFFEE' },
    { kind: 'ACT', roles: ['COFFEE'], action: 'DRINK' },
  ] },
  { id: 'balcony', titleKey: 'ds_live_balcony', steps: [
    { kind: 'ACT', roles: ['BALCONY_DOOR'], action: 'OPEN' },
    { kind: 'SEAT', posture: 'SIT', outdoor: true },
  ] },
  { id: 'tv', titleKey: 'ds_live_tv', steps: [
    { kind: 'SEAT', posture: 'SIT', near: 'TV' },
    { kind: 'ACT', roles: ['TV'], action: 'TURN_ON' },
  ] },
  { id: 'kitchen', titleKey: 'ds_live_kitchen', steps: [
    { kind: 'ACT', roles: ['APPLIANCE'], action: 'OPEN' },
    { kind: 'ACT', roles: ['APPLIANCE'], action: 'CLOSE' },
    { kind: 'ACT', roles: ['OVEN'], action: 'OPEN', optional: true },
    { kind: 'ACT', roles: ['OVEN'], action: 'CLOSE', optional: true },
    { kind: 'ACT', roles: ['FAUCET'], action: 'WASH_HANDS', optional: true },
  ] },
  { id: 'dinner', titleKey: 'ds_live_dinner', steps: [
    { kind: 'ACT', roles: ['STOVE'], action: 'COOK' },
    { kind: 'ACT', roles: ['STOVE'], action: 'SERVE' },
  ] },
  { id: 'evening', titleKey: 'ds_live_evening', steps: [
    { kind: 'ENV', env: 'EVENING' },
    { kind: 'ACT', roles: ['CURTAIN'], action: 'CLOSE', optional: true },
    { kind: 'ACT', roles: ['BLIND'], action: 'LOWER', optional: true },
    { kind: 'ACT', roles: ['LAMP'], action: 'TURN_ON', optional: true },
    { kind: 'SEAT', posture: 'SIT' },
  ] },
  { id: 'rest', titleKey: 'ds_live_rest', steps: [
    { kind: 'SEAT', posture: 'LIE' },
  ] },
];

export interface MachineFact {
  key: string; role: InteractionRole; objectId: string | null; state: string;
  actions: ActionCode[]; allActions: ActionCode[]; at: { x: number; y: number }; outdoor: boolean;
}
export interface SeatFact { objectId: string; postures: Array<'SIT' | 'LIE'>; at: { x: number; y: number }; outdoor: boolean }
export interface SceneFacts { machines: MachineFact[]; seats: SeatFact[] }

export type ResolvedStep =
  | { kind: 'ACT'; key: string; role: InteractionRole; action: ActionCode; objectId: string | null }
  | { kind: 'SEAT'; objectId: string; posture: 'SIT' | 'LIE' }
  | { kind: 'ENV'; env: TimeOfDayEnv };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * What a step means in this home, nearest to `from`. `prefer` keeps an
 * experience on the same piece across its steps (open THIS fridge, then
 * close it). Null when the home cannot do it.
 */
export function resolveStep(step: LiveStep, facts: SceneFacts, from: { x: number; y: number }, prefer: string | null = null): ResolvedStep | null {
  if (step.kind === 'ENV') return step;
  if (step.kind === 'ACT') {
    const able = facts.machines.filter((m) => step.roles.includes(m.role) && m.allActions.includes(step.action));
    if (!able.length) return null;
    const kept = prefer ? able.find((m) => m.key === prefer) : undefined;
    const m = kept ?? [...able].sort((a, b) => dist(a.at, from) - dist(b.at, from))[0];
    return { kind: 'ACT', key: m.key, role: m.role, action: step.action, objectId: m.objectId };
  }
  let seats = facts.seats.filter((s) => s.postures.includes(step.posture) && (step.outdoor === undefined || s.outdoor === step.outdoor));
  if (!seats.length) return null;
  let origin = from;
  if (step.near) {
    const thing = facts.machines.filter((m) => m.role === step.near).sort((a, b) => dist(a.at, from) - dist(b.at, from))[0];
    if (!thing) return null;
    origin = thing.at;
    // Near means in sight: within 6 m of it.
    seats = seats.filter((s) => dist(s.at, origin) <= 6);
    if (!seats.length) return null;
  }
  const seat = [...seats].sort((a, b) => dist(a.at, origin) - dist(b.at, origin))[0];
  return { kind: 'SEAT', objectId: seat.objectId, posture: step.posture };
}

/** The experiences this home can offer: every required step resolves. */
export function availableExperiences(facts: SceneFacts, from: { x: number; y: number }): Experience[] {
  return EXPERIENCES.filter((x) => x.steps.every((s) => ('optional' in s && s.optional) || resolveStep(s, facts, from) !== null));
}

/** The steps of an experience that this home can actually do (optional ones it cannot are left out). */
export function planExperience(x: Experience, facts: SceneFacts, from: { x: number; y: number }): LiveStep[] {
  return x.steps.filter((s) => resolveStep(s, facts, from) !== null);
}
