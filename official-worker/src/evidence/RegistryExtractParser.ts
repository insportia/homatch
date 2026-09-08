// RegistryExtractParser.ts — turns a NAPR entrepreneur-registry extract into
// structured, provenance-bearing company facts.
//
// WHY THIS EXISTS
// ---------------
// Production job 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 retrieved two real
// registry extracts (4,423 and 3,238 characters of rawText) containing
// EXACTLY what the customer report is missing: legal name, id code, legal
// form, registration date, registered address, directors and their
// representation rights, shareholders WITH EXACT PERCENTAGES, pledges,
// seizures, tax liens and debtor-registry status.
//
// None of it was parsed. The evidence was retrieved and then thrown away.
// This module closes that gap deterministically — no model involved, so a
// shareholding percentage can never be hallucinated.
//
// It also produced the evidence that settled a real question: idCode
// 405068386 was recorded under the name "შპს მილენიო გრუპი", but its own
// extract says "შპს არტიტექსი" — a DIFFERENT company (registered 2014, a
// different address, a different director). Parsing the extract is what makes
// that visible; name-based guessing is what hid it.

export type EvidenceState = 'CONFIRMED' | 'CORROBORATED' | 'INFERRED' | 'CONFLICTING' | 'UNAVAILABLE';

export interface Shareholder {
  name: string;
  /** Personal/company id exactly as printed. Never used for person research. */
  idNumber: string | null;
  /** Units held, when the extract states them. */
  units: number | null;
  /** Exact percentage as registered. */
  percentage: number | null;
}

export interface Director {
  name: string;
  idNumber: string | null;
  /** e.g. joint ("ერთობლივი") or sole ("ერთპიროვნული"). */
  representation: string | null;
}

export interface Encumbrance {
  kind: 'PLEDGE_LEASE' | 'TAX_LIEN' | 'SEIZURE' | 'OBLIGATION' | 'DEBTOR_REGISTRY';
  registered: boolean;
  reference: string | null;
  creditor: string | null;
  registeredAt: string | null;
}

export interface RegistryExtract {
  /** Extract document number, e.g. B24099518. */
  extractNumber: string | null;
  preparedAt: string | null;
  legalName: string | null;
  legalForm: string | null;
  idCode: string | null;
  registrationDate: string | null;
  registrar: string | null;
  address: string | null;
  liquidationRegistered: boolean | null;
  governanceBody: string | null;
  directors: Director[];
  shareholders: Shareholder[];
  totalUnits: number | null;
  encumbrances: Encumbrance[];
  /** Percentages summing to ~100 is a strong internal consistency signal. */
  shareholdingConsistent: boolean | null;
}

const NOT_REGISTERED = 'რეგისტრირებული არ არის';

/** Collapses the extract's hard-wrapped layout so a label and its value can be
 * matched even when the PDF put them on different lines. */
