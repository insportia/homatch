// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/entities.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH Communications — Georgian real-estate entities, normalised.
//
// §137. The same district arrives as "კრწანისი", "Krtsanisi", "Крцаниси",
// "krtsanisi" and, from an STT that heard it in a noisy call, "krtsanisi" with
// a letter wrong. They are one place. Until they are one string, matching
// under-counts, analytics splits a district in half, and an agent asked about
// "Vake" cannot find the property in "ვაკე".
//
// WHY THIS IS A TABLE AND NOT A MODEL
//
// §7 again: this is a lookup with a known answer set of a few dozen entries.
// An LLM asked to normalise a district name costs money per call, is slower
// than a Map, and will occasionally invent a district. The one thing a model
// would add — handling a name not in the table — is handled here by returning
// null and keeping the raw string, which is honest.
//
// This also does useful work on the STT side (§136): a Georgian transcript
// containing a recognisable district is normalised for EXTRACTION while the
// raw transcript is kept verbatim for display. The caller's own words are
// never rewritten.

export interface PlaceMatch {
  /** Canonical machine id. Stable; safe to store and group by. */
  id: string;
  /** Canonical display name in Georgian. */
  ka: string;
  en: string;
  ru: string;
  city: string;
  kind: 'DISTRICT' | 'CITY';
}

const PLACES: PlaceMatch[] = [
  { id: 'tbilisi',     ka: 'თბილისი',    en: 'Tbilisi',     ru: 'Тбилиси',    city: 'tbilisi', kind: 'CITY' },
  { id: 'batumi',      ka: 'ბათუმი',     en: 'Batumi',      ru: 'Батуми',     city: 'batumi',  kind: 'CITY' },
  { id: 'kutaisi',     ka: 'ქუთაისი',    en: 'Kutaisi',     ru: 'Кутаиси',    city: 'kutaisi', kind: 'CITY' },
  { id: 'rustavi',     ka: 'რუსთავი',    en: 'Rustavi',     ru: 'Рустави',    city: 'rustavi', kind: 'CITY' },
  { id: 'gudauri',     ka: 'გუდაური',    en: 'Gudauri',     ru: 'Гудаури',    city: 'gudauri', kind: 'CITY' },
  { id: 'bakuriani',   ka: 'ბაკურიანი',  en: 'Bakuriani',   ru: 'Бакуриани',  city: 'bakuriani', kind: 'CITY' },

  { id: 'vake',        ka: 'ვაკე',        en: 'Vake',        ru: 'Ваке',       city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'saburtalo',   ka: 'საბურთალო',  en: 'Saburtalo',   ru: 'Сабуртало',  city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'krtsanisi',   ka: 'კრწანისი',   en: 'Krtsanisi',   ru: 'Крцаниси',   city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'ortachala',   ka: 'ორთაჭალა',   en: 'Ortachala',   ru: 'Ортачала',   city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'mtatsminda',  ka: 'მთაწმინდა',  en: 'Mtatsminda',  ru: 'Мтацминда',  city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'didi-dighomi', ka: 'დიდი დიღომი', en: 'Didi Dighomi', ru: 'Диди Дигоми', city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'gldani',      ka: 'გლდანი',      en: 'Gldani',      ru: 'Глдани',     city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'isani',       ka: 'ისანი',       en: 'Isani',       ru: 'Исани',      city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'samgori',     ka: 'სამგორი',     en: 'Samgori',     ru: 'Самгори',    city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'chughureti',  ka: 'ჩუღურეთი',   en: 'Chughureti',  ru: 'Чугурети',   city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'nadzaladevi', ka: 'ნაძალადევი', en: 'Nadzaladevi', ru: 'Надзаладеви', city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'varketili',   ka: 'ვარკეთილი',  en: 'Varketili',   ru: 'Варкетили',  city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'lisi',        ka: 'ლისი',        en: 'Lisi',        ru: 'Лиси',       city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'digomi',      ka: 'დიღომი',      en: 'Dighomi',     ru: 'Дигоми',     city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'avlabari',    ka: 'ავლაბარი',   en: 'Avlabari',    ru: 'Авлабари',   city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'sololaki',    ka: 'სოლოლაკი',   en: 'Sololaki',    ru: 'Сололаки',   city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'vera',        ka: 'ვერა',        en: 'Vera',        ru: 'Вера',       city: 'tbilisi', kind: 'DISTRICT' },
  { id: 'nutsubidze',  ka: 'ნუცუბიძე',   en: 'Nutsubidze',  ru: 'Нуцубидзе',  city: 'tbilisi', kind: 'DISTRICT' },
];

