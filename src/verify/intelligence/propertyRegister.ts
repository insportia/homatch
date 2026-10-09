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
 * PRIVACY. A private owner is described as a private person — never by name,
 * never by personal number. A company owner is named (a registered company's
 * name is public business information and the buyer needs it). Bank and
 * company identification codes are public. Representatives are never read.
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
  /** Only for a company. A private person is never named here. */
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
  /** Decision outcome, when the decision was read. */
  outcome: 'SATISFIED' | 'REFUSED' | 'SUSPENDED' | null;
  decisionNumber: string | null;
  decisionDate: string | null;
}

export interface RemovedMortgage extends RegisterMortgage {
  /** ISO datetime of the last extract that still listed it. */
  lastSeenAt: string | null;
  /** The termination proceeding that removed it, when one was read. */
  removedBy: { applicationNumber: string; decisionNumber: string | null; decisionDate: string | null } | null;
}

export interface PropertyRegister {
  cadastralCode: string | null;
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
        const name = squash(line.replace(/,?\s*(?:ს\/ნ|ს\/კ|ID\/N)\s*:?\s*\d{9}\s*$/, '').replace(/\d{9}\s*$/, '')).replace(/,$/, '');
        return { kind: 'COMPANY', name: name || undefined, ...(id ? { companyId: id } : {}) };
      }
      return { kind: 'PERSON' };
    })
    .slice(0, 12);
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
  const landFunction = text.match(/ნაკვეთის\s+ფუნქცია\s*:\s*([^\n]+)/)?.[1];
  const landArea = text.match(/დაზუსტებული\s+ფართობი\s*:\s*([\d.]+)/)?.[1];
  const buildings = section(text, /შენობა-ნაგებობები\s*:/, [L_OWNERS]) ?? '';
  const unitArea = ownersBlock.match(/\n\s*([\d]+\.\d{1,2})\s*\n\s*კვ\.მ/)?.[1];
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
    unitUnderConstruction: /ფართი\s*\(\s*მშენებარე\s*\)/.test(ownersBlock),
    unitAreaSqm: unitArea ? Number(unitArea) : null,
    mortgages: mortgageBody ? parseMortgages(mortgageBody) : [],
    taxLien: stateOf(text, L_TAX, [L_SEIZURE, L_DEBTOR, /\nვალდებულება\s*\n/, L_END]),
    seizure: stateOf(text, L_SEIZURE, tail.slice(1)),
    debtorRegistry: stateOf(text, L_DEBTOR, [L_END]),
  };
}

/**
 * Document text safe to hand a model: decoded, with private persons'
 * names and 11-digit personal numbers removed. A private owner becomes
 * "ფიზიკური პირი"; a representative's name and number are withheld. Company
 * names and 9-digit company codes are public and stay.
 */