function flatten(raw: string): string {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Labels that terminate a field value. The extract is hard-wrapped, so a
 * value can legitimately span lines — but it must never swallow the NEXT
 * field, which is what produced "name + legal form + id code" as one string.
 */
const FIELD_LABELS = [
  'საფირმო სახელწოდება:',
  'სამართლებრივი ფორმა:',
  'საიდენტიფიკაციო ნომერი:',
  'რეგისტრაციის ნომერი',
  'მარეგისტრირებელი',
  'იურიდიული მისამართი:',
  'ინფორმაცია ლიკვიდაციის',
  'მმართველობის ორგანო',
  'ხელმძღვანელობა/წარმომადგენლობა',
  'კაპიტალი',
  'პარტნიორები',
];

function after(text: string, label: string, maxLen = 300): string | null {
  const i = text.indexOf(label);
  if (i === -1) return null;
  let rest = text.slice(i + label.length, i + label.length + maxLen);
  let cut = rest.length;
  for (const l of FIELD_LABELS) {
    const j = rest.indexOf(l);
    if (j !== -1 && j < cut) cut = j;
  }
  rest = rest.slice(0, cut);
  const value = rest.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim();
  return value || null;
}

/** A 9-digit company id or an 11-digit personal id, as printed. */
const ID_RE = /\b(\d{9}|\d{11})\b/;
const DATE_RE = /\b(\d{2}\/\d{2}\/\d{4})\b/;

/**
 * Parses the "პარტნიორები" (partners/shareholders) table.
 *
 * The layout is irregular — a row can be one line or spread over four — so
 * this walks the section and pairs each name+id with the numbers that follow
 * it, rather than assuming a fixed column layout. A percentage is only
 * accepted when it is actually printed; nothing is derived by division,
 * because a derived percentage is not a registered fact.
 */
export function parseShareholders(flat: string): { shareholders: Shareholder[]; totalUnits: number | null } {
  const start = flat.indexOf('პარტნიორები');
  if (start === -1) return { shareholders: [], totalUnits: null };
  const endMarkers = ['ვალდებულება', 'ყადაღა', 'საგადასახადო გირავნობა', 'მოძრავ ნივთებსა', 'მოვალეთა რეესტრი'];
  let end = flat.length;
  for (const m of endMarkers) {
    const i = flat.indexOf(m, start);
    if (i !== -1 && i < end) end = i;
  }
  const section = flat.slice(start, end);

  const totalUnits = (() => {
    const m = /რაოდენობა:\s*(\d+)/.exec(section);
    return m ? Number(m[1]) : null;
  })();

  /*
   * The PDF concatenates a shareholder's id, unit count and percentage into
   * one unbroken digit run, e.g.
   *
   *   "ლევან ჩაჩუა, 010120122875050%"   ->  id 01012012287, 50 units, 50%
   *   "01024003718\n250025%"            ->  id 01024003718, 2500 units, 25%
   *   "01008007608\n377037.7%"          ->  id 01008007608, 3770 units, 37.7%
   *
   * Splitting it by guessing digit counts would be fragile, so the split is
   * VALIDATED instead: the only accepted split is the one where
   * units / totalUnits * 100 equals the printed percentage. That makes the
   * percentage a read-and-checked fact rather than a derived one — and a run
   * that cannot be reconciled is reported with a null rather than a guess.
   */
  const shareholders: Shareholder[] = [];
  const entryRe = /([^\n,%]{2,60}?)\s*,?\s*((?:\d[\d.]*\s*){1,3})%/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(section))) {
    const name = m[1].replace(/[,\s]+$/, '').replace(/^[\s,]+/, '').trim();
    if (!name || /^\d/.test(name) || name.includes('რაოდენობა') || name.includes('ნომინალური')) continue;

    const blob = m[2].replace(/\s+/g, '');
    const decoded = decodeShareRun(blob, totalUnits);
    if (!decoded) continue;
    shareholders.push({ name, idNumber: decoded.idNumber, units: decoded.units, percentage: decoded.percentage });
  }
  return { shareholders, totalUnits };
}

/**
 * Decomposes a concatenated "id + units + percentage" run.
 *
 * Returns null rather than a guess when no split reconciles against
 * totalUnits — a shareholding percentage is far too consequential to invent.
 */
export function decodeShareRun(
  blob: string,
  totalUnits: number | null
): { idNumber: string | null; units: number | null; percentage: number | null } | null {
  if (!blob) return null;
  const dot = blob.indexOf('.');

  // Candidate id lengths, longest first: 11-digit personal, 9-digit company.
  for (const idLen of [11, 9, 0]) {
    const idNumber = idLen > 0 ? blob.slice(0, idLen) : null;
    if (idLen > 0 && (blob.length <= idLen || !/^\d+$/.test(idNumber as string))) continue;
    const rest = blob.slice(idLen);
    if (!rest) continue;

    // Try every split of `rest` into units | percentage.
    for (let k = 1; k < rest.length; k++) {
      const unitsPart = rest.slice(0, k);
      const pctPart = rest.slice(k);
      if (!/^\d+$/.test(unitsPart)) continue;
      if (!/^\d+(?:\.\d+)?$/.test(pctPart)) continue;
      const units = Number(unitsPart);
      const percentage = Number(pctPart);
      if (percentage <= 0 || percentage > 100) continue;
      if (totalUnits && totalUnits > 0) {
        const implied = (units / totalUnits) * 100;
        if (Math.abs(implied - percentage) < 0.05) return { idNumber, units, percentage };
      }
    }

    // No totalUnits to reconcile against: accept a lone trailing percentage
    // only when the remainder is entirely the percentage.
    if (!totalUnits && /^\d+(?:\.\d+)?$/.test(rest)) {
      const percentage = Number(rest);
      if (percentage > 0 && percentage <= 100) return { idNumber, units: null, percentage };
    }
    if (dot !== -1 && idLen > 0) {
      // A decimal percentage with an unreconcilable unit count: keep the
      // percentage, admit the units are unknown.
      const tail = /(\d+\.\d+)$/.exec(rest);
      if (tail) {
        const percentage = Number(tail[1]);
        if (percentage > 0 && percentage <= 100) return { idNumber, units: null, percentage };
      }
    }
  }
  return null;
}

