/*
 * WHAT HOMI MAY TALK ABOUT: only services Admin has not hidden.
 *
 * The Admin Service Control Center has two switches per service:
 * `frontend_enabled` (customers can see and open it) and `backend_enabled`
 * (it may start work); frontend implies backend. A service whose FRONTEND
 * switch is off is hidden from customers, so HOMI must not mention it,
 * recommend it, link it, card it, pitch it, or offer a reply chip about it.
 *
 * This module turns one read of the switches into a visibility set and
 * applies it everywhere HOMI produces something: the prompt (only visible
 * services are described, hidden ones are named as off-limits), the service
 * cards, the service note, the suggested replies and the deterministic
 * fallbacks. Pure and runtime-neutral, so the edge function, the app and the
 * tests share one definition.
 */

import { SERVICE_ACTION_CATALOGUE, SERVICE_ACTION_SERVICE, type ServiceActionId } from '../ai/serviceActions.ts';
import type { SuggestedReply } from '../ai/suggestedReplies.ts';
import { detectService, servicesNamedIn, SERVICE_PROMPT_NAME } from './webPolicy.ts';

/** Service-control keys that are not catalogue actions but appear in HOMI's prompt. */
export const EXTRA_PROMPT_SERVICE_KEYS = ['email_marketing', 'ai_call_center'] as const;

/** Every service-control key HOMI's prompt can name: read once per turn. */
export const HOMI_PROMPT_SERVICE_KEYS: readonly string[] = [
  ...new Set([...Object.values(SERVICE_ACTION_SERVICE) as string[], ...EXTRA_PROMPT_SERVICE_KEYS]),
];

const EXTRA_KEY_NAME: Record<string, string> = {
  email_marketing: 'Email Campaigns (/outreach/email)',
  ai_call_center: 'AI Call Center (/outreach/calls)',
};

/* Which service a written HOMI answer (deterministic intent) is about. */
export const INTENT_SERVICE: Readonly<Record<string, ServiceActionId>> = Object.freeze({
  SERVICE_VERIFY: 'VERIFY',
  SERVICE_MORTGAGE: 'MORTGAGE',
  MORTGAGE_QUICK: 'MORTGAGE',
  MORTGAGE_DOCS: 'MORTGAGE',
  SERVICE_INVESTMENT: 'INVESTMENT',
  ROI_QUICK: 'INVESTMENT',
  SERVICE_CONTRACTS: 'CONTRACT_INTELLIGENCE',
  SERVICE_EXPATS: 'FOR_EXPATS',
  SERVICE_FIND_BUYERS: 'FIND_BUYERS_TENANTS',
  SERVICE_BROKERS: 'BROKERS',
  SERVICE_FIND_PROPERTY: 'FIND_PROPERTY',
  FIND_PROPERTY: 'FIND_PROPERTY',
});

export function serviceOfIntent(intent: unknown): ServiceActionId | null {
  if (typeof intent !== 'string') return null;
  if (intent in INTENT_SERVICE) return INTENT_SERVICE[intent];
  if (intent.startsWith('MORTGAGE_DOCS')) return 'MORTGAGE';
  return null;
}

export interface ServiceVisibility {
  visible: ServiceActionId[];
  hidden: ServiceActionId[];
  /** Service-control keys whose frontend switch is off (extra prompt keys included). */
  hiddenKeys: string[];
  isVisible: (id: ServiceActionId | null | undefined) => boolean;
  isKeyVisible: (key: string | null | undefined) => boolean;
}

/**
 * One read of the switches → the visibility set. A catalogue action with no
 * service key (CONTACT) is always visible. A key with no state is treated as
 * hidden: HOMI fails closed on recommending, never on answering.
 */
export function buildServiceVisibility(states: Record<string, { frontend: boolean } | undefined>): ServiceVisibility {
  const keyVisible = (key: string | null | undefined) => !key || states[key]?.frontend === true;
  const ids = Object.keys(SERVICE_ACTION_CATALOGUE) as ServiceActionId[];
  const visible = ids.filter((id) => keyVisible(SERVICE_ACTION_SERVICE[id]));
  const hidden = ids.filter((id) => !keyVisible(SERVICE_ACTION_SERVICE[id]));
  const hiddenKeys = HOMI_PROMPT_SERVICE_KEYS.filter((k) => !keyVisible(k));
  return {
    visible, hidden, hiddenKeys,
    isVisible: (id) => Boolean(id) && visible.includes(id as ServiceActionId),
    isKeyVisible: keyVisible,
  };
}

/** Everything visible (the browser's own fallback when it has no switches yet). */
export const ALL_VISIBLE: ServiceVisibility = buildServiceVisibility(
  Object.fromEntries(HOMI_PROMPT_SERVICE_KEYS.map((k) => [k, { frontend: true }])),
);

export function filterServiceIds<T extends string>(ids: readonly T[], vis: ServiceVisibility): T[] {
  return ids.filter((id) => vis.isVisible(id as unknown as ServiceActionId));
}

/** Does this reply chip talk about (or lead to) a hidden service? */
export function replyPointsToHidden(reply: Pick<SuggestedReply, 'label' | 'value' | 'intent'>, vis: ServiceVisibility): boolean {
  if (!vis.hidden.length) return false;
  const fromIntent = serviceOfIntent(reply.intent);
  if (fromIntent && !vis.isVisible(fromIntent)) return true;
  for (const text of [reply.label, reply.value]) {
    const about = detectService(text);
    if (about && !vis.isVisible(about)) return true;
    if (servicesNamedIn(text).some((id) => !vis.isVisible(id))) return true;
  }
  return false;
}

export function filterReplies<T extends Pick<SuggestedReply, 'label' | 'value' | 'intent'>>(replies: readonly T[], vis: ServiceVisibility): T[] {
  return replies.filter((r) => !replyPointsToHidden(r, vis));
}

/** Keep only the prompt lines whose service is visible (null key = always). */
export function visibleLines(lines: ReadonlyArray<readonly [string | null, string]>, vis: ServiceVisibility): string[] {
  return lines.filter(([key]) => vis.isKeyVisible(key)).map(([, line]) => line);
}

/** The explicit off-limits line for the prompt, or '' when nothing is hidden. */
export function hiddenServicesPrompt(vis: ServiceVisibility): string {
  const names = [
    ...vis.hidden.map((id) => SERVICE_PROMPT_NAME[id]),
    ...vis.hiddenKeys.filter((k) => k in EXTRA_KEY_NAME).map((k) => EXTRA_KEY_NAME[k]),
  ];
  if (!names.length) return '';
  return `SERVICES HIDDEN BY HOMATCH RIGHT NOW: ${names.join('; ')}. Do not mention, recommend or link these, in the reply, in suggested_replies, in suggested_actions or in pitch_service. If the person asks for one, say briefly that it is not available right now and offer the closest visible alternative.`;
}
