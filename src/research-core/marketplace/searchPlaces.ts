// HOMATCH MARKETPLACE SEARCH — the places a search sentence can name.
//
// The query engine (queryEngine.ts) reads a customer's sentence without a model,
// so every place it can recognise is listed here, with the spellings people
// actually type in the six product languages. It extends the Find Buyers
// gazetteer (findBuyers/places.ts, which already carries most Tbilisi
// neighbourhoods) with more Tbilisi neighbourhoods and the Batumi, Kutaisi and
// Rustavi areas portals list, and with the spellings a search box sees
// (genitive and locative Georgian forms, Russian, Turkish, Arabic, Hebrew).
//
// WHAT A ROW STORES
//
//   name   the canonical Latin name the request carries. MyHome resolves it
//          against its own dictionary (English display names), the HTML
//          portals against their place table; an area neither knows simply
//          widens to its city, it is never invented into another place.
//   kind   CITY or AREA (an administrative district or a neighbourhood)
//   city   for an AREA, the city it is in
//   forms  every spelling, any script. Georgian forms are matched with their
//          case endings stripped; everything else whole-word.
//
// A LOOKUP, NOT A TRANSLITERATOR. A spelling missing here costs a recognition
// (the customer is asked for the place), never a wrong place.

import { CITY_NAMES, cityOfArea, DISTRICT_NAMES } from '../findBuyers/places.ts';

export interface SearchPlace {
  key: string;
  name: string;
  kind: 'CITY' | 'AREA';
  /** City key ('tbilisi'), for an AREA. */
  city: string | null;
  forms: string[];
  /** Localised display names, for clarification chips. */
  labels: Partial<Record<'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he', string>>;
}

type Row = { name: string; city?: string; ka: string[]; en?: string[]; ru?: string[]; tr?: string[]; ar?: string[]; he?: string[] };

/** Cities beyond the Find Buyers list, and extra spellings for the listed ones. */
const EXTRA_CITIES: Record<string, Row> = {
  tbilisi: { name: 'Tbilisi', ka: ['თბილისი', 'თბილისში', 'თბილისის', 'თბ'], en: ['Tbilisi', 'Tiblisi', 'Tbilissi'], ru: ['Тбилиси', 'Тбилисе'], tr: ['Tiflis', "Tiflis'te"], ar: ['تبليسي', 'تبيليسي'], he: ['טביליסי', 'טיביליסי'] },
  batumi: { name: 'Batumi', ka: ['ბათუმი', 'ბათუმში', 'ბათუმის'], en: ['Batumi', 'Batum'], ru: ['Батуми', 'Батум'], tr: ['Batum'], ar: ['باتومي', 'باطومي'], he: ['בטומי', 'באטומי'] },
  kutaisi: { name: 'Kutaisi', ka: ['ქუთაისი', 'ქუთაისში', 'ქუთაისის'], en: ['Kutaisi'], ru: ['Кутаиси'], tr: ['Kutaisi'], ar: ['كوتايسي'], he: ['קוטאיסי'] },
  rustavi: { name: 'Rustavi', ka: ['რუსთავი', 'რუსთავში', 'რუსთავის'], en: ['Rustavi'], ru: ['Рустави'], tr: ['Rustavi'], ar: ['روستافي'], he: ['רוסטאבי'] },
  mtskheta: { name: 'Mtskheta', ka: ['მცხეთა', 'მცხეთაში', 'მცხეთის'], en: ['Mtskheta'], ru: ['Мцхета', 'Мцхете'], tr: ['Mtskheta'] },
  kobuleti: { name: 'Kobuleti', ka: ['ქობულეთი', 'ქობულეთში'], en: ['Kobuleti'], ru: ['Кобулети'], tr: ['Kobuleti'], ar: ['كوبوليتي'], he: ['קובולטי'] },
  gudauri: { name: 'Gudauri', ka: ['გუდაური', 'გუდაურში'], en: ['Gudauri'], ru: ['Гудаури'], tr: ['Gudauri'], ar: ['غوداوري'], he: ['גודאורי'] },
  bakuriani: { name: 'Bakuriani', ka: ['ბაკურიანი', 'ბაკურიანში'], en: ['Bakuriani'], ru: ['Бакуриани'], tr: ['Bakuriani'], ar: ['باكورياني'], he: ['בקוריאני'] },
  zugdidi: { name: 'Zugdidi', ka: ['ზუგდიდი', 'ზუგდიდში'], en: ['Zugdidi'], ru: ['Зугдиди'], tr: ['Zugdidi'] },
  telavi: { name: 'Telavi', ka: ['თელავი', 'თელავში'], en: ['Telavi'], ru: ['Телави'], tr: ['Telavi'] },
  borjomi: { name: 'Borjomi', ka: ['ბორჯომი', 'ბორჯომში'], en: ['Borjomi'], ru: ['Боржоми'], tr: ['Borjomi'] },
  poti: { name: 'Poti', ka: ['ფოთი', 'ფოთში'], en: ['Poti'], ru: ['Поти'], tr: ['Poti'] },
  gori: { name: 'Gori', ka: ['გორი', 'გორში'], en: ['Gori'], ru: ['Гори'], tr: ['Gori'] },
};