/** Parses the directorate / representation block. */
export function parseDirectors(flat: string): Director[] {
  const start = flat.indexOf('ხელმძღვანელობა/წარმომადგენლობა');
  if (start === -1) return [];
  const end = flat.indexOf('კაპიტალი', start);
  const section = flat.slice(start, end === -1 ? start + 600 : end);

  const directors: Director[] = [];
  for (const line of section.split('\n')) {
    const idm = ID_RE.exec(line);
    if (!idm) continue;
    const [namePart, ...restParts] = line.split(idm[1]);
    const name = namePart.replace(/[,\s]+$/, '').trim();
    if (!name) continue;
    const rest = restParts.join('').replace(/^[,\s]+/, '').trim();
    directors.push({ name, idNumber: idm[1], representation: rest || null });
  }
  return directors;
}

/** Encumbrances. Absence is a POSITIVE finding here — "not registered" is a
 * real, useful answer, not missing data. */
export function parseEncumbrances(flat: string): Encumbrance[] {
  const out: Encumbrance[] = [];
  const sections: { kind: Encumbrance['kind']; label: string }[] = [
    { kind: 'OBLIGATION', label: 'ვალდებულება' },
    { kind: 'SEIZURE', label: 'ყადაღა/აკრძალვა' },
    { kind: 'TAX_LIEN', label: 'საგადასახადო გირავნობა/იპოთეკის უფლება' },
    { kind: 'PLEDGE_LEASE', label: 'მოძრავ ნივთებსა და არამატერიალურ ქონებრივ სიკეთეზე გირავნობა/ლიზინგის' },
    { kind: 'DEBTOR_REGISTRY', label: 'მოვალეთა რეესტრი' },
  ];

  for (const { kind, label } of sections) {
    const i = flat.indexOf(label);
    if (i === -1) continue;
    const body = flat.slice(i + label.length, i + label.length + 400);
    const registered = !body.trimStart().startsWith(NOT_REGISTERED) && !body.slice(0, 60).includes(NOT_REGISTERED);
    if (!registered) {
      out.push({ kind, registered: false, reference: null, creditor: null, registeredAt: null });
      continue;
    }
    const ref = /([A-Z]\d{6,})\s/.exec(body);
    const when = DATE_RE.exec(body);
    const creditorLine = /კრედიტორი\s*:\s*([^\n]+)/.exec(body);
    out.push({
      kind,
      registered: true,
      reference: ref ? ref[1] : null,
      creditor: creditorLine ? creditorLine[1].trim() : null,
      registeredAt: when ? when[1] : null,
    });
  }
  return out;
}

