// Place names as people actually write them, per search language, and the
// reverse: does a piece of text mention this place?
//
// A closed gazetteer of the Georgian cities and Tbilisi/Batumi districts that
// carry real estate demand. A place outside it is still searched by the name
// stored on the property (never invented); it simply has no translations.

import type { SearchLanguage } from './languages.ts';

type Names = Partial<Record<SearchLanguage, string[]>>;

/* Keys are the lowercased Latin form the property pipeline stores. */
export const CITY_NAMES: Readonly<Record<string, Names>> = {
  tbilisi: { ka: ['თბილისი', 'თბილისში'], ru: ['Тбилиси'], en: ['Tbilisi'], ar: ['تبليسي'], he: ['טביליסי'], tr: ['Tiflis', 'Tbilisi'] },
  batumi: { ka: ['ბათუმი', 'ბათუმში'], ru: ['Батуми'], en: ['Batumi'], ar: ['باتومي'], he: ['בטומי'], tr: ['Batum', 'Batumi'] },
  kutaisi: { ka: ['ქუთაისი', 'ქუთაისში'], ru: ['Кутаиси'], en: ['Kutaisi'], ar: ['كوتايسي'], he: ['קוטאיסי'], tr: ['Kutaisi'] },
  rustavi: { ka: ['რუსთავი', 'რუსთავში'], ru: ['Рустави'], en: ['Rustavi'], tr: ['Rustavi'] },
  kobuleti: { ka: ['ქობულეთი', 'ქობულეთში'], ru: ['Кобулети'], en: ['Kobuleti'], tr: ['Kobuleti'] },
  gudauri: { ka: ['გუდაური', 'გუდაურში'], ru: ['Гудаури'], en: ['Gudauri'], tr: ['Gudauri'] },
  bakuriani: { ka: ['ბაკურიანი', 'ბაკურიანში'], ru: ['Бакуриани'], en: ['Bakuriani'], tr: ['Bakuriani'] },
  mtskheta: { ka: ['მცხეთა', 'მცხეთაში'], ru: ['Мцхета'], en: ['Mtskheta'], tr: ['Mtskheta'] },
};

