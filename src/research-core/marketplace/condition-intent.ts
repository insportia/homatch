// HOMATCH FIND PROPERTY — building age and finishing condition, read from the customer's words.
//
// The brief's model call may return a wish as a requirement (production d3d859cc, 2026-10-22:
// "უკეთესია ახალაშენებულში" — "better in a new building" — came back as buildingStatuses
// [NEW_BUILD, OLD_BUILD], which excluded every building under construction). This reader is
// the deterministic check on that reading: each clause of the request is classified by its
// own wording as a REQUIREMENT, an ACCEPTED alternative, a PREFERENCE or an EXCLUSION.
//
// Two dimensions, never mixed: building AGE (new / old / under construction) and finishing
// CONDITION (renovated / green, white, black frame / needs renovation). "Green frame" is a
// condition, never an age; "newly renovated" (ახალგარემონტებული) is a condition, never a new
// building. A value said in two contradicting ways is AMBIGUOUS and is left for the customer
// to confirm; nothing is inferred from silence.

import type { BuildingStatus, RenovationStatus } from './taxonomy.ts';

export type IntentRole = 'REQUIRED' | 'ACCEPTED' | 'PREFERRED' | 'EXCLUDED';

export interface ConditionIntent<T extends string> {
  /** Required or accepted: the hard set a listing must fall in. */
  accepted: T[];
  /** Said as a requirement ("must", "only", "აუცილებლად") — a subset of accepted. */
  required: T[];
  preferred: T[];
  excluded: T[];
  /** Said in contradicting ways; the customer must confirm. */
  ambiguous: T[];
  /** The clauses each value was read from. */
  evidence: Array<{ value: T; role: IntentRole; clause: string }>;
}

export interface StatedConditions {
  building: ConditionIntent<BuildingStatus>;
  renovation: ConditionIntent<RenovationStatus>;
}

const BUILDING_TERMS: Array<[BuildingStatus, RegExp]> = [
  ['NEW_BUILD', /ახალი?\s?აშენებ|ახალ(?:ი|ს|ში)?\s+(?:კორპუს|შენობ)|\bnew[- ]?build|\bnew(?:ly)?[- ]built\b|\bnew (?:construction|building|development)\b|новостро|нов(?:ый|ом|ого)\s+дом|yeni\s+(?:bina|yapı|inşaat)|sıfır\s+(?:bina|daire)|(?:مبنى|بناء)\s+جديد|בניין\s+חדש|בנייה\s+חדשה|חדשה\s+מקבלן/iu],
  ['OLD_BUILD', /ძველი?\s?აშენებ|ძველ(?:ი|ს|ში)?\s+(?:კორპუს|შენობ|ფონდ)|\bold[- ](?:build|building|construction|stock)\b|стар(?:ый|ом|ого)\s+(?:фонд|дом)|вторичк|eski\s+(?:bina|yapı)|(?:مبنى|بناء)\s+قديم|בניין\s+ישן/iu],
  ['UNDER_CONSTRUCTION', /მშენებარე|მიმდინარე(?:ში|\s+(?:მშენებლობ|კორპუს|პროექტ))|\bunder[- ]construction\b|\boff[- ]plan\b|строящ|на\s+этапе\s+строительства|inşaat\s+halinde|yapım\s+aşamasında|(?:قيد|تحت)\s+الإنشاء|בבנייה|על\s+הנייר/iu],
];

const RENOVATION_TERMS: Array<[RenovationStatus, RegExp]> = [
  ['NEEDS_RENOVATION', /გასარემონტებ|გაურემონტებ|სარემონტო|\bneeds? (?:a )?renovation\b|\bunrenovated\b|требует\s+ремонта|без\s+ремонта|tadilat\s+gerek|bakım\s+gerek|يحتاج\s+(?:إلى\s+)?ترميم|דורש(?:ת)?\s+שיפוץ/iu],
  ['RENOVATED', /გარემონტებ|ახალი\s+რემონტ|\brenovated\b|\bwith (?:a )?renovation\b|отремонтир|с\s+ремонтом|евроремонт|tadilatlı|yenilenmiş|(?<!\p{L})مرممة?(?!\p{L})|(?<!\p{L})مجددة?(?!\p{L})|משופצ(?:ת)?/iu],
  ['GREEN_FRAME', /მწვანე\s+კარკას|\bgreen[- ]frame\b|зел[её]н\S*\s+каркас/iu],
  ['WHITE_FRAME', /თეთრ\S*\s+კარკას|\bwhite[- ]frame\b|бел\S*\s+каркас/iu],
  ['BLACK_FRAME', /შავ\S*\s+კარკას|\bblack[- ]frame\b|ч[её]рн\S*\s+каркас/iu],
];

/* Role markers, tested on the clause with the matched term removed. Exclusion wins, then a
   wish (a wish never becomes a requirement), then a requirement, then acceptance. */
