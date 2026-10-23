/*
 * THE PROPERTY'S OWN REGISTER, READ DETERMINISTICALLY.
 *
 * Service 176 (my.gov.ge / NAPR) gives Verify, for one cadastral code: the
 * list of registration proceedings, and — for the records it could open —
 * the decision and the registry extract (ამონაწერი) issued at its end.
 *
 * An extract is the most authoritative document in the whole report: who
 * owns the unit, on what basis, and every mortgage, tax lien, seizure and
 * debtor-registry entry on it, AS OF the moment it was prepared. Until this
 * module the extracts reached the model as legacy-encoded text it could not
 * read (see georgianLegacyText.ts), so the report for job c80f7237:
 *   - named the developer as owner, while the extract names a private person
 *     who bought the flat in May 2026;
 *   - said a termination "does not specify which mortgage ended", while the
 *     extract before it lists two mortgages and the extract after it one.
 *
 * Everything here is arithmetic over the documents, never the model's
 * reading of them. The model is handed the result as fact; finalize and the
 * read path (reconcile*) remove prose that contradicts it.
 *
 * PRIVACY. The owner is named as the public extract names them (owner,
 * 2026-10-10: the buyer must know who is registered as owner — a NAPR
 * extract is a public document). A private person's 11-digit personal
 * number never leaves the parser. Bank and company identification codes are
 * public. Representatives are never read.
 */

import { decodeGeorgianLegacy } from './georgianLegacyText.ts';

export type RegisterState = 'NONE' | 'REGISTERED' | 'UNKNOWN';

export interface RegisterMortgage {
  /** Application (proceeding) number that registered it. */
  applicationNumber: string | null;
  /** ISO date the right was registered. */
  registeredOn: string | null;
  /** Creditor as printed, e.g. სააქციო საზოგადოება "საქართველოს ბანკი". */
  creditor: string | null;
  /** Creditor identification code (a company's, public). */
  creditorId: string | null;
  agreementNumber: string | null;
  /** ISO date of the mortgage agreement. */
  agreementDate: string | null;
}

export interface RegisterOwner {
  kind: 'PERSON' | 'COMPANY';
  /** As printed in the extract. A private person's personal number is never kept. */
  name?: string;
  companyId?: string;
}

export interface RegisterExtract {
  recordId: string;
  applicationNumber: string | null;
  /** ISO datetime the extract was prepared — the moment it describes. */
  issuedAt: string | null;
  owners: RegisterOwner[];
  ownershipRegisteredOn: string | null;
  /** PURCHASE when the basis is a sale-purchase agreement. */
  ownershipBasis: 'PURCHASE' | 'OTHER' | null;
  landFunction: string | null;
  landAreaSqm: number | null;
  /** Buildings on the plot marked (მშენებარე) — under construction. */
  buildingsUnderConstruction: boolean;
  /** The unit itself marked ფართი(მშენებარე). */
  unitUnderConstruction: boolean;
  unitAreaSqm: number | null;
  /*
   * THE UNIT'S OWN ROW IN THE OWNERS TABLE (v7, job eeefada9), read in both
   * layouts: collapsed on one line ("…საკუთრებაფართი(მშენებარე)სართული2,ბინა
   * N4,79.50 კვ.მ.") and wrapped ("…ბინა\nN601,ბლოკი "ც"\n94.10\nკვ.მ.").
   * All optional so persisted registers from older logic still type-check.
   */
  /** The registered description of the unit as printed, e.g. "ფართი (მშენებარე)". */
  unitDescription?: string | null;
  /** The whole registered item text of the row, e.g. "ფართი (მშენებარე) სართული 2, ბინა N4". */
  unitItemText?: string | null;
  unitFloor?: string | null;
  /** Apartment / parking / office number as the row prints it. */
  unitNumber?: string | null;
  unitBlock?: string | null;
  /** True when the owners table has a row for a unit (an apartment, parking space…); false for a parcel-only extract. */
  unitRowFound?: boolean;
  /** The parcel's address line (not the unit's registered address). */
  parcelAddress?: string | null;
  /** Total area of the buildings on the parcel, as printed (never the unit's area). */
  buildingsTotalAreaSqm?: number | null;
  /** The buildings line as printed, e.g. "შენობა N01 (მშენებარე)". */
  buildingsText?: string | null;
  /** The extract PDF itself on the official NAPR blob service (set by buildPropertyRegister). */
  documentUrl?: string | null;
  /** The record's public NAPR page (set by buildPropertyRegister). */
  recordUrl?: string | null;
  mortgages: RegisterMortgage[];
  taxLien: RegisterState;
  seizure: RegisterState;
  debtorRegistry: RegisterState;
}

export type ProceedingKind =
  | 'OWNERSHIP_TRANSFER'
  | 'PARTNERSHIP_OWNERSHIP'
  | 'MORTGAGE_CREATED'
  | 'MORTGAGE_TERMINATED'
  | 'OTHER';

export interface RegisterProceeding {
  applicationNumber: string;
  kind: ProceedingKind;
  /** The registry's own wording of the service, Georgian. */
  typeText: string | null;
  filedOn: string | null;
  completedOn: string | null;
  /** True when its documents were opened and read. */
  read: boolean;
  /** The FINAL decision's outcome (the latest one read), when a decision was read. */
  outcome: DecisionOutcome | null;
  /** The final decision's number and date — never an earlier, intermediate one. */
  decisionNumber: string | null;
  decisionDate: string | null;
  /**
   * Every decision read for this proceeding, oldest first. A proceeding can
   * be SUSPENDED (e.g. fee unpaid) and later SATISFIED; the two are distinct
   * legal steps and are never collapsed (job 8ba97da9: termination
   * 882026724195 was suspended on 18.08.2026 and registered on 24.08.2026).
   */
  decisions?: Array<{ number: string | null; date: string | null; outcome: DecisionOutcome | null }>;
}

export type DecisionOutcome = 'SATISFIED' | 'REFUSED' | 'SUSPENDED' | 'DISCONTINUED';

export interface RemovedMortgage extends RegisterMortgage {
  /** ISO datetime of the last extract that still listed it. */
  lastSeenAt: string | null;
  /** The termination proceeding that removed it, when one was read. */
  removedBy: { applicationNumber: string; decisionNumber: string | null; decisionDate: string | null } | null;
}

/** One extract HOMATCH read: who it named, what it listed, and when it was prepared. */
export interface ExtractSummary {
  issuedAt: string | null;
  applicationNumber: string | null;
  owners: RegisterOwner[];
  ownershipRegisteredOn: string | null;
  ownershipBasis: RegisterExtract['ownershipBasis'];
  mortgageAgreements: Array<string | null>;
}

