// HOMATCH Verify — translating the CONTENT of a report (owner P0, 2026-10-12).
//
// The report's chrome is i18n keys and was always translated. Its CONTENT is
// Georgian: model prose and deterministic copy stored in synthesis_json, and
// sentences the browser computes from the evidence (project story, legal
// findings, property facts, gallery labels …). A customer reading in English,
// Russian, Turkish, Arabic or Hebrew saw a page of Georgian with English
// headings.
//
// THE DESIGN: translation is keyed on the TEXT, never on the report.
//
//   * The same Georgian sentence is translated once per language and reused by
//     every report forever (public.verify_text_translations, service-role only).
//   * The browser translates what it actually RENDERS (domTranslation.ts), so
//     stored prose, browser-computed sentences and anything a future component
//     adds are covered without anyone remembering to wrap a string.
//   * verify-synthesis `translate` answers from the cache and sends only the
//     misses to the model, records the model's cost against the job
//     (cost_events, REPORT_TRANSLATION_VERIFY — never a silent zero) and is
//     rate-limited per job and language.
//
// This module is the part both sides share: limits, the eligibility test, the
// prompt, the output parser and the guard that refuses a translation which
// lost a number, a placeholder, a URL or a case/cadastral code. Pure — no DOM,
// no network, no Deno — so node:test covers it directly.

/** Georgian (Mkhedruli, Mtavruli, Asomtavruli/Nuskhuri). */
export const GEORGIAN_RE = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;
const GEORGIAN_G = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/g;

export const hasGeorgian = (s: unknown): boolean => typeof s === 'string' && GEORGIAN_RE.test(s);

/** The languages a report is translated INTO. Georgian is the source. */
export const TRANSLATION_LANGS = ['en', 'ru', 'tr', 'ar', 'he'] as const;
export type TranslationLang = (typeof TRANSLATION_LANGS)[number];
export const isTranslationLang = (l: unknown): l is TranslationLang =>
  typeof l === 'string' && (TRANSLATION_LANGS as readonly string[]).includes(l);

/** One request: at most this many texts … */
export const MAX_TEXTS_PER_CALL = 400;
/** … each at most this long (longer ones are not translated, never truncated) … */
export const MAX_TEXT_CHARS = 4000;
/** … and at most this many characters in total. */
export const MAX_CALL_CHARS = 60000;
/** What the browser puts in ONE request, so a request finishes well inside the edge limit. */
export const CLIENT_BATCH_TEXTS = 120;
export const CLIENT_BATCH_CHARS = 16000;
/** One model call: small enough to answer quickly and fail cheaply. */
export const MODEL_CHUNK_CHARS = 5000;
export const MODEL_CHUNK_TEXTS = 60;

/** An 11-digit run is a Georgian personal number: such a text is never sent to a model or stored. */
const PERSONAL_NUMBER = /(^|\D)\d{11}(?!\d)/;

/** The canonical form a text is cached under. */
export const normalizeSource = (s: string): string => s.normalize('NFC').trim();

/** Whether a text is something this layer translates at all. */
export function isTranslatable(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.length > 0 && t.length <= MAX_TEXT_CHARS && hasGeorgian(t) && !PERSONAL_NUMBER.test(t);
}

/** Leading and trailing whitespace stay where they were; only the core is translated. */
export function splitEdges(s: string): { lead: string; core: string; trail: string } {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: '', core: s, trail: '' };
}

/* ------------------------------------------------------------------ *
 * WHAT A TRANSLATION MUST KEEP.
 *
 * A legal/real-estate report lives on its numbers and identifiers. A
 * translation that dropped "2024", turned 01.18.06.019.055 into something
 * else or lost a {{placeholder}} is worse than the Georgian, so it is refused
 * (not cached, not shown) rather than trusted.
 * ------------------------------------------------------------------ */
const PLACEHOLDER_G = /\{\{\s*[\w.]+\s*\}\}/g;
const URL_G = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/** Cadastral codes (dotted digit groups), case numbers such as AR1234567, registration codes. */
const CODE_G = /\b(?:\d{2,}(?:\.\d+){2,}|[A-Z]{1,3}\d{4,}(?:[-/]\d+)*)\b/g;
/** Every run of two or more digits (years, amounts, areas, dates, codes). */
const DIGITS_G = /\d{2,}/g;

