/*
 * RS.ge TAXPAYER REGISTRY — what one check established, end to end.
 *
 * The worker (official-worker RsTaxpayerWorker / RsTaxpayerResponse) reads
 * RS.ge's own answer to the search and records one of four states:
 *
 *   VERIFIED                 RS.ge answered: a parsed record, or a confirmed
 *                            "no such record" for this identifier
 *   PENDING_VERIFICATION     the check is waiting for (or needed) a human step
 *   TEMPORARILY_UNAVAILABLE  network / 5xx / timeout — RS.ge did not answer
 *   VERIFICATION_FAILED      RS.ge refused the verification, or its answer
 *                            could not be read
 *
 * This module maps a stored result (queue task, legacy worker result, or the
 * research-agent's "gave up waiting" placeholder) onto that state, and onto
 * the report's legal matrix. A missing or failed check NEVER reads positive,
 * and nothing here ever says "no tax debt": the taxpayer registry shows
 * registration facts, it does not prove the absence of arrears.
 *
 * Pure: no network, no clock.
 */

export type RsVerificationStatus = 'VERIFIED' | 'PENDING_VERIFICATION' | 'TEMPORARILY_UNAVAILABLE' | 'VERIFICATION_FAILED';
export type RsRecordTone = 'confirmed' | 'caution';
export type LegalStatusValue = 'CONFIRMED_POSITIVE' | 'CONFIRMED_ATTENTION' | 'NOT_CONFIRMED' | 'HUMAN_VERIFICATION_REQUIRED';

export const RS_TAXPAYER_REGISTRY_URL = 'https://www.rs.ge/TaxpayersRegistry';

const STATUSES: ReadonlySet<string> = new Set(['VERIFIED', 'PENDING_VERIFICATION', 'TEMPORARILY_UNAVAILABLE', 'VERIFICATION_FAILED']);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/**
 * A queue task's error text → the state. The worker's executor tags every
 * failure with `rs=<STATUS>`; older rows carry only the legacy prefixes.
 */
export function rsStatusFromTaskError(error: unknown): RsVerificationStatus {
  const s = String(error ?? '');
  const tagged = /\brs=(VERIFIED|PENDING_VERIFICATION|TEMPORARILY_UNAVAILABLE|VERIFICATION_FAILED)\b/.exec(s)?.[1];
  if (tagged && tagged !== 'VERIFIED') return tagged as RsVerificationStatus;
  if (/RS_VERIFICATION_FAILED|HUMAN_VERIFICATION_REQUIRED:REJECTED/.test(s)) return 'VERIFICATION_FAILED';
  if (/HUMAN_VERIFICATION_REQUIRED/.test(s)) return 'PENDING_VERIFICATION';
  return 'TEMPORARILY_UNAVAILABLE';
}

/**
 * A record stored as VERIFIED / NO_RESULT only because the PAGE read "no
 * result" while RS.ge's own captured answer was unreadable (reason
 * PAGE_READ_UNPARSEABLE, PAGE_READ_HTTP_ERROR …). The grid's empty state is
 * what an unreadable answer leaves on screen, so this is not a confirmed
 * absence. Production 2026-10-22: company 405456359, a registered LLC.
 * Mirrors official-worker RsTaxpayerResponse.rsDomOnlyNoResult; it also
 * corrects results cached (24 h) or stored before the worker fix.
 */
export function rsDomOnlyNoResult(rsVerification: unknown): boolean {
  const v = obj(rsVerification);
  if (v.status !== 'VERIFIED' || v.serverOutcome !== 'NO_RESULT') return false;
  return /^PAGE_READ_(?!NO_RESULT$|ACCEPTED$)[A-Z_]+$/.test(String(v.reason ?? ''));
}

/** The state of one stored rstax result. Null when there is no result at all. */
export function rsVerificationStatusOf(result: unknown): RsVerificationStatus | null {
  const r = obj(result);
  if (!Object.keys(r).length) return null;
  if (rsDomOnlyNoResult(r.rsVerification)) return 'VERIFICATION_FAILED';
  const own = String(obj(r.rsVerification).status ?? '');
  if (STATUSES.has(own)) return own as RsVerificationStatus;
  const st = String(r.status ?? '');
  if (r.unavailable === true) return 'TEMPORARILY_UNAVAILABLE';
  if (st === 'SEARCH_CONFIRMED' || st === 'NO_RESULT_CONFIRMED') return 'VERIFIED';
  if (st === 'SKIPPED_HUMAN_VERIFICATION' || st === 'WAITING_HUMAN' || st === 'CAPTCHA_REQUIRED' || st === 'PENDING_VERIFICATION') return 'PENDING_VERIFICATION';
  if (st === 'VERIFICATION_FAILED' || st === 'SUBMITTED_UNPARSED') return 'VERIFICATION_FAILED';
  return 'TEMPORARILY_UNAVAILABLE';
}

