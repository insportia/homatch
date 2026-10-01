// META ADS — WHAT AN ADMIN APPROVAL OF A HELD CLAIM MEANS. Pure.
//
// The HOMATCH check holds a creative for a person to look at when its text
// makes a claim (guaranteed profit, risk-free investment …): the campaign goes
// to MANUAL_REVIEW and a moderation case is opened. An admin's APPROVE:
//   • closes that case, with who, when, why and the exact text approved —
//     the claim fingerprint (SHA-256 of the creative text the check reads);
//   • lets the next HOMATCH check pass THAT text, so the same review is not
//     opened again — any edit changes the fingerprint and is reviewed afresh;
//   • moves the campaign back onto the normal path (PREFLIGHT_REQUIRED, with
//     the stale check cleared) only when no other review is still open.
// It never launches, publishes, resumes or spends: a held campaign has no
// plan, so it cannot be launchable until the normal check builds one, and
// launch stays its own explicit act with every check it always had.
// Shared by meta-ads-api (engine.ts preflight, actions.ts admin action).

export const CLAIM_FLAG = 'CLAIM_GUARANTEE';

export interface CreativeText { headline?: string | null; primary_text?: string | null; description?: string | null }

/** The text the claim rule reads — one definition for the check and the approval. */
export const claimText = (cr: CreativeText) => `${cr.headline ?? ''}\n${cr.primary_text ?? ''}\n${cr.description ?? ''}`;

/** SHA-256 of the claim text, hex: equal only for the exact same words. */
export async function claimFingerprint(cr: CreativeText): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(claimText(cr)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ModerationCaseRow {
  id: string;
  creative_id: string | null;
  status: string;
  findings?: { claim_fingerprint?: string | null; [k: string]: unknown } | null;
}

/** An approval of exactly this creative's exactly this text, if one exists. */
export function approvedClaim(cases: ModerationCaseRow[], creativeId: string, fingerprint: string): ModerationCaseRow | null {
  return cases.find((m) => m.status === 'APPROVED' && m.creative_id === creativeId && m.findings?.claim_fingerprint === fingerprint) ?? null;
}

/** A review already waiting for this text (or an older case without a fingerprint): never open a second one. */
export function openClaimCase(cases: ModerationCaseRow[], creativeId: string, fingerprint: string): ModerationCaseRow | null {
  return cases.find((m) => m.status === 'OPEN' && m.creative_id === creativeId
    && (!m.findings?.claim_fingerprint || m.findings.claim_fingerprint === fingerprint)) ?? null;
}

export type NextAction = 'RUN_PREFLIGHT' | 'OTHER_REVIEWS_OPEN' | 'NONE';

/**
 * Where an approval leaves the campaign. Only a campaign still held in
 * MANUAL_REVIEW with no other open review returns to the normal path — to
 * PREFLIGHT_REQUIRED, never READY: READY means a fresh check built a plan.
 */
export function afterApproval(campaignStatus: string | null | undefined, otherOpenReviews: number): { status: 'PREFLIGHT_REQUIRED' | null; next: NextAction } {
  if (String(campaignStatus ?? '').toUpperCase() !== 'MANUAL_REVIEW') return { status: null, next: 'NONE' };
  if (otherOpenReviews > 0) return { status: null, next: 'OTHER_REVIEWS_OPEN' };
  return { status: 'PREFLIGHT_REQUIRED', next: 'RUN_PREFLIGHT' };
}
