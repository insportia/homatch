// HOMATCH Communications — translating what providers say into what Homatch says.
//
// This is the only file in the product that knows Meta's words or Vapi's
// words. Everything downstream — the inbox, the calls table, analytics, the
// funnel, billing — reads the vocabulary in vocabulary.ts. Adding a fifth
// provider means adding a function here and touching nothing else (§88, §89).
//
// THE RULE THAT MATTERS MOST
//
// Webhooks arrive out of order. Meta will deliver `sent` after `read` often
// enough that it must be designed for, not patched around, and Vapi can
// report `ended` before the `in-progress` that preceded it. So mapping alone
// is not enough: the caller must also ask whether the new status is actually
// FORWARD of the stored one, and drop it if not. isForwardMessageTransition
// and isForwardCallTransition are that check.

import type { MessageStatus, SendStatus, CallOutcome } from './vocabulary.ts';

// ── Meta WhatsApp Cloud API ─────────────────────────────────────────────────

/**
 * Meta statuses, from the `statuses[]` array of a webhook change.
 * `accepted` and `deleted` are undocumented-but-real values seen in the wild;
 * mapping them explicitly is better than letting them fall through to a
 * default that would look like a failure.
 */
export function mapMetaMessageStatus(raw: string | null | undefined): MessageStatus {
  switch (String(raw ?? '').toLowerCase()) {
    case 'accepted':
    case 'queued':     return 'QUEUED';
    case 'sent':       return 'SENT';
    case 'delivered':  return 'DELIVERED';
    case 'read':       return 'READ';
    case 'failed':     return 'FAILED';
    case 'deleted':    return 'DELETED';
    default:           return 'QUEUED';
  }
}

/** The `type` of an inbound Meta message. */
export function mapMetaMessageKind(raw: string | null | undefined): string {
  switch (String(raw ?? '').toLowerCase()) {
    case 'text':      return 'TEXT';
    case 'image':     return 'IMAGE';
    case 'document':  return 'DOCUMENT';
    case 'audio':
    case 'voice':     return 'AUDIO';
    case 'video':     return 'VIDEO';
    case 'location':  return 'LOCATION';
    case 'contacts':  return 'CONTACT';
    case 'sticker':   return 'STICKER';
    case 'template':  return 'TEMPLATE';
    case 'button':
    case 'interactive': return 'TEXT';
    // An unknown type is not a failure and must not be dropped — the operator
    // needs to see that SOMETHING arrived, even if Homatch cannot render it.
    default:          return 'UNSUPPORTED';
  }
}

/**
 * Meta error codes that mean the recipient must never be messaged again, as
 * opposed to a transient failure worth retrying.
 *
 *   131026  message undeliverable (no WhatsApp account on this number)
 *   131047  re-engagement required — outside the 24h window without a template
 *   131049  Meta declined to deliver for quality reasons
 *   131050  the user has blocked business-initiated messages
 *   368     the account is temporarily blocked by policy
 */
export function isPermanentMetaFailure(code: number | string | null | undefined): boolean {
  const n = Number(code);
  return [131026, 131050, 368, 131031].includes(n);
}

/** Errors that mean "this contact opted out", which must set whatsapp_opted_out. */
export function isMetaOptOutSignal(code: number | string | null | undefined): boolean {
  return Number(code) === 131050;
}

/**
 * An inbound message re-opens Meta's 24-hour customer service window. Every
 * inbound resets it; nothing else extends it. The send path reads the stored
 * expiry rather than recomputing, so a clock skew cannot authorise a send Meta
 * will reject and charge for.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function serviceWindowExpiry(inboundAt: Date | string | number): Date {
  return new Date(new Date(inboundAt).getTime() + SERVICE_WINDOW_MS);
}

export function isWithinServiceWindow(expiresAt: string | Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > now.getTime();
}

/**
 * The rule that decides whether a free-text reply is even legal, or whether an
 * approved template is required (§38). Checked on the server before any send.
 */
export function requiresTemplate(expiresAt: string | Date | null | undefined, now = new Date()): boolean {
  return !isWithinServiceWindow(expiresAt, now);
}

// ── Voice ───────────────────────────────────────────────────────────────────

