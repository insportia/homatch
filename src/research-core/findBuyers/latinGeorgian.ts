// GEORGIAN WRITTEN IN LATIN LETTERS ("translit"), READ AS GEORGIAN.
//
// A large share of Georgian posts and comments are typed on a Latin keyboard:
// "viyidi bina vakeshi", "vqiraob otaxs", "mchirdeba bina saburtaloze". The demand rules
// (demandClassifier.ts) read Georgian in Georgian script, so without this a translit post
// reads as "not real estate" and a real buyer is lost. This module recognises translit and
// converts it to Georgian script deterministically, so the SAME rules decide (no model).
//
// TWO STEPS
//
//   1. Letters. The common chat conventions, digraphs first: kh/x→ხ, gh→ღ, sh→შ, ch→ჩ,
//      zh→ჟ, ts/c→ც, dz→ძ, q→ქ, y→ყ, w→წ, j→ჯ, and the apostrophe forms t'→ტ, k'→კ,
//      p'→პ, ch'→ჭ, ts'→წ, q'→ყ. Single letters map to their usual counterpart.
//   2. Ambiguity repairs. Translit writers use one Latin letter for two Georgian ones
//      (q for both ქ and ყ, ch for ჩ and ჭ, z for ზ and ძ). Only the repairs that are
//      unambiguous in real-estate vocabulary are made: the purchase stem ყიდ- ("vqidulob",
//      "iqideba"), the rent stem ქირ- ("kiravdeba"), მჭირდ- / საჭირო ("mchirdeba",
//      "sachiro"), ვეძებ ("vezeb"), საძინებ- ("sazinebeli").
//
// Digits are never letters here: "3" stays a three (a room count), not ე.
//
// Tokens that are plainly English or international (bedroom, usd, m2, a URL, a number) are
// left as written, so a mixed post keeps both readings.

