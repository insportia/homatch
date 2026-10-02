// HOMATCH DESIGN STUDIO — what a room IS, from the label printed in it.
//
// A plan names its rooms in its own language and its own shorthand
// ("MASTERBEDROOM", "LET", "K+D", "საძინებელი", "санузел", "yatak odası").
// The model already proposes a kind; a label it left as UNKNOWN, or one it
// classified differently from the dictionary, is settled here
// deterministically, with a confidence the review uses to decide whether to
// ask. Outdoor spaces (porch, terrace, verandah, balcony, loggia) are marked
// as outdoor so they are built as open-air spaces, not rooms.
//
// Pure and dependency-free (Deno + Node + browser).

import type { RoomKind } from './types.ts';

export interface RoomClass { kind: RoomKind; outdoor: boolean; confidence: number; matched: string | null }

interface Entry { kind: RoomKind; words: string[]; confidence: number; outdoor?: boolean }

// Order matters: the FIRST entry whose word appears wins, so compound and
// specific names come before generic ones ("master bedroom" before "room",
// "dining" after "kitchen" so "kitchen+dining" is a kitchen).
const DICTIONARY: Entry[] = [
  { kind: 'BALCONY', outdoor: true, confidence: 0.95, words: ['balcony', 'balconies', 'loggia', 'ბალკონ', 'ლოჯი', 'балкон', 'лоджия', 'balkon', 'شرفة', 'بلكون', 'מרפסת שמש', 'מרפסת', 'גזוזטרה'] },
  { kind: 'TERRACE', outdoor: true, confidence: 0.85, words: ['terrace', 'verandah', 'veranda', 'porch', 'patio', 'deck', 'sit out', 'sitout', 'otla', 'ტერას', 'ვერანდ', 'აივან', 'терраса', 'веранда', 'крыльцо', 'патио', 'teras', 'veranda', 'sundurma', 'تراس', 'شرفة خارجية', 'فناء', 'رواق', 'טרסה', 'פטיו', 'מרפסת גג'] },
  { kind: 'BEDROOM', confidence: 0.95, words: ['master bedroom', 'masterbedroom', 'master bed', 'bedroom', 'bed room', 'bedrm', 'guest room', 'kids room', 'children', 'nursery', 'm.bed', 'mbr', 'bed', 'საძინებელ', 'спальня', 'спальная', 'детская', 'yatak odası', 'yatak odasi', 'yatak', 'ebeveyn', 'çocuk odası', 'غرفة نوم', 'غرفة النوم', 'نوم', 'חדר שינה', 'חדר הורים', 'חדר ילדים'] },
  { kind: 'KITCHEN', confidence: 0.95, words: ['kitchen', 'kitchenette', 'kit.', 'pantry', 'სამზარეულო', 'кухня', 'кухня-столовая', 'mutfak', 'مطبخ', 'מטבח', 'מטבחון'] },
  { kind: 'WC', confidence: 0.9, words: ['wc', 'w.c', 'toilet', 'lavatory', 'latrine', 'let', 'powder', 'water closet', 'უნიტაზ', 'ტუალეტ', 'туалет', 'уборная', 'tuvalet', 'دورة مياه', 'مرحاض', 'שירותים'] },
  { kind: 'BATHROOM', confidence: 0.92, words: ['bathroom', 'bath', 'shower', 'ensuite', 'en-suite', 'washroom', 'toilet & bath', 'სააბაზანო', 'აბაზანა', 'სველი წერტილი', 'ванная', 'санузел', 'с/у', 'душ', 'banyo', 'duş', 'حمام', 'אמבטיה', 'מקלחת', 'חדר רחצה'] },
  // A "wash" or utility area holds a sink or a washing machine, not a bath:
  // it is a service room. Built as STORAGE (no bed, no sofa, no shower),
  // with a confidence low enough that the customer is asked.
  { kind: 'STORAGE', confidence: 0.7, words: ['wash', 'utility', 'laundry', 'washing', 'სამრეცხაო', 'прачечная', 'постирочная', 'çamaşır', 'غسيل', 'כביסה'] },
  { kind: 'STORAGE', confidence: 0.9, words: ['store', 'storage', 'storeroom', 'closet', 'wardrobe', 'walk-in', 'dressing', 'w.i.c', 'wic', 'boiler', 'შესანახ', 'საკუჭნაო', 'გარდერობ', 'кладовая', 'кладовка', 'гардероб', 'гардеробная', 'kiler', 'depo', 'giyinme', 'مخزن', 'خزانة', 'מחסן', 'ארון', 'חדר ארונות'] },
  { kind: 'LIVING', confidence: 0.92, words: ['living', 'lounge', 'family', 'sitting', 'drawing', 'great room', 'salon', 'saloon', 'მისაღებ', 'სასტუმრო ოთახ', 'гостиная', 'зал', 'salon', 'oturma', 'غرفة معيشة', 'معيشة', 'صالة', 'مجلس', 'סלון', 'חדר מגורים', 'חדר אורחים'] },
  { kind: 'LIVING', confidence: 0.8, words: ['dining', 'სასადილო', 'столовая', 'yemek', 'طعام', 'פינת אוכל'] },
  { kind: 'CORRIDOR', confidence: 0.9, words: ['corridor', 'passage', 'passageway', 'hallway', 'დერეფან', 'коридор', 'koridor', 'ممر', 'מסדרון'] },
  { kind: 'HALL', confidence: 0.85, words: ['entrance', 'entry', 'foyer', 'lobby', 'vestibule', 'hall', 'ჰოლ', 'შესასვლელ', 'холл', 'прихожая', 'тамбур', 'антре', 'giriş', 'hol', 'antre', 'مدخل', 'ردهة', 'כניסה', 'מבואה', 'לובי'] },
  { kind: 'LIVING', confidence: 0.6, words: ['office', 'study', 'den', 'კაბინეტ', 'кабинет', 'çalışma', 'مكتب', 'חדר עבודה'] },
];