/**
 * Vapi call statuses plus its endedReason, which is where the outcome
 * actually lives. `status: "ended"` on its own says nothing useful — the same
 * value covers a 4-minute qualified conversation and a number that does not
 * exist.
 */
export function mapVapiCallStatus(
  status: string | null | undefined,
  endedReason?: string | null,
): SendStatus {
  const s = String(status ?? '').toLowerCase();
  switch (s) {
    case 'scheduled':
    case 'queued':       return 'QUEUED';
    case 'ringing':      return 'RINGING';
    case 'in-progress':
    case 'forwarding':   return 'ANSWERED';
    case 'ended':        return mapVapiEndedReason(endedReason);
    default:             return 'QUEUED';
  }
}

export function mapVapiEndedReason(reason: string | null | undefined): SendStatus {
  const r = String(reason ?? '').toLowerCase();
  if (!r) return 'COMPLETED';
  if (r.includes('no-answer') || r.includes('noanswer')) return 'NO_ANSWER';
  if (r.includes('busy')) return 'BUSY';
  if (r.includes('customer-did-not-answer')) return 'NO_ANSWER';
  if (r.includes('voicemail')) return 'NO_ANSWER';
  if (r.includes('cancel')) return 'CANCELLED';
  if (r.includes('error') || r.includes('failed') || r.includes('rejected')) return 'FAILED';
  // customer-ended-call, assistant-ended-call, silence-timeout: the call
  // happened and there is something to read.
  return 'COMPLETED';
}

/**
 * What the CALL achieved, which is a different question from what the
 * telephony did. Derived from the AI's own extraction where one exists, and
 * from the transport status only when it does not — a call that reached
 * COMPLETED with no extraction was answered and said nothing useful.
 */
export function deriveCallOutcome(params: {
  status: SendStatus;
  callbackRequested?: boolean | null;
  viewingInterest?: boolean | null;
  interestLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  humanHandoff?: boolean | null;
  durationSec?: number | null;
}): CallOutcome | null {
  switch (params.status) {
    case 'NO_ANSWER': return 'NO_ANSWER';
    case 'BUSY':      return 'BUSY';
    case 'FAILED':    return 'FAILED';
    case 'CANCELLED': return null;
    default: break;
  }
  if (params.status !== 'COMPLETED' && params.status !== 'ANSWERED') return null;

  if (params.humanHandoff) return 'HUMAN_HANDOFF';
  if (params.callbackRequested) return 'CALLBACK';
  if (params.viewingInterest) return 'QUALIFIED';
  if (params.interestLevel === 'HIGH') return 'QUALIFIED';
  if (params.interestLevel === 'MEDIUM') return 'INTERESTED';
  if (params.interestLevel === 'NONE') return 'NOT_INTERESTED';
  // Answered, ended, nothing extracted. A five-second call is not a
  // conversation; anything longer is at least an attempt that connected.
  if ((params.durationSec ?? 0) < 8) return 'NOT_INTERESTED';
  return null;
}

/** Legacy Retell webhook events, kept so historical rows still read correctly (§4, §104). */
export function mapRetellCallStatus(event: string | null | undefined): SendStatus {
  switch (String(event ?? '').toLowerCase()) {
    case 'call_started':   return 'ANSWERED';
    case 'call_ended':     return 'COMPLETED';
    case 'call_analyzed':  return 'COMPLETED';
    default:               return 'QUEUED';
  }
}

const CALL_STATUS_RANK: Record<SendStatus, number> = {
  PENDING: 0, QUEUED: 1, SENDING: 1, DIALING: 2, RINGING: 3, ANSWERED: 4,
  SENT: 4, DELIVERED: 5, READ: 6,
  // Terminal states all sit above every live one and none supersedes another.
  COMPLETED: 10, FAILED: 10, NO_ANSWER: 10, BUSY: 10, CANCELLED: 10,
  BOUNCED: 10, OPTED_OUT: 10, SUPPRESSED: 10,
};

export function isForwardCallTransition(from: SendStatus, to: SendStatus): boolean {
  // Once terminal, always terminal. A late `ringing` after `completed` is a
  // reordered webhook, not a second call.
  if (CALL_STATUS_RANK[from] >= 10) return false;
  return CALL_STATUS_RANK[to] > CALL_STATUS_RANK[from];
}
