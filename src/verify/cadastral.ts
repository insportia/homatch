// HOMATCH — the parcel, the building, and the flat are not the same thing.
//
// §14. A Georgian cadastral code is hierarchical. Five groups identify the
// LAND PARCEL:
//
//   01.18.06.019.055                 the parcel
//   01.18.06.019.055.03.01.601       a unit inside it
//
// Everything registered against the parcel — its area, its permitted use, an
// encumbrance on the land, the developer who built on it — is a fact about
// the parcel. It is not automatically a fact about flat 601, and presenting
// it as one is how a buyer ends up believing their specific apartment has
// been checked when what was checked is the ground underneath it.
//
// WHAT PRODUCTION DID
//
// The report already had an identifiedParent and an exactUnit, and the card
// that renders them already had a "parent parcel" label. It never appeared,
// because the label was gated on identifiedParent.code being populated and
// in production that field is null — the code arrives inside the NAME
// instead:
//
//   identifiedParent.code = null
//   identifiedParent.name = "საკადასტრო კოდი 01.18.06.019.055"
//   exactUnit.code        = "01.18.06.019.055.03.01.601"
//   exactUnit.verified    = false
//
// So the parcel's own cadastral code was rendered under the label "Project:",
// and the distinction the card was built to draw was silently switched off.
//
// The hierarchy is in the code itself, so it does not need a populated field
// to be discovered. That is what this module does.

/** A cadastral code: five or more dot-separated numeric groups. */
const CADASTRAL_CODE = /\b(\d{2}(?:\.\d{2,3}){4,})\b/;

const PARCEL_GROUPS = 5;

/** The cadastral code contained in a string, or null. Handles the shape the
 *  research layer actually emits, where the code is embedded in prose. */
export function extractCadastralCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const m = CADASTRAL_CODE.exec(text.trim());
  return m ? m[1] : null;
}

export function isCadastralCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  const m = CADASTRAL_CODE.exec(s);
  return !!m && m[1] === s;
}

/**
 * The land parcel a unit sits on, or null when the code IS a parcel.
 *
 * Returning null for a bare parcel code matters: it is what stops the report
 * inventing a parent for a property that has none.
 */
export function parentParcelCode(unitCode: unknown): string | null {
  const code = typeof unitCode === 'string' ? unitCode.trim() : '';
  if (!isCadastralCode(code)) return null;
  const groups = code.split('.');
  if (groups.length <= PARCEL_GROUPS) return null;
  return groups.slice(0, PARCEL_GROUPS).join('.');
}

/** Whether a code identifies something inside a parcel rather than the
 *  parcel itself — a building, a floor, a flat. */
export function isUnitWithinParcel(code: unknown): boolean {
  return parentParcelCode(code) !== null;
}

export type ParcelRelation = {
  /** The exact unit the customer asked about. */
  unitCode: string | null;
  /** The parcel it sits on, derived from the code or from the report. */
  parcelCode: string | null;
  /** True when the two are genuinely different things. */
  differs: boolean;
  /** Whether the exact unit's own status was confirmed by a source. */
  unitVerified: boolean;
};

/**
 * How the queried unit relates to the parcel beneath it.
 *
 * The parcel is taken from the unit's own code first, because that is
 * structural and always available, and only then from the report's
 * identifiedParent — whose code field is frequently null while the code
 * itself sits in the name.
 */
export function parcelRelation(report: unknown): ParcelRelation {
  const r = (report ?? {}) as Record<string, unknown>;
  const unit = (r.exactUnit ?? {}) as Record<string, unknown>;
  const parent = (r.identifiedParent ?? {}) as Record<string, unknown>;

  const unitCode = typeof unit.code === 'string' && unit.code.trim() ? unit.code.trim() : null;

  const parcelCode =
    parentParcelCode(unitCode) ??
    (typeof parent.code === 'string' ? extractCadastralCode(parent.code) : null) ??
    extractCadastralCode(parent.name);

  return {
    unitCode,
    parcelCode,
    differs: !!(unitCode && parcelCode && unitCode !== parcelCode),
    unitVerified: unit.verified === true,
  };
}

/*
 * A parent whose "name" is only its own cadastral code is not a name.
 *
 * "საკადასტრო კოდი 01.18.06.019.055" was being rendered under the label
 * "Project:", which is the §1 failure in its most literal form — the report
 * telling a buyer that the project is a cadastral code.
 */
export function isNameJustACode(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const s = name.trim();
  if (!s) return true;
  const code = extractCadastralCode(s);
  if (!code) return false;
  // Remove the code and the words that only introduce it.
  const rest = s
    .replace(code, ' ')
    .replace(/საკადასტრო|კადასტრული|კოდი|ერთეული|cadastral|code|unit|parcel|ნაკვეთი/gi, ' ')
    .replace(/[\s.,:;/()-]+/g, '');
  return rest.length < 3;
}

/** The parent's display name, or null when it is only a restatement of its
 *  code. The code is shown separately, under its own label. */
export function parentDisplayName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  return isNameJustACode(name) ? null : name.trim();
}
