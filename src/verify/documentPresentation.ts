// HOMATCH — turning document history into something a person can read.
//
// WHAT WAS ON SCREEN
//
// The Evidence drawer rendered the research layer's own field names, its
// document identifiers and raw PDF metadata straight to the customer:
//
//   NAPR registration 892024224686 | D:20240823122736+00'00' | buildingFunction
//   AR11148112 შედეგის ნახვა 1     | K2 | piles | structuralScheme | coAuthors
//
// WHAT THE DATA ACTUALLY LOOKS LIKE
//
// Reading the stored payload for a real job changed this fix substantially.
// The problem is not only that the KEYS are internal — many of the VALUES are
// not values at all. They are fragments the extractor tore out of the wrong
// side of a PDF form:
//
//   height           →  "(მ):"                                    a unit, no number
//   K2               →  "კოეფიციენტის საანგარიშო ფართობი (კვ.მ):" a form label
//   coAuthors        →  "(ებ)ის სახელი და გვარი.:"                a form label
//   idCode           →  ".დამკვეთის ინფორმაცია. *"                a form label
//   structuralScheme →  "/ საექსპერტო შეფასება"                   a fragment
//   elevator         →  "განსაზღვრეთ განაცხადის მდებარეობა რუკაზე" unrelated text
//
// against a small number that are genuinely clean:
//
//   buildingFunction →  "არასასოფლო"      buildingBlock →  "2, ბინა 34"
//
// So a whitelist of keys alone would still have shipped "Height: (მ):" and
// "Lift: define the application's location on the map". Two gates are needed:
// the key must be something a buyer can use, AND the value must survive a
// plausibility check. A key is on the whitelist only when the value gate can
// protect it — which is why `elevator` is absent: its failure mode is a
// well-formed sentence about something else, and no syntactic check catches
// that. A key with no evidence of a clean extraction does not belong here.
//
// This module is the presentation boundary. It decides what a document row
// SAYS, and leaves the research layer free to name its fields however it
// likes. It returns i18n KEYS, never prose, so it stays pure and testable.

/* ── which facts a buyer can use ─────────────────────────────────────── */

/** Fact keys worth showing, mapped to their i18n label. A key absent here is
 *  an extractor internal and renders nothing — never its own raw name. */
const FACT_LABEL_KEYS: Record<string, string> = {
  buildingfunction: 'verify_docfact_building_function',
  buildingblock: 'verify_docfact_block',
  height: 'verify_docfact_height',
  area: 'verify_docfact_area',
  ფართობი: 'verify_docfact_area',
};

export function factLabelKey(rawKey: unknown): string | null {
  if (typeof rawKey !== 'string') return null;
  return FACT_LABEL_KEYS[rawKey.trim().toLowerCase()] ?? null;
}

/**
 * Whether a string is a value rather than a piece of the form it came from.
 *
 * Every rule here is pinned to a real production sample; none is speculative.
 * It is deliberately conservative — dropping a good fact costs a line, while
 * showing "Height: (მ):" costs the report its credibility.
 */
export function isPresentableValue(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s) return false;

  // A trailing colon means we captured the LABEL, not what follows it.
  //   "(მ):"  "კოეფიციენტის საანგარიშო ფართობი (კვ.მ):"  "(ს/ნ:"
  if (/[:：]$/.test(s)) return false;

  // A leading connective or bracket means the capture began mid-phrase.
  //   "/ საექსპერტო შეფასება"   ".დამკვეთის ინფორმაცია"   "(ებ)ის სახელი"
  if (/^[/(),;.\-*„"']/.test(s)) return false;

  // An asterisk is the "required field" marker on these forms, never content.
  if (s.includes('*')) return false;

  // Two characters of actual content, so stray punctuation cannot qualify.
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}

export type PresentableFact = { labelKey: string; value: string };

export function presentableFacts(facts: unknown): PresentableFact[] {
  if (!Array.isArray(facts)) return [];
  const out: PresentableFact[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    if (!f || typeof f !== 'object') continue;
    const rec = f as Record<string, unknown>;
    const labelKey = factLabelKey(rec.key);
    if (!labelKey || !isPresentableValue(rec.value)) continue;
    const value = String(rec.value).trim();
    const dedupe = JSON.stringify([labelKey, value]);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ labelKey, value });
  }
  return out;
}