/** Extra spellings that are not one of the three canonical names. */
const ALIASES: Record<string, string> = {
  tblisi: 'tbilisi', tbilissi: 'tbilisi', tiflis: 'tbilisi', тифлис: 'tbilisi',
  vaqe: 'vake', wake: 'vake', ваке: 'vake',
  saburtalo1: 'saburtalo', saburthalo: 'saburtalo',
  krcanisi: 'krtsanisi', krtsanisis: 'krtsanisi', krwanisi: 'krtsanisi', крцанис: 'krtsanisi',
  ortachala1: 'ortachala', orthachala: 'ortachala',
  mtacminda: 'mtatsminda', mtatsmida: 'mtatsminda',
  'didi digomi': 'didi-dighomi', dighomi: 'digomi', digomi1: 'digomi',
  chugureti: 'chughureti', chugureti1: 'chughureti',
  'nutsubidze plateau': 'nutsubidze', 'нуцубидзе плато': 'nutsubidze',
  'lisi lake': 'lisi', 'озеро лиси': 'lisi',
};

/** A currency word written after the number. */
function currencyFromTail(tail: string): string {
  const t = tail.toLowerCase();
  if (/ლარ|gel|₾/u.test(t)) return 'gel';
  if (/დოლარ|доллар|usd|\$/u.test(t)) return 'usd';
  if (/ევრ|евро|eur|€/u.test(t)) return 'eur';
  return '';
}

