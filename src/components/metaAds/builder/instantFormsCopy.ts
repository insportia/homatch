// Leads on Facebook/Instagram, in product words. The state comes from the
// server (src/lib/metaAds/instantForms.ts); a status without one is read as
// "not confirmed yet" — never as ready, never as a permission name.
import type { MetaStatus } from '@/services/metaAds';
import type { InstantFormsState, LeadTerms } from '@/lib/metaAds/instantForms';

export function formsStateOf(status: MetaStatus | null | undefined): InstantFormsState {
  const c = status?.connection;
  if (c?.instant_forms) return c.instant_forms;
  if (status?.mode !== 'REAL') return 'READY';
  return 'TERMS_UNKNOWN';
}

export function leadTermsOf(status: MetaStatus | null | undefined): LeadTerms {
  if (status?.mode !== 'REAL') return 'ACCEPTED';
  const v = status?.connection?.lead_terms;
  return v === 'ACCEPTED' || v === 'REQUIRED' ? v : 'UNKNOWN';
}

/** The customer sentence for each state that is not ready (literal keys for the i18n gates). */
export const FORMS_COPY: Record<Exclude<InstantFormsState, 'READY' | 'DISABLED'>, string> = {
  PERMISSIONS_MISSING: 'mm_c_lf_perms',
  TERMS_REQUIRED: 'mm_l_terms_body',
  TERMS_UNKNOWN: 'mm_c_lf_terms_unknown',
  FORM_ACCESS_UNAVAILABLE: 'mm_c_lf_form_access',
  PAGE_UNAVAILABLE: 'madsb_gap_page',
  META_ERROR: 'mm_l_meta_error',
};

/** Every state the owner can resolve inside the builder — the Leads goal stays selectable for them. */
export const FORMS_ACTIONABLE: ReadonlySet<InstantFormsState> = new Set([
  'READY', 'PERMISSIONS_MISSING', 'TERMS_REQUIRED', 'TERMS_UNKNOWN', 'FORM_ACCESS_UNAVAILABLE', 'PAGE_UNAVAILABLE', 'META_ERROR',
]);
