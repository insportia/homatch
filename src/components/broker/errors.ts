// Server refusal codes from the broker RPCs → the sentence a person reads.

import type { TranslationKey } from '@/i18n/translations';

export function brokerErrorKey(code: string): TranslationKey {
  const known: Record<string, TranslationKey> = {
    INVALID_NAME: 'broker_apply_err_name',
    CONTACT_REQUIRED: 'broker_apply_err_contact',
    ALREADY_PENDING: 'broker_apply_err_pending',
    ACCOUNT_SUSPENDED: 'broker_err_suspended',
    LISTING_SUSPENDED: 'broker_err_suspended',
    INVALID_LOGO_URL: 'broker_err_logo',
    LOGO_NOT_IMAGE: 'broker_err_logo',
    FILE_TOO_LARGE: 'broker_err_file_too_large',
    UPLOAD_FAILED: 'broker_err_upload',
    TOO_MANY_VALUES: 'broker_err_too_many',
    VALUE_TOO_LONG: 'broker_err_too_long',
    INVALID_EXPERIENCE: 'broker_err_experience',
    INSUFFICIENT_CREDITS: 'broker_err_insufficient_credits',
    NOT_APPROVED: 'broker_err_not_purchasable',
    PRODUCT_UNAVAILABLE: 'broker_err_product_unavailable',
    NOT_SUBMITTABLE: 'broker_err_not_submittable',
    INVALID_PATH: 'broker_err_upload',
    DOCUMENT_REQUIRED: 'broker_err_document_required',
    UNLOCK_REQUIRED: 'broker_err_unlock_required',
    TOO_MANY_DOCUMENTS: 'broker_err_too_many',
    VERIFICATION_CLOSED: 'broker_err_verification_closed',
    INVALID_TRANSITION: 'broker_err_invalid_transition',
    MATCH_CLOSED: 'broker_err_match_closed',
  };
  return known[code] ?? 'broker_apply_err_generic';
}
