/*
 * Georgian dates in the case a sentence needs. "2026 წლის 11 მარტს",
 * "2025 წლის აგვისტოში", "2026 წლის სექტემბრის განაცხადი": the month
 * changes form, and a template with one month word reads as translated.
 * Pure.
 */

const NOM = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
/** "11 მარტს" (dative, "on"). */
const DAT = ['იანვარს', 'თებერვალს', 'მარტს', 'აპრილს', 'მაისს', 'ივნისს', 'ივლისს', 'აგვისტოს', 'სექტემბერს', 'ოქტომბერს', 'ნოემბერს', 'დეკემბერს'];
/** "სექტემბრის" (genitive, "of"). */
const GEN = ['იანვრის', 'თებერვლის', 'მარტის', 'აპრილის', 'მაისის', 'ივნისის', 'ივლისის', 'აგვისტოს', 'სექტემბრის', 'ოქტომბრის', 'ნოემბრის', 'დეკემბრის'];
/** "აგვისტოში" ("in"). */
const IN = ['იანვარში', 'თებერვალში', 'მარტში', 'აპრილში', 'მაისში', 'ივნისში', 'ივლისში', 'აგვისტოში', 'სექტემბერში', 'ოქტომბერში', 'ნოემბერში', 'დეკემბერში'];

function parts(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  const x = typeof iso === 'string' ? /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso) : null;
  if (!x) return null;
  const m = Number(x[2]);
  if (m < 1 || m > 12) return null;
  return { y: Number(x[1]), m: m - 1, d: x[3] ? Number(x[3]) : 0 };
}

/** "2026 წლის 11 მარტს" — on a day. */
export function kaOnDay(iso: string | null | undefined): string | null {
  const p = parts(iso);
  return p && p.d ? `${p.y} წლის ${p.d} ${DAT[p.m]}` : null;
}
/** "2026 წლის 11 მარტი" — a day, as a name. */
export function kaDay(iso: string | null | undefined): string | null {
  const p = parts(iso);
  return p && p.d ? `${p.y} წლის ${p.d} ${NOM[p.m]}` : null;
}
/** "2025 წლის 30 მაისის" — of a day (precedes a noun). */
export function kaOfDay(iso: string | null | undefined): string | null {
  const p = parts(iso);
  return p && p.d ? `${p.y} წლის ${p.d} ${GEN[p.m]}` : null;
}
/** "2025 წლის აგვისტოში" — in a month. */
export function kaInMonth(iso: string | null | undefined): string | null {
  const p = parts(iso);
  return p ? `${p.y} წლის ${IN[p.m]}` : null;
}
/** "2026 წლის სექტემბრის" — of a month (precedes a noun). */
export function kaOfMonth(iso: string | null | undefined): string | null {
  const p = parts(iso);
  return p ? `${p.y} წლის ${GEN[p.m]}` : null;
}
export const yearOf = (iso: string | null | undefined): number | null => parts(iso)?.y ?? null;