export const DISTRICT_NAMES: Readonly<Record<string, Names>> = {
  vake: { ka: ['ვაკე', 'ვაკეში'], ru: ['Ваке'], en: ['Vake'] },
  saburtalo: { ka: ['საბურთალო', 'საბურთალოზე'], ru: ['Сабуртало'], en: ['Saburtalo'] },
  krtsanisi: { ka: ['კრწანისი', 'კრწანისში'], ru: ['Крцаниси'], en: ['Krtsanisi'] },
  mtatsminda: { ka: ['მთაწმინდა', 'მთაწმინდაზე'], ru: ['Мтацминда'], en: ['Mtatsminda'] },
  isani: { ka: ['ისანი', 'ისანში'], ru: ['Исани'], en: ['Isani'] },
  samgori: { ka: ['სამგორი', 'სამგორში'], ru: ['Самгори'], en: ['Samgori'] },
  gldani: { ka: ['გლდანი', 'გლდანში'], ru: ['Глдани'], en: ['Gldani'] },
  nadzaladevi: { ka: ['ნაძალადევი'], ru: ['Надзаладеви'], en: ['Nadzaladevi'] },
  didube: { ka: ['დიდუბე', 'დიდუბეში'], ru: ['Дидубе'], en: ['Didube'] },
  chugureti: { ka: ['ჩუღურეთი'], ru: ['Чугурети'], en: ['Chugureti'] },
  avlabari: { ka: ['ავლაბარი', 'ავლაბარში'], ru: ['Авлабари'], en: ['Avlabari'] },
  ortachala: { ka: ['ორთაჭალა'], ru: ['Ортачала'], en: ['Ortachala'] },
  vera: { ka: ['ვერა', 'ვერაზე'], ru: ['Вера'], en: ['Vera'] },
  sololaki: { ka: ['სოლოლაკი'], ru: ['Сололаки'], en: ['Sololaki'] },
  digomi: { ka: ['დიღომი', 'დიღომში', 'დიღმის'], ru: ['Дигоми', 'Дигом'], en: ['Digomi', 'Dighomi'] },
  lisi: { ka: ['ლისი', 'ლისზე'], ru: ['Лиси'], en: ['Lisi'] },
  nutsubidze: { ka: ['ნუცუბიძე', 'ნუცუბიძის'], ru: ['Нуцубидзе'], en: ['Nutsubidze'] },
  bagebi: { ka: ['ბაგები', 'ბაგებში'], ru: ['Багеби'], en: ['Bagebi'] },
  vashlijvari: { ka: ['ვაშლიჯვარი'], ru: ['Вашлиджвари'], en: ['Vashlijvari'] },
  mukhiani: { ka: ['მუხიანი', 'მუხიანში'], ru: ['Мухиани'], en: ['Mukhiani'] },
  temka: { ka: ['თემქა', 'თემქაზე'], ru: ['Темка'], en: ['Temka', 'Temqa'] },
  sanzona: { ka: ['სანზონა', 'სანზონაში'], ru: ['Санзона'], en: ['Sanzona'] },
  avchala: { ka: ['ავჭალა', 'ავჭალაში'], ru: ['Авчала'], en: ['Avchala'] },
  zahesi: { ka: ['ზაჰესი', 'ზაჰესში'], ru: ['Загэс', 'Захеси'], en: ['Zahesi'] },
  varketili: { ka: ['ვარკეთილი', 'ვარკეთილში'], ru: ['Варкетили'], en: ['Varketili'] },
  vazisubani: { ka: ['ვაზისუბანი'], ru: ['Вазисубани'], en: ['Vazisubani'] },
  navtlughi: { ka: ['ნავთლუღი'], ru: ['Навтлуги'], en: ['Navtlughi'] },
  lilo: { ka: ['ლილო'], ru: ['Лило'], en: ['Lilo'] },
  ponichala: { ka: ['ფონიჭალა', 'ფონიჭალაში'], ru: ['Поничала'], en: ['Ponichala'] },
  abanotubani: { ka: ['აბანოთუბანი'], ru: ['Абанотубани'], en: ['Abanotubani'] },
  'old tbilisi': { ka: ['ძველი თბილისი', 'ძველ თბილისში'], ru: ['Старый Тбилиси', 'Старом Тбилиси'], en: ['Old Tbilisi', 'Old Town'] },
  marjanishvili: { ka: ['მარჯანიშვილი', 'მარჯანიშვილზე'], ru: ['Марджанишвили'], en: ['Marjanishvili'] },
  sarajishvili: { ka: ['სარაჯიშვილი', 'სარაჯიშვილზე'], ru: ['Сараджишвили'], en: ['Sarajishvili'] },
  akhmeteli: { ka: ['ახმეტელი', 'ახმეტელის'], ru: ['Ахметели'], en: ['Akhmeteli'] },
  guramishvili: { ka: ['გურამიშვილი', 'გურამიშვილზე'], ru: ['Гурамишвили'], en: ['Guramishvili'] },
  tsereteli: { ka: ['წერეთელი', 'წერეთელზე'], ru: ['Церетели'], en: ['Tsereteli'] },
  tskneti: { ka: ['წყნეთი', 'წყნეთში'], ru: ['Цхнети'], en: ['Tskneti'] },
  'old batumi': { ka: ['ძველი ბათუმი'], ru: ['Старый Батуми'], en: ['Old Batumi'] },
  'new boulevard': { ka: ['ახალი ბულვარი'], ru: ['Новый бульвар'], en: ['New Boulevard'] },
};

/** Districts commonly considered acceptable alternatives (soft, never hard). */
export const NEARBY_DISTRICTS: Readonly<Record<string, string[]>> = {
  vake: ['saburtalo', 'mtatsminda', 'vera'],
  saburtalo: ['vake', 'didube', 'digomi'],
  krtsanisi: ['mtatsminda', 'isani', 'ortachala', 'sololaki'],
  mtatsminda: ['vake', 'sololaki', 'vera', 'krtsanisi'],
  isani: ['samgori', 'avlabari', 'krtsanisi'],
  samgori: ['isani'],
  gldani: ['nadzaladevi'],
  nadzaladevi: ['gldani', 'didube'],
  didube: ['saburtalo', 'chugureti', 'nadzaladevi'],
  chugureti: ['didube', 'vera'],
  avlabari: ['isani', 'sololaki'],
  ortachala: ['krtsanisi', 'isani'],
  vera: ['vake', 'mtatsminda', 'chugureti'],
  sololaki: ['mtatsminda', 'krtsanisi', 'avlabari'],
  digomi: ['saburtalo'],
  lisi: ['saburtalo', 'vake'],
};