export function parseRegistryExtract(rawText: string | null | undefined): RegistryExtract | null {
  const flat = flatten(rawText || '');
  if (!flat || !flat.includes('საიდენტიფიკაციო ნომერი')) return null;

  const extractNumber = /\*?\s*([A-Z]\d{7,})\s*\*/.exec(flat)?.[1] ?? null;
  const preparedAt = /მომზადების თარიღი:\s*[A-Z]?\d*,?\s*(\d{2}\/\d{2}\/\d{4})/.exec(flat)?.[1] ?? null;
  const legalName = after(flat, 'საფირმო სახელწოდება:', 120)?.split('\n')[0]?.trim() ?? null;
  const legalForm = after(flat, 'სამართლებრივი ფორმა:', 120)?.split('\n')[0]?.trim() ?? null;
  const idCode = after(flat, 'საიდენტიფიკაციო ნომერი:', 40)?.match(/\d{9}/)?.[0] ?? null;

  /*
   * The SUBJECT's registration date, not the extract's preparation date.
   * "განაცხადის რეგისტრაციის ნომერი, მომზადების თარიღი: B24099518,
   * 15/08/2024" appears in the header and also contains the substring
   * "რეგისტრაციის ნომერი", so an unanchored search returns the day the PDF
   * was produced (2024) instead of the day the company was registered (2023).
   * Anchor after the id code, which is always in the subject block.
   */
  const idAnchor = flat.indexOf('საიდენტიფიკაციო ნომერი:');
  const regIdx = idAnchor === -1 ? -1 : flat.indexOf('რეგისტრაციის ნომერი', idAnchor);
  const regBlock = regIdx === -1 ? '' : flat.slice(regIdx, regIdx + 220);
  const registrationDate = DATE_RE.exec(regBlock)?.[1] ?? null;
  const registrar = after(flat, 'მარეგისტრირებელი', 160)?.replace(/^ორგანო:\s*/, '').split('\n')[0]?.trim() ?? null;
  const address = after(flat, 'იურიდიული მისამართი:', 220)?.trim() ?? null;

  const liqIdx = flat.indexOf('გადახდისუუნარობის პროცესის');
  const liquidationRegistered =
    liqIdx === -1 ? null : !flat.slice(liqIdx, liqIdx + 200).includes(NOT_REGISTERED);

  const governanceBody = after(flat, 'მმართველობის ორგანო', 60)?.split('\n')[0]?.trim() ?? null;
  const directors = parseDirectors(flat);
  const { shareholders, totalUnits } = parseShareholders(flat);
  const encumbrances = parseEncumbrances(flat);

  const pctSum = shareholders.reduce((s, x) => s + (x.percentage ?? 0), 0);
  const shareholdingConsistent = shareholders.length ? Math.abs(pctSum - 100) < 1.5 : null;

  return {
    extractNumber,
    preparedAt,
    legalName,
    legalForm,
    idCode,
    registrationDate,
    registrar,
    address,
    liquidationRegistered,
    governanceBody,
    directors,
    shareholders,
    totalUnits,
    encumbrances,
    shareholdingConsistent,
  };
}

/**
 * Cross-checks the identity the pipeline BELIEVED against what the registry
 * actually says.
 *
 * This is the check that would have caught idCode 405068386 being carried
 * under the name "შპს მილენიო გრუპი" while its own extract said
 * "შპს არტიტექსი". A mismatch is reported, never silently corrected and never
 * used to merge two ids.
 */
export function verifyClaimedIdentity(
  extract: RegistryExtract | null,
  claimed: { idCode: string | null; name: string | null }
): { agrees: boolean; state: EvidenceState; note: string } {
  if (!extract) return { agrees: false, state: 'UNAVAILABLE', note: 'no registry extract was parsed' };
  if (!extract.idCode) return { agrees: false, state: 'UNAVAILABLE', note: 'extract carries no id code' };

  if (claimed.idCode && claimed.idCode !== extract.idCode) {
    return { agrees: false, state: 'CONFLICTING', note: `extract is for ${extract.idCode}, not ${claimed.idCode}` };
  }
  if (claimed.name && extract.legalName) {
    const norm = (s: string) => s.toLowerCase().replace(/[«»""'„]/g, '').replace(/\s+/g, ' ').trim();
    if (!norm(extract.legalName).includes(norm(claimed.name)) && !norm(claimed.name).includes(norm(extract.legalName))) {
      return {
        agrees: false,
        state: 'CONFLICTING',
        note: `registry name "${extract.legalName}" does not match the name carried with this id ("${claimed.name}")`,
      };
    }
  }
  return { agrees: true, state: 'CONFIRMED', note: 'registry extract matches the claimed identity' };
}
