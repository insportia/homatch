// HOMATCH — location intelligence.
//
// "Krtsanisi, Tbilisi" is a label, not intelligence. A buyer wants to know
// what the address MEANS: what is nearby, who competes for it, and who ends
// up living there.
//
// The honest constraint is that this pipeline has no geocoder and no
// points-of-interest feed. So this module does not pretend to measure
// distances. It does two things it CAN do truthfully:
//
//   1. resolves the address into city / district / street from evidence text;
//   2. attaches a curated, static characterisation of the district — the kind
//      of thing any Tbilisi agent knows — clearly labelled as general area
//      context rather than a finding about this property.
//
// Everything else (amenities, project scale, construction stage) already
// comes from real evidence and is passed through, not invented here.
//
// If the district is not recognised, this returns the address facts alone and
// no characterisation. An unknown area produces silence, never a guess.

export interface AreaProfile {
  /** Canonical district name, as written in Georgian. */
  district: string;
  /** One sentence a local adviser would actually say about the area. */
  character: string;
  /** Who realistically competes for homes here. Evidence-free general context. */
  likelyResidents: string[];
  /** Notable context: proximity, landmarks, character. Never distances. */
  context: string[];
}

export interface LocationIntelligence {
  city?: string;
  district?: string;
  street?: string;
  /** Present only for a district this module actually knows. */
  profile?: AreaProfile;
  /** True when nothing beyond a raw address string could be resolved. */
  minimal: boolean;
}

/*
 * Curated Tbilisi district context.
 *
 * This is GENERAL AREA KNOWLEDGE, not research output, and the prompt is told
 * to present it that way. It is kept small and factual — character, who lives
 * there, what is around — with no claim about prices, growth or investment
 * return, because those would be exactly the invented facts this product
 * refuses to make.
 */
