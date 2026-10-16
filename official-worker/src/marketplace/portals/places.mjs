/*
 * Tbilisi districts for the HTML portals — the worker's copy of the place rows in
 * src/research-core/normalize/place.ts (the worker image is built from
 * official-worker/ alone and cannot import the core). A test pins every row here
 * to that table, so the two vocabularies cannot drift: a lookup, not a
 * transliterator.
 *
 * District check (portal sources only): MyHome and SS.ge filter districts on their
 * own servers; these portals cannot (Place.ge, Allhome, Brokeri) or only by slug
 * (Home.ge). So when every requested district is known, a listing that names a
 * district which is not one of them is dropped here — including a neighbourhood the
 * table does not know ("ვაშლიჯვარი" for a Krtsanisi search, 2026-10-16 live run),
 * which the results pipeline would otherwise keep as "district unverified" whenever
 * the request was typed in Latin. A listing that names no district is kept.
 */
const DISTRICTS = [
  ['saburtalo', 'საბურთალო', 'сабуртало'],
  ['vake', 'ვაკე', 'ваке'],
  ['chughureti', 'ჩუღურეთი', 'чугурети'],
  ['didube', 'დიდუბე', 'дидубе'],
  ['krtsanisi', 'კრწანისი', 'крцаниси'],
  ['sololaki', 'სოლოლაკი', 'сололаки'],
  ['vera', 'ვერა', 'вера'],
  ['digomi', 'დიღომი', 'дигоми'],
  ['didi digomi', 'დიდი დიღომი', 'диди дигоми'],
  ['gldani', 'გლდანი', 'глдани'],
  ['isani', 'ისანი', 'исани'],
  ['samgori', 'სამგორი', 'самгори'],
  ['mtatsminda', 'მთაწმინდა', 'мтацминда'],
  ['nadzaladevi', 'ნაძალადევი', 'надзаладеви'],
  ['avlabari', 'ავლაბარი', 'авлабари'],
  ['ortachala', 'ორთაჭალა', 'ортачала'],
];
const INDEX = new Map(DISTRICTS.flatMap((row) => row.map((name) => [name, row[0]])));
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const TBILISI_DISTRICT_ROWS = DISTRICTS;

/** Canonical Latin key of a Tbilisi district, or null when the table does not know the name. */
export const districtKey = (name) => INDEX.get(norm(name)) ?? null;

/** Every requested district's key, or null unless all of them are known (a partial set would drop real matches). */
export function requestedDistrictKeys(request) {
  const wanted = (request.districts ?? []).map((d) => String(d ?? '').trim()).filter(Boolean);
  if (!wanted.length) return null;
  const keys = wanted.map(districtKey);
  return keys.every(Boolean) ? [...new Set(keys)] : null;
}

/** True when every requested district is known and the listing names a different place. */
export function districtConflict(listingDistrict, request) {
  const wanted = requestedDistrictKeys(request), stated = norm(listingDistrict);
  return Boolean(wanted && stated && !wanted.includes(districtKey(stated)));
}
