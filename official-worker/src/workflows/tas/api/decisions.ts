// decisions.ts — what an official TAS response actually DECIDED.
//
// A motion's response document (NewArchitectureResponse: PDF or HTML) is the
// municipality's answer to an application. Its legal effect — permit issued,
// project approved, application refused, deficiencies to fix, intermediate
// answer, suspension, cancellation, deadline extension — is what decides the
// property's current official situation, not the upload date of a file.
//
// Deterministic and conservative: an outcome is assigned only when the
// response text itself carries the operative wording. Otherwise the outcome
// is UNDETERMINED, which downstream treats as "do not infer".
//
// The owner's live research confirmed the shape for document 639208 /
// motion 4304382: decision number 4303543, issue date 13/12/2018, result
// "intermediate". Exact phrasings across all response templates are NOT
// live-verified from this repository; every pattern below is a government
// form phrase, never a project-specific value.

export type DecisionOutcome =
  | 'PERMIT_ISSUED'
  | 'APPROVED'
  | 'AMENDMENT_APPROVED'
  | 'DEADLINE_EXTENDED'
  | 'COMMISSIONED'
  | 'INTERMEDIATE'
  | 'DEFICIENCY'
  | 'REFUSED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'INFORMATIONAL'
  | 'UNDETERMINED';

export interface ExtractedDecision {
  number: string | null;
  issueDate: string | null;
  outcome: DecisionOutcome;
  /** The operative phrase that established the outcome (≤ 240 chars). */
  evidence: string | null;
  /** A permit / deadline date the decision itself states, when present. */
  validUntil: string | null;
}

/**
 * Ordered most-specific first. Refusal/cancellation wording outranks a
 * generic "decision" so a refusal is never read as an approval.
 */
const OUTCOME_RULES: Array<{ outcome: DecisionOutcome; re: RegExp }> = [
  { outcome: 'CANCELLED', re: /(ბათილად\s+იქნეს\s+ცნობილი|ბათილად\s+ცნობ|გაუქმდეს|გაუქმებულ\s+იქნეს|ძალადაკარგულად|revoked|cancelled|отменить|аннулир)/i },
  { outcome: 'SUSPENDED', re: /(შეჩერდეს|შეჩერებულ\s+იქნეს|suspended|приостановить)/i },
  { outcome: 'REFUSED', re: /(უარი\s+ეთქვა|უარი\s+ეთქვას|უარყოფილ|არ\s+დაკმაყოფილდეს|refused|rejected|отказать)/i },
  { outcome: 'DEFICIENCY', re: /(ხარვეზ|ხარვეზის\s+აღმოფხვრ|deficienc|недостат)/i },
  { outcome: 'INTERMEDIATE', re: /(შუალედური|intermediate|промежуточн)/i },
  { outcome: 'COMMISSIONED', re: /(ექსპლუატაციაში\s+მიღებ|ექსპლუატაციაში\s+შეყვან|commission|ввод\s+в\s+эксплуатац)/i },
  { outcome: 'DEADLINE_EXTENDED', re: /(ვადა\s+გაგრძელდ(?:ეს|ა)|ვადის\s+გაგრძელებ|extension\s+of\s+the\s+(permit|deadline)|продлить\s+срок)/i },
  { outcome: 'AMENDMENT_APPROVED', re: /(ცვლილებ\S*\s+შეთანხმდეს|ცვლილება\s+დამტკიცდეს|შეთანხმდეს\s+ცვლილ|amendment\s+approved|изменени\S*\s+согласова)/i },
  { outcome: 'PERMIT_ISSUED', re: /(ნებართვა\s+გაიცეს|გაიცეს\s+\S*\s*ნებართვა|მშენებლობის\s+ნებართვის\s+გაცემ|permit\s+(is\s+)?issued|выдать\s+разрешени)/i },
  { outcome: 'APPROVED', re: /(დაკმაყოფილდეს|შეთანხმდეს|დამტკიცდეს|approved|утвердить|согласовать)/i },
];

const DECISION_NUMBER = /(?:ბრძანებ\S*|გადაწყვეტილებ\S*|decision|order|приказ|решени\S*)\s*(?:№|N|No\.?|#)\s*([0-9][0-9\-/]{2,20})/i;
const ANY_NUMBER_NEAR = /(?:№|N|No\.?)\s*([0-9]{5,12})/;
const DATE = /(\d{1,2})[./](\d{1,2})[./](\d{4})/;

function isoDay(d: RegExpExecArray | null): string | null {
  if (!d || +d[2] < 1 || +d[2] > 12 || +d[1] < 1 || +d[1] > 31) return null;
  return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
}

function around(text: string, index: number, len = 240): string {
  const start = Math.max(0, index - 80);
  return text.slice(start, start + len).replace(/\s+/g, ' ').trim();
}

/** Read the operative decision from an official response's text. */
export function extractDecision(text: string | null | undefined): ExtractedDecision {
  const t = String(text ?? '');
  if (t.trim().length < 20) return { number: null, issueDate: null, outcome: 'UNDETERMINED', evidence: null, validUntil: null };
  const head = t.slice(0, 6000);
  const numberMatch = DECISION_NUMBER.exec(head) ?? ANY_NUMBER_NEAR.exec(head);
  const dateMatch = DATE.exec(head);
  let outcome: DecisionOutcome = 'UNDETERMINED';
  let evidence: string | null = null;
  for (const rule of OUTCOME_RULES) {
    const m = rule.re.exec(t);
    if (m) {
      outcome = rule.outcome;
      evidence = around(t, m.index);
      break;
    }
  }
  if (outcome === 'UNDETERMINED' && /(ინფორმაცია|ცნობა|განმარტება|information|reply|ответ)/i.test(head)) outcome = 'INFORMATIONAL';
  // A validity / deadline date stated next to deadline wording.
  const vm = /(ვად\S*|მოქმედ\S*|deadline|valid\s+until|срок)[^0-9]{0,40}(\d{1,2})[./](\d{1,2})[./](\d{4})/i.exec(t);
  const validUntil = vm ? isoDay([vm[0], vm[2], vm[3], vm[4]] as unknown as RegExpExecArray) : null;
  return { number: numberMatch ? numberMatch[1] : null, issueDate: isoDay(dateMatch), outcome, evidence, validUntil };
}

/** Legal weight of an outcome for "what is the current official situation". */
export const OUTCOME_AUTHORITY: Record<DecisionOutcome, number> = {
  CANCELLED: 100,
  SUSPENDED: 95,
  COMMISSIONED: 90,
  PERMIT_ISSUED: 85,
  AMENDMENT_APPROVED: 80,
  DEADLINE_EXTENDED: 75,
  REFUSED: 70,
  APPROVED: 65,
  DEFICIENCY: 40,
  INTERMEDIATE: 35,
  INFORMATIONAL: 10,
  UNDETERMINED: 0,
};