/** RS.ge's own status words that call for caution (liquidated, suspended, struck off…). */
const CAUTION_RE = /ლიკვიდ|გაუქმ|შეჩერ|შეწყვეტ|გაკოტრ|გადახდისუუნარ|რეორგანიზ|არააქტიურ|ამოღებ|liquidat|suspend|terminat|deregist|struck|inactive|bankrupt|insolv|reorgani|closed|ceased/i;

/** Tone for RS.ge's status text: caution for liquidation/suspension-type states, never more. */
export function rsStatusTone(statusText: unknown): RsRecordTone {
  return typeof statusText === 'string' && CAUTION_RE.test(statusText) ? 'caution' : 'confirmed';
}

/** Did a VERIFIED check find a record (true), confirm there is none (false), or neither (null)? */
export function rsRecordFound(result: unknown): boolean | null {
  const r = obj(result);
  if (rsVerificationStatusOf(r) !== 'VERIFIED') return null;
  if (r.status === 'SEARCH_CONFIRMED') return true;
  if (r.status === 'NO_RESULT_CONFIRMED') return false;
  const o = String(obj(r.rsVerification).serverOutcome ?? '');
  return o === 'ACCEPTED' ? true : o === 'NO_RESULT' ? false : null;
}

/**
 * The legal matrix's "taxpayer status" from the job's rstax results:
 *   a parsed record                  → CONFIRMED_POSITIVE (CONFIRMED_ATTENTION
 *                                      when RS.ge's own status is a caution state)
 *   pending verification             → HUMAN_VERIFICATION_REQUIRED
 *   anything else (no record found, unavailable, failed, not run) → NOT_CONFIRMED
 * Never positive without a record RS.ge actually returned.
 */
export function rsTaxpayerLegalStatus(results: unknown): LegalStatusValue {
  const rows = (Array.isArray(results) ? results : []).filter((r) => obj(r).source === 'rstax');
  if (!rows.length) return 'NOT_CONFIRMED';
  const found = rows.find((r) => rsRecordFound(r) === true);
  if (found) return rsStatusTone(obj(obj(found).taxpayerData).status) === 'caution' ? 'CONFIRMED_ATTENTION' : 'CONFIRMED_POSITIVE';
  if (rows.some((r) => rsVerificationStatusOf(r) === 'PENDING_VERIFICATION')) return 'HUMAN_VERIFICATION_REQUIRED';
  return 'NOT_CONFIRMED';
}

/** A labelled extra field RS.ge returned, kept as RS.ge named it. */
export interface RsExtraField {
  label: string;
  value: string;
}

/** Every public field one parsed record carries, known ones first. */
export function rsPublicFields(taxpayerData: unknown): {
  identificationCode: string | null;
  taxpayerName: string | null;
  legalForm: string | null;
  status: string | null;
  registrationDate: string | null;
  vatStatus: string | null;
  address: string | null;
  extra: RsExtraField[];
} {
  const d = obj(taxpayerData);
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : null);
  const extra = Object.entries(obj(d.otherPublicFields))
    .map(([label, value]) => ({ label: String(label).slice(0, 80).trim(), value: s(value) }))
    .filter((x): x is RsExtraField => !!x.label && !!x.value)
    .slice(0, 40);
  return {
    identificationCode: s(d.identificationCode),
    taxpayerName: s(d.taxpayerName),
    legalForm: s(d.legalForm),
    status: s(d.status),
    registrationDate: s(d.registrationDate),
    vatStatus: s(d.vatStatus),
    address: s(d.address),
    extra,
  };
}

/** Drop RS.ge's raw answer from anything a model or a customer view reads (it lives in evidence storage). */
export function withoutRsRaw<T>(result: T): T {
  const r = obj(result);
  const v = obj(r.rsVerification);
  if (!('rawResponse' in v)) return result;
  const { rawResponse: _raw, ...rest } = v;
  return { ...r, rsVerification: rest } as T;
}

/* ───────────── the report card's model (CompanyFinanceCard) ───────────── */