export interface PropertyRegister {
  cadastralCode: string | null;
  /** Every extract read, oldest first — ownership history, never only the latest. */
  history?: ExtractSummary[];
  /** When the registry's proceedings list was observed (the search run), ISO. */
  observedAt?: string | null;
  /** The newest extract HOMATCH holds — what the register said, and when. */
  latest: RegisterExtract | null;
  /** Mortgages listed in the latest extract. */
  currentMortgages: RegisterMortgage[];
  /** Mortgages in an earlier extract and absent from the latest one. */
  removedMortgages: RemovedMortgage[];
  proceedings: RegisterProceeding[];
  coverage: { found: number; read: number; documents: number; notOpened: number };
}

/* ───────────────────────── text helpers ───────────────────────── */

const DMY = /(\d{2})[./](\d{2})[./](\d{4})/;
const isoDay = (s: string | null | undefined): string | null => {
  const m = typeof s === 'string' ? s.match(DMY) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const isoMoment = (d: string, t: string | undefined): string => (t ? `${isoDay(d)}T${t}` : isoDay(d)!);
const unixDay = (v: unknown): string | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1e8 ? new Date(n * 1000).toISOString().slice(0, 10) : null;
};
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The page footer repeats mid-section ("…ეროვნულისააგენტო.http://…გვერდი:1(2)"); it is not content. */
const FOOTER = /^.*(?:public\.reestri\.gov\.ge|გვერდი:\s*\d+\(\d+\)).*$/gm;

/** The text between a label and the next of the given labels (or the end). */
function section(text: string, label: RegExp, next: RegExp[]): string | null {
  const m = label.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  let end = rest.length;
  for (const n of next) {
    const k = rest.search(n);
    if (k >= 0 && k < end) end = k;
  }
  return rest.slice(0, end);
}

const NOT_REGISTERED = /რეგისტრირებული\s+არ\s+არის/;
function stateOf(text: string, label: RegExp, next: RegExp[]): RegisterState {
  const body = section(text, label, next);
  if (body == null) return 'UNKNOWN';
  if (NOT_REGISTERED.test(body.slice(0, 80))) return 'NONE';
  return squash(body) ? 'REGISTERED' : 'UNKNOWN';
}

const COMPANY_FORM = /(შპს|სს\b|სააქციო\s+საზოგადოება|შეზღუდული\s+პასუხისმგებლობის|ააიპ|კოოპერატივ|ამხანაგობა|ს\/ნ|ს\/კ|ID\/N)/;
const PERSON_ID = /,?\s*(?:P\/N|პ\/ნ)\s*:?\s*\d{11}/;

/* ───────────────────────── extract parsing ───────────────────────── */

const L_OWNERS = /\nმესაკუთრეები\s*\n/;
const L_MORTGAGE = /\nიპოთეკა\s*\n/;
const L_TAX = /საგადასახადო\s+გირავნობა\s*:/;
const L_SEIZURE = /ყადაღა\/აკრძალვა\s*:/;
const L_DEBTOR = /მოვალეთა\s+რეესტრი\s*:/;
const L_END = /\n\s*ფიზიკური\s+პირის/;

function parseMortgages(body: string): RegisterMortgage[] {
  const clean = body.replace(FOOTER, '');
  return clean
    .split(/(?:^|\n)\s*\d+\)\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => /იპოთეკარი/.test(chunk))
    .map((chunk) => {
      const flat = squash(chunk);
      const app = flat.match(/ნომერი\s+(\d{9,14})/);
      const rights = flat.match(/უფლების\s+რეგისტრაცია\s*:\s*თარიღი\s+(\d{2}\/\d{2}\/\d{4})/);
      const creditorRaw = flat.match(/იპოთეკარი\s*:\s*([^;]+);/)?.[1] ?? null;
      const creditorId = creditorRaw?.match(/(\d{9})\s*$/)?.[1] ?? null;
      const creditor = creditorRaw ? squash(creditorRaw.replace(/\d{9}\s*$/, '')) : null;
      const agreement = flat.match(/იპოთეკის\s+ხელშეკრულება\s+([A-Za-z0-9\-/]+)/);
      const agreementDate = flat.match(/იპოთეკის\s+ხელშეკრულება[^,]*,\s*დამოწმების\s+თარიღი\s*:?\s*(\d{2}\/\d{2}\/\d{4})/);
      return {
        applicationNumber: app?.[1] ?? null,
        registeredOn: isoDay(rights?.[1]),
        creditor: creditor || null,
        creditorId,
        agreementNumber: agreement?.[1] ?? null,
        agreementDate: isoDay(agreementDate?.[1]),
      };
    });
}

function parseOwners(text: string): RegisterOwner[] {
  // The list follows "მესაკუთრეები:" (with the colon) and ends at "მესაკუთრე:".
  const body = section(text, /მესაკუთრეები\s*:\s*\n/, [/\nმესაკუთრე\s*:/, L_MORTGAGE, L_TAX]);
  if (!body) return [];
  return body
    .split('\n')
    .map(squash)
    .filter(Boolean)
    .map((line): RegisterOwner => {
      if (COMPANY_FORM.test(line) && !PERSON_ID.test(line)) {
        const id = line.match(/(\d{9})\s*$/)?.[1];
        const name = squash(line.replace(/,?\s*(?:ს\/ნ|ს\/კ|ID\/N|ID\s*ნომერი)\s*:?\s*\d{9}\s*$/, '').replace(/\d{9}\s*$/, '')).replace(/\s*,$/, '');
        return { kind: 'COMPANY', name: name || undefined, ...(id ? { companyId: id } : {}) };
      }
      // "სახელი გვარი ,P/N: 01001012345" → the name only.
      const name = squash(line.replace(/,?\s*(?:P\/N|პ\/ნ)\s*:?\s*(?:\d{11}|—).*$/, '').replace(/\d{11}.*$/, '')).replace(/,$/, '');
      return name && /\p{L}/u.test(name) ? { kind: 'PERSON', name } : { kind: 'PERSON' };
    })
    .slice(0, 12);
}

/*
 * THE OWNERS TABLE ROW, LAYOUT-INDEPENDENT.
 *
 * The table header is "საკუთრება:ფართი:წილი:"; each row is the owner's name,
 * the ownership type (საკუთრება / თანასაკუთრება), the registered item
 * (description, floor, number, block) and its area in კვ.მ. pdf-to-text may
 * keep the row on one line or wrap it anywhere, so the row is flattened
 * before reading. Only this row is read for the unit's area: the parcel area
 * (დაზუსტებული ფართობი) and the buildings' total (საერთო ფართი) sit in
 * other sections and can never be taken for it.
 */
export interface UnitRow {
  description: string | null;
  itemText: string | null;
  areaSqm: number | null;
  floor: string | null;
  number: string | null;
  block: string | null;
}

const UNIT_ROW_HEADER = /საკუთრება\s*:\s*ფართი\s*:\s*წილი\s*:/;
const AREA_IN_ROW = /(\d{1,6}(?:[.,]\d{1,2})?)\s*კვ\s*\.?\s*მ/u;