const fold = (s: string) => s.toLocaleLowerCase('en').normalize('NFC').replace(/[_]+/g, ' ');

/** Does `word` occur in `text` as a word (Latin) or as a stem (other scripts)? */
function has(text: string, word: string): boolean {
  if (/^[a-z.&/\s-]+$/.test(word)) {
    // Latin: whole words only ("let" is not inside "toilet"), but glued
    // compounds are common on plans ("MASTERBEDROOM", "KITCHEN+DINING").
    const esc = word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    if (word.length >= 5) return new RegExp(esc).test(text);
    return new RegExp(`(^|[^a-z])${esc}($|[^a-z])`).test(text);
  }
  // Georgian, Cyrillic, Arabic, Hebrew, Turkish with diacritics: the stem
  // anywhere (these languages inflect; \b does not work on them).
  return text.includes(word);
}

/** Classify a printed room label. Null when the label says nothing the dictionary knows. */
export function classifyLabel(label: string | null | undefined): RoomClass | null {
  if (typeof label !== 'string' || !label.trim()) return null;
  const text = fold(label);
  for (const e of DICTIONARY) {
    for (const w of e.words) {
      if (has(text, fold(w))) return { kind: e.kind, outdoor: !!e.outdoor, confidence: e.confidence, matched: w };
    }
  }
  return null;
}

export const OUTDOOR_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['BALCONY', 'TERRACE']);

/**
 * The kind to build: the dictionary's when it knows the label, else the
 * model's. When both speak and disagree, the dictionary wins (the label is
 * evidence; the model's kind is an opinion of it) at reduced confidence.
 */
export function settleKind(label: string | null | undefined, modelKind: RoomKind, modelConfidence: number): RoomClass {
  const dict = classifyLabel(label);
  if (!dict) {
    return { kind: modelKind, outdoor: OUTDOOR_KINDS.has(modelKind), confidence: modelKind === 'UNKNOWN' ? 0.2 : Math.min(0.8, modelConfidence), matched: null };
  }
  if (modelKind === 'UNKNOWN' || modelKind === dict.kind) return dict;
  return { ...dict, confidence: Math.min(dict.confidence, 0.72) };
}
