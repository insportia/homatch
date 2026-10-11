/*
 * EDITORIAL RULES THAT CODE CAN KEEP (owner, 2026-10-11).
 *
 * The prompt asks the model to write like an experienced person beside the
 * buyer. Some of what it still gets wrong is mechanical and is fixed here,
 * deterministically, after the model has written:
 *
 *   - em/en dashes used as punctuation become a comma or a full stop;
 *   - a provenance opening ("ოფიციალური ინფორმაციის მიხედვით, …") is the
 *     source basis, established ONCE; every later sentence that opens with
 *     one loses the opening;
 *   - brand names are written the way the brands write themselves in
 *     Georgian (კარფური, never Karpuri);
 *   - case and decision numbers leave the prose for the evidence
 *     (stripCaseIdentifiers), and a conclusion said twice in nearly the same
 *     words is said once (nearDuplicate, used by report.ts).
 *
 * Nothing here adds a claim. The worst it can do is drop a repeated
 * opening or change a dash into a comma. Pure.
 */

/** Openings that restate the source basis. Order: longest first. */
export const PROVENANCE_OPENINGS: RegExp[] = [
  /^(?:პროექტის\s+)?ოფიციალურ(?:ი|ად)\s+(?:ინფორმაცი(?:ის|ა)|მონაცემ(?:ებ)?ის)\s+(?:მიხედვით|თანახმად)[,:]?\s*/u,
  /^(?:პროექტის\s+(?:შესახებ\s+)?)?საჯაროდ\s+ხელმისაწვდომი\s+(?:ინფორმაციის|მონაცემების|წყაროების)\s+(?:მიხედვით|თანახმად)[,:]?\s*/u,
  /^(?:განხილული|შესწავლილი|წარმოდგენილი)\s+(?:დოკუმენტების|მასალების|ჩანაწერების|წყაროების)\s+(?:მიხედვით|თანახმად)[,:]?\s*/u,
  /^(?:ხელმისაწვდომი|არსებული)\s+(?:ინფორმაციის|მონაცემების|დოკუმენტების)\s+(?:მიხედვით|თანახმად)[,:]?\s*/u,
  /^(?:ოფიციალური\s+)?(?:ჩანაწერების|დოკუმენტების|წყაროების)\s+(?:მიხედვით|თანახმად)[,:]?\s*/u,
  /^(?:according\s+to\s+(?:the\s+)?(?:official|publicly\s+available|available|reviewed)\s+(?:information|records|documents|sources))[,:]?\s*/iu,
  /^(?:по\s+(?:официальн\w+|общедоступн\w+|имеющ\w+)\s+(?:данн\w+|информаци\w+|документ\w+))[,:]?\s*/iu,
];

/** The opening a sentence starts with, if it is one of the provenance openings. */
export function provenanceOpening(sentence: string): string | null {
  const s = sentence.trimStart();
  for (const re of PROVENANCE_OPENINGS) {
    const m = re.exec(s);
    if (m) return m[0];
  }
  return null;
}

export function stripProvenanceOpening(sentence: string): string {
  const lead = sentence.length - sentence.trimStart().length;
  const open = provenanceOpening(sentence);
  if (!open) return sentence;
  const rest = sentence.trimStart().slice(open.length);
  return rest ? sentence.slice(0, lead) + rest : sentence;
}

/**
 * Dashes used as punctuation. A dash between two words with spaces is a
 * pause: it becomes a comma. A dash that opens a list after a colon-like
 * clause or ends a sentence becomes a full stop. Ranges ("2022–2025",
 * "$1,500–1,900") become a hyphen. Hyphens inside words are untouched.
 */
export function replaceDashes(text: string): string {
  if (!text || !/[—–]/.test(text)) return text;
  return text
    // numeric ranges: 2022–2025, 1 500 — 1 900 → hyphen without spaces
    .replace(/(\d)\s*[—–]\s*(?=[$€₾]?\d)/g, '$1-')
    // a dash closing a sentence or before a line break
    .replace(/\s*[—–]\s*(?=$|\n)/g, '.')
    // a dash at the very start of a line (list marker)
    .replace(/(^|\n)\s*[—–]\s*/g, '$1')
    // a pause between clauses
    .replace(/\s*[—–]\s*/g, ', ')
    // ", ," or ",." produced by adjacent punctuation
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/([.;:!?])\s*,\s*/g, '$1 ');
}

/*
 * Brand names, as the brands write themselves in Georgian. Small and
 * explicit: each entry is a transliteration the model has actually produced.
 */
export const BRAND_FIXES: Array<[RegExp, string]> = [
  [/\b[Kk]arpuri\b|\bKARPURI\b|კარპური|\bCarrefour\b/gu, 'კარფური'],
  [/ფარმა\s+დეპო|ფარმადეფო|\b[Pp]harma\s?[Dd]epo\b/gu, 'ფარმადეპო'],
  [/\b[Pp]sp\b|ფსპ/gu, 'PSP'],
  [/\b[Aa]versi\b/gu, 'ავერსი'],
  [/\b[Ss]paar\b|სპაარი?(?=[\s,.])/gu, 'სპარი'],
  [/\b[Nn]ikora\b/gu, 'ნიკორა'],
  [/\b[Ff]resco\b/gu, 'ფრესკო'],
  [/\b[Ee]ast\s?[Pp]oint\b/gu, 'ისთ ფოინთი'],
];

/** Applied only to lines written in Georgian: an English sentence keeps its brand spelling. */
export function fixBrands(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .map((line) => {
      if (!/[ა-ჰ]/u.test(line)) return line;
      let out = line;
      for (const [re, to] of BRAND_FIXES) out = out.replace(re, to);
      return out;
    })
    .join('\n');
}

/*
 * RAW IDENTIFIERS STAY IN THE EVIDENCE (owner, 2026-10-11). A TAS case number
 * ("AR11143236") or a decision number ("No7761945", "№ 7761945") in a sentence
 * is procedure, not information; the evidence list under each fact carries
 * it. Removed with the words that only introduce it; the sentence around it
 * stays grammatical. Cadastral codes are left alone: a buyer uses them.
 */
export function stripCaseIdentifiers(text: string): string {
  if (!text || !/AR\d{5,9}|(?:No|N|№)\s*\d{6,8}/u.test(text)) return text;
  return text
    // a parenthesised reference: "(AR11143236)", "(საქმე AR11143236, № 7930086)"
    .replace(/\s*\((?:[^()]{0,24}\s)?(?:AR\d{5,9}|(?:No|N|№)\s*\d{6,8})(?:[,;]?\s*(?:AR\d{5,9}|(?:No|N|№)\s*\d{6,8}|[^()]{0,16}))*\)/gu, '')
    // "განაცხადით/საქმით/ბრძანებით/გადაწყვეტილებით No… " → the noun stays
    .replace(/(\S+)\s+(?:No|N|№)\s*\d{6,8}(?=[\s,.;:]|$)/gu, (_m, w: string) => w)
    .replace(/(?:No|N|№)\s*\d{6,8}\s+/gu, '')
    .replace(/\s*AR\d{5,9}(?=[\s,.;:)]|$)/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/(^|\n)[ \t]+/g, '$1');
}

/** Two sentences that say the same thing in nearly the same words (a duplicate conclusion). */
export function nearDuplicate(a: string, b: string): boolean {
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
  const A = words(a), B = words(b);
  if (A.size < 6 || B.size < 6) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both) >= 0.8;
}

/** One field, mechanically: dashes and brands. Openings need the whole report (see report.ts). */
export function polishText(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  return fixBrands(replaceDashes(text)).replace(/[ \t]{2,}/g, ' ');
}
