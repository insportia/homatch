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

/*
 * OPERATOR CHANGE, 2026-10-29 (owner): the individual entrepreneur was
 * replaced by the limited liability company below. The owner provided the
 * Georgian name and the identification code and nothing else, so:
 *   - no Latin-script name exists anywhere in the repo or the instruction, and
 *     none is invented: every locale shows the registered Georgian name,
 *     followed by the translated entity type outside Georgian;
 *   - registered address, VAT status, bank details and representative are
 *     unknown and stay unset (not shown).
 * Records made under the previous operator (payments, invoices, policy
 * acceptances, audit rows) are history and are not rewritten.
 */
export const LEGAL_OPERATOR = {
  brandName: 'HOMATCH',
  legalEntityType: 'llc' as LegalEntityType,
  /** Authoritative (Georgian) legal name, as registered, with its Georgian quotation marks. */
  legalEntityName: 'შპს „ულტრა ქონექშენ“',
  /** The registered name in Latin script. Not provided by the owner: null, never guessed. */
  legalEntityNameLatin: null as string | null,
  /** Company identification code. Shown on the legal pages only. */
  identificationNumber: '406378511',
  /** Not provided yet: not shown. */
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
  /* 2026-10-29: new operator (all three documents name it) and the Terms'
     subscription section. Equal to supabase/migrations/20261207160000_policy_versions_operator_change.sql. */
  versions: { terms: '2026-10-29', privacy: '2026-10-29', cookies: '2026-10-29' },
  effectiveDates: { terms: '2026-10-29', privacy: '2026-10-29', cookies: '2026-10-29' },
} as const;

export type LegalDoc = 'terms' | 'privacy' | 'cookies';

/** The translation key of the operator's entity type ("Limited Liability Company" etc.). */
export const ENTITY_TYPE_LABEL_KEY: Record<LegalEntityType, string> = {
  individual_entrepreneur: 'legal_entity_individual_entrepreneur',
  llc: 'legal_entity_llc',
};

/** Who operated HOMATCH under a given edition of the legal documents. */
export interface OperatorIdentity {
  legalEntityType: LegalEntityType;
  legalEntityName: string;
  legalEntityNameLatin: string | null;
  identificationNumber: string;
  registeredAddress: string | null;
}

/*
 * ARCHIVED EDITIONS (owner, 2026-10-29: documents of the previous legal entity
 * are never overwritten).
 *
 * Whoever accepted an earlier edition can still read it as it was, with the
 * operator it named: /terms?version=2026-10-25 (and /privacy, /cookies). The
 * 2026-10-25 edition is the only one anybody accepted on record:
 * public.policy_acceptances and the cookie-consent version both start there
 * (20261206100000_policy_acceptance.sql). Texts published before it were not
 * versioned and no acceptance of them exists.
 *
 * What differs between 2026-10-25 and 2026-10-29: the operator below and the
 * Terms' fees section (TermsPage.tsx renders the 2026-10-25 keys for it).
 * Every other section is the same text in both editions.
 */
export const PREVIOUS_OPERATOR_2026_10_25: OperatorIdentity = {
  legalEntityType: 'individual_entrepreneur',
  legalEntityName: 'ინდივიდუალური მეწარმე ტარიელი ჩაჩუა',
  legalEntityNameLatin: 'Tariel Chachua',
  identificationNumber: '01027085016',
  registeredAddress: null,
};

export interface LegalEdition {
  version: string;
  effectiveDate: string;
  /** The day the next edition replaced it; null for the current edition. */
  supersededOn: string | null;
  operator: OperatorIdentity;
}

/** Newest first. The three documents have always been published together. */
export const ARCHIVED_EDITIONS: readonly LegalEdition[] = [
  { version: '2026-10-25', effectiveDate: '2026-10-25', supersededOn: '2026-10-29', operator: PREVIOUS_OPERATOR_2026_10_25 },
];

export function currentEdition(doc: LegalDoc): LegalEdition {
  return {
    version: LEGAL_OPERATOR.versions[doc],
    effectiveDate: LEGAL_OPERATOR.effectiveDates[doc],
    supersededOn: null,
    operator: LEGAL_OPERATOR,
  };
}

/** The edition a `?version=` asks for; anything unknown (or nothing) is the current one. */
export function editionFor(doc: LegalDoc, requested: string | null | undefined): LegalEdition {
  return ARCHIVED_EDITIONS.find((e) => e.version === requested) ?? currentEdition(doc);
}

export const operatorEntityLabelKey = (op: OperatorIdentity = LEGAL_OPERATOR): string => ENTITY_TYPE_LABEL_KEY[op.legalEntityType];

/**
 * 'შპს „ულტრა ქონექშენ“' in Georgian (the name already carries შპს). Elsewhere
 * the Latin name when one is configured, otherwise the registered Georgian
 * name with the entity type in the reader's language:
 * 'შპს „ულტრა ქონექშენ“ (Limited Liability Company)'.
 */
export function operatorDisplayName(lang: string, entityTypeLabel: string, op: OperatorIdentity = LEGAL_OPERATOR): string {
  if (lang === 'ka') return op.legalEntityName;
  /* The previous operator was a person: the type label goes before the name. */
  if (op.legalEntityNameLatin) return op.legalEntityType === 'individual_entrepreneur' ? `${entityTypeLabel} ${op.legalEntityNameLatin}` : op.legalEntityNameLatin;
  /* First-strong isolate around the Georgian name, so on the Arabic and Hebrew
     pages it neither reorders nor drags the parenthesis with it. */
  return `\u2068${op.legalEntityName}\u2069 (${entityTypeLabel})`;
}

export function formatLegalDate(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${iso}T00:00:00`));
  } catch {
    return iso;
  }
}