/** Areas beyond the Find Buyers list (and extra spellings for listed ones), by key. */
const EXTRA_AREAS: Record<string, Row> = {
  vake: { name: 'Vake', ka: ['ვაკე', 'ვაკეში', 'ვაკის', 'ვაკეზე'], en: ['Vake'], ru: ['Ваке'], tr: ['Vake'], ar: ['فاكي', 'فاكه'], he: ['ואקה', 'וואקה'] },
  saburtalo: { name: 'Saburtalo', ka: ['საბურთალო', 'საბურთალოზე', 'საბურთალოს', 'საბურთალოში'], en: ['Saburtalo'], ru: ['Сабуртало'], tr: ['Saburtalo'], ar: ['سابورتالو'], he: ['סבורטלו', 'סאבורטלו'] },
  didube: { name: 'Didube', ka: ['დიდუბე', 'დიდუბეში', 'დიდუბის'], en: ['Didube'], ru: ['Дидубе'], tr: ['Didube'], ar: ['ديدوبي'], he: ['דידובה'] },
  'didi digomi': { name: 'Didi Digomi', ka: ['დიდი დიღომი', 'დიდ დიღომში', 'დიდი დიღმის', 'დიდ დიღომში'], en: ['Didi Digomi', 'Didi Dighomi'], ru: ['Диди Дигоми', 'Большой Дигоми'], tr: ['Didi Digomi'] },
  'digomi massive': { name: 'Digomi Massive', ka: ['დიღმის მასივი', 'დიღმის მასივში'], en: ['Digomi Massive', 'Dighomi Massive'], ru: ['Дигомский массив', 'Дигомском массиве'] },
  'digomi village': { name: 'Digomi Village', ka: ['დიღმის სოფელი', 'სოფელი დიღომი'], en: ['Digomi Village'], ru: ['Дигоми село'] },
  gldanula: { name: 'Gldanula', ka: ['გლდანულა', 'გლდანულაზე'], en: ['Gldanula'], ru: ['Глданула'] },
  orkhevi: { name: 'Orkhevi', ka: ['ორხევი', 'ორხევში'], en: ['Orkhevi'], ru: ['Орхеви'] },
  kukia: { name: 'Kukia', ka: ['კუკია', 'კუკიაზე', 'კუკიაში'], en: ['Kukia'], ru: ['Кукия'] },
  okrokana: { name: 'Okrokana', ka: ['ოქროყანა', 'ოქროყანაში'], en: ['Okrokana'], ru: ['Окрокана'] },
  delisi: { name: 'Delisi', ka: ['დელისი', 'დელისზე', 'დელისში'], en: ['Delisi'], ru: ['Делиси'] },
  vedzisi: { name: 'Vedzisi', ka: ['ვეძისი', 'ვეძისზე'], en: ['Vedzisi'], ru: ['Ведзиси'] },
  'tbilisi sea': { name: 'Tbilisi Sea', ka: ['თბილისის ზღვა', 'თბილისის ზღვაზე', 'ზღვის უბანი'], en: ['Tbilisi Sea'], ru: ['Тбилисское море', 'Тбилисском море'] },
  dighmis_chala: { name: 'Dighmis Chala', ka: ['დიღმის ჭალა', 'დიღმის ჭალაში'], en: ['Dighmis Chala', 'Digmis Chala'], ru: ['Дигмис Чала'] },
  rustaveli: { name: 'Rustaveli', ka: ['რუსთაველი', 'რუსთაველზე', 'რუსთაველის'], en: ['Rustaveli'], ru: ['Руставели'], tr: ['Rustaveli'] },
  betania: { name: 'Betania', ka: ['ბეთანია', 'ბეთანიაში'], en: ['Betania'], ru: ['Бетания'] },
  kojori: { name: 'Kojori', ka: ['კოჯორი', 'კოჯორში'], en: ['Kojori'], ru: ['Коджори'] },
  'nutsubidze plateau': { name: 'Nutsubidze Plateau', ka: ['ნუცუბიძის პლატო', 'ნუცუბიძის პლატოზე'], en: ['Nutsubidze Plateau'], ru: ['плато Нуцубидзе'] },
  chugureti: { name: 'Chughureti', ka: ['ჩუღურეთი', 'ჩუღურეთში', 'ჩუღურეთის'], en: ['Chughureti', 'Chugureti'], ru: ['Чугурети'] },
  'old tbilisi': { name: 'Old Tbilisi', ka: ['ძველი თბილისი', 'ძველ თბილისში', 'ძველი თბილისის'], en: ['Old Tbilisi', 'Old Town'], ru: ['Старый Тбилиси', 'Старом Тбилиси', 'Старый город'], tr: ['Eski Tiflis'], ar: ['تبليسي القديمة'], he: ['טביליסי העתיקה'] },
  // Batumi
  'old batumi': { name: 'Old Batumi', city: 'batumi', ka: ['ძველი ბათუმი', 'ძველ ბათუმში', 'ძველი ბათუმის'], en: ['Old Batumi'], ru: ['Старый Батуми', 'Старом Батуми'], tr: ['Eski Batum'], ar: ['باتومي القديمة'], he: ['בטומי העתיקה'] },
  'new boulevard': { name: 'New Boulevard', city: 'batumi', ka: ['ახალი ბულვარი', 'ახალ ბულვართან', 'ახალ ბულვარზე'], en: ['New Boulevard'], ru: ['Новый бульвар', 'Новом бульваре'], tr: ['Yeni Bulvar'], ar: ['البوليفارد الجديد'], he: ['השדרה החדשה'] },
  gonio: { name: 'Gonio', city: 'batumi', ka: ['გონიო', 'გონიოში'], en: ['Gonio'], ru: ['Гонио'], tr: ['Gonio'], ar: ['غونيو'], he: ['גוניו'] },
  makhinjauri: { name: 'Makhinjauri', city: 'batumi', ka: ['მახინჯაური', 'მახინჯაურში'], en: ['Makhinjauri'], ru: ['Махинджаури'], tr: ['Mahincauri', 'Makhinjauri'] },
  angisa: { name: 'Angisa', city: 'batumi', ka: ['ანგისა', 'ანგისაში'], en: ['Angisa'], ru: ['Ангиса'] },
  'boni gorodok': { name: 'Boni-Gorodok', city: 'batumi', ka: ['ბონი-გოროდოკი', 'ბონი გოროდოკი', 'ბონი-გოროდოკში'], en: ['Boni-Gorodok', 'Boni Gorodok'], ru: ['Бони-Городок', 'Бони Городок'] },
  khimshiashvili: { name: 'Khimshiashvili', city: 'batumi', ka: ['ხიმშიაშვილი', 'ხიმშიაშვილზე'], en: ['Khimshiashvili'], ru: ['Химшиашвили'] },
  'batumi airport': { name: 'Airport', city: 'batumi', ka: ['აეროპორტის დასახლება', 'აეროპორტთან'], en: ['Airport district'], ru: ['район аэропорта'] },
  chakvi: { name: 'Chakvi', city: 'batumi', ka: ['ჩაქვი', 'ჩაქვში'], en: ['Chakvi'], ru: ['Чакви'], tr: ['Çakvi', 'Chakvi'] },
  // Kutaisi
  avtokarkhana: { name: 'Avtokarkhana', city: 'kutaisi', ka: ['ავტოქარხანა', 'ავტოქარხანაში', 'ავტოქარხნის'], en: ['Avtokarkhana', 'Avtoqarkhana'], ru: ['Автозавод'] },
  nikea: { name: 'Nikea', city: 'kutaisi', ka: ['ნიკეა', 'ნიკეაში'], en: ['Nikea'], ru: ['Никея'] },
  balakhvani: { name: 'Balakhvani', city: 'kutaisi', ka: ['ბალახვანი', 'ბალახვანში'], en: ['Balakhvani'], ru: ['Балахвани'] },
  sapichkhia: { name: 'Sapichkhia', city: 'kutaisi', ka: ['საფიჩხია', 'საფიჩხიაში'], en: ['Sapichkhia'], ru: ['Сапичхия'] },
  'mtsvane kvavili': { name: 'Mtsvane Kvavili', city: 'kutaisi', ka: ['მწვანე ყვავილი', 'მწვანე ყვავილზე'], en: ['Mtsvane Kvavili'], ru: ['Мцване Квавили'] },
  // Rustavi
  'new rustavi': { name: 'New Rustavi', city: 'rustavi', ka: ['ახალი რუსთავი', 'ახალ რუსთავში'], en: ['New Rustavi'], ru: ['Новый Рустави', 'Новом Рустави'] },
  'old rustavi': { name: 'Old Rustavi', city: 'rustavi', ka: ['ძველი რუსთავი', 'ძველ რუსთავში'], en: ['Old Rustavi'], ru: ['Старый Рустави', 'Старом Рустави'] },
};

