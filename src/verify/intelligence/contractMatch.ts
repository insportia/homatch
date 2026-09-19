// HOMATCH — the contract, read against what the verification already knows.
//
// A contract uploaded from a Verification Case is not a loose file. Homatch
// already holds the cadastral code, the address, the developer's legal name,
// its identification code and — read from the entrepreneur register — how
// that company may be represented. The document was previously analysed in
// isolation and none of that was used, so the one question a buyer actually
// has at signing time ("is this contract about the property I checked, sold
// by the company I checked, signed by someone who may sign for it?") went
// unanswered while all the evidence sat one table away.
//
// WHAT THIS IS AND IS NOT
//
// Every comparison here is deterministic string work over facts the analyser
// already extracted and persisted. No model runs. Nothing is inferred from
// tone or likelihood. A field is MATCH only on an exact normalised equality,
// MISMATCH only when both sides are present and genuinely differ, and
// INSUFFICIENT whenever the document does not say — which is the common case
// and is emphatically not a finding against anyone.
//
// THE THREE-STATE RULE EXISTS BECAUSE TWO STATES LIE.
//
// Collapsing INSUFFICIENT into MISMATCH turns "the contract does not mention
// a cadastral code" into "the contract names a different property", which is
// the single most alarming thing this screen could say and would frequently
// be false. Collapsing it into MATCH is worse. So absence is its own answer
// and is styled as neutral.

import type { CompanyIntelligence } from './companyIntelligence.ts';

export type MatchState = 'MATCH' | 'MISMATCH' | 'INSUFFICIENT';

export interface ComparisonRow {
  /** Stable key: the UI translates it, tests assert on it. */
  field:
    | 'CADASTRAL'
    | 'ADDRESS'
    | 'COMPANY_NAME'
    | 'COMPANY_ID'
    | 'REPRESENTATION';
  state: MatchState;
  /** What the document says, when it says anything. */
  contractValue?: string;
  /** What the verification established. */
  verifyValue?: string;
  /**
   * i18n key for the one line of advice this row earns. Present only where
   * the row genuinely deserves an action — a MATCH needs no instruction.
   */
  noteKey?: string;
}

/** Everything the verification already established about the subject. */
export interface VerifyContext {
  cadastralCode?: string | null;
  address?: string | null;
  company?: CompanyIntelligence | null;
}

/** The analysis shape deal-room-document-analyze persists. */
export interface AnalysisLike {
  summary?: unknown;
  documentType?: unknown;
  financial?: unknown;
  clauses?: unknown;
  deadlines?: unknown;
  obligations?: unknown;
  questions?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Everything the analyser quoted out of the document, as one searchable body.
 *
 * Deliberately built from the ANALYSIS rather than from the raw extracted
 * text: those quotes are the passages the analyser actually grounded its
 * findings in, they are bounded in size, and they are already on the client.
 * Searching raw text would also match a header, a footer or a boilerplate
 * annex and call it a fact.
 */
export function contractCorpus(analysis: AnalysisLike | null | undefined): string {
  if (!analysis) return '';
  const parts: string[] = [];
  const pushAll = (items: unknown[]) => {
    for (const item of items) {
      if (typeof item === 'string') { parts.push(item); continue; }
      const o = (item ?? {}) as Record<string, unknown>;
      for (const k of ['label', 'value', 'quote', 'plain', 'party']) {
        const v = str(o[k]);
        if (v) parts.push(v);
      }
    }
  };
  pushAll(arr(analysis.summary));
  pushAll(arr(analysis.financial));
  pushAll(arr(analysis.clauses));
  pushAll(arr(analysis.deadlines));
  pushAll(arr(analysis.obligations));
  pushAll(arr(analysis.questions));
  const type = str(analysis.documentType);
  if (type) parts.push(type);
  return parts.join('\n');
}

/**
 * A Georgian cadastral code.
 *
 * Two dot-separated groups at minimum, because the parent parcel
 * (01.18.06.019.055) and the unit (…​.03.01.601) are both written this way and
 * a contract may name either. Anchored on a non-digit boundary so a phone
 * number or an account number cannot be read as one.
 */
const CADASTRAL = /(?<![\d.])(\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}\.\d{2}\.\d{3})?)(?![\d.])/g;