/** Translit vocabulary: a hit says the Latin text is Georgian, not English or Turkish. */
const STRONG = /(?<![a-z])(?:v?[iy]?[qy]idul|v[iy][qy]id|vqid|vyid|i[qy]ideb|ga[sm]a[qy]id|[qk]ira(?:v|o|ob|it|ze|s|a)|v[qk]irao|gamo[qk]irav|ga[qk]irav|mchird|mch'ird|sachir|vedzeb|vezeb|minda|mainteresebs|bina(?:s|ze|shi|si|ebi)?|sa[kx]h?l(?:i|s|shi)|saxl|otax|otakh|sadzineb|sazineb|sacxovreb|satsxovreb|mesakutre|shuamavl|uZrav|udzrav|qoneb|koneb|kvadrat|ubanshi|ubani|tbilisshi|tbilisis|vakeshi|vakis|saburtaloze|saburtaloshi|gldanshi|isanshi|didubeshi|batumshi|varketilshi|digomshi|kerzo|axalasheneb|akhalasheneb|garemonteb|tvesh|tveshi|dgiurad|dghiurad|gaqidv|yidv|qidv)/i;
/** Turkish or English text that only shares a word or two with translit. */
const NOT_TRANSLIT = /(?<![a-z])(?:the|and|for|with|looking|want|need|apartment|flat|house|rent|buy|sale|kiralık|kiralik|satılık|satilik|daire|ev|için|arıyorum|ariyorum)(?![a-z])/gi;

const KEEP = new Set(['usd', 'gel', 'eur', 'm2', 'sqm', 'kvm', 'kv', 'bedroom', 'bedrooms', 'room', 'rooms', 'metro', 'wifi', 'ok', 'pm', 'dm', 'whatsapp', 'viber', 'telegram', 'facebook', 'myhome', 'ss', 'ge', 'tel', 'mob', 'id']);

/** Is this text Georgian typed in Latin letters? (No Georgian script, translit vocabulary, not English/Turkish.) */
export function isLatinGeorgian(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  /* Turkish letters never occur in translit Georgian. */
  if (/[Ⴀ-ჿ]/.test(s) || !/[a-z]/i.test(s) || /[çğışöüÇĞİŞÖÜ]/u.test(s)) return false;
  const strong = s.match(new RegExp(STRONG.source, 'gi')) ?? [];
  if (!strong.length) return false;
  const foreign = (s.match(NOT_TRANSLIT) ?? []).length;
  return strong.length >= Math.max(1, foreign);
}

const DIGRAPHS: Array<[RegExp, string]> = [
  [/ch'|tch|chh/g, 'ჭ'], [/ts'|tz'/g, 'წ'], [/q'/g, 'ყ'], [/t'/g, 'ტ'], [/k'/g, 'კ'], [/p'/g, 'პ'],
  [/kh/g, 'ხ'], [/gh/g, 'ღ'], [/sh/g, 'შ'], [/ch/g, 'ჩ'], [/zh/g, 'ჟ'], [/dz/g, 'ძ'], [/ts/g, 'ც'], [/th/g, 'თ'], [/ph/g, 'ფ'], [/dj/g, 'ჯ'],
];
const LETTERS: Record<string, string> = {
  a: 'ა', b: 'ბ', g: 'გ', d: 'დ', e: 'ე', v: 'ვ', z: 'ზ', t: 'თ', i: 'ი', k: 'კ', l: 'ლ', m: 'მ', n: 'ნ', o: 'ო', p: 'პ',
  j: 'ჯ', r: 'რ', s: 'ს', u: 'უ', f: 'ფ', q: 'ქ', y: 'ყ', x: 'ხ', c: 'ც', w: 'წ', h: 'ჰ',
};
/* Uppercase chat conventions where they are unambiguous. */
const UPPER: Record<string, string> = { S: 'შ', Z: 'ძ', J: 'ჟ', T: 'ტ', R: 'ღ', C: 'ჩ', W: 'ჭ' };

const REPAIRS: Array<[RegExp, string]> = [
  [/[ქკ]იდ(?=ულ|ვ|ი(?![\p{L}])|ებ|ეთ|ის|ე(?![\p{L}]))/gu, 'ყიდ'],
  [/(?<![\p{L}])კირ(?=ა|ი|ავ|აო|აობ|ით|აზე|ის)/gu, 'ქირ'],
  [/(?<=[\p{L}])კირ(?=ავ|აო|აობ)/gu, 'ქირ'],
  [/მჩირდ/gu, 'მჭირდ'], [/საჩირო/gu, 'საჭირო'], [/ვეზებ/gu, 'ვეძებ'], [/საზინებ/gu, 'საძინებ'],
  /* t and g/z stand for two letters each; these real-estate words have only one reading. */
  [/დგიურ/gu, 'დღიურ'], [/ბიუჯეთ/gu, 'ბიუჯეტ'], [/რემონთ/gu, 'რემონტ'], [/მაინთერეს/gu, 'მაინტერეს'], [/კერზო/gu, 'კერძო'], [/დიგომ/gu, 'დიღომ'], [/დიგმ/gu, 'დიღმ'],
  [/უზრავ/gu, 'უძრავ'], [/(?<![\p{L}])კონებ/gu, 'ქონებ'], [/ზგვ/gu, 'ზღვ'], [/ცხოვრებ/gu, 'ცხოვრებ'],
];

function word(w: string): string {
  if (KEEP.has(w.toLowerCase()) || /\d/.test(w) || /^https?:/i.test(w)) return w;
  /* A capital inside a word is a chat letter (veZeb); a leading capital is just a capital (Tbilisi). */
  let out = (w[0] + w.slice(1).replace(/[SZJTRCW]/g, (c) => (UPPER[c] ?? c))).toLowerCase();
  for (const [re, to] of DIGRAPHS) out = out.replace(re, to);
  out = out.replace(/[a-z]/g, (c) => LETTERS[c] ?? c).replace(/'/g, '');
  for (const [re, to] of REPAIRS) out = out.replace(re, to);
  return out;
}

/** Georgian script for a translit text; anything else is returned unchanged. */
export function latinGeorgianToScript(text: string): string {
  if (!isLatinGeorgian(text)) return text;
  return text.replace(/[A-Za-z][A-Za-z']*/g, word);
}