const spellings = (row: Row): Partial<Record<string, string[]>> => ({ ka: row.ka, en: row.en, ru: row.ru, tr: row.tr, ar: row.ar, he: row.he });

const titleCase = (key: string) => key.replace(/(^|[\s-])(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase());

function build(): SearchPlace[] {
  const out = new Map<string, SearchPlace>();
  const add = (key: string, kind: 'CITY' | 'AREA', city: string | null, name: string, langs: Partial<Record<string, string[]>>, rename = false) => {
    const prev = out.get(key);
    const forms = new Set(prev?.forms ?? []);
    for (const list of Object.values(langs)) for (const f of list ?? []) if (f) forms.add(f);
    const labels = { ...(prev?.labels ?? {}) } as SearchPlace['labels'];
    for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const) {
      const first = langs[lang]?.[0];
      if (first && !labels[lang]) labels[lang] = first;
    }
    out.set(key, { key, name: rename ? name : prev?.name ?? name, kind, city, forms: [...forms], labels });
  };
  for (const [key, names] of Object.entries(CITY_NAMES)) add(key, 'CITY', null, titleCase(key), names as Record<string, string[]>);
  for (const [key, row] of Object.entries(EXTRA_CITIES)) add(key, 'CITY', null, row.name, spellings(row), true);
  for (const [key, names] of Object.entries(DISTRICT_NAMES)) add(key, 'AREA', cityOfArea(key), titleCase(key), names as Record<string, string[]>);
  for (const [key, row] of Object.entries(EXTRA_AREAS)) add(key, 'AREA', row.city ?? 'tbilisi', row.name, spellings(row), true);
  return [...out.values()];
}

/** Every place the query engine recognises. Built once. */
export const SEARCH_PLACES: readonly SearchPlace[] = build();

/** The canonical display name of a city key ('tbilisi' → 'Tbilisi'). */
export const cityName = (key: string) => SEARCH_PLACES.find((p) => p.kind === 'CITY' && p.key === key)?.name ?? titleCase(key);