/** "1 670", "1,670", "1.670" and "1670" are the same amount. */
const joinThousands = (s: string): string => s.replace(/(\d)[,.'\s\u00A0\u202F](?=\d{3}(?!\d))/g, '$1');

const tokens = (s: string, re: RegExp): string[] => (s.match(re) ?? []).map((x) => x.replace(/\s+/g, ''));

const countOf = (xs: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

/** Tokens the source carries that the translation lost, or [] when it kept them all. */
export function lostTokens(source: string, translated: string): string[] {
  const lost: string[] = [];
  const out = translated.replace(/\s+/g, ' ');
  // Placeholders must survive exactly, as many times as they appear.
  const want = countOf(tokens(source, PLACEHOLDER_G));
  const got = countOf(tokens(out, PLACEHOLDER_G));
  for (const [k, n] of want) if ((got.get(k) ?? 0) < n) lost.push(k);
  for (const u of tokens(source, URL_G)) if (!out.includes(u.replace(/[.,;:]+$/, ''))) lost.push(u);
  for (const c of tokens(source, CODE_G)) if (!out.includes(c)) lost.push(c);
  // Digit runs: a thousands separator may change ("1 670" → "1,670"), the digits may not.
  const outDigits = new Set(tokens(joinThousands(out), DIGITS_G));
  for (const d of tokens(joinThousands(source), DIGITS_G)) if (!outDigits.has(d)) lost.push(d);
  return [...new Set(lost)];
}

/** The share of letters that are still Georgian — an untranslated answer reads close to 1. */
export function georgianShare(s: string): number {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (!letters) return 0;
  return (s.match(GEORGIAN_G) ?? []).length / letters;
}

/** Whether a model's answer for `source` may be cached and shown. */
export function acceptTranslation(source: string, translated: unknown): translated is string {
  if (typeof translated !== 'string') return false;
  const t = translated.trim();
  if (!t || t === source.trim()) return false;
  if (t.length > Math.max(200, source.length * 4)) return false;
  // Names are transliterated, so a correct answer is (almost) free of Georgian letters.
  if (georgianShare(t) > 0.25) return false;
  return lostTokens(source, t).length === 0;
}

/* ------------------------------------------------------------------ *
 * THE PROMPT.
 * ------------------------------------------------------------------ */
export const LANGUAGE_NAME: Record<TranslationLang, string> = {
  en: 'English',
  ru: 'Russian',
  tr: 'Turkish',
  ar: 'Arabic (Modern Standard Arabic)',
  he: 'Hebrew',
};

/** Product terminology the translation must follow (CLAUDE.md). */
const TERMINOLOGY: Record<TranslationLang, string> = {
  en: '"დამთხვევა" = "match"; "მოიჯარე" = "tenant"; "თბილისი" = "Tbilisi"; "შპს" = "LLC"; "სს" = "JSC"; "საკადასტრო კოდი" = "cadastral code"; "საჯარო რეესტრი" = "Public Registry"; "იპოთეკა" = "mortgage"; "ყადაღა" = "seizure (attachment)"; "მშენებლობის ნებართვა" = "construction permit"; "ექსპლუატაციაში მიღება" = "commissioning (acceptance into service)".',
  ru: '"დამთხვევა" = «совпадение»; "მოიჯარე" = «арендатор»; "თბილისი" = «Тбилиси»; "შპს" = «ООО»; "სს" = «АО»; "საკადასტრო კოდი" = «кадастровый код»; "საჯარო რეესტრი" = «Публичный реестр»; "იპოთეკა" = «ипотека»; "ყადაღა" = «арест (запрет)»; "მშენებლობის ნებართვა" = «разрешение на строительство».',
  tr: '"დამთხვევა" = "eşleşme"; "მოიჯარე" = "kiracı"; "თბილისი" = "Tiflis"; "შპს" = "LTD (Limited Şirket)"; "სს" = "A.Ş."; "საკადასტრო კოდი" = "kadastro kodu"; "საჯარო რეესტრი" = "Kamu Sicili"; "იპოთეკა" = "ipotek"; "ყადაღა" = "haciz"; "მშენებლობის ნებართვა" = "inşaat ruhsatı".',
  ar: '"დამთხვევა" = "تطابق"; "მოიჯარე" = "مستأجر"; "თბილისი" = "تبليسي"; "შპს" = "ش.ذ.م.م"; "სს" = "شركة مساهمة"; "საკადასტრო კოდი" = "الرمز المساحي"; "საჯარო რეესტრი" = "السجل العام"; "იპოთეკა" = "رهن عقاري"; "ყადაღა" = "حجز"; "მშენებლობის ნებართვა" = "رخصة بناء".',
  he: '"დამთხვევა" = "התאמה"; "მოიჯარე" = "שוכר"; "თბილისი" = "טביליסי"; "შპს" = "בע״מ"; "სს" = "חברה ציבורית"; "საკადასტრო კოდი" = "קוד קדסטרי"; "საჯარო რეესტრი" = "המרשם הציבורי"; "იპოთეკა" = "משכנתא"; "ყადაღა" = "עיקול"; "მშენებლობის ნებართვა" = "היתר בנייה".',
};

export function buildTranslationPrompt(lang: TranslationLang, texts: readonly string[]): { system: string; user: string } {
  const name = LANGUAGE_NAME[lang];
  const system = [
    `You translate fragments of a Georgian real-estate due-diligence report into ${name}.`,
    'The reader is a property buyer or tenant. Use a faithful, plain professional real-estate and legal register.',
    'Rules:',
    '- Translate every item completely and faithfully. Never summarise, explain, add, soften or omit anything.',
    '- Keep EXACTLY as written: every number, amount, percentage, area, floor, date component and year; dates written with digits (e.g. 12.03.2024); cadastral codes (e.g. 01.18.06.019.055); case and file numbers (e.g. AR1234567); registration and identification codes; URLs; e-mail addresses; and {{placeholders}}. Always write digits as Western digits 0-9.',
    `- Person names, company names, project names, street and place names: transliterate from Georgian into the ${name} script using standard romanisation conventions (never translate their meaning). Keep legal forms translated (e.g. შპს → LLC equivalent).`,
    `- Dates written in words (e.g. "2024 წლის 12 მარტი") become natural ${name} dates with the same day, month and year.`,
    '- Never describe anyone as a "confirmed buyer"; a person who may be interested is a "potentially interested person".',
    `- Terminology: ${TERMINOLOGY[lang]}`,
    '- Short labels stay short labels; a fragment that ends mid-sentence stays a fragment. Keep the original punctuation style and line breaks.',
    '- An item that is already not Georgian is returned unchanged.',
    'Input: a JSON object mapping ids to Georgian texts. Output: ONLY a JSON object with exactly the same ids, each mapped to its translation. No commentary.',
  ].join('\n');
  const obj: Record<string, string> = {};
  texts.forEach((t, i) => { obj[`t${i}`] = t; });
  return { system, user: JSON.stringify(obj) };
}

/** The model's JSON answer, mapped back to the texts it was given. Unusable items are absent. */
export function parseTranslationOutput(raw: string | null | undefined, texts: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  let obj: unknown = null;
  const body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { obj = JSON.parse(body); } catch {
    const a = body.indexOf('{'); const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(body.slice(a, b + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  texts.forEach((t, i) => {
    const v = (obj as Record<string, unknown>)[`t${i}`];
    if (acceptTranslation(t, v)) out[t] = (v as string).trim();
  });
  return out;
}

/** Splits texts into model-sized chunks, preserving order. */
export function chunkTexts(texts: readonly string[], maxChars = MODEL_CHUNK_CHARS, maxItems = MODEL_CHUNK_TEXTS): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const t of texts) {
    if (cur.length && (size + t.length > maxChars || cur.length >= maxItems)) {
      chunks.push(cur); cur = []; size = 0;
    }
    cur.push(t); size += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export type TranslateRequest = { jobId: string; lang: TranslationLang; texts: string[] };

/** Validates the `translate` action body. Returns the request, or the error to answer with. */
export function parseTranslateRequest(body: unknown):
  | { ok: true; request: TranslateRequest; skipped: number }
  | { ok: false; status: number; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const jobId = String(b.jobId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ok: false, status: 400, error: 'jobId is required' };
  if (!isTranslationLang(b.lang)) return { ok: false, status: 400, error: 'unsupported_lang' };
  if (!Array.isArray(b.texts)) return { ok: false, status: 400, error: 'texts is required' };
  if (b.texts.length > MAX_TEXTS_PER_CALL) return { ok: false, status: 413, error: 'too_many_texts' };
  const seen = new Set<string>();
  const texts: string[] = [];
  let chars = 0;
  let skipped = 0;
  for (const raw of b.texts) {
    if (!isTranslatable(raw)) { skipped++; continue; }
    const t = normalizeSource(raw);
    if (seen.has(t)) continue;
    seen.add(t);
    texts.push(t);
    chars += t.length;
  }
  if (chars > MAX_CALL_CHARS) return { ok: false, status: 413, error: 'too_many_characters' };
  return { ok: true, request: { jobId, lang: b.lang, texts }, skipped };
}

/** sha256 of the canonical text, hex — the cache key. */
export async function sourceHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSource(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Every Georgian string inside a payload subtree (depth-first, de-duplicated,
 * at most `max`) — what the page prefetches so its prose is translated on the
 * first paint. `shape` turns a stored string into what is rendered (the
 * report's clean() and paragraph split).
 */
export function collectGeorgianTexts(value: unknown, shape: (s: string) => string[] = (s) => [s], max = 1500): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number): void => {
    if (out.size >= max || depth > 12 || v == null) return;
    if (typeof v === 'string') {
      if (!hasGeorgian(v)) return;
      for (const p of shape(v)) if (isTranslatable(p) && out.size < max) out.add(normalizeSource(p));
      return;
    }
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
  };
  visit(value, 0);
  return [...out];
}