/* ── dates ───────────────────────────────────────────────────────────── */

// "D:20240823122736+00'00'" is the PDF spec's own date format and it reached
// the screen verbatim. Only the calendar part belongs in a history row; the
// minute a PDF was stamped is noise and the UTC offset doubly so.
const PDF_DATE = /^D:(\d{4})(\d{2})(\d{2})/;
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})/;
// Titles carry the real date where the metadata does not: "AR11026464 28/03/2024".
const DMY_ANYWHERE = /(\d{2})[./](\d{2})[./](\d{4})/;

const isCalendarDate = (y: string, m: string, d: string) => {
  const mi = Number(m);
  const di = Number(d);
  const yi = Number(y);
  return mi >= 1 && mi <= 12 && di >= 1 && di <= 31 && yi >= 1900 && yi <= 2200;
};

/**
 * A plain `YYYY-MM-DD` date, or null when the input holds none.
 *
 * Returning null rather than the original string is the point: a row with no
 * readable date shows no date, never a fragment of PDF metadata. ISO is used
 * because it reads the same in all six supported languages, right-to-left
 * ones included.
 */
export function readableDocumentDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  const pdf = PDF_DATE.exec(s);
  if (pdf && isCalendarDate(pdf[1], pdf[2], pdf[3])) return `${pdf[1]}-${pdf[2]}-${pdf[3]}`;

  const iso = ISO_LIKE.exec(s);
  if (iso && isCalendarDate(iso[1], iso[2], iso[3])) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = DMY_ANYWHERE.exec(s);
  if (dmy && isCalendarDate(dmy[3], dmy[2], dmy[1])) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  return null;
}

/* ── what kind of document this was ──────────────────────────────────── */

// A permit reference and a registry registration number are real, and they
// belong in the underlying document. A history row needs to say what KIND of
// document it was, in the reader's own language.
const PERMIT_REF = /\bAR\s?(\d{5,})\b/i;
const REGISTRY_REF = /\b(?:NAPR\s+registration|რეგისტრაცია)\s*(\d{6,})\b/i;

export type DocumentKind = 'PERMIT_DOCUMENT' | 'REGISTRY_RECORD' | 'DOCUMENT';

export const DOCUMENT_KIND_KEY: Record<DocumentKind, string> = {
  PERMIT_DOCUMENT: 'verify_doc_kind_permit',
  REGISTRY_RECORD: 'verify_doc_kind_registry',
  DOCUMENT: 'verify_doc_kind_other',
};

export function documentKind(title: unknown): DocumentKind {
  const s = typeof title === 'string' ? title : '';
  if (PERMIT_REF.test(s)) return 'PERMIT_DOCUMENT';
  if (REGISTRY_REF.test(s) || /\bNAPR\b/i.test(s)) return 'REGISTRY_RECORD';
  return 'DOCUMENT';
}

/**
 * A stable identity for a document, used to collapse the several rows the
 * research layer emits for one underlying file.
 *
 * Production has "AR11026464 28/03/2024" and "AR11026464 შედეგის ნახვა 1" as
 * two separate entries for one permit — one carrying the date, the other the
 * facts. Grouping on the reference puts them back together.
 */
export function documentRef(title: unknown): string | null {
  const s = typeof title === 'string' ? title : '';
  const permit = PERMIT_REF.exec(s);
  if (permit) return `AR${permit[1]}`;
  const registry = REGISTRY_REF.exec(s);
  if (registry) return `REG${registry[1]}`;
  return null;
}

/* ── the timeline a customer sees ────────────────────────────────────── */

export type DocumentRow = {
  kindKey: string;
  date: string | null;
  block: string | null;
  facts: PresentableFact[];
};

