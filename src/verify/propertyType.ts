// HOMATCH — what kind of property is this?
//
// A buyer opens the report and the first thing they want confirmed is what
// they are looking at. Production answered that question sixteen different
// ways for one cadastral code, including:
//
//   "საკადასტრო იდენტიფიკატორი"                    cadastral identifier
//   "ინდივიდუალური საკადასტრო ერთეული"             individual cadastral unit
//   "უძრავი ქონების ერთეული"                       real estate unit
//   "საკადასტრო კოდით იდენტიფიცირებული ერთეული"    unit identified by cadastral code
//   "ცალკე საკადასტრო ერთეული; ფუნქციური სახეობა დაუდასტურებელია"
//   "REAL_ESTATE_UNIT"
//
// Every one of those restates the input. The customer typed a cadastral code
// and was told it is a cadastral code. That is §1: the property has to be
// CLASSIFIED, and the classification has to be stable — the same property
// cannot be a different kind of thing on Tuesday.
//
// So the label comes from assetClass, which is an enum the server now
// resolves from evidence rather than accepting as a self-report. The model's
// free text is a fallback only, and only when it actually says something.

export const ASSET_CLASS_LABEL_KEYS: Record<string, string> = {
  APARTMENT_IN_PROJECT: 'verify_asset_apartment_in_project',
  PRIVATE_RESALE: 'verify_asset_private_resale',
  PRIVATE_HOUSE: 'verify_asset_private_house',
  LAND: 'verify_asset_land',
  COMMERCIAL: 'verify_asset_commercial',
  RENTAL: 'verify_asset_rental',
  UNDER_CONSTRUCTION: 'verify_asset_under_construction',
  COMPANY_OWNED: 'verify_asset_company_owned',
};

/** The i18n key for a resolved asset class, or null when it is unknown.
 *  MIXED_OR_UNKNOWN deliberately has no label: saying "mixed or unknown" to
 *  a buyer is worse than saying nothing and letting the description stand. */
export function assetClassLabelKey(assetClass: unknown): string | null {
  if (typeof assetClass !== 'string') return null;
  return ASSET_CLASS_LABEL_KEYS[assetClass.trim().toUpperCase()] ?? null;
}

/*
 * Words that describe the REFERENCE rather than the property. A label built
 * only from these tells the reader nothing they did not already type.
 */
const GENERIC_TOKENS = new Set([
  'საკადასტრო', 'კადასტრული', 'კადასტრი', 'ერთეული', 'ერთეულის',
  'იდენტიფიკატორი', 'იდენტიფიცირებული', 'ინდივიდუალური', 'უძრავი',
  'ქონების', 'ქონება', 'კოდით', 'კოდი', 'ცალკე', 'ობიექტი', 'ობიექტის',
  'cadastral', 'cadastre', 'unit', 'identifier', 'individual', 'real',
  'estate', 'property', 'code', 'object', 'separate',
]);

/** An internal enum: ALL_CAPS with underscores, e.g. REAL_ESTATE_UNIT. */
const INTERNAL_ENUM = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * Whether the model's free-text type is worth showing.
 *
 * Rejects an internal enum, a caveat pinned onto the label with a semicolon
 * (a caveat belongs in the report body, not in a badge), and a label made
 * entirely of words describing the cadastral reference.
 */
export function isUsableTypeLabel(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 2) return false;
  if (INTERNAL_ENUM.test(s)) return false;
  if (s.toUpperCase() === 'UNKNOWN') return false;

  // "ცალკე საკადასტრო ერთეული; ფუნქციური სახეობა დაუდასტურებელია" — the
  // qualification is real information, but a badge is the wrong place for it.
  if (s.includes(';')) return false;

  // Strip the reference vocabulary and see whether anything is left.
  const remaining = s
    .split(/[\s/,·—–-]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && !GENERIC_TOKENS.has(w));

  return remaining.join('').length >= 3;
}

export type PropertyTypeDisplay =
  | { kind: 'LABEL'; labelKey: string }
  | { kind: 'TEXT'; text: string }
  | { kind: 'NONE' };

/**
 * What the property-type badge should say.
 *
 * The resolved class wins, because it is stable across runs and evidence-
 * bound. The model's description is used only when there is no class and the
 * description actually adds something. When neither qualifies the caller
 * shows nothing rather than a restatement of the cadastral code.
 */
export function propertyTypeDisplay(report: unknown): PropertyTypeDisplay {
  const r = (report ?? {}) as Record<string, unknown>;

  const labelKey = assetClassLabelKey(r.assetClass);
  if (labelKey) return { kind: 'LABEL', labelKey };

  if (isUsableTypeLabel(r.entityType)) return { kind: 'TEXT', text: String(r.entityType).trim() };

  return { kind: 'NONE' };
}