/** The taxpayer part of the finance view, structurally (reportGaps.CompanyFinanceView['taxStatus']). */
export interface RsTaxStatusLike {
  state: 'CHECKED' | 'NOT_CHECKED';
  checkedOn: string | null;
  verification?: RsVerificationStatus | null;
  recordFound?: boolean | null;
  tone?: RsRecordTone;
  status?: string | null;
  vatStatus?: string | null;
  registeredOn?: string | null;
  taxpayerName?: string | null;
  legalForm?: string | null;
  address?: string | null;
  identificationCode?: string | null;
  extra?: RsExtraField[];
  sourceUrl?: string;
}

/** One labelled line: a translation key for the known fields, RS.ge's own label for the rest. */
export interface RsCardRow {
  labelKey?: string;
  label?: string;
  value: string;
  /** The value is RS.ge's boolean; render it as the locale's yes/no. */
  yesNo?: boolean | null;
  /** The value is a day (YYYY-MM-DD) to render in the locale's date order. */
  isDate?: boolean;
}

export interface RsCardModel {
  kind: 'RECORD' | 'NO_RECORD' | 'STATE';
  /** Pill: RS.ge's own status text (verbatim) or a translation key — never "confirmed" by default. */
  pill: { tone: 'confirmed' | 'attention' | 'quiet'; text?: string; key?: string };
  rows: RsCardRow[];
  /** Explanation copy, stating only what RS.ge literally returned. */
  explainKey: string;
  explainVars?: Record<string, string>;
  /** Extra caution line when RS.ge's status is a liquidation/suspension-type state. */
  cautionKey?: string;
  checkedOn: string | null;
  sourceUrl: string;
}

const yesNoOf = (v: string): boolean | null => (/^(true|კი|yes|да|evet|נכון|نعم)$/i.test(v.trim()) ? true : /^(false|არა|no|нет|hayır|לא|لا)$/i.test(v.trim()) ? false : null);
const dayOf = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

/**
 * What the Company finance card shows for RS.ge. Null when RS.ge was never
 * part of this research (nothing is written about what was not attempted).
 */
export function rsTaxCardModel(tax: RsTaxStatusLike | null | undefined, companyId: string | null): RsCardModel | null {
  if (!tax) return null;
  const sourceUrl = tax.sourceUrl || RS_TAXPAYER_REGISTRY_URL;
  const id = companyId ?? tax.identificationCode ?? '';
  if (tax.state === 'CHECKED' && tax.recordFound === false) {
    return { kind: 'NO_RECORD', pill: { tone: 'quiet', key: 'vbi_rs_no_record' }, rows: [], explainKey: 'vbi_rs_no_record_explain', explainVars: { id }, checkedOn: tax.checkedOn, sourceUrl };
  }
  if (tax.state === 'CHECKED') {
    const rows: RsCardRow[] = [];
    const push = (labelKey: string, value: string | null | undefined, extra: Partial<RsCardRow> = {}) => {
      if (value) rows.push({ labelKey, value, ...extra });
    };
    push('vbi_rs_name', tax.taxpayerName);
    push('vbi_rs_id', tax.identificationCode);
    push('vbi_rs_legal_form', tax.legalForm);
    push('vbi_rs_registered', tax.registeredOn, { isDate: !!tax.registeredOn && dayOf(tax.registeredOn) });
    if (tax.vatStatus) push('vbi_rs_vat', tax.vatStatus, { yesNo: yesNoOf(tax.vatStatus) });
    push('vbi_rs_address', tax.address);
    for (const x of tax.extra ?? []) rows.push({ label: x.label, value: x.value, yesNo: yesNoOf(x.value), isDate: dayOf(x.value) });
    const caution = tax.tone === 'caution';
    return {
      kind: 'RECORD',
      pill: tax.status ? { tone: caution ? 'attention' : 'confirmed', text: tax.status } : { tone: 'confirmed', key: 'vbi_rs_record_found' },
      rows,
      explainKey: 'vbi_fin_tax_explain',
      ...(caution ? { cautionKey: 'vbi_rs_status_caution' } : {}),
      checkedOn: tax.checkedOn,
      sourceUrl,
    };
  }
  const v = tax.verification;
  if (!v) return null;
  const key = v === 'PENDING_VERIFICATION' ? 'vbi_rs_state_pending' : v === 'VERIFICATION_FAILED' ? 'vbi_rs_state_failed' : 'vbi_rs_state_unavailable';
  return { kind: 'STATE', pill: { tone: 'quiet', key }, rows: [], explainKey: `${key}_explain`, explainVars: { id }, checkedOn: null, sourceUrl };
}
