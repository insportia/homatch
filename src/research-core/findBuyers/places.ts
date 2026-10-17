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
  vake: { ka: ['ვაკე', 'ვაკეში', 'ვაკის'], ru: ['Ваке'], en: ['Vake'], ar: ['فاكي'], he: ['וואקה'], tr: ['Vake'] },
  saburtalo: { ka: ['საბურთალო', 'საბურთალოზე', 'საბურთალოს'], ru: ['Сабуртало'], en: ['Saburtalo'], ar: ['سابورتالو'], he: ['סבורטלו'], tr: ['Saburtalo'] },
  krtsanisi: { ka: ['კრწანისი', 'კრწანისში', 'კრწანისის'], ru: ['Крцаниси'], en: ['Krtsanisi'], ar: ['كرتسانيسي'], he: ['קרצניסי'], tr: ['Krtsanisi'] },
  mtatsminda: { ka: ['მთაწმინდა', 'მთაწმინდაზე', 'მთაწმინდის'], ru: ['Мтацминда'], en: ['Mtatsminda'], ar: ['متاتسميندا'], he: ['מטאצמינדה'], tr: ['Mtatsminda'] },
  isani: { ka: ['ისანი', 'ისანში', 'ისნის'], ru: ['Исани'], en: ['Isani'], ar: ['إيساني'], he: ['איסאני'], tr: ['Isani'] },
  samgori: { ka: ['სამგორი', 'სამგორში', 'სამგორის'], ru: ['Самгори'], en: ['Samgori'], ar: ['سامغوري'], he: ['סמגורי'], tr: ['Samgori'] },
  gldani: { ka: ['გლდანი', 'გლდანში', 'გლდანის'], ru: ['Глдани'], en: ['Gldani'], ar: ['غلداني'], he: ['גלדאני'], tr: ['Gldani'] },
  nadzaladevi: { ka: ['ნაძალადევი', 'ნაძალადევის'], ru: ['Надзаладеви'], en: ['Nadzaladevi'] },
  didube: { ka: ['დიდუბე', 'დიდუბეში', 'დიდუბის'], ru: ['Дидубе'], en: ['Didube'], ar: ['ديدوبي'], he: ['דידובה'], tr: ['Didube'] },
  chugureti: { ka: ['ჩუღურეთი', 'ჩუღურეთის'], ru: ['Чугурети'], en: ['Chugureti'], ar: ['تشوغوريتي'], he: ['צ\'וגורטי'], tr: ['Chugureti'] },
  avlabari: { ka: ['ავლაბარი', 'ავლაბარში', 'ავლაბრის'], ru: ['Авлабари'], en: ['Avlabari'], ar: ['أفلباري'], he: ['אבלבארי'], tr: ['Avlabari'] },
  ortachala: { ka: ['ორთაჭალა', 'ორთაჭალის'], ru: ['Ортачала'], en: ['Ortachala'], ar: ['أورتاتشالا'], he: ['אורטצ\'אלה'], tr: ['Ortaçala'] },
  /* No bare 'ვერა' / 'Вера': they hit ვერაფერი ("nothing"), ვერანდა, веранда and the
     name Вера (2026-10-17). Only district-shaped forms count. */
  vera: { ka: ['ვერაზე', 'ვერაში', 'ვერის უბან'], ru: ['на Вере', 'районе Вера', 'район Вера'], en: ['Vera district', 'in Vera', 'on Vera'] },
  sololaki: { ka: ['სოლოლაკი', 'სოლოლაკის'], ru: ['Сололаки'], en: ['Sololaki'], ar: ['سولولاكي'], he: ['סולולאקי'], tr: ['Sololaki'] },
  digomi: { ka: ['დიღომი', 'დიღომში', 'დიღმის'], ru: ['Дигоми', 'Дигом'], en: ['Digomi', 'Dighomi'], ar: ['ديغومي'], he: ['דיגומי'], tr: ['Digomi'] },
  lisi: { ka: ['ლისი', 'ლისზე'], ru: ['Лиси'], en: ['Lisi'], ar: ['بحيرة ليسي'], he: ['ליסי'], tr: ['Lisi'] },
  nutsubidze: { ka: ['ნუცუბიძე', 'ნუცუბიძის'], ru: ['Нуцубидзе'], en: ['Nutsubidze'] },
  bagebi: { ka: ['ბაგები', 'ბაგებში', 'ბაგების'], ru: ['Багеби'], en: ['Bagebi'], ar: ['باغيبي'], he: ['בגבי'], tr: ['Bagebi'] },
  vashlijvari: { ka: ['ვაშლიჯვარი', 'ვაშლიჯვრის'], ru: ['Вашлиджвари'], en: ['Vashlijvari'], ar: ['فاشليجفاري'], he: ['ושליג\'ווארי'], tr: ['Vashlijvari'] },
  mukhiani: { ka: ['მუხიანი', 'მუხიანში', 'მუხიანის'], ru: ['Мухиани'], en: ['Mukhiani'] },
  temka: { ka: ['თემქა', 'თემქაზე'], ru: ['Темка'], en: ['Temka', 'Temqa'] },
  sanzona: { ka: ['სანზონა', 'სანზონაში'], ru: ['Санзона'], en: ['Sanzona'] },
  avchala: { ka: ['ავჭალა', 'ავჭალაში'], ru: ['Авчала'], en: ['Avchala'] },
  zahesi: { ka: ['ზაჰესი', 'ზაჰესში'], ru: ['Загэс', 'Захеси'], en: ['Zahesi'] },
  varketili: { ka: ['ვარკეთილი', 'ვარკეთილში', 'ვარკეთილის'], ru: ['Варкетили'], en: ['Varketili'] },
  vazisubani: { ka: ['ვაზისუბანი'], ru: ['Вазисубани'], en: ['Vazisubani'] },
  navtlughi: { ka: ['ნავთლუღი'], ru: ['Навтлуги'], en: ['Navtlughi'] },
  lilo: { ka: ['ლილო'], ru: ['Лило'], en: ['Lilo'] },
  ponichala: { ka: ['ფონიჭალა', 'ფონიჭალაში', 'ფონიჭალის'], ru: ['Поничала'], en: ['Ponichala'], ar: ['بونيتشالا'], he: ['פוניצ\'אלה'], tr: ['Ponichala'] },
  abanotubani: { ka: ['აბანოთუბანი'], ru: ['Абанотубани'], en: ['Abanotubani'] },
  'old tbilisi': { ka: ['ძველი თბილისი', 'ძველ თბილისში'], ru: ['Старый Тбилиси', 'Старом Тбилиси'], en: ['Old Tbilisi', 'Old Town'], ar: ['تبليسي القديمة'], he: ['טביליסי העתיקה'], tr: ['Eski Tiflis'] },
  marjanishvili: { ka: ['მარჯანიშვილი', 'მარჯანიშვილზე'], ru: ['Марджанишвили'], en: ['Marjanishvili'] },
  sarajishvili: { ka: ['სარაჯიშვილი', 'სარაჯიშვილზე'], ru: ['Сараджишвили'], en: ['Sarajishvili'] },
  akhmeteli: { ka: ['ახმეტელი', 'ახმეტელის'], ru: ['Ахметели'], en: ['Akhmeteli'] },
  guramishvili: { ka: ['გურამიშვილი', 'გურამიშვილზე'], ru: ['Гурамишвили'], en: ['Guramishvili'] },
  tsereteli: { ka: ['წერეთელი', 'წერეთელზე'], ru: ['Церетели'], en: ['Tsereteli'] },
  tskneti: { ka: ['წყნეთი', 'წყნეთში'], ru: ['Цхнети'], en: ['Tskneti'] },
  'old batumi': { ka: ['ძველი ბათუმი'], ru: ['Старый Батуми'], en: ['Old Batumi'], ar: ['باتومي القديمة'], he: ['בטומי העתיקה'], tr: ['Eski Batum'] },
  'new boulevard': { ka: ['ახალი ბულვარი'], ru: ['Новый бульвар'], en: ['New Boulevard'], ar: ['البوليفارد الجديد'], he: ['השדרה החדשה'], tr: ['Yeni Bulvar'] },
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

