/*
 * WHO OPERATES HOMATCH — the one place legal identity lives.
 *
 * Every legal page, the signup disclosure and the footer read this object.
 * When the operator changes (e.g. the individual entrepreneur becomes an
 * LLC), change it HERE, bump the versions below, update
 * public.legal_policy_versions to match, and decide whether existing
 * accounts must re-accept (legal_policy_versions.reaccept_existing).
 *
 * Only verified facts belong here. A field that has not been verified is
 * null and is simply not shown — never filled with a guess.
 */
export type LegalEntityType = 'individual_entrepreneur' | 'llc';

export const LEGAL_OPERATOR = {
  brandName: 'HOMATCH',
  legalEntityType: 'individual_entrepreneur' as LegalEntityType,
  /** Authoritative (Georgian) legal name, as registered. */
  legalEntityName: 'ინდივიდუალური მეწარმე ტარიელი ჩაჩუა',
  /** The person's name in Latin script, for the non-Georgian pages. */
  legalEntityNameLatin: 'Tariel Chachua',
  /** Personal/entrepreneur ID. Shown on the legal pages only. */
  identificationNumber: '01027085016',
  /** Not verified yet — not shown. */
  registeredAddress: null as string | null,
  country: { ka: 'საქართველო', en: 'Georgia', ru: 'Грузия', tr: 'Gürcistan', ar: 'جورجيا', he: 'גאורגיה' },
  website: 'https://www.homatch.live',
  /*
   * The addresses the legal pages have published since before 2026-10-25.
   * The owner has not yet confirmed these mailboxes are monitored; until
   * they do, contactsVerified stays false (reported, not hidden, because
   * removing them would leave data subjects with no way to reach us).
   */
  legalContactEmail: 'legal@homatch.live' as string | null,
  privacyContact: 'privacy@homatch.live' as string | null,
  supportEmail: 'support@homatch.live' as string | null,
  contactsVerified: false,
  /** Must equal public.legal_policy_versions (the server refuses any other). */
  versions: { terms: '2026-10-25', privacy: '2026-10-25', cookies: '2026-10-25' },
  effectiveDates: { terms: '2026-10-25', privacy: '2026-10-25', cookies: '2026-10-25' },
} as const;

export type LegalDoc = 'terms' | 'privacy' | 'cookies';

/** "ინდივიდუალური მეწარმე ტარიელი ჩაჩუა" in Georgian, "Individual Entrepreneur Tariel Chachua" etc. elsewhere. */
export function operatorDisplayName(lang: string, entityTypeLabel: string): string {
  return lang === 'ka' ? LEGAL_OPERATOR.legalEntityName : `${entityTypeLabel} ${LEGAL_OPERATOR.legalEntityNameLatin}`;
}

export function formatLegalDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${iso}T00:00:00`));
  } catch {
    return iso;
  }
}