const EXCLUDED = /(?:არ\s+(?:მინდა|მაწყობს|მაინტერესებს|განვიხილავ|მჭირდება)|არა\s|გარდა|(?<!\p{L})no(?!\p{L})|(?<!\p{L})not(?!\p{L})|\bwithout\b|\bexcept\b|\bavoid\b|(?<!\p{L})не(?!\p{L})|(?<!\p{L})кроме(?!\p{L})|istemiyorum|olmasın|hariç|لا\s+أريد|(?<!\p{L})بدون(?!\p{L})|לא\s+רוצה|(?<!\p{L})(?:בלי|ללא)(?!\p{L}))/iu;
const PREFERRED = /უკეთესი|სასურველი|ჯობია|სჯობს|იდეალურ|\bprefer|\bideally\b|\bbetter\b|\bif possible\b|лучше|желательн|предпочт|по\s+возможности|tercihen|mümkünse|يفضل|إن\s+أمكن|עדיף|רצוי/iu;
const REQUIRED = /აუცილებ|მხოლოდ|უნდა\s+(?:იყოს|ჰქონდეს|ქონდეს)|სავალდებულ|\bmust\b|\bonly\b|\brequired\b|\bmandatory\b|\bhas to\b|обязательн|только|должн|mutlaka|kesinlikle|sadece|(?<!\p{L})فقط(?!\p{L})|(?<!\p{L})يجب(?!\p{L})|ضروري|(?<!\p{L})חייב(?:ת)?(?!\p{L})|(?<!\p{L})רק(?!\p{L})/iu;
const ACCEPTED = /განვიხ|მისაღები|მაწყობს|\balso fine\b|\bfine\b|\bok(?:ay)?\b|\bacceptable\b|\bconsider\b|подойд|рассмотр|устроит|тоже/iu;

/* Clauses: sentence punctuation and the conjunctions that join separate statements. "ან" / "or"
   / "или" do NOT split: "new or under construction" is one statement of two accepted values. */
const SPLIT = /[,.;!?\n]+|\s+(?:და|მაგრამ|ხოლო|თუმცა|and|but|however|while|но|а|и|однако)\s+/iu;

function classify<T extends string>(text: string, terms: Array<[T, RegExp]>): ConditionIntent<T> {
  const roles = new Map<T, Set<IntentRole>>();
  const evidence: ConditionIntent<T>['evidence'] = [];
  const note = (value: T, role: IntentRole, clause: string) => {
    if (!roles.has(value)) roles.set(value, new Set());
    roles.get(value)!.add(role);
    evidence.push({ value, role, clause });
  };
  for (const raw of String(text ?? '').split(SPLIT)) {
    const clause = raw.trim();
    if (!clause) continue;
    for (const [value, re] of terms) {
      const m = clause.match(re);
      if (!m) continue;
      const rest = clause.replace(m[0], ' ');
      const role: IntentRole = EXCLUDED.test(rest) ? 'EXCLUDED' : PREFERRED.test(rest) ? 'PREFERRED'
        : REQUIRED.test(rest) ? 'REQUIRED' : 'ACCEPTED';
      note(value, role, clause);
    }
  }
  const out: ConditionIntent<T> = { accepted: [], required: [], preferred: [], excluded: [], ambiguous: [], evidence };
  for (const [value, set] of roles) {
    const hard = set.has('REQUIRED') || set.has('ACCEPTED');
    /* "X is a must" and "no X" for the same X, or "X is a must" and "ideally X": unresolved. */
    if (set.has('EXCLUDED') && (hard || set.has('PREFERRED'))) { out.ambiguous.push(value); continue; }
    if (set.has('EXCLUDED')) out.excluded.push(value);
    else if (hard) {
      out.accepted.push(value);
      if (set.has('REQUIRED')) out.required.push(value);
    } else out.preferred.push(value);
  }
  return out;
}

/** "ძველიც და ახალიც", "old or new", "старый или новый": both ages accepted in one phrase. */
const BOTH_AGES = /ძველიც\s+(?:და|ან)\s+ახალიც|ახალიც\s+(?:და|ან)\s+ძველიც|\b(?:old or new|new or old|old and new|new and old)\b|(?<!\p{L})(?:старый\s+или\s+новый|новый\s+или\s+старый)(?!\p{L})/iu;

export function statedConditions(text: string | null | undefined): StatedConditions {
  const source = String(text ?? '');
  const building = classify(source, BUILDING_TERMS);
  const both = source.match(BOTH_AGES);
  if (both) {
    /* Said together, the two ages are accepted; an exclusion or wish elsewhere still applies. */
    for (const value of ['NEW_BUILD', 'OLD_BUILD'] as const) {
      if (!building.accepted.includes(value) && !building.excluded.includes(value) && !building.ambiguous.includes(value)) {
        building.accepted.push(value);
        building.preferred = building.preferred.filter((v) => v !== value);
        building.evidence.push({ value, role: 'ACCEPTED', clause: both[0] });
      }
    }
  }
  return { building, renovation: classify(source, RENOVATION_TERMS) };
}
