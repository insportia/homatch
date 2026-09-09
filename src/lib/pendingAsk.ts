/**
 * Carrying a question typed while signed out through sign-in and into the
 * assistant.
 *
 * WHY THIS EXISTS
 *
 * The public Main Page invites a visitor to ask Homatch AI something, but /ai
 * is an authenticated route. Before this, the landing page parked the text
 * under the `homatch_pending_url` key that the URL-import flow uses — and the
 * auth pages only ever replay that key when the pending *intent* is
 * 'analyse'. A question asked from the hero was therefore stored, never read,
 * and the visitor was dropped on the dashboard having lost what they typed.
 *
 * This keeps the ask on its own key with its own intent, so the URL-import
 * flow and the assistant flow cannot shadow one another, and gives all three
 * auth entry points (password login, signup, OAuth callback) one function to
 * call.
 *
 * sessionStorage rather than localStorage: an unanswered question is worth
 * carrying across a redirect, not across a browser restart. Every access is
 * guarded — Safari private mode and storage-blocked browsers throw on both
 * read and write, and losing the question must never break signing in.
 */
const PENDING_ASK_KEY = 'homatch_pending_ask';
const PENDING_INTENT_KEY = 'homatch_pending_intent';

export const ASK_AI_INTENT = 'ask-ai';

export function rememberPendingAsk(prompt: string): void {
  try {
    sessionStorage.setItem(PENDING_ASK_KEY, prompt);
    sessionStorage.setItem(PENDING_INTENT_KEY, ASK_AI_INTENT);
  } catch {
    /* storage unavailable — signing in still has to work */
  }
}

/**
 * Returns the parked question and clears it, or null when there isn't one.
 * Clearing on read is deliberate: replaying the same question on every later
 * sign-in of the session would be worse than losing it once.
 */
export function consumePendingAsk(): string | null {
  try {
    if (sessionStorage.getItem(PENDING_INTENT_KEY) !== ASK_AI_INTENT) return null;
    const prompt = sessionStorage.getItem(PENDING_ASK_KEY);
    sessionStorage.removeItem(PENDING_ASK_KEY);
    sessionStorage.removeItem(PENDING_INTENT_KEY);
    return prompt && prompt.trim() ? prompt : null;
  } catch {
    return null;
  }
}
