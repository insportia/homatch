/*
 * SUGGESTED NEXT STEP — a rule, not a model.
 *
 * The CRM drawer shows the owner one suggestion for what to do next with an unlocked
 * contact. It is deterministic on purpose: the same facts always give the same
 * suggestion, nothing leaves the browser, and every rule below can be read and argued
 * with. No LLM is called.
 *
 * WHAT IT NEVER DOES
 *
 *   - It never infers interest. A delivered or opened message is a transport fact, not
 *     an intention, so DELIVERED / EMAIL_OPENED never produce "they are interested".
 *     INTERESTED only ever comes from the owner setting it.
 *   - It never changes a status. It suggests; the owner decides (crm_update).
 *
 * Pure module: no imports, erasable TypeScript only, so node:test can load it directly.
 */

export type CrmStatus =
  | 'UNLOCKED'
  | 'CONTACTED'
  | 'DELIVERED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'VIEWING_SCHEDULED'
  | 'CLOSED'
  | 'NOT_INTERESTED';

export type NextStepCode =
  | 'follow_up_due'
  | 'reply'
  | 'first_message'
  | 'wait_for_reply'
  | 'follow_up_no_reply'
  | 'propose_viewing'
  | 'confirm_viewing'
  | 'record_outcome'
  | 'respect_decision'
  | 'review';

/** Which control in the drawer the suggestion points at, if any. */
export type NextStepAction = 'conversation' | 'follow_up' | 'note' | 'status' | null;

export interface NextStepMessage {
  mine: boolean;
  createdAt: string;
}

export interface NextStepInput {
  status: string;
  /** Messages in any order; only `mine` and `createdAt` are read. */
  messages?: ReadonlyArray<NextStepMessage> | null;
  followUpAt?: string | null;
  lastActivityAt?: string | null;
  /** Injected for tests; defaults to the current time. */
  now?: number;
}

export interface NextStep {
  code: NextStepCode;
  titleKey: string;
  bodyKey: string;
  action: NextStepAction;
}

/** How long a sent, unanswered message waits before a follow-up is suggested. */
export const NO_REPLY_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function ts(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function step(code: NextStepCode, action: NextStepAction): NextStep {
  return { code, titleKey: `crm_next_${code}_title`, bodyKey: `crm_next_${code}_body`, action };
}

export function suggestNextStep(input: NextStepInput): NextStep {
  const now = input.now ?? Date.now();
  const status = String(input.status ?? '').toUpperCase();

  /* A decision already made is respected before anything else. */
  if (status === 'NOT_INTERESTED') return step('respect_decision', null);
  if (status === 'CLOSED') return step('record_outcome', 'note');

  /* The owner's own reminder outranks any inference from activity. */
  const followUp = ts(input.followUpAt);
  if (followUp !== null && followUp <= now) return step('follow_up_due', 'conversation');

  const messages = [...(input.messages ?? [])]
    .map((m) => ({ mine: Boolean(m.mine), at: ts(m.createdAt) }))
    .filter((m): m is { mine: boolean; at: number } => m.at !== null)
    .sort((a, b) => b.at - a.at);
  const latest = messages[0] ?? null;

  /* They wrote last: the conversation is waiting on the owner. */
  if ((latest && !latest.mine) || (status === 'REPLIED' && (!latest || !latest.mine))) {
    return step('reply', 'conversation');
  }

  if (status === 'VIEWING_SCHEDULED') return step('confirm_viewing', 'conversation');
  if (status === 'INTERESTED') return step('propose_viewing', 'conversation');

  if (!latest) {
    if (status === 'UNLOCKED' || status === 'CONTACTED' || status === 'DELIVERED') {
      /* CONTACTED with no message visible here can come from email; judge by activity. */
      if (status !== 'UNLOCKED') {
        const last = ts(input.lastActivityAt);
        if (last !== null && now - last >= NO_REPLY_DAYS * DAY_MS && followUp === null) {
          return step('follow_up_no_reply', 'follow_up');
        }
        return step('wait_for_reply', 'follow_up');
      }
      return step('first_message', 'conversation');
    }
    return step('review', 'status');
  }

  /* The owner wrote last. */
  if (now - latest.at >= NO_REPLY_DAYS * DAY_MS && followUp === null) {
    return step('follow_up_no_reply', 'follow_up');
  }
  return step('wait_for_reply', followUp === null ? 'follow_up' : null);
}