/**
 * Micro-areas and neighbourhoods → the administrative district they belong
 * to (approximate where an area spans a border; used for nearby/other-area
 * decisions only, never to state an address).
 */
export const AREA_PARENT: Readonly<Record<string, string>> = {
  ortachala: 'krtsanisi', ponichala: 'krtsanisi', abanotubani: 'krtsanisi', 'old tbilisi': 'mtatsminda',
  sololaki: 'mtatsminda', vera: 'vake', bagebi: 'vake', tskneti: 'vake', lisi: 'saburtalo', nutsubidze: 'saburtalo',
  vashlijvari: 'saburtalo', digomi: 'didube', tsereteli: 'didube', sarajishvili: 'didube', marjanishvili: 'chugureti',
  mukhiani: 'gldani', temka: 'gldani', avchala: 'gldani', zahesi: 'gldani', akhmeteli: 'gldani',
  sanzona: 'nadzaladevi', guramishvili: 'nadzaladevi', varketili: 'samgori', lilo: 'samgori', vazisubani: 'gldani',
  navtlughi: 'samgori', avlabari: 'isani',
};

export const normKey = (value: string | null | undefined) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+district$/, '').replace(/\s+/g, ' ');

/** Names to search with, in one language; falls back to the stored name. */
export function placeNamesFor(kind: 'city' | 'district', stored: string | null | undefined, lang: SearchLanguage): string[] {
  if (!stored) return [];
  const table = kind === 'city' ? CITY_NAMES : DISTRICT_NAMES;
  const names = table[normKey(stored)]?.[lang];
  if (names && names.length) return names;
  /* Arabic/Hebrew/Turkish writers mostly use the Latin form for districts. */
  const en = table[normKey(stored)]?.en;
  return en && en.length ? en : [String(stored)];
}

const fold = (s: string) => s.toLowerCase().normalize('NFKC').replace(/ё/g, 'е');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* A place name must start at a word boundary ("Lisi" is not inside
   "Tbilisi"); case endings after it are allowed (Ваке → Ваке, ვაკეში). */
const hasWord = (hay: string, form: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(fold(form))}`, 'u').test(hay);

/** Does the text mention the place in any of the six languages? */
export function mentionsPlace(text: string, kind: 'city' | 'district', stored: string | null | undefined): boolean {
  if (!stored) return false;
  const table = kind === 'city' ? CITY_NAMES : DISTRICT_NAMES;
  const entry = table[normKey(stored)];
  const forms = entry ? Object.values(entry).flat() : [String(stored)];
  const hay = fold(text);
  return forms.some((f) => f && hasWord(hay, f));
}

/** Which known district (key) does the text mention, if any. */
export function districtMentioned(text: string): string | null {
  const hay = fold(text);
  for (const [key, names] of Object.entries(DISTRICT_NAMES)) {
    if (Object.values(names).flat().some((f) => hasWord(hay, f))) return key;
  }
  return null;
}

/** Every known district/area the text names (in order of the table). */
export function districtsMentioned(text: string): string[] {
  const hay = fold(text);
  return Object.entries(DISTRICT_NAMES)
    .filter(([, names]) => Object.values(names).flat().some((f) => hasWord(hay, f)))
    .map(([key]) => key);
}

/** The administrative district a district/area key belongs to. */
export const parentDistrict = (key: string) => AREA_PARENT[key] ?? key;

/** Common misspellings people write; recognised, never used to search. */
const CITY_TYPOS: Readonly<Record<string, string[]>> = { tbilisi: ['თბილიში', 'Tiblisi', 'Тбилис'] };

export function cityMentioned(text: string): string | null {
  const hay = fold(text);
  for (const [key, names] of Object.entries(CITY_NAMES)) {
    if ([...Object.values(names).flat(), ...(CITY_TYPOS[key] ?? [])].some((f) => hasWord(hay, f))) return key;
  }
  return null;
}
