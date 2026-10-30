import { supabase } from '@/db/supabase';
import { LEGAL_OPERATOR } from '@/lib/legal/operator';

/*
 * THE POLICY VERSIONS THIS CLIENT DISPLAYS.
 *
 * They must equal public.legal_policy_versions. The server refuses an
 * acceptance that names any other version (POLICY_VERSION_MISMATCH), so a
 * page cached from before a policy change cannot accept a text it never
 * showed. Publishing a new version = bump them in src/lib/legal/operator.ts,
 * update the row, ship both.
 */
export const POLICY_VERSIONS = { terms: LEGAL_OPERATOR.versions.terms, privacy: LEGAL_OPERATOR.versions.privacy } as const;
/** The version a stored cookie choice must carry (moves only for a cookie change that needs a new choice). */
export const COOKIE_POLICY_VERSION = LEGAL_OPERATOR.cookieConsentVersion;

/** Paths an account that still owes an acceptance may open. */
export const POLICY_GATE_ALLOWED = ['/auth/', '/terms', '/privacy', '/cookies'];

/** Ticked on the signup page before the Google round trip; read once after it. */
const PREACCEPT_KEY = 'homatch_policy_preaccept';

export function rememberPreAcceptance(): void {
  try { sessionStorage.setItem(PREACCEPT_KEY, JSON.stringify(POLICY_VERSIONS)); } catch { /* storage unavailable */ }
}

export function takePreAcceptance(): boolean {
  try {
    const raw = sessionStorage.getItem(PREACCEPT_KEY);
    sessionStorage.removeItem(PREACCEPT_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as Record<string, string>;
    return v.terms === POLICY_VERSIONS.terms && v.privacy === POLICY_VERSIONS.privacy;
  } catch {
    return false;
  }
}

export interface PolicyStatus {
  required: boolean;
  missing: string[];
}

/**
 * Null when the status cannot be read (network, or the migration not yet
 * applied in this environment). Callers treat null as "do not block": an
 * outage of this check must never lock existing customers out of sign-in.
 */
export async function fetchPolicyStatus(): Promise<PolicyStatus | null> {
  const { data, error } = await supabase.rpc('policy_acceptance_status');
  if (error || !data) return null;
  const d = data as { required?: boolean; missing?: string[] };
  return { required: d.required === true, missing: d.missing ?? [] };
}

export async function acceptCurrentPolicies(
  source: 'oauth_signup' | 'onboarding' | 'reacceptance',
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('accept_current_policies', {
    p_versions: POLICY_VERSIONS,
    p_source: source,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: (data as { required?: boolean } | null)?.required === false };
}
