/*
 * Tbilisi districts for the HTML portals — the worker's copy of the place rows in
 * src/research-core/normalize/place.ts (the worker image is built from
 * official-worker/ alone and cannot import the core). A test pins every row here
 * to that table, so the two vocabularies cannot drift: a lookup, not a
 * transliterator. A name not in the table resolves to null, and null is never a
 * conflict — the pipeline decides those listings, not the worker.
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

/** True only when the listing names a known district and every requested one is a known, different district. */
export function districtConflict(listingDistrict, request) {
  const have = districtKey(listingDistrict), wanted = requestedDistrictKeys(request);
  return Boolean(have && wanted && !wanted.includes(have));
}