export function redactRegisterText(rawText: string): string {
  let text = decodeGeorgianLegacy(String(rawText ?? ''));
  const ownersBody = section(text, /მესაკუთრეები\s*:\s*\n/, [/\nმესაკუთრე\s*:/, L_MORTGAGE, L_TAX]) ?? '';
  const names = ownersBody
    .split('\n')
    .map((l) => l.match(/^\s*(.+?)\s*,?\s*(?:P\/N|პ\/ნ)\s*:?\s*\d{11}/)?.[1]?.replace(/,$/, '').trim())
    .filter((n): n is string => !!n && n.length > 2);
  for (const name of names) text = text.split(name).join('ფიზიკური პირი');
  return text
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

export function parseDecision(rawText: string, recordId: string): Decision | null {
  const text = decodeGeorgianLegacy(String(rawText ?? ''));
  const m = text.match(/გადაწყვეტილება\s*#\s*([\w-]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/);
  if (!m) return null;
  const service = text.match(/მომსახურების\s+სახე\s*:\s*([^\n]+)/)?.[1] ?? null;
  const outcome = /მოთხოვნის\s+დაკმაყოფილების/.test(text)
    ? 'SATISFIED'
    : /უარის\s+თქმის|უარი\s+ეთქვა/.test(text)
      ? 'REFUSED'
      : /შეჩერებ/.test(text)
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
  const decisions = new Map<string, Decision>();
  const proceedings = new Map<string, RegisterProceeding>();
  const byRecord = new Map<string, string>(); // recordId → application number
  let cadastralCode: string | null = null;
  let documents = 0;

  for (const result of results) {
    const search = result?.traversal?.search;
    const code = typeof search?.cadastralCode === 'string' ? search.cadastralCode : null;
    if (!code) continue;
    cadastralCode = cadastralCode ?? code;
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
        extracts.push(extract);
        continue;
      }
      const decision = parseDecision(d.rawText, recordId);
      if (decision) decisions.set(recordId, decision);
    }
  }
  if (!cadastralCode) return null;

  for (const [recordId, app] of byRecord) {
    const p = proceedings.get(app)!;
    const decision = decisions.get(recordId);
    if (extracts.some((e) => e.recordId === recordId) || decision) p.read = true;
    if (decision) {
      p.outcome = decision.outcome;
      p.decisionNumber = decision.number;
      p.decisionDate = decision.date;
    }
  }

  extracts.sort((a, b) => String(a.issuedAt ?? '').localeCompare(String(b.issuedAt ?? '')));
  const latest = extracts.length ? extracts[extracts.length - 1] : null;
  const currentMortgages = latest?.mortgages ?? [];

  const removed: RemovedMortgage[] = [];
  for (const e of extracts.slice(0, -1)) {
    for (const m of e.mortgages) {
      if (currentMortgages.some((c) => sameMortgage(c, m))) continue;
      if (removed.some((r) => sameMortgage(r, m))) continue;
      // The termination that falls between the two extracts and was granted.
      const termination = [...proceedings.values()].find(
        (p) =>
          p.kind === 'MORTGAGE_TERMINATED' &&
          p.outcome === 'SATISFIED' &&
          (!p.decisionDate || !e.issuedAt || p.decisionDate >= e.issuedAt.slice(0, 10)) &&
          (!p.decisionDate || !latest?.issuedAt || p.decisionDate <= latest.issuedAt.slice(0, 10))
      );
      removed.push({
        ...m,
        lastSeenAt: e.issuedAt,
        removedBy: termination
          ? { applicationNumber: termination.applicationNumber, decisionNumber: termination.decisionNumber, decisionDate: termination.decisionDate }
          : null,
      });
    }
  }

  const all = [...proceedings.values()].sort((a, b) => String(a.filedOn ?? '').localeCompare(String(b.filedOn ?? '')));
  const read = all.filter((p) => p.read).length;
  return {
    cadastralCode,
    latest,
    currentMortgages,
    removedMortgages: removed,
    proceedings: all,
    coverage: { found: all.length, read, documents, notOpened: all.length - read },
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
    owners: l.owners.map((o) => (o.kind === 'PERSON' ? 'a private individual (name withheld)' : `${o.name ?? 'a company'}${o.companyId ? ` (${o.companyId})` : ''}`)),
    ownershipRegisteredOn: l.ownershipRegisteredOn,
    ownershipBasis: l.ownershipBasis,
    mortgagesRegisteredOnThisUnit: reg.currentMortgages,
    mortgagesRemovedBeforeThisExtract: reg.removedMortgages.map((m) => ({
      creditor: m.creditor, agreementNumber: m.agreementNumber, agreementDate: m.agreementDate, registeredOn: m.registeredOn,
      lastSeenInExtractOf: m.lastSeenAt, removedByDecision: m.removedBy?.decisionNumber ?? null, decisionDate: m.removedBy?.decisionDate ?? null,
    })),
    taxLien: l.taxLien, seizureOrProhibition: l.seizure, debtorRegistry: l.debtorRegistry,
    landFunction: l.landFunction, buildingsMarkedUnderConstruction: l.buildingsUnderConstruction, unitMarkedUnderConstruction: l.unitUnderConstruction,
    proceedings: reg.proceedings.map((p) => ({ kind: p.kind, filedOn: p.filedOn, completedOn: p.completedOn, documentsRead: p.read })),
  };
}

export function registerPromptFacts(reg: PropertyRegister | null): string {
  const facts = registerModelFacts(reg);
  if (!facts || !reg?.latest) return '';
  const l = reg.latest;
  return `\nPROPERTY REGISTER — AUTHORITATIVE (parsed from the NAPR extract HOMATCH retrieved; state "as of ${l.issuedAt?.slice(0, 10)}"): ${JSON.stringify(facts)}
These facts are settled. Never contradict them, never call the owner anything else, never say a termination "does not specify" which mortgage ended when mortgagesRemovedBeforeThisExtract names it, and never ask the buyer to obtain an extract as if none had been read — at most suggest a fresh extract on the signing day to confirm nothing changed after ${l.issuedAt?.slice(0, 10)}. A company's own pledge is a company obligation; a mortgage listed above is on this apartment. "NONE" means the extract states nothing is registered. Never name a private owner.\n`;
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
}

export function rulesFrom(reg: PropertyRegister | null): ReconcileRules {
  const owners = reg?.latest?.owners ?? [];
  return {
    ownerIsPrivate: owners.length > 0 && owners.every((o) => o.kind === 'PERSON'),
    terminationResolved: (reg?.removedMortgages ?? []).length > 0,
  };
}

export function contradicts(sentence: string, rules: ReconcileRules): boolean {
  if (rules.ownerIsPrivate && OWNER_WORD.test(sentence) && COMPANY_WORD.test(sentence)) return true;
  if (rules.terminationResolved && TERMINATION_WORD.test(sentence) && UNSPECIFIED_WORD.test(sentence)) return true;
  if (BOGUS_PURPOSE.test(sentence)) return true;
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
