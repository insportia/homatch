import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isImpersonating } from '@/lib/impersonation';
import { rememberPendingPath } from '@/services/returnTo';
import {
  POLICY_GATE_ALLOWED,
  acceptCurrentPolicies,
  fetchPolicyStatus,
  takePreAcceptance,
} from '@/lib/legal/policies';

export const POLICIES_ACCEPTED_EVENT = 'homatch:policies-accepted';

/*
 * An account that has not accepted the current Terms and acknowledged the
 * current Privacy Policy goes to /auth/accept-policies before it can use the
 * platform. The server decides whether it owes one (policy_acceptance_status);
 * this only routes.
 *
 * Google sign-up: the signup page's tick is remembered across the provider
 * round trip and recorded here, once, through the server function. A Google
 * sign-in that started anywhere else (the login page) never had a tick, so
 * the account lands on the acceptance screen instead.
 *
 * Viewing-as is read-only and must never record an acceptance for the
 * customer, so it is not gated.
 */
export function PolicyAcceptanceGate() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [required, setRequired] = useState(false);
  const uid = session?.user?.id ?? null;

  useEffect(() => {
    if (!uid || isImpersonating()) { setRequired(false); return; }
    let cancelled = false;
    const check = async () => {
      let status = await fetchPolicyStatus();
      if (status?.required && takePreAcceptance()) {
        await acceptCurrentPolicies('oauth_signup');
        status = await fetchPolicyStatus();
      }
      if (!cancelled) setRequired(status?.required === true);
    };
    void check();
    const onAccepted = () => { setRequired(false); };
    window.addEventListener(POLICIES_ACCEPTED_EVENT, onAccepted);
    return () => { cancelled = true; window.removeEventListener(POLICIES_ACCEPTED_EVENT, onAccepted); };
  }, [uid]);

  useEffect(() => {
    if (!required) return;
    if (POLICY_GATE_ALLOWED.some((p) => pathname === p || pathname.startsWith(p))) return;
    rememberPendingPath(pathname + search);
    navigate('/auth/accept-policies', { replace: true });
  }, [required, pathname, search, navigate]);

  return null;
}
