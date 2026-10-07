// Conservative multilingual text evidence, never promoted into structured facts.
export type DescriptionSignalCode = 'RENOVATED' | 'NEW_BUILD' | 'UNDER_CONSTRUCTION' | 'PARKING' | 'FURNISHED' | 'APPLIANCES' | 'BALCONY' | 'VIEW' | 'CENTRAL_HEATING' | 'ELEVATOR' | 'OWNER_CLAIM' | 'AGENCY_LANGUAGE' | 'URGENT' | 'NEGOTIABLE';
export interface DescriptionSignal { code: DescriptionSignalCode; evidence: string; basis: 'DESCRIPTION'; polarity: 'MENTIONED' | 'NEGATED' }
const PATTERNS: Array<[DescriptionSignalCode, RegExp]> = [
  ['RENOVATED', /გარემონტ|რემონტით|\brenovated\b|\brenovation\b|ремонт/iu],
  ['NEW_BUILD', /ახალ(?:ად)?\s*აშენებულ|\bnew[ -]build|новостро|новый дом/iu],
  ['UNDER_CONSTRUCTION', /მშენებარე|\bunder construction\b|строящ/iu],
  ['PARKING', /პარკინგ|ავტოფარეხ|\bparking\b|\bgarage\b|парков|гараж/iu],
  ['FURNISHED', /ავეჯ|\bunfurnished\b|\bfurnished\b|\bfurniture\b|мебел/iu],
  ['APPLIANCES', /ტექნიკ|\bappliances\b|бытов.{0,12}техник/iu],
  ['BALCONY', /აივან|აივნ|\bbalcony\b|балкон/iu],
  ['VIEW', /ხედით|\b(?:sea|city|mountain|panoramic) view\b|панорам|вид на/iu],
  ['CENTRAL_HEATING', /ცენტრალური გათბ|\bcentral heating\b|центральн.{0,8}отоплен/iu],
  ['ELEVATOR', /ლიფტ|\belevator\b|\blift\b|лифт/iu],
  ['OWNER_CLAIM', /მესაკუთრისგან|მე ვარ მესაკუთრე|\b(?:I am the owner|my apartment|my flat|from the owner)\b|я собственник|от собственника/iu],
  ['AGENCY_LANGUAGE', /სააგენტო|საკომისიო|\b(?:agency|commission|broker)\b|агентств|комисси|ри[еэ]лтор/iu],
  ['URGENT', /სასწრაფო|\burgent\b|срочно/iu],
  ['NEGOTIABLE', /ფასზე.{0,20}შეთანხმ|ფასი.{0,15}შეთანხმ|\bnegotiable\b|торг/iu],
];
export function descriptionSignals(description: string | null | undefined): DescriptionSignal[] {
  const text = (description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  const result: DescriptionSignal[] = [];
  for (const [code, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const before = text.slice(Math.max(0, match.index - 32), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 32);
    const negated = /(?:\bno\b|\bnot\b|\bwithout\b|\bunfurnished\b|\bбез\b|не|არ არის|არ აქვს)\s*(?:\w+\s*)?$/iu.test(before)
      || /^(?:\S*\s*)?(?:არ აქვს|არ არის|გარეშე|нет)/iu.test(after) || /^unfurnished$/i.test(match[0]);
    result.push({ code, basis: 'DESCRIPTION', polarity: negated ? 'NEGATED' : 'MENTIONED',
      evidence: text.slice(Math.max(0, match.index - 35), Math.min(text.length, match.index + match[0].length + 45)).trim() });
  }
  return result;
}

/** Substantial descriptions only; generic short pitches are never property identities. */
export function descriptionFingerprint(text: string | null): string | null {
  const clean = (text ?? '').normalize('NFKC').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return clean.length >= 180 && clean.split(/\s+/).length >= 24 ? clean : null;
}