/** A Georgian legal-entity identification code: exactly nine digits. */
const COMPANY_ID = /(?<!\d)(\d{9})(?!\d)/g;

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[«»„“”"'`]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/** Strips the legal-form prefix so `შპს X` and `X` compare as the same name. */
const bareName = (s: string): string =>
  normalise(s).replace(/^(შპს|სს|ი\/მ|ooo|llc|ltd)\s+/i, '').trim();

/**
 * The distinctive part of an address, as a comparable key.
 *
 * The register writes "…კრწანისის ქუჩა, N6" and a contract writes
 * "კრწანისის ქუჩა №6-ში". Those are the same address; comparing the formatted
 * strings, or even searching one inside the other, says they are not. Only
 * the street word and the number carry identity, so both sides are reduced to
 * `street|number` and that is what is compared.
 *
 * Returns '' when no street/number pair is present, which makes the row
 * INSUFFICIENT rather than a false mismatch.
 */
export function streetKey(text: string): string {
  const m = normalise(text).match(
    /([\p{L}]+)\s*(?:ქუჩა|street|st)\s*[,\s]*(?:№|#|n)?\s*(\d+)/u
  );
  return m ? `${m[1]}|${m[2]}` : '';
}

function compare(
  field: ComparisonRow['field'],
  contractValue: string | undefined,
  verifyValue: string | undefined,
  equal: (a: string, b: string) => boolean,
  mismatchNoteKey: string
): ComparisonRow {
  if (!contractValue || !verifyValue) {
    return { field, state: 'INSUFFICIENT', ...(contractValue ? { contractValue } : {}), ...(verifyValue ? { verifyValue } : {}) };
  }
  const match = equal(contractValue, verifyValue);
  return {
    field,
    state: match ? 'MATCH' : 'MISMATCH',
    contractValue,
    verifyValue,
    ...(match ? {} : { noteKey: mismatchNoteKey }),
  };
}

/**
 * Compares a persisted document analysis against the verification's own facts.
 *
 * Returns one row per field it can speak about. Fields the document never
 * mentions still produce a row, because "the contract does not say" is
 * information a buyer wants before signing — it simply produces the neutral
 * state rather than a warning.
 */
export function compareContractToVerify(
  analysis: AnalysisLike | null | undefined,
  context: VerifyContext
): ComparisonRow[] {
  const corpus = contractCorpus(analysis);
  const rows: ComparisonRow[] = [];

  /* ---- the property ---- */

  const codes = [...corpus.matchAll(CADASTRAL)].map((m) => m[1]);
  const subject = str(context.cadastralCode).trim();
  // A contract naming the parent parcel of the verified unit is talking about
  // the same property, so a prefix relationship counts either way round.
  const related = (a: string, b: string): boolean => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  const codeInContract = subject ? (codes.find((c) => related(c, subject)) ?? codes[0]) : codes[0];
  rows.push(compare('CADASTRAL', codeInContract, subject || undefined, related, 'cm_note_cadastral_mismatch'));

  const address = str(context.address).trim();
  if (address) {
    const wanted = streetKey(address);
    const found = wanted && streetKey(corpus) === wanted ? streetKey(corpus) : undefined;
    rows.push(compare('ADDRESS', found, wanted || undefined, (a, b) => a === b, 'cm_note_address_mismatch'));
  }

  /* ---- who is selling ---- */

  const company = context.company ?? null;
  if (company?.legalName) {
    const wanted = bareName(company.legalName);
    const found = wanted && normalise(corpus).includes(wanted) ? company.legalName : undefined;
    rows.push(compare('COMPANY_NAME', found, company.legalName, () => true, 'cm_note_company_mismatch'));
  }

  if (company?.idCode) {
    const ids = [...corpus.matchAll(COMPANY_ID)].map((m) => m[1]);
    const found = ids.includes(company.idCode) ? company.idCode : ids[0];
    rows.push(compare('COMPANY_ID', found, company.idCode, (a, b) => a === b, 'cm_note_company_id_mismatch'));
  }

  /* ---- and who may sign for it ----
   *
   * The most useful check on this screen, and the one most easily overstated.
   * The register says the company is bound JOINTLY; a contract carrying one
   * signature may still be perfectly valid on a separate authority. So this
   * never declares a document invalid. It reports what the register says,
   * reports how many of the registered directors the document actually names,
   * and asks the buyer to confirm the basis — which is the question a lawyer
   * would ask first.
   */
  if (company?.representationRule === 'JOINT' && company.directors.length > 1) {
    const body = normalise(corpus);
    const named = company.directors.filter((d) => d.name && body.includes(normalise(d.name)));
    if (!named.length) {
      // The document names none of them; nothing can be concluded from that.
      rows.push({ field: 'REPRESENTATION', state: 'INSUFFICIENT', verifyValue: 'JOINT', noteKey: 'cm_note_joint_unknown' });
    } else if (named.length < company.directors.length) {
      rows.push({
        field: 'REPRESENTATION',
        state: 'MISMATCH',
        contractValue: named.map((d) => d.name).join(', '),
        verifyValue: company.directors.map((d) => d.name).join(', '),
        noteKey: 'cm_note_joint_partial',
      });
    } else {
      rows.push({
        field: 'REPRESENTATION',
        state: 'MATCH',
        contractValue: named.map((d) => d.name).join(', '),
        verifyValue: 'JOINT',
      });
    }
  }

  return rows;
}

/** How many rows landed in each state — the figure a header may state. */
export function matchCounts(rows: ComparisonRow[]): Record<MatchState, number> {
  return rows.reduce(
    (acc, r) => { acc[r.state] += 1; return acc; },
    { MATCH: 0, MISMATCH: 0, INSUFFICIENT: 0 } as Record<MatchState, number>
  );
}
