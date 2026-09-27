// A CITY IS A PLACE, NOT A QUOTATION.
//
// Georgian customers read "Tbilisi" on every match card, in Latin letters, on a page that
// was otherwise entirely in Georgian. The value is genuine — `preview_city` carries what
// the signal's classifier recorded — but that does not make it source evidence. A quoted
// post is somebody's words and stays in their language; a city name is a thing the
// reader's language already has a word for, and leaving it untranslated is the mixed-UI
// failure rather than fidelity to a source.
//
// WHY A MAP AND NOT A LOOKUP
//
// Fourteen cities cover essentially all Georgian supply and demand, they do not change,
// and a network round-trip to render a card is not a trade worth making. Anything outside
// the map is returned UNCHANGED — a village nobody listed here still renders, in whatever
// the classifier wrote, rather than disappearing or being guessed at.
//
// The keys are lowercased Latin because that is what the pipeline produces. The Georgian
// spellings are the ones the import map uses for the reverse direction, so a city read
// from a Georgian portal and a city read from an English one converge on the same word.

const GEORGIAN: Readonly<Record<string, string>> = {
  tbilisi: 'თბილისი',
  batumi: 'ბათუმი',
  kutaisi: 'ქუთაისი',
  rustavi: 'რუსთავი',
  gori: 'გორი',
  zugdidi: 'ზუგდიდი',
  poti: 'ფოთი',
  telavi: 'თელავი',
  kobuleti: 'ქობულეთი',
  bakuriani: 'ბაკურიანი',
  gudauri: 'გუდაური',
  borjomi: 'ბორჯომი',
  mtskheta: 'მცხეთა',
  kvareli: 'ყვარელი',
  signagi: 'სიღნაღი',
  akhaltsikhe: 'ახალციხე',
};

/*
 * DISTRICTS, for the same reason and with the same rule.
 *
 * The property rows read "Krtsanisi, თბილისი" — the city translated and the district left
 * in Latin beside it, which is worse than leaving both: it looks like one of them failed.
 * Tbilisi districts are a closed, stable list and these are the spellings the import maps
 * already use in the other direction.
 */
const GEORGIAN_DISTRICTS: Readonly<Record<string, string>> = {
  vake: 'ვაკე',
  saburtalo: 'საბურთალო',
  krtsanisi: 'კრწანისი',
  mtatsminda: 'მთაწმინდა',
  isani: 'ისანი',
  samgori: 'სამგორი',
  gldani: 'გლდანი',
  nadzaladevi: 'ნაძალადევი',
  didube: 'დიდუბე',
  chugureti: 'ჩუღურეთი',
  avlabari: 'ავლაბარი',
  ortachala: 'ორთაჭალა',
  vera: 'ვერა',
  dighomi: 'დიღომი',
  'didi dighomi': 'დიდი დიღომი',
  varketili: 'ვარკეთილი',
  lilo: 'ლილო',
  ponichala: 'ფონიჭალა',
  avchala: 'ავჭალა',
  tsavkisi: 'წავკისი',
  kojori: 'კოჯორი',
  mukhiani: 'მუხიანი',
  lisi: 'ლისი',
  'old tbilisi': 'ძველი თბილისი',
};

const RUSSIAN: Readonly<Record<string, string>> = {
  tbilisi: 'Тбилиси',
  batumi: 'Батуми',
  kutaisi: 'Кутаиси',
  rustavi: 'Рустави',
  gori: 'Гори',
  zugdidi: 'Зугдиди',
  poti: 'Поти',
  telavi: 'Телави',
  kobuleti: 'Кобулети',
  bakuriani: 'Бакуриани',
  gudauri: 'Гудаури',
  borjomi: 'Боржоми',
  mtskheta: 'Мцхета',
  kvareli: 'Кварели',
  signagi: 'Сигнахи',
  akhaltsikhe: 'Ахалцихе',
};

/**
 * A place name in the reader's script, or exactly what was passed in.
 *
 * Returns the input untouched for a language with no map, for a name not in one, and for
 * anything blank. Never guesses and never drops a value: a card that silently stopped
 * showing a city would be worse than one showing it in the wrong alphabet.
 *
 * Only Georgian and Russian have maps. Turkish, Arabic and Hebrew readers of a Georgian
 * property market are reading Latin place names everywhere else too, and inventing
 * transliterations for them here would be this file guessing rather than translating.
 */
export function placeName(city: string | null | undefined, lang: string): string {
  const raw = String(city ?? '').trim();
  if (!raw) return raw;
  const table = lang === 'ka' ? GEORGIAN : lang === 'ru' ? RUSSIAN : null;
  if (!table) return raw;
  const key = raw.toLowerCase();
  /* Cities first, then districts: the same function serves both fields, and a name that
     is in neither comes back exactly as it was passed in. */
  return table[key] ?? (lang === 'ka' ? GEORGIAN_DISTRICTS[key] : undefined) ?? raw;
}