function fold(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every form a Georgian place name can take, longest first.
 *
 * Georgian has no upper case, so lowercasing does nothing here; what matters
 * is that speakers attach case endings. "ვაკეში" is "in Vake".
 *
 * The subtlety that made the first attempt at this wrong: the CANONICAL name
 * carries an ending of its own. "კრწანისი" is already inflected, so stripping
 * only the spoken form leaves "კრწანის" against a stored "კრწანისი" and the
 * two never meet. Generating the whole ladder for both, and indexing all of
 * it, makes them meet in the middle.
 */
function georgianForms(name: string): string[] {
  const base = fold(name);
  if (!base) return [];
  const forms = [base];
  // Longest endings first, so "ში" is taken before "ი".
  const endings = /(ებში|ებზე|ისკენ|ამდე|ში|ზე|დან|თან|მდე|ის|ით|მა|ს|ი)$/u;
  let current = base;
  for (let i = 0; i < 3; i++) {
    const stripped = current.replace(endings, '');
    if (stripped === current || stripped.length < 3) break;
    forms.push(stripped);
    current = stripped;
  }
  return forms;
}

const INDEX: Map<string, PlaceMatch> = (() => {
  const m = new Map<string, PlaceMatch>();
  const add = (name: string, place: PlaceMatch) => {
    for (const key of georgianForms(name)) {
      if (key && key.length >= 3 && !m.has(key)) m.set(key, place);
    }
  };
  for (const p of PLACES) {
    for (const name of [p.ka, p.en, p.ru, p.id.replace(/-/g, ' ')]) add(name, p);
  }
  for (const [alias, id] of Object.entries(ALIASES)) {
    const target = PLACES.find((p) => p.id === id);
    if (target) add(alias, target);
  }
  return m;
})();

/** Resolve one place name. Returns null rather than guessing. */
export function resolvePlace(raw: string): PlaceMatch | null {
  for (const form of georgianForms(raw)) {
    const hit = INDEX.get(form);
    if (hit) return hit;
  }
  return null;
}

/**
 * Find every place mentioned in free text — a transcript, a campaign
 * description, a WhatsApp message.
 *
 * Longest match first, so "Didi Dighomi" is one place rather than "Dighomi"
 * with a stray word in front of it.
 */
export function extractPlaces(text: string): PlaceMatch[] {
  const folded = fold(text);
  if (!folded) return [];
  const found = new Map<string, PlaceMatch>();

  // Longest key first, so "didi dighomi" is one place rather than "dighomi"
  // with a stray word in front of it.
  const keys = [...INDEX.keys()].sort((a, b) => b.length - a.length);
  let remaining = folded;
  for (const key of keys) {
    if (key.length < 4) continue;
    if (remaining.includes(key)) {
      const place = INDEX.get(key)!;
      if (!found.has(place.id)) found.set(place.id, place);
      remaining = remaining.split(key).join(' ');
    }
  }

  // Then each word on its own ladder, which is what catches an inflected
  // Georgian form whose stem is shorter than the stored name.
  for (const word of folded.split(/[\s,.;]+/)) {
    if (word.length < 4) continue;
    const place = resolvePlace(word);
    if (place && !found.has(place.id)) found.set(place.id, place);
  }

  return [...found.values()];
}

// ── Money ───────────────────────────────────────────────────────────────────

export interface MoneyAmount {
  value: number;
  currency: 'USD' | 'GEL' | 'EUR' | null;
  /** True when the speaker said "up to", so this is a ceiling not a target. */
  isMaximum: boolean;
  raw: string;
}

/**
 * Parse the prices people actually say.
 *
 * "180 ათასამდე" is 180,000 GEL-or-USD as a maximum. "$180k" is 180,000 USD.
 * "180 000" is 180,000 with no currency stated, and a currency is NOT invented
 * — an agent that assumes dollars when the caller meant lari has just
 * mis-qualified the lead by a factor of three.
 */
export function parseMoney(text: string): MoneyAmount[] {
  const out: MoneyAmount[] = [];
  const s = String(text ?? '');

  const MULTIPLIERS: Array<[RegExp, number]> = [
    [/ათას/u, 1_000],       // ka: thousand
    [/მილიონ/u, 1_000_000],  // ka: million
    [/тысяч|тыс\b/u, 1_000],
    [/миллион|млн\b/u, 1_000_000],
    [/\bk\b|\bthousand\b/iu, 1_000],
    [/\bm\b|\bmillion\b/iu, 1_000_000],
    [/\bbin\b/iu, 1_000],
  ];

  const re = /([$€₾]|usd|gel|eur|dollar|ლარ|დოლარ|евро|доллар)?\s*(\d[\d\s.,]*)\s*([a-zA-Zა-ჰА-Яа-я]*)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const rawNum = m[2].replace(/[\s,]/g, '');
    // A number written with a dot as a thousands separator ("180.000") is not
    // 180 with three decimal places.
    const normalised = /\.\d{3}$/.test(rawNum) ? rawNum.replace(/\./g, '') : rawNum;
    let value = Number(normalised);
    if (!Number.isFinite(value) || value <= 0) continue;

    const tail = `${m[3] ?? ''} ${s.slice(re.lastIndex, re.lastIndex + 16)}`;
    for (const [pattern, mult] of MULTIPLIERS) {
      if (pattern.test(tail)) { value *= mult; break; }
    }
    // Anything under 1000 with no multiplier is a bedroom count, a floor, or a
    // square meterage, not a property price.
    if (value < 1_000) continue;

    // A currency can precede the amount ("$180k") or follow it ("180 ათასი
    // ლარი"). Reading only the prefix lost every Georgian and Russian phrasing.
    const sym = ((m[1] ?? '') || currencyFromTail(tail)).toLowerCase();
    const currency: MoneyAmount['currency'] =
      sym === '$' || sym === 'usd' || sym.startsWith('dollar') || sym.startsWith('დოლარ') || sym.startsWith('доллар') ? 'USD'
      : sym === '₾' || sym === 'gel' || sym.startsWith('ლარ') ? 'GEL'
      : sym === '€' || sym === 'eur' || sym.startsWith('евро') ? 'EUR'
      : null;

    const isMaximum = /მდე|до\b|up to|under|max|maximum|kadar/iu.test(tail)
      || /მდე/u.test(m[3] ?? '');

    out.push({ value, currency, isMaximum, raw: m[0].trim() });
  }
  return out;
}

/** Bedroom counts, in the four ways they are said. */
export function parseBedrooms(text: string): number | null {
  const s = String(text ?? '').toLowerCase();
  const patterns: RegExp[] = [
    /(\d+)\s*(?:bed\s?rooms?|beds?|br\b)/u,
    /(\d+)\s*(?:საძინებელი|ოთახი)/u,
    /(\d+)[\s-]*(?:комнат|спальн)/u,
    /(\d+)\s*(?:yatak\s?odası|oda)/u,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 20) return n;
    }
  }
  return null;
}