/** Administrative districts (everything else in DISTRICT_NAMES is a micro-area or a
 *  street-named area that belongs to one of these via AREA_PARENT). */
export const ADMIN_DISTRICTS: ReadonlySet<string> = new Set([
  'vake', 'saburtalo', 'krtsanisi', 'mtatsminda', 'isani', 'samgori', 'gldani', 'nadzaladevi', 'didube', 'chugureti',
]);

/** District/area keys that are not in Tbilisi (everything else in DISTRICT_NAMES is). */
const AREA_CITY: Readonly<Record<string, string>> = { 'old batumi': 'batumi', 'new boulevard': 'batumi' };
export const cityOfArea = (key: string) => AREA_CITY[key] ?? 'tbilisi';

/**
 * Streets, as people write them, and the district they lie in. A street is never a
 * district: "კრწანისის ქ. 6" is an address on Krtsanisi Street, and a request for
 * "Ponichala" (a micro-area of the Krtsanisi district) is not a request for that
 * street (owner, 2026-10-17). Forms are the street NAME; a street word must follow
 * (or precede, in Russian) for the text to count as naming the street.
 */
export const STREETS: Readonly<Record<string, { district: string; names: Names }>> = {
  krtsanisi: { district: 'krtsanisi', names: { ka: ['კრწანისის'], ru: ['Крцаниси', 'Крцанисская', 'Крцанисской'], en: ['Krtsanisi'], tr: ['Krtsanisi'] } },
  marjanishvili: { district: 'chugureti', names: { ka: ['მარჯანიშვილის'], ru: ['Марджанишвили'], en: ['Marjanishvili'], tr: ['Marjanishvili'] } },
  tsereteli: { district: 'didube', names: { ka: ['წერეთლის'], ru: ['Церетели'], en: ['Tsereteli'], tr: ['Tsereteli'] } },
  chavchavadze: { district: 'vake', names: { ka: ['ჭავჭავაძის'], ru: ['Чавчавадзе'], en: ['Chavchavadze'], tr: ['Chavchavadze'] } },
  pekini: { district: 'saburtalo', names: { ka: ['პეკინის'], ru: ['Пекинская', 'Пекинской', 'Пекини'], en: ['Pekini', 'Pekin'], tr: ['Pekini'] } },
  kazbegi: { district: 'saburtalo', names: { ka: ['ყაზბეგის'], ru: ['Казбеги'], en: ['Kazbegi'], tr: ['Kazbegi'] } },
  vazha: { district: 'saburtalo', names: { ka: ['ვაჟა-ფშაველას', 'ვაჟა ფშაველას'], ru: ['Важа-Пшавела', 'Важа Пшавела'], en: ['Vazha-Pshavela', 'Vazha Pshavela'], tr: ['Vazha-Pshavela'] } },
  agmashenebeli: { district: 'chugureti', names: { ka: ['აღმაშენებლის'], ru: ['Агмашенебели'], en: ['Aghmashenebeli', 'Agmashenebeli'], tr: ['Aghmashenebeli'] } },
  rustaveli: { district: 'mtatsminda', names: { ka: ['რუსთაველის'], ru: ['Руставели'], en: ['Rustaveli'], tr: ['Rustaveli'] } },
  nutsubidze: { district: 'saburtalo', names: { ka: ['ნუცუბიძის'], ru: ['Нуцубидзе'], en: ['Nutsubidze'], tr: ['Nutsubidze'] } },
};
/* "ქ." / "ქუჩა", "ул." / "улица", "street" / "str." / "st.", "caddesi" / "sokak", "شارع", "רחוב". */
const STREET_AFTER = '\\s*(?:ქ\\.|ქუჩ|street|str\\.?|st\\.|ave(?:nue)?|ул\\.?|улиц|проспект|пр\\.|caddesi|cad\\.|sokak|sok\\.)';
const STREET_BEFORE = '(?:ул\\.?|улиц[аеуы]|проспект|пр\\.|street|شارع|רחוב)\\s*';

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
const LATIN = /^[\p{Script=Latin}\s'.-]+$/u;
const HEBREW = /\p{Script=Hebrew}/u;
const ARABIC = /\p{Script=Arabic}/u;
/* Hebrew and Arabic attach prepositions to the word: בסבורטלו ("in Saburtalo"), بفاكي. */
const PREFIX = (form: string) => (HEBREW.test(form) ? '[בלמהוש]?' : ARABIC.test(form) ? '(?:ب|ل|و|ال)?' : '');
const formRe = (form: string) => new RegExp(`(?<![\\p{L}\\p{N}])${PREFIX(form)}${escapeRe(fold(form))}${LATIN.test(form) ? "(?:'s)?(?![\\p{L}\\p{N}])" : ''}`, 'gu');
/* Latin text has no case endings, so a Latin form also needs a right boundary:
   "Vera" is not inside "veranda", "Lisi" not inside "Lisin" (2026-10-17). */
const hasWord = (hay: string, form: string) => formRe(form).test(hay);

/** Does the text mention the place in any of the six languages? */
export function mentionsPlace(text: string, kind: 'city' | 'district', stored: string | null | undefined): boolean {
  if (!stored) return false;
  const table = kind === 'city' ? CITY_NAMES : DISTRICT_NAMES;
  const entry = table[normKey(stored)];
  const forms = entry ? Object.values(entry).flat() : [String(stored)];
  const hay = fold(text);
  return forms.some((f) => f && hasWord(hay, f));
}

export type PlaceKind = 'DISTRICT' | 'MICRO_AREA' | 'STREET';
export interface PlaceMention { key: string; kind: PlaceKind; negated: boolean; index: number }

/* "not Vake", "кроме Ваке", "არა ვაკე", "except Saburtalo", "ليس", "לא" before the name;
   "ვაკის გარდა", "Vake hariç", "Vake dışında" after it. */
const NEG_BEFORE = /(?:^|[^\p{L}])(?:not|no|except|excluding|but not|не|кроме|исключая|არა|არ|გარდა|hariç|değil|ليس|غير|عدا|לא|חוץ מ|מלבד)[\s,:-]{1,3}(?:in |в |на |ში )?$/iu;
const NEG_AFTER = /^[\p{L}]{0,4}[\s,]{0,2}(?:გარდა|hariç|dışında|değil|не подходит|не рассматриваю|не интересует)/iu;

function mentionsOf(hay: string, forms: string[]): number[] {
  const at: number[] = [];
  for (const f of forms) if (f) for (const m of hay.matchAll(formRe(f))) at.push(m.index ?? 0);
  return at;
}

/**
 * Every place the text names, with its kind: a street ("კრწანისის ქუჩა",
 * "ул. Крцаниси", "Krtsanisi street"), an administrative district, or a
 * micro-area — and whether the writer EXCLUDED it ("not Vake", "ვაკის გარდა").
 * A street mention never also counts as the district of the same name.
 */
export function placesMentioned(text: string): PlaceMention[] {
  const hay = fold(text);
  const out: PlaceMention[] = [];
  const streetSpans: Array<[number, number]> = [];
  for (const [key, st] of Object.entries(STREETS)) {
    for (const f of Object.values(st.names).flat()) {
      if (!f) continue;
      const name = escapeRe(fold(f));
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${STREET_BEFORE}${name}|${name}[\\p{L}]{0,4}${STREET_AFTER})`, 'giu');
      for (const m of hay.matchAll(re)) {
        const i = m.index ?? 0;
        streetSpans.push([i, i + m[0].length]);
        if (!out.some((o) => o.kind === 'STREET' && o.key === key)) out.push({ key, kind: 'STREET', negated: negatedAt(hay, i, i + m[0].length), index: i });
      }
    }
  }
  for (const [key, names] of Object.entries(DISTRICT_NAMES)) {
    const hits = mentionsOf(hay, Object.values(names).flat())
      .filter((i) => !streetSpans.some(([a, b]) => i >= a && i < b));
    if (!hits.length) continue;
    const i = Math.min(...hits);
    const negated = hits.every((h) => negatedAt(hay, h, h + 1));
    out.push({ key, kind: ADMIN_DISTRICTS.has(key) ? 'DISTRICT' : 'MICRO_AREA', negated, index: i });
  }
  return out.sort((a, b) => a.index - b.index);
}

function negatedAt(hay: string, start: number, end: number): boolean {
  const before = hay.slice(Math.max(0, start - 16), start);
  const word = hay.slice(start).match(/^[\p{L}\p{N}]*/u)?.[0] ?? '';
  const after = hay.slice(start + Math.max(word.length, end - start), start + Math.max(word.length, end - start) + 24);
  return NEG_BEFORE.test(before) || NEG_AFTER.test(after);
}

/** Which known district/area (key) the text names (not a street, not excluded), if any. */
export function districtMentioned(text: string): string | null {
  return districtsMentioned(text)[0] ?? null;
}

/** Every known district/area the text names as a wanted place: streets and places the
 *  writer excluded ("not Vake") are left out (see placesMentioned for those). */
export function districtsMentioned(text: string): string[] {
  return placesMentioned(text).filter((p) => p.kind !== 'STREET' && !p.negated).map((p) => p.key);
}

/** Streets the text names as wanted (not excluded). */
export function streetsMentioned(text: string): string[] {
  return placesMentioned(text).filter((p) => p.kind === 'STREET' && !p.negated).map((p) => p.key);
}

/** Districts, micro-areas and streets the writer explicitly excluded. */
export function excludedPlaces(text: string): string[] {
  return placesMentioned(text).filter((p) => p.negated).map((p) => (p.kind === 'STREET' ? `street:${p.key}` : p.key));
}

/** The street an address line names ("კრწანისის ქ. 6" → krtsanisi), or null. */
export function streetOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return placesMentioned(String(address)).find((p) => p.kind === 'STREET')?.key ?? null;
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
