// Leads on Facebook/Instagram, in product words. The state comes from the
// server (src/lib/metaAds/instantForms.ts); an older server that only sends
// instant_forms_available reads as "coming soon" — never as a request to grant
// permissions by name.
import type { MetaStatus } from '@/services/metaAds';
import type { InstantFormsState } from '@/lib/metaAds/instantForms';

export function formsStateOf(status: MetaStatus | null | undefined): InstantFormsState {
  const c = status?.connection;
  if (c?.instant_forms) return c.instant_forms;
  if (status?.mode !== 'REAL') return 'AVAILABLE';
  return c?.instant_forms_available === false ? 'COMING_SOON' : 'AVAILABLE';
}

/** The customer message for each unavailable state (literal keys for the i18n gates). */
export const FORMS_COPY: Record<Exclude<InstantFormsState, 'AVAILABLE' | 'DISABLED'>, string> = {
  COMING_SOON: 'mm_b_lf_soon',
  RECONNECT: 'mm_b_lf_reconnect',
  TERMS_REQUIRED: 'mm_l_terms_body',
  PAGE_REQUIRED: 'madsb_gap_page',
  RECHECK: 'mm_l_recheck_body',
};

/** States the owner can resolve inside the builder — the Leads goal stays selectable for them. */
export const FORMS_ACTIONABLE: ReadonlySet<InstantFormsState> = new Set(['AVAILABLE', 'TERMS_REQUIRED', 'RECONNECT', 'RECHECK', 'PAGE_REQUIRED']);