/** Spaces around brackets and after commas, as a person writes it. */
const tidy = (s: string) =>
  squash(s.replace(/(სართული|ბინა|ბლოკი)(?=[\d"'„N№])/gu, '$1 ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ') ').replace(/\s*,\s*/g, ', '))
    .replace(/\s+\)/g, ')').replace(/[\s,;]+$/, '');

export function parseUnitRow(ownersBlock: string): UnitRow | null {
  const body = section(ownersBlock, UNIT_ROW_HEADER, [L_MORTGAGE, L_TAX, /\nიპოთეკა\b/]);
  if (body == null) return null;
  const flat = squash(body.replace(FOOTER, ''));
  if (!flat) return null;
  // The first row: up to and including its area (a parcel-only row may have none).
  const area = AREA_IN_ROW.exec(flat);
  const row = area ? flat.slice(0, area.index) : flat;
  // The item starts after the ownership type that follows the owner's name.
  const type = /(?:თანა)?საკუთრება/u.exec(row);
  const item = type ? row.slice(type.index + type[0].length) : '';
  const itemText = item.trim() ? tidy(item) : null;
  if (!itemText && !area) return null;
  // The description is what precedes the floor / number / block (e.g. "ფართი (მშენებარე)").
  const lead = itemText ? itemText.match(/^(.*?)(?=სართული|ბინა\s|ბინა(?:N|№)|ბლოკი|კორპუსი|,|$)/u)?.[1] ?? '' : '';
  const description = lead.trim() ? tidy(lead) : null;
  const t = itemText ?? '';
  const floor = t.match(/სართული\s*(-?\d{1,3})/u)?.[1] ?? null;
  const number =
    t.match(/(?:ბინა|ავტოსადგომი|პარკინგი|ავტოფარეხი|ოფისი|სათავსო|ფართი)\s*(?:N|№|ნომერი)\s*([\p{L}\d-]{1,8})/u)?.[1] ??
    t.match(/ბინა\s*(\d{1,5})/u)?.[1] ??
    null;
  const block =
    t.match(/ბლოკი\s*["'„“”]?\s*([\p{L}\d]{1,3})/u)?.[1] ??
    t.match(/["'„“]\s*([\p{L}\d]{1,3})\s*["'“”]\s*ბლოკი/u)?.[1] ??
    null;
  const areaSqm = area ? Number(area[1].replace(',', '.')) : null;
  return {
    description,
    itemText,
    areaSqm: areaSqm != null && Number.isFinite(areaSqm) && areaSqm > 0 ? areaSqm : null,
    floor,
    number: number ? number.replace(/[,;]+$/, '') : null,
    block,
  };
}

/** True for the registry extract PDF (as opposed to a decision page). */
export function isRegisterExtract(text: string): boolean {
  return /ამონაწერი\s+საჯარო\s+რეესტრიდან/.test(text) && /საკუთრების\s+განყოფილება/.test(text);
}

export function parseRegisterExtract(rawText: string, recordId: string): RegisterExtract | null {
  const text = decodeGeorgianLegacy(String(rawText ?? '')).replace(/\r/g, '');
  if (!isRegisterExtract(text)) return null;

  const head = text.match(/N\s+(\d{9,14})\s*-\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  const ownersBlock = section(text, L_OWNERS, [L_MORTGAGE, L_TAX]) ?? '';
  const rights = ownersBlock.match(/უფლების\s+რეგისტრაცია\s*:\s*თარიღი\s+(\d{2}\/\d{2}\/\d{4})/);
  const basisText = squash(section(ownersBlock, /უფლების\s+დამადასტურებელი\s+დოკუმენტი\s*:/, [/მესაკუთრეები\s*:/]) ?? '');
  // Older extracts say "ნაკვეთის ფუნქცია:", current ones "ნაკვეთის დანიშნულება:"
  // and wrap the value ("არასასოფლო\nსამეურნეო", prod 176264ba): a following
  // line with no label of its own is part of it.
  const landFunction = text.match(/ნაკვეთის\s+(?:ფუნქცია|დანიშნულება)\s*:\s*([^\n]+(?:\n(?![^\n]*:)[^\n]+)?)/)?.[1];
  const landArea = text.match(/დაზუსტებული\s+ფართობი\s*:\s*([\d.]+)/)?.[1];
  const buildings = section(text, /შენობა-ნაგებობები\s*:/, [L_OWNERS]) ?? '';
  const unitArea = ownersBlock.match(/\n\s*([\d]+\.\d{1,2})\s*\n\s*კვ\.მ/)?.[1];
  // v7: the owners row, read whether pdf-to-text kept it on one line or wrapped it (eeefada9).
  const unitRow = parseUnitRow(ownersBlock);
  const parcelAddress = section(text, /მისამართი\s*:/, [/\nნაკვეთის\s+საკუთრების\s+ტიპი/, /\nნაკვეთის\s+ფუნქცია/, L_OWNERS]);
  const buildingsTotal = squash(buildings).match(/(?:საერთო\s+ფართ\S*|ფართით?)\s*-?\s*(\d{1,7}(?:\.\d{1,2})?)\s*კვ/u)?.[1];
  const mortgageBody = section(text, L_MORTGAGE, [L_TAX, L_SEIZURE, L_DEBTOR]);
  const tail = [L_SEIZURE, L_DEBTOR, L_END];

  return {
    recordId: String(recordId),
    applicationNumber: head?.[1] ?? null,
    issuedAt: head ? isoMoment(head[4], head[5]) : null,
    owners: parseOwners(ownersBlock),
    ownershipRegisteredOn: isoDay(rights?.[1]),
    ownershipBasis: basisText ? (/ნასყიდობ/.test(basisText) ? 'PURCHASE' : 'OTHER') : null,
    landFunction: landFunction ? squash(landFunction) : null,
    landAreaSqm: landArea ? Number(landArea) : null,
    buildingsUnderConstruction: /მშენებარე/.test(buildings),
    // Any unit marked (მშენებარე): ფართი, ავტოსადგომი N17, … (v7, job dbf04e48).
    unitUnderConstruction: /ფართი\s*\(\s*მშენებარე\s*\)/.test(ownersBlock) || /\(\s*მშენებარე\s*\)/.test(unitRow?.description ?? ''),
    unitAreaSqm: unitArea ? Number(unitArea) : unitRow?.areaSqm ?? null,
    unitDescription: unitRow?.description ?? null,
    unitItemText: unitRow?.itemText ?? null,
    unitFloor: unitRow?.floor ?? null,
    unitNumber: unitRow?.number ?? null,
    unitBlock: unitRow?.block ?? null,
    unitRowFound: !!unitRow?.itemText,
    parcelAddress: parcelAddress ? squash(parcelAddress) || null : null,
    buildingsTotalAreaSqm: buildingsTotal ? Number(buildingsTotal) : null,
    buildingsText: squash(buildings) || null,
    mortgages: mortgageBody ? parseMortgages(mortgageBody) : [],
    taxLien: stateOf(text, L_TAX, [L_SEIZURE, L_DEBTOR, /\nვალდებულება\s*\n/, L_END]),
    seizure: stateOf(text, L_SEIZURE, tail.slice(1)),
    debtorRegistry: stateOf(text, L_DEBTOR, [L_END]),
  };
}

/**
 * Document text safe to hand a model: decoded, with 11-digit personal
 * numbers removed and representatives withheld. Owner names stay (the
 * extract is public); company names and 9-digit codes are public too.
 */
export function redactRegisterText(rawText: string): string {
  return decodeGeorgianLegacy(String(rawText ?? ''))
    .replace(/(?:P\/N|პ\/ნ)\s*:?\s*\d{11}/g, 'P/N: —')
    .replace(/(წარმომადგენელი\s*:?)[^\n]*/g, '$1 —')
    .replace(/\(\s*\d{11}\s*\)/g, '(—)')
    .replace(/(?<!\d)\d{11}(?!\d)/g, '—');
}

/* ───────────────────────── decisions & proceedings ───────────────────────── */

interface Decision {
  recordId: string;
  number: string | null;
  date: string | null;
  service: string | null;
  outcome: RegisterProceeding['outcome'];
}

/*
 * THE DECISION'S OWN HEADING DECIDES ITS OUTCOME.
 *
 * A suspension says what is needed "სარეგისტრაციო მოთხოვნის
 * დაკმაყოფილებისთვის" (for the request to be satisfied) — the words of a
 * satisfaction. Matching the body read a fee-unpaid SUSPENSION as a granted
 * termination (job 8ba97da9, decision 882026724195-03 of 18.08.2026). The
 * heading under the decision number is the act's own title: read it first.
 */
const HEADING_SUSPENDED = /წარმოების\s+შეჩერების\s+შესახებ/;
const HEADING_DISCONTINUED = /წარმოების\s+შეწყვეტის\s+შესახებ/;
const HEADING_REFUSED = /(?:უარის\s+თქმის\s+შესახებ|უარი\s+ეთქვა)/;
const BODY_SATISFIED = /მოთხოვნის\s+დაკმაყოფილების\s+თაობაზე/;

export function parseDecision(rawText: string, recordId: string): Decision | null {
  const text = decodeGeorgianLegacy(String(rawText ?? ''));
  const m = text.match(/გადაწყვეტილება\s*#\s*([\w-]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/);
  if (!m) return null;
  const service = text.match(/მომსახურების\s+სახე\s*:\s*([^\n]+)/)?.[1] ?? null;
  // The act's title: the line(s) right after the decision number, before the application details.
  const after = text.slice((m.index ?? 0) + m[0].length);
  const heading = after.slice(0, Math.max(0, after.search(/განცხადების\s+ნომერი/)) || 160);
  const outcome: RegisterProceeding['outcome'] = HEADING_SUSPENDED.test(heading)
    ? 'SUSPENDED'
    : HEADING_DISCONTINUED.test(heading)
      ? 'DISCONTINUED'
      : HEADING_REFUSED.test(heading)
        ? 'REFUSED'
        : BODY_SATISFIED.test(text)
          ? 'SATISFIED'
          : /შეჩერდეს\s+სარეგისტრაციო\s+წარმოება/.test(text)
            ? 'SUSPENDED'
            : null;
  return { recordId: String(recordId), number: m[1], date: isoDay(m[2]), service: service ? squash(service) : null, outcome };
}

export function proceedingKind(typeText: string | null | undefined): ProceedingKind {
  const t = String(typeText ?? '');
  if (/იპოთეკის\s+შეწყვეტ/.test(t)) return 'MORTGAGE_TERMINATED';
  if (/იპოთეკის\s+წარმოშობ/.test(t)) return 'MORTGAGE_CREATED';
  if (/ამხანაგობის\s+წევრ/.test(t)) return 'PARTNERSHIP_OWNERSHIP';
  if (/საკუთრების\s+უფლების\s+რეგისტრაცია/.test(t)) return 'OWNERSHIP_TRANSFER';
  return 'OTHER';
}

/* ───────────────────────── the register ───────────────────────── */

/** The NAPR blob service URL of an extract PDF, or null for anything else. */
export function officialExtractUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !/^https:\/\/[^\s"'<>]+$/i.test(v.trim())) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.hostname !== 'bs.napr.gov.ge' || !/^\/GetBlob$/i.test(u.pathname) || u.username || u.password) return null;
    return v.trim();
  } catch {
    return null;
  }
}

/** The public NAPR record page for a Service 176 application id. */
export function officialRecordUrl(appID: unknown): string | null {
  const id = String(appID ?? '').trim();
  return /^\d{4,12}$/.test(id) ? `https://naprweb.reestri.gov.ge/_dea/#/view/${id}` : null;
}

const sameMortgage = (a: RegisterMortgage, b: RegisterMortgage) =>
  (a.agreementNumber && a.agreementNumber === b.agreementNumber) ||
  (!a.agreementNumber && a.applicationNumber && a.applicationNumber === b.applicationNumber);

function service176Results(browserOfficial: unknown): any[] {
  const results = (browserOfficial as any)?.results;
  return Array.isArray(results) ? results.filter((r: any) => r?.source === 'mygov') : [];
}

/**
 * The register for the job's cadastral code, or null when Service 176
 * returned nothing usable. Only records the registry search returned FOR THIS
 * cadastral code are used; a document whose record is not in that list is
 * ignored.
 */
export function buildPropertyRegister(browserOfficial: unknown): PropertyRegister | null {
  const results = service176Results(browserOfficial);
  if (!results.length) return null;

  const extracts: RegisterExtract[] = [];
  // A record can carry several decisions (suspended, then satisfied): all are kept.
  const decisions = new Map<string, Decision[]>();
  let observedAt: string | null = null;
  const proceedings = new Map<string, RegisterProceeding>();
  const byRecord = new Map<string, string>(); // recordId → application number
  let cadastralCode: string | null = null;
  let documents = 0;

  for (const result of results) {
    const search = result?.traversal?.search;
    const code = typeof search?.cadastralCode === 'string' ? search.cadastralCode : null;
    if (!code) continue;
    cadastralCode = cadastralCode ?? code;
    if (typeof result?.retrievedAt === 'string' && (!observedAt || result.retrievedAt > observedAt)) observedAt = result.retrievedAt;
    const list = Array.isArray(search.records) ? search.records : [];
    for (const r of list.slice(0, 60)) {
      const app = String(r?.regNumber ?? '').trim();
      if (!/^\d{6,14}$/.test(app) || proceedings.has(app)) continue;
      byRecord.set(String(r.appID), app);
      proceedings.set(app, {
        applicationNumber: app,
        kind: proceedingKind(r.webTransact),
        typeText: typeof r.webTransact === 'string' ? squash(r.webTransact) : null,
        filedOn: unixDay(r.appRegDate),
        completedOn: unixDay(r.lastActDate),
        read: false,
        outcome: null,
        decisionNumber: null,
        decisionDate: null,
      });
    }
    for (const d of Array.isArray(result.documents) ? result.documents : []) {
      const recordId = String(d?.sourceReference?.recordId ?? '');
      if (!byRecord.has(recordId) || typeof d?.rawText !== 'string') continue;
      if (d.sourceReference?.cadastralCode && d.sourceReference.cadastralCode !== code) continue;
      documents++;
      const extract = parseRegisterExtract(d.rawText, recordId);
      if (extract) {
        // The extract PDF itself and its record page: public NAPR links, no personal data in either.
        extract.documentUrl = officialExtractUrl(d.url ?? d.sourceReference?.url);
        extract.recordUrl = officialRecordUrl(recordId);
        extracts.push(extract);
        continue;
      }
      const decision = parseDecision(d.rawText, recordId);
      if (decision) decisions.set(recordId, [...(decisions.get(recordId) ?? []), decision]);
    }
  }
  if (!cadastralCode) return null;

  for (const [recordId, app] of byRecord) {
    const p = proceedings.get(app)!;
    // Oldest first; on the same day the later decision number is the later act.
    const read = [...(decisions.get(recordId) ?? [])].sort((a, b) =>
      String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.number ?? '').localeCompare(String(b.number ?? ''), undefined, { numeric: true }));
    if (extracts.some((e) => e.recordId === recordId) || read.length) p.read = true;
    if (read.length) {
      const final = read[read.length - 1];
      p.outcome = final.outcome;
      p.decisionNumber = final.number;
      p.decisionDate = final.date;
      p.decisions = read.map((d) => ({ number: d.number, date: d.date, outcome: d.outcome }));
    }
  }

  extracts.sort((a, b) => String(a.issuedAt ?? '').localeCompare(String(b.issuedAt ?? '')));
  const latest = extracts.length ? extracts[extracts.length - 1] : null;
  const currentMortgages = latest?.mortgages ?? [];

  const removed: RemovedMortgage[] = [];
  for (const e of extracts.slice(0, -1)) {
    for (const m of e.mortgages) {
      if (currentMortgages.some((c) => sameMortgage(c, m))) continue;
      const seen = removed.find((r) => sameMortgage(r, m));
      // "Last seen" is the LAST extract that still listed it, not the first (8ba97da9: 17.08.2026, not 09.09.2024).
      if (seen) {
        if (e.issuedAt && (!seen.lastSeenAt || e.issuedAt > seen.lastSeenAt)) seen.lastSeenAt = e.issuedAt;
        continue;
      }
      removed.push({ ...m, lastSeenAt: e.issuedAt, removedBy: null });
    }
  }
  // The termination that was finally GRANTED after the mortgage was last seen and by the latest extract.
  for (const m of removed) {
    const termination = [...proceedings.values()].find(
      (p) =>
        p.kind === 'MORTGAGE_TERMINATED' &&
        p.outcome === 'SATISFIED' &&
        (!p.decisionDate || !m.lastSeenAt || p.decisionDate >= m.lastSeenAt.slice(0, 10)) &&
        (!p.decisionDate || !latest?.issuedAt || p.decisionDate <= latest.issuedAt.slice(0, 10))
    );
    m.removedBy = termination
      ? { applicationNumber: termination.applicationNumber, decisionNumber: termination.decisionNumber, decisionDate: termination.decisionDate }
      : null;
  }

  const all = [...proceedings.values()].sort((a, b) => String(a.filedOn ?? '').localeCompare(String(b.filedOn ?? '')));
  const read = all.filter((p) => p.read).length;
  return {
    cadastralCode,
    history: extracts.map((e) => ({
      issuedAt: e.issuedAt, applicationNumber: e.applicationNumber, owners: e.owners,
      ownershipRegisteredOn: e.ownershipRegisteredOn, ownershipBasis: e.ownershipBasis,
      mortgageAgreements: e.mortgages.map((m) => m.agreementNumber ?? m.applicationNumber),
    })),
    observedAt,
    latest,
    currentMortgages,
    removedMortgages: removed,
    proceedings: all,
    coverage: { found: all.length, read, documents, notOpened: all.length - read },
  };
}

/* ───────────────────────── the unit's legal position ───────────────────────── */

/*
 * WHAT IS REGISTERED ON THIS UNIT, STEP BY STEP, AND AS OF WHEN.
 *
 * Distinct legal steps are never collapsed: a mortgage REGISTERED on the unit,
 * an APPLICATION to terminate it, a SUSPENSION of that application, and the
 * REGISTERED CANCELLATION are four different things (job 8ba97da9: BoG's
 * termination application 882026724195 was filed 13.08.2026, suspended
 * 18.08.2026 for an unpaid fee, and registered 24.08.2026 — and only the
 * extract of 24.08.2026 shows the unit without the mortgage).
 *
 * Every conclusion carries its scope (this exact cadastral unit), its source
 * (the NAPR extract) and its date (the extract's preparation moment). A
 * company's bank obligations, project financing and parent-parcel
 * encumbrances are NOT in this register and are never inferred from it.
 */
export type MortgageLifecycle =
  | 'ACTIVE'
  | 'TERMINATION_APPLIED'
  | 'TERMINATION_SUSPENDED'
  | 'CANCELLATION_REGISTERED'
  /** Listed in the latest extract HOMATCH holds, but a later registry decision granted its termination. */
  | 'CANCELLATION_REGISTERED_AFTER_EXTRACT'
  | 'ABSENT_FROM_LATEST_EXTRACT';

export interface MortgageStep {
  date: string | null;
  step: 'MORTGAGE_REGISTERED' | 'TERMINATION_APPLIED' | 'SUSPENDED' | 'REFUSED' | 'DISCONTINUED' | 'CANCELLATION_REGISTERED';
  applicationNumber: string | null;
  decisionNumber: string | null;
}

export interface UnitMortgageHistory {
  scope: 'EXACT_UNIT';
  creditor: string | null;
  creditorId: string | null;
  agreementNumber: string | null;
  registeredOn: string | null;
  lifecycle: MortgageLifecycle;
  /** Preparation moment of the last extract that listed it. */
  lastSeenInExtractOf: string | null;
  /** Preparation moment of the first extract read that no longer lists it. */
  absentFromExtractOf: string | null;
  steps: MortgageStep[];
}

export interface UnitLegalPosition {
  scope: 'EXACT_UNIT';
  cadastralCode: string | null;
  evidence: {
    source: 'NAPR_EXTRACT';
    /** The extract's own preparation moment — the date every conclusion below is "as of". */
    extractIssuedAt: string | null;
    extractApplicationNumber: string | null;
    /** When HOMATCH observed the registry's proceedings list (later than the extract). */
    proceedingsObservedAt: string | null;
  };
  ownership: { owners: RegisterOwner[]; registeredOn: string | null; basis: RegisterExtract['ownershipBasis']; asOf: string | null } | null;
  ownershipHistory: Array<{ owners: RegisterOwner[]; registeredOn: string | null; basis: RegisterExtract['ownershipBasis']; seenInExtractOf: string | null }>;
  mortgages: { state: 'ACTIVE' | 'NONE_REGISTERED'; asOf: string | null; history: UnitMortgageHistory[] };
  restrictions: { taxLien: RegisterState; seizure: RegisterState; debtorRegistry: RegisterState; asOf: string | null };
  /** Proceedings filed and not finally decided (none of SATISFIED / REFUSED / DISCONTINUED). */
  openProceedings: Array<{ kind: ProceedingKind; applicationNumber: string; filedOn: string | null; lastOutcome: DecisionOutcome | null }>;
  freshExtractAdvised: boolean;
  /** What this register does NOT cover — said, never inferred. */
  notCovered: Array<'COMPANY_OBLIGATIONS' | 'PROJECT_FINANCING' | 'PARENT_PARCEL_ENCUMBRANCES'>;
}

const FINAL = new Set<DecisionOutcome>(['SATISFIED', 'REFUSED', 'DISCONTINUED']);

function terminationSteps(p: RegisterProceeding): MortgageStep[] {
  const steps: MortgageStep[] = [{ date: p.filedOn, step: 'TERMINATION_APPLIED', applicationNumber: p.applicationNumber, decisionNumber: null }];
  for (const d of p.decisions ?? (p.outcome ? [{ number: p.decisionNumber, date: p.decisionDate, outcome: p.outcome }] : [])) {
    const step: MortgageStep['step'] | null = d.outcome === 'SATISFIED' ? 'CANCELLATION_REGISTERED' : d.outcome === 'SUSPENDED' ? 'SUSPENDED' : d.outcome === 'REFUSED' ? 'REFUSED' : d.outcome === 'DISCONTINUED' ? 'DISCONTINUED' : null;
    if (step) steps.push({ date: d.date, step, applicationNumber: p.applicationNumber, decisionNumber: d.number });
  }
  return steps;
}

export function unitLegalPosition(reg: PropertyRegister | null): UnitLegalPosition | null {
  if (!reg?.latest) return null;
  const l = reg.latest;
  const asOf = l.issuedAt;
  const history = reg.history ?? [];
  const terminations = reg.proceedings.filter((p) => p.kind === 'MORTGAGE_TERMINATED');
  const mortgages: UnitMortgageHistory[] = [];

  const extractDay = String(asOf ?? '').slice(0, 10);
  for (const m of reg.currentMortgages) {
    const after = (p: RegisterProceeding) => !m.registeredOn || !p.filedOn || p.filedOn >= m.registeredOn;
    // A termination GRANTED after the extract was prepared — only attributable when one mortgage is listed.
    const grantedLater = reg.currentMortgages.length === 1
      ? terminations.find((p) => p.outcome === 'SATISFIED' && after(p) && !!p.decisionDate && p.decisionDate > extractDay) ?? null
      : null;
    // A termination filed after this mortgage and not yet granted: applied for, NOT cancelled.
    const open = grantedLater ?? terminations.find((p) => p.outcome !== 'SATISFIED' && after(p)) ?? null;
    const lifecycle: MortgageLifecycle = grantedLater
      ? 'CANCELLATION_REGISTERED_AFTER_EXTRACT'
      : open ? (open.outcome === 'SUSPENDED' ? 'TERMINATION_SUSPENDED' : 'TERMINATION_APPLIED') : 'ACTIVE';
    mortgages.push({
      scope: 'EXACT_UNIT', creditor: m.creditor, creditorId: m.creditorId, agreementNumber: m.agreementNumber, registeredOn: m.registeredOn,
      lifecycle, lastSeenInExtractOf: asOf, absentFromExtractOf: null,
      steps: [{ date: m.registeredOn, step: 'MORTGAGE_REGISTERED', applicationNumber: m.applicationNumber, decisionNumber: null }, ...(open ? terminationSteps(open) : [])],
    });
  }
  for (const m of reg.removedMortgages) {
    const absent = history.find((h) => h.issuedAt && m.lastSeenAt && h.issuedAt > m.lastSeenAt)?.issuedAt ?? asOf;
    const termination = m.removedBy ? terminations.find((p) => p.applicationNumber === m.removedBy!.applicationNumber) ?? null : null;
    mortgages.push({
      scope: 'EXACT_UNIT', creditor: m.creditor, creditorId: m.creditorId, agreementNumber: m.agreementNumber, registeredOn: m.registeredOn,
      lifecycle: termination ? 'CANCELLATION_REGISTERED' : 'ABSENT_FROM_LATEST_EXTRACT',
      lastSeenInExtractOf: m.lastSeenAt, absentFromExtractOf: absent,
      steps: [{ date: m.registeredOn, step: 'MORTGAGE_REGISTERED', applicationNumber: m.applicationNumber, decisionNumber: null }, ...(termination ? terminationSteps(termination) : [])],
    });
  }

  const ownershipHistory: UnitLegalPosition['ownershipHistory'] = [];
  for (const h of history) {
    const key = `${h.ownershipRegisteredOn}|${h.owners.map((o) => o.name ?? o.companyId ?? '').join(',')}`;
    if (ownershipHistory.some((o) => `${o.registeredOn}|${o.owners.map((x) => x.name ?? x.companyId ?? '').join(',')}` === key)) continue;
    ownershipHistory.push({ owners: h.owners, registeredOn: h.ownershipRegisteredOn, basis: h.ownershipBasis, seenInExtractOf: h.issuedAt });
  }

  const fresh = extractFreshness(reg);
  return {
    scope: 'EXACT_UNIT',
    cadastralCode: reg.cadastralCode,
    evidence: { source: 'NAPR_EXTRACT', extractIssuedAt: asOf, extractApplicationNumber: l.applicationNumber, proceedingsObservedAt: reg.observedAt ?? null },
    ownership: l.owners.length ? { owners: l.owners, registeredOn: l.ownershipRegisteredOn, basis: l.ownershipBasis, asOf } : null,
    ownershipHistory,
    mortgages: { state: reg.currentMortgages.length ? 'ACTIVE' : 'NONE_REGISTERED', asOf, history: mortgages },
    restrictions: { taxLien: l.taxLien, seizure: l.seizure, debtorRegistry: l.debtorRegistry, asOf },
    openProceedings: reg.proceedings
      // A decision read and not final, or filed after the extract with nothing read about it.
      .filter((p) => (p.outcome ? !FINAL.has(p.outcome) : (p.filedOn ?? '') > String(asOf ?? '').slice(0, 10)))
      .map((p) => ({ kind: p.kind, applicationNumber: p.applicationNumber, filedOn: p.filedOn, lastOutcome: p.outcome })),
    freshExtractAdvised: fresh.freshExtractAdvised,
    notCovered: ['COMPANY_OBLIGATIONS', 'PROJECT_FINANCING', 'PARENT_PARCEL_ENCUMBRANCES'],
  };
}

/* ───────────────────────── for the model ───────────────────────── */

/**
 * The register as authoritative facts for the synthesis prompt. Compact, no
 * personal data, and explicit about what it settles so the model neither
 * contradicts it nor asks the buyer to fetch a document HOMATCH already read.
 */
export function registerModelFacts(reg: PropertyRegister | null): Record<string, unknown> | null {
  if (!reg?.latest) return null;
  const l = reg.latest;
  return {
    extractIssuedAt: l.issuedAt,
    owners: l.owners.map((o) => (o.kind === 'PERSON' ? `${o.name ?? 'a private individual'} (private individual)` : `${o.name ?? 'a company'}${o.companyId ? ` (${o.companyId})` : ''}`)),
    ownershipRegisteredOn: l.ownershipRegisteredOn,
    ownershipBasis: l.ownershipBasis,
    mortgagesRegisteredOnThisUnit: reg.currentMortgages,
    mortgagesRemovedBeforeThisExtract: reg.removedMortgages.map((m) => ({
      creditor: m.creditor, agreementNumber: m.agreementNumber, agreementDate: m.agreementDate, registeredOn: m.registeredOn,
      lastSeenInExtractOf: m.lastSeenAt, removedByDecision: m.removedBy?.decisionNumber ?? null, decisionDate: m.removedBy?.decisionDate ?? null,
    })),
    taxLien: l.taxLien, seizureOrProhibition: l.seizure, debtorRegistry: l.debtorRegistry,
    landFunction: l.landFunction, buildingsMarkedUnderConstruction: l.buildingsUnderConstruction, unitMarkedUnderConstruction: l.unitUnderConstruction,
    // v7: the unit's own row (its registered area, description, number, floor/level, block) and the parcel area — never confused.
    unitAreaSqm: l.unitAreaSqm, unitDescription: l.unitDescription ?? null, unitItemText: l.unitItemText ?? null,
    unitNumber: l.unitNumber ?? null, unitFloorOrLevel: l.unitFloor ?? null, unitBlock: l.unitBlock ?? null, parcelLandAreaSqm: l.landAreaSqm,
    proceedings: reg.proceedings.map((p) => ({
      kind: p.kind, applicationNumber: p.applicationNumber, filedOn: p.filedOn, completedOn: p.completedOn, documentsRead: p.read,
      decisions: (p.decisions ?? []).map((d) => ({ number: d.number, date: d.date, outcome: d.outcome })),
    })),
    // Step-by-step, scoped and dated (unitLegalPosition): an application is never a cancellation.
    mortgageChronology: unitLegalPosition(reg)?.mortgages.history.map((m) => ({
      scope: m.scope, creditor: m.creditor, agreementNumber: m.agreementNumber, registeredOn: m.registeredOn, lifecycle: m.lifecycle,
      lastSeenInExtractOf: m.lastSeenInExtractOf, absentFromExtractOf: m.absentFromExtractOf,
      steps: m.steps.map((x) => ({ date: x.date, step: x.step, decisionNumber: x.decisionNumber })),
    })),
    scope: 'EXACT_UNIT',
    notCoveredByThisRegister: ['COMPANY_OBLIGATIONS', 'PROJECT_FINANCING', 'PARENT_PARCEL_ENCUMBRANCES'],
    proceedingsObservedAt: reg.observedAt ?? null,
    ...extractFreshness(reg),
  };
}

/**
 * Whether the register moved after the newest extract HOMATCH holds. A fresh
 * extract is advised ONLY then (a registry step newer than the extract);
 * otherwise the buyer is never sent for a document Verify already read.
 */
export function extractFreshness(reg: PropertyRegister | null): { registryStepsAfterExtract: Array<{ kind: ProceedingKind; filedOn: string | null; completedOn: string | null; outcome: string | null }>; freshExtractAdvised: boolean; removalNotResolved: boolean } {
  const issued = reg?.latest?.issuedAt?.slice(0, 10) ?? null;
  const after = issued
    ? (reg?.proceedings ?? []).filter((p) => (p.completedOn ?? p.filedOn ?? '') > issued)
    : [];
  return {
    registryStepsAfterExtract: after.map((p) => ({ kind: p.kind, filedOn: p.filedOn, completedOn: p.completedOn, outcome: p.outcome })),
    freshExtractAdvised: after.length > 0,
    // A mortgage that left the register without a termination HOMATCH could read: say exactly that.
    removalNotResolved: (reg?.removedMortgages ?? []).some((m) => !m.removedBy),
  };
}

export function registerPromptFacts(reg: PropertyRegister | null): string {
  const facts = registerModelFacts(reg);
  if (!facts || !reg?.latest) return '';
  const l = reg.latest;
  return `\nPROPERTY REGISTER — AUTHORITATIVE (parsed from the NAPR extract HOMATCH retrieved; state "as of ${l.issuedAt?.slice(0, 10)}"): ${JSON.stringify(facts)}
These facts are settled. Never contradict them, never call the owner anything else, never say a termination "does not specify" which mortgage ended when mortgagesRemovedBeforeThisExtract names it, and never ask the buyer to obtain an extract as if none had been read — at most suggest a fresh extract on the signing day to confirm nothing changed after ${l.issuedAt?.slice(0, 10)}. A company's own pledge is a company obligation; a mortgage listed above is on this exact unit (whatever its registered kind: unitItemText). "NONE" means the extract states nothing is registered. Name the owner exactly as listed (never a personal number).\n`;
}

/* ───────────────────────── reconciliation ───────────────────────── */

/*
 * Prose the register proves wrong is removed, sentence by sentence — the
 * report already persisted for c80f7237 and every report like it is fixed on
 * read, with no new model call or charge. Only two claims are policed, both
 * narrow: (1) a company named as owner when the extract's owners are private
 * persons; (2) "the termination does not say which mortgage" when the
 * extracts settle it. Plus (3) the malformed land/"area" purpose change
 * (ფართობი → არასასოფლო სამეურნეო) that tasIntelligence used to produce.
 */
const OWNER_WORD = /(მესაკუთრ|\bowner|собственник|\bsahib|malik|مالك|المالك|בעל(?:ים|ת)?\b)/i;
const COMPANY_WORD = /(შპს|LLC|ООО|\bLtd|Group|გრუპ|„[^“]+“\s*(?:LLC)?)/i;
const TERMINATION_WORD = /(შეწყვეტ|შეწყდა|terminat|прекращ|fesih|إنهاء|ביטול|סיום)/i;
const UNSPECIFIED_WORD = /(არ\s+აკონკრეტებს|არ\s+ასახელებს|არ\s+ამბობს|არ\s+მიუთითებს|not\s+(?:specify|say|state|identify|name)|which\s+mortgage|не\s+(?:уточня|указыва|называ)|belirtmiyor|لا\s+يحدد|אינו\s+מציין)/i;
const BOGUS_PURPOSE = /„?ფართობ(?:ი|ად)“?[\s\S]{0,80}(?:შეიცვალა|→)|area[\s\S]{0,40}changed\s+to\s+non-agricultural/i;

/** Sentences, splitting after . ! ? — but not after "ქ." / "N." or inside "01. 18. 06". */
export function sentences(text: string): string[] {
  const parts = String(text ?? '').split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    const glue = prev !== undefined && (/(?:^|[\s(])(?:ქ|N|მ|კვ)\.$/.test(prev) || (/(?:^|\s)\d{1,4}\.$/.test(prev) && /^\d/.test(part)));
    if (glue) out[out.length - 1] = `${prev} ${part}`;
    else out.push(part);
  }
  return out.filter((s) => s.trim());
}

export interface ReconcileRules {
  ownerIsPrivate: boolean;
  terminationResolved: boolean;
  /** A mortgage is listed in the latest extract (an application to end it is not an end). */
  mortgageStillRegistered?: boolean;
  /** The NAPR extract for this exact unit was read: the unit is officially identified. */
  unitVerified?: boolean;
}

/* "The mortgage ended / was cancelled" — false while the latest extract still lists one. */
const MORTGAGE_CLEARED = /(იპოთეკ\S*\s+(?:შეწყდა|მოიხსნა|გაუქმდა|გაუქმებულია|შეწყვეტილია)|mortgage\s+(?:was\s+|has\s+been\s+|is\s+)?(?:terminated|cancell?ed|released|removed|lifted|discharged)|ипотек\S*\s+(?:прекращ|снят|погаш))/iu;
/* "The exact unit could not be / was not independently verified" — false once its extract was read. */
const UNIT_UNVERIFIED = /(დამოუკიდებლად\s+(?:ვერ|არ)\s+(?:იქნა\s+)?(?:და)?(?:დადასტურ|გადამოწმ)|not\s+(?:been\s+)?independently\s+(?:verified|confirmed)|независимо\s+не\s+подтвержд|(?:იდენტობ|identity|ვინაობ)[^.!?]{0,60}(?:ვერ\s+დადასტურდა|არ\s+არის\s+დადასტურებ|not\s+(?:been\s+)?(?:verified|confirmed)|unverified))/iu;

export function rulesFrom(reg: PropertyRegister | null): ReconcileRules {
  const owners = reg?.latest?.owners ?? [];
  return {
    ownerIsPrivate: owners.length > 0 && owners.every((o) => o.kind === 'PERSON'),
    terminationResolved: (reg?.removedMortgages ?? []).length > 0,
    // Only when NO mortgage ended: a sentence about an earlier mortgage that did end stays true.
    mortgageStillRegistered: (reg?.currentMortgages ?? []).length > 0 && (reg?.removedMortgages ?? []).length === 0,
    unitVerified: !!reg?.latest,
  };
}

export function contradicts(sentence: string, rules: ReconcileRules): boolean {
  if (rules.ownerIsPrivate && OWNER_WORD.test(sentence) && COMPANY_WORD.test(sentence)) return true;
  if (rules.terminationResolved && TERMINATION_WORD.test(sentence) && UNSPECIFIED_WORD.test(sentence)) return true;
  if (BOGUS_PURPOSE.test(sentence)) return true;
  if (rules.mortgageStillRegistered && MORTGAGE_CLEARED.test(sentence)) return true;
  if (rules.unitVerified && UNIT_UNVERIFIED.test(sentence)) return true;
  return false;
}

/** Text with contradicted sentences (and "; "-clauses) removed. */
export function reconcileText(text: string, rules: ReconcileRules): string {
  if (typeof text !== 'string' || !text.trim()) return text;
  const kept = sentences(text)
    .map((s) => {
      if (!contradicts(s, rules)) return s;
      // A "; "-joined value may hold one bad clause and one good one.
      const clauses = s.split(/;\s+/);
      if (clauses.length < 2) return '';
      const ok = clauses.filter((c) => !contradicts(c, rules));
      return ok.length === clauses.length ? s : ok.join('; ').replace(/[;,]\s*$/, '');
    })
    .filter((s) => s.trim());
  return kept.join(' ').trim();
}

/** True when anything in the text would be removed. */
export function hasContradiction(text: unknown, rules: ReconcileRules): boolean {
  return typeof text === 'string' && reconcileText(text, rules) !== text.trim();
}

/**
 * Applies reconcileText across a synthesis report object. Items that become
 * empty are removed; a story chapter whose subject was the malformed purpose
 * change is removed whole (what remains would discuss a change that did not
 * happen).
 */
export function reconcileReport<T extends Record<string, any>>(report: T, reg: PropertyRegister | null): T {
  if (!report || typeof report !== 'object') return report;
  const rules = rulesFrom(reg);
  const fix = (s: unknown) => (typeof s === 'string' ? reconcileText(s, rules) : s);
  const out: Record<string, any> = { ...report };

  if (out.summary && typeof out.summary === 'object') {
    out.summary = {
      ...out.summary,
      statement: fix(out.summary.statement),
      highlights: Array.isArray(out.summary.highlights)
        ? out.summary.highlights
            .map((h: any) => ({ ...h, detail: fix(h?.detail) }))
            .filter((h: any) => typeof h.detail !== 'string' || h.detail.trim())
        : out.summary.highlights,
    };
  }
  if (Array.isArray(out.keyFindings)) {
    out.keyFindings = out.keyFindings
      .map((k: any) => ({ ...k, finding: fix(k?.finding), whyItMatters: hasContradiction(k?.finding, rules) ? '' : fix(k?.whyItMatters) }))
      .filter((k: any) => typeof k.finding === 'string' && k.finding.trim());
  }
  if (Array.isArray(out.attentionPoints)) {
    out.attentionPoints = out.attentionPoints
      .map((a: any) => ({ ...a, point: fix(a?.point), why: hasContradiction(a?.point, rules) ? '' : fix(a?.why) }))
      .filter((a: any) => typeof a.point === 'string' && a.point.trim());
  }
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.map((s: any) => ({ ...s, body: fix(s?.body) }));
  }
  if (out.propertyStory && Array.isArray(out.propertyStory.chapters)) {
    out.propertyStory = {
      ...out.propertyStory,
      chapters: out.propertyStory.chapters
        .filter((c: any) => !sentences(c?.body ?? '').some((s) => BOGUS_PURPOSE.test(s)))
        .map((c: any) => ({ ...c, body: fix(c?.body) }))
        .filter((c: any) => typeof c.body === 'string' && c.body.trim()),
    };
  }
  if (out.currentStatus && Array.isArray(out.currentStatus.items)) {
    out.currentStatus = {
      ...out.currentStatus,
      statement: fix(out.currentStatus.statement),
      items: out.currentStatus.items
        .map((i: any) => ({ ...i, value: fix(i?.value) }))
        .filter((i: any) => typeof i.value === 'string' && i.value.trim()),
    };
  }
  if (typeof out.finalView === 'string') out.finalView = fix(out.finalView);
  return out as T;
}
