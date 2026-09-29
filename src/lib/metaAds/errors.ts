// META ERROR NORMALIZER — cryptic outside, honest inside.
//
// A customer never reads "(#100) Invalid parameter"; they read one human
// sentence keyed into the i18n bundle. Admin always sees the real code,
// subcode and message — a serious error is never hidden, only translated.
//
// The map covers the long-stable Graph error families. Anything unknown
// falls through to a generic-but-truthful key and stays fully visible in
// meta_api_errors for Admin.

export interface NormalizedMetaError {
  /** i18n key for the customer sentence. */
  customerKey: string;
  /** Can a plain retry help, without changing anything? */
  recoverable: boolean;
  /** What has to happen first. */
  action: 'RETRY' | 'RECONNECT' | 'FIX_INPUT' | 'META_ACTION_REQUIRED' | 'CONTACT_SUPPORT';
  code: string;
  subcode: string;
  rawMessage: string;
}

export function normalizeMetaError(err: {
  code?: number | string; error_subcode?: number | string; message?: string; type?: string;
}): NormalizedMetaError {
  const code = String(err?.code ?? '');
  const subcode = String(err?.error_subcode ?? '');
  const rawMessage = String(err?.message ?? '');
  const base = { code, subcode, rawMessage };

  // Auth family: expired/invalidated token, revoked permission.
  if (code === '190' || err?.type === 'OAuthException') {
    return { ...base, customerKey: 'meta_err_reconnect', recoverable: false, action: 'RECONNECT' };
  }
  // Permission family.
  if (code === '200' || code === '10' || (Number(code) >= 200 && Number(code) <= 299)) {
    return { ...base, customerKey: 'meta_err_permission', recoverable: false, action: 'META_ACTION_REQUIRED' };
  }
  // Rate limits / throttling.
  if (code === '4' || code === '17' || code === '32' || code === '613' || subcode === '80004') {
    return { ...base, customerKey: 'meta_err_busy', recoverable: true, action: 'RETRY' };
  }
  // Transient platform errors.
  if (code === '1' || code === '2') {
    return { ...base, customerKey: 'meta_err_temporary', recoverable: true, action: 'RETRY' };
  }
  // Invalid parameter — our input, our fix.
  if (code === '100') {
    return { ...base, customerKey: 'meta_err_invalid', recoverable: false, action: 'FIX_INPUT' };
  }
  // Account-level restriction (disabled ad account, unsettled balance…).
  if (code === '368' || code === '2446079' || code === '2615') {
    return { ...base, customerKey: 'meta_err_account_action', recoverable: false, action: 'META_ACTION_REQUIRED' };
  }
  return { ...base, customerKey: 'meta_err_generic', recoverable: false, action: 'CONTACT_SUPPORT' };
}