const AREAS: Record<string, Omit<AreaProfile, 'district'>> = {
  'კრწანისი': {
    character: 'ისტორიული, მწვანე უბანი ძველ თბილისთან და მტკვრის სანაპიროსთან ახლოს, სადაც ბოლო წლებში რამდენიმე ბუტიკური საცხოვრებელი პროექტი განვითარდა.',
    likelyResidents: ['დიპლომატიური და საერთაშორისო ორგანიზაციების თანამშრომლები', 'ექსპატები', 'ცენტრთან სიახლოვის მოყვარული ოჯახები', 'გრძელვადიანი პრემიუმ მოიჯარეები'],
    context: ['ძველი თბილისისა და ცენტრის სიახლოვე', 'საელჩოებისა და სახელმწიფო უწყებების ზონა', 'მტკვრის სანაპირო და გამწვანებული ტერიტორიები', 'შედარებით დაბალი სიმჭიდროვის განაშენიანება'],
  },
  'ვაკე': {
    character: 'თბილისის ერთ-ერთი ყველაზე მოთხოვნადი და პრესტიჟული საცხოვრებელი უბანი, განვითარებული ინფრასტრუქტურითა და მაღალი მოთხოვნით.',
    likelyResidents: ['ადგილობრივი შეძლებული ოჯახები', 'ექსპატები', 'კორპორაციული მენეჯმენტი', 'გრძელვადიანი პრემიუმ მოიჯარეები'],
    context: ['ვაკის პარკი', 'უნივერსიტეტები და სკოლები', 'რესტორნები და სერვისები', 'ისტორიულად სტაბილური მოთხოვნა'],
  },
  'საბურთალო': {
    character: 'დიდი, აქტიურად განაშენიანებული უბანი ბიზნეს-ცენტრებით, კლინიკებითა და უნივერსიტეტებით; მიწოდება შედარებით მაღალია.',
    likelyResidents: ['ახალგაზრდა ოჯახები', 'სტუდენტები და აკადემიური სექტორი', 'სამედიცინო და ბიზნეს-სექტორის თანამშრომლები'],
    context: ['მეტროსადგურები', 'ბიზნეს და სამედიცინო კლასტერები', 'ახალი განაშენიანების მაღალი ტემპი'],
  },
  'მთაწმინდა': {
    character: 'ცენტრალური, ისტორიული უბანი ქალაქის ხედებით; ძველი ფონდი და ახალი ბუტიკური პროექტები ერთმანეთს ენაცვლება.',
    likelyResidents: ['ექსპატები', 'მოკლევადიანი გაქირავების ბაზარი', 'ცენტრის მოყვარული მყიდველები'],
    context: ['ქალაქის ცენტრი და ისტორიული ნაწილი', 'ხედები და რელიეფი', 'ტურისტული აქტივობა'],
  },
  'ისანი': {
    character: 'შერეული ხასიათის უბანი მდინარის მარცხენა სანაპიროზე, ცენტრთან კარგი კავშირით და შედარებით ხელმისაწვდომი ფასებით.',
    likelyResidents: ['ადგილობრივი ოჯახები', 'პირველი ბინის მყიდველები', 'გრძელვადიანი მოიჯარეები'],
    context: ['ავლაბრისა და ცენტრის სიახლოვე', 'სატრანსპორტო კვანძები'],
  },
  'ჩუღურეთი': {
    character: 'ცენტრთან ახლოს მდებარე ისტორიული უბანი, სადაც ძველი განაშენიანება თანდათან ახლდება.',
    likelyResidents: ['ახალგაზრდა მყიდველები', 'ექსპატები', 'ცენტრთან სიახლოვის მოყვარულები'],
    context: ['ცენტრის სიახლოვე', 'ისტორიული განაშენიანება', 'მიმდინარე განახლების პროცესი'],
  },
  'დიდუბე': {
    character: 'სატრანსპორტო კვანძებთან ახლოს მდებარე მჭიდრო უბანი, უპირატესად ხელმისაწვდომი სეგმენტით.',
    likelyResidents: ['ადგილობრივი ოჯახები', 'ხელმისაწვდომი სეგმენტის მყიდველები'],
    context: ['სატრანსპორტო კვანძები', 'მჭიდრო განაშენიანება'],
  },
  'ვერა': {
    character: 'ცენტრალური, მწვანე და ისტორიული უბანი, რომელიც ტრადიციულად მაღალ მოთხოვნას ინარჩუნებს.',
    likelyResidents: ['ექსპატები', 'შეძლებული ოჯახები', 'პრემიუმ მოიჯარეები'],
    context: ['ვერის პარკი', 'ცენტრის სიახლოვე', 'განვითარებული სერვისები'],
  },
};

const CITY_HINTS = ['თბილისი', 'ბათუმი', 'ქუთაისი', 'რუსთავი', 'გორი', 'ზუგდიდი', 'თელავი'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Pulls a street phrase out of a Georgian address without inventing one. */
export function streetOf(address: unknown): string | undefined {
  const a = str(address);
  if (!a) return undefined;
  const m = a.match(/([Ⴀ-ჿ'’\-\s]+?(?:ქუჩა|გამზირი|ჩიხი|მოედანი))\s*(?:N?\s*\d+)?/);
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  return undefined;
}

export function districtOfAddress(address: unknown): string | undefined {
  const a = str(address);
  return Object.keys(AREAS).find((d) => a.includes(d));
}

export function cityOfAddress(address: unknown): string | undefined {
  const a = str(address);
  return CITY_HINTS.find((c) => a.includes(c));
}

/**
 * Builds location intelligence from whatever the research produced.
 *
 * `texts` are any evidence strings that may carry the address — the subject
 * address, publicResearch facts, comparables' addresses. They are scanned in
 * order, so the most authoritative one wins.
 */
export function buildLocationIntelligence(texts: (string | undefined)[]): LocationIntelligence {
  const candidates = texts.map(str).filter(Boolean);
  const joined = candidates.join(' \n ');

  const city = cityOfAddress(joined);
  const district = districtOfAddress(joined);
  const street = candidates.map(streetOf).find(Boolean);

  const known = district ? AREAS[district] : undefined;

  return {
    city,
    district,
    street,
    profile: known && district ? { district, ...known } : undefined,
    minimal: !city && !district && !street,
  };
}