/**
 * Collapse the raw revision timeline into rows worth rendering.
 *
 * A row survives when it has a readable date or at least one presentable
 * fact — an entry that is only an internal identifier says nothing to a
 * buyer and is dropped rather than shown as evidence of thoroughness.
 */
export function buildDocumentRows(timeline: unknown): DocumentRow[] {
  if (!Array.isArray(timeline)) return [];

  const groups = new Map<string, DocumentRow>();
  let fallbackId = 0;

  for (const entry of timeline) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = e.documentTitle;
    // The metadata date first, then whatever the title itself carries.
    const date = readableDocumentDate(e.documentDate) ?? readableDocumentDate(title);
    const key = documentRef(title) ?? `#${fallbackId++}`;
    const block = isPresentableValue(e.block) ? String(e.block).trim() : null;

    const existing = groups.get(key);
    if (existing) {
      existing.date = existing.date ?? date;
      existing.block = existing.block ?? block;
      for (const f of presentableFacts(e.facts)) {
        if (!existing.facts.some((x) => x.labelKey === f.labelKey && x.value === f.value)) {
          existing.facts.push(f);
        }
      }
      continue;
    }

    groups.set(key, {
      kindKey: DOCUMENT_KIND_KEY[documentKind(title)],
      date,
      block,
      facts: presentableFacts(e.facts),
    });
  }

  return [...groups.values()]
    .filter((r) => r.date !== null || r.facts.length > 0)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/* ── document history, interpreted ───────────────────────────────────── */

/*
 * WHY NO DIFF IS RENDERED, AND WHY NONE IS INTERPRETED EITHER
 *
 * `addedInNewer` / `removedFromOlder` were rendered as green "+" and red "−"
 * lines. In production those lines are OCR'd text from registry extracts in a
 * legacy Georgian font encoding, read back as Latin-1 — the customer saw
 * "ÌÀÒÉÍÀ ÊÀÝÉÔÀÞÄ (ÃÀÁ.01/02/1969) ,P/N: 01018001305": a previous owner's
 * name, date of birth and personal number, as mojibake. They are stripped
 * from the customer payload server-side now, and nothing here renders them.
 *
 * It is tempting to go one step further and pattern-match those bytes for
 * "mortgage" or "lease" to produce a real interpretation. This module
 * deliberately does not. Guessing an encumbrance from corrupted text risks
 * asserting a mortgage that is not there, on a report someone uses to decide
 * whether to buy — and encumbrances already have a properly sourced surface
 * of their own in the legal-status matrix. What is safe to state is what can
 * be counted from the structure: how many extracts were compared, over what
 * period, and how many of them differ from the one before.
 */

export type HistorySummary = {
  documentsCompared: number;
  changedCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

export function summarizeDocumentHistory(hc: unknown): HistorySummary | null {
  if (!hc || typeof hc !== 'object') return null;
  const h = hc as Record<string, unknown>;
  if (h.available !== true) return null;

  const comparisons = Array.isArray(h.comparisons) ? h.comparisons : [];
  if (!comparisons.length) return null;

  const dates: string[] = [];
  let changedCount = 0;
  for (const c of comparisons) {
    if (!c || typeof c !== 'object') continue;
    const cmp = c as Record<string, unknown>;
    if (cmp.changed === true) changedCount += 1;
    for (const side of [cmp.olderDocument, cmp.newerDocument]) {
      if (!side || typeof side !== 'object') continue;
      const rec = side as Record<string, unknown>;
      const d = readableDocumentDate(rec.date) ?? readableDocumentDate(rec.title);
      if (d) dates.push(d);
    }
  }
  dates.sort();

  const considered = Number(h.documentsConsidered);
  return {
    documentsCompared: Number.isFinite(considered) && considered > 0 ? considered : comparisons.length + 1,
    changedCount,
    firstDate: dates[0] ?? null,
    lastDate: dates.length ? dates[dates.length - 1] : null,
  };
}
