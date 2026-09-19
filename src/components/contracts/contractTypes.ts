/*
 * THE KINDS OF DOCUMENT A BUYER ARRIVES WITH.
 *
 * Kept as data, in one place, because three screens need the same list and a
 * fourth (the result page) needs to map what the analyser detected back onto
 * it in order to notice a disagreement.
 *
 * AUTO IS FIRST AND IS THE DEFAULT. The analyser identifies the document type
 * from the text and does it well; making the customer classify their own
 * contract before Homatch will read it is asking a question whose answer we
 * already have, and getting it wrong would be their fault instead of ours.
 * Choosing a type is therefore never required and never blocks the upload.
 */

export type ContractTypeId =
  | 'AUTO'
  | 'PURCHASE'
  | 'PRESALE'
  | 'LEASE'
  | 'MORTGAGE'
  | 'OTHER';

export interface ContractTypeOption {
  id: ContractTypeId;
  labelKey: string;
  /**
   * Substrings that indicate this type in a detected documentType string,
   * in Georgian and English. Lower-cased comparison; a detected type that
   * matches none of them simply produces no opinion.
   */
  markers: string[];
}

export const CONTRACT_TYPES: ContractTypeOption[] = [
  { id: 'AUTO', labelKey: 'ct_type_auto', markers: [] },
  {
    id: 'PURCHASE',
    labelKey: 'ct_type_purchase',
    markers: ['ნასყიდობ', 'purchase', 'sale agreement', 'sale contract'],
  },
  {
    id: 'PRESALE',
    labelKey: 'ct_type_presale',
    markers: ['წინარე', 'მშენებარე', 'pre-sale', 'presale', 'off-plan', 'preliminary'],
  },
  {
    id: 'LEASE',
    labelKey: 'ct_type_lease',
    markers: ['იჯარ', 'ქირავნობ', 'lease', 'rental', 'tenancy'],
  },
  {
    id: 'MORTGAGE',
    labelKey: 'ct_type_mortgage',
    markers: ['იპოთეკ', 'mortgage', 'pledge'],
  },
  { id: 'OTHER', labelKey: 'ct_type_other', markers: [] },
];

/**
 * Which of the offered types the analyser's own description corresponds to.
 *
 * Returns null when the detected text matches nothing we offer — which is
 * common and unremarkable, since the analyser writes a full descriptive
 * phrase rather than picking from a menu.
 */
export function detectedTypeId(documentType: string | null | undefined): ContractTypeId | null {
  if (!documentType) return null;
  const text = documentType.toLowerCase();
  for (const opt of CONTRACT_TYPES) {
    if (opt.markers.some((m) => text.includes(m))) return opt.id;
  }
  return null;
}

/**
 * Whether what the customer said and what the analyser found disagree.
 *
 * Deliberately conservative: a disagreement is only reported when the
 * customer actually chose a specific type AND the detected type was
 * recognised AND the two differ. Every uncertain case returns false, because
 * telling somebody their contract is not what they think it is, on a guess,
 * is far worse than staying quiet.
 */
export function typesDisagree(
  declared: ContractTypeId | null | undefined,
  documentType: string | null | undefined
): boolean {
  if (!declared || declared === 'AUTO' || declared === 'OTHER') return false;
  const detected = detectedTypeId(documentType);
  if (!detected || detected === 'OTHER') return false;
  return detected !== declared;
}
