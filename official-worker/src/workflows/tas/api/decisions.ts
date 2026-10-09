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

type Polarity = 'NEGATIVE' | 'PENDING' | 'POSITIVE' | 'NEUTRAL';

const POLARITY: Record<DecisionOutcome, Polarity> = {
  CANCELLED: 'NEGATIVE',
  SUSPENDED: 'NEGATIVE',
  REFUSED: 'NEGATIVE',
  DEFICIENCY: 'PENDING',
  INTERMEDIATE: 'PENDING',
  COMMISSIONED: 'POSITIVE',
  DEADLINE_EXTENDED: 'POSITIVE',
  AMENDMENT_APPROVED: 'POSITIVE',
  PERMIT_ISSUED: 'POSITIVE',
  APPROVED: 'POSITIVE',
  INFORMATIONAL: 'NEUTRAL',
  UNDETERMINED: 'NEUTRAL',
};

/**
 * Ordered most-specific first (the order breaks ties WITHIN one polarity).
 * `weak` marks wording that routinely appears as a side clause — e.g. an
 * amendment order declaring the PREVIOUS order void — and only decides when
 * no other operative wording is present.
 */
const OUTCOME_RULES: Array<{ outcome: DecisionOutcome; re: RegExp; weak?: boolean }> = [
  { outcome: 'CANCELLED', re: /(ბათილად\s+იქნეს\s+ცნობილი|ბათილად\s+ცნობ|გაუქმდეს|გაუქმებულ\s+იქნეს|revoked|cancelled|отменить|аннулир)/giu },
  { outcome: 'CANCELLED', re: /(ძალადაკარგულად)/giu, weak: true },
  { outcome: 'SUSPENDED', re: /(შეჩერდეს|შეჩერებულ\s+იქნეს|suspended|приостановить)/giu },
  { outcome: 'REFUSED', re: /(უარი\s+ეთქვა|უარი\s+ეთქვას|უარის\s+თქმ|უარყოფილ|refused|rejected|отказать)/giu },
  { outcome: 'DEFICIENCY', re: /(ხარვეზ|deficienc|недостат)/giu },
  { outcome: 'INTERMEDIATE', re: /(შუალედური|intermediate|промежуточн)/giu },
  { outcome: 'COMMISSIONED', re: /(ექსპლუატაციაში\s+მიღებ|ექსპლუატაციაში\s+შეყვან|commissioned|ввод\s+в\s+эксплуатац)/giu },
  { outcome: 'DEADLINE_EXTENDED', re: /(ვადა\s+გაგრძელდ(?:ეს|ა)|ვადის\s+გაგრძელებ|extension\s+of\s+the\s+(?:permit|deadline)|продлить\s+срок)/giu },
  { outcome: 'AMENDMENT_APPROVED', re: /(ცვლილებ\S*\s+შეთანხმდეს|ცვლილება\s+დამტკიცდეს|შეთანხმდეს\s+ცვლილ|amendment\s+approved|изменени\S*\s+согласова)/giu },
  { outcome: 'PERMIT_ISSUED', re: /(ნებართვა\s+გაიცეს|გაიცეს\s+\S*\s*ნებართვა|მშენებლობის\s+ნებართვის\s+გაცემის\s+შესახებ|permit\s+(?:is\s+)?issued|выдать\s+разрешени)/giu },
  { outcome: 'APPROVED', re: /(დაკმაყოფილდეს|შეთანხმდეს|დამტკიცდეს|approved|утвердить|согласовать)/giu },
];

/** The words that open the operative (resolution) part of an order. */
const OPERATIVE_MARKER = /(ვბრძანებ|გადაწყდა|გადაწყვიტა|დაადგინა|ვადგენ|it\s+is\s+(?:hereby\s+)?(?:ordered|decided)|resolved|приказываю|постановля|решил)/iu;
/** "not …" right before a verb: a negated approval is a refusal; a negated sanction is nothing. */
const NEGATED = /(?:^|[\s,.;:])(?:არ|ვერ|not|не)\s+$/iu;
/** Conditional / informational boilerplate: "may be suspended", "in case of …". */
const CONDITIONAL = /(?:^|[\s,(])(?:შეიძლება|შესაძლოა|შემთხვევაში|თუ|may\s+be|could\s+be|in\s+case|может\s+быть|в\s+случае)\s[^.;\n]{0,60}$/iu;
/** "ხარვეზი არ გამოვლინდა": a deficiency that was NOT found. */
const NOT_FOUND_AFTER = /^\S*\s+(?:არ|ვერ)\s+(?:გამოვლინდ|დაფიქსირდ|აღმოჩნდ|არსებობ)/iu;

/** Title (first lines) + the operative part when it is marked; otherwise the whole text. */
function operativeText(t: string): string {
  const m = OPERATIVE_MARKER.exec(t);
  if (!m) return t;
  return `${t.slice(0, Math.min(400, m.index))}\n${t.slice(m.index, m.index + 4000)}`;
}

interface RuleHit { outcome: DecisionOutcome; index: number; weak: boolean }

function collectHits(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of OUTCOME_RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const positive = POLARITY[rule.outcome] === 'POSITIVE';
      if (NEGATED.test(before)) {
        // "არ დაკმაყოფილდეს / არ შეთანხმდეს" is a refusal; "არ გაუქმდეს" is not a cancellation.
        if (positive) hits.push({ outcome: 'REFUSED', index: m.index, weak: false });
        continue;
      }
      if (CONDITIONAL.test(before)) continue;
      if (rule.outcome === 'DEFICIENCY' && NOT_FOUND_AFTER.test(after)) continue;
      hits.push({ outcome: rule.outcome, index: m.index, weak: !!rule.weak });
    }
  }
  return hits;
}

/**
 * Resolve the hits conservatively:
 *  - weak wording decides only alone;
 *  - NEGATIVE and POSITIVE operative wording together → UNDETERMINED (never guess);
 *  - PENDING with POSITIVE → the PENDING outcome (it establishes nothing);
 *  - otherwise the most specific rule in OUTCOME_RULES order.
 */
function resolveHits(hits: RuleHit[]): { outcome: DecisionOutcome; hit: RuleHit | null; conflicting: boolean } {
  if (!hits.length) return { outcome: 'UNDETERMINED', hit: null, conflicting: false };
  const strong = hits.filter((h) => !h.weak);
  const pool = strong.length ? strong : hits;
  const polarities = new Set(pool.map((h) => POLARITY[h.outcome]));
  if (polarities.has('NEGATIVE') && polarities.has('POSITIVE')) return { outcome: 'UNDETERMINED', hit: pool[0], conflicting: true };
  const preferred: Polarity = polarities.has('NEGATIVE') ? 'NEGATIVE' : polarities.has('PENDING') ? 'PENDING' : 'POSITIVE';
  const order = OUTCOME_RULES.map((r) => r.outcome);
  const best = pool
    .filter((h) => POLARITY[h.outcome] === preferred)
    .sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome) || a.index - b.index)[0];
  return { outcome: best.outcome, hit: best, conflicting: false };
}

const DECISION_NUMBER = /(?:ბრძანებ\S*|გადაწყვეტილებ\S*|decision|order|приказ|решени\S*)\s*(?:№|N|No\.?|#)\s*([0-9][0-9\-/]{2,20})/iu;
const ANY_NUMBER_NEAR = /(?:№|N|No\.?)\s*([0-9]{5,12})/u;
const DATE = /(\d{1,2})[./](\d{1,2})[./](\d{4})/u;

function isoDay(d: RegExpExecArray | string[] | null): string | null {
  if (!d || +d[2] < 1 || +d[2] > 12 || +d[1] < 1 || +d[1] > 31) return null;
  return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
}

function around(text: string, index: number, len = 240): string {
  const start = Math.max(0, index - 80);
  return text.slice(start, start + len).replace(/\s+/g, ' ').trim();
}

/**
 * The issue date is accepted only when it sits next to the decision number
 * (within 60 chars after it, or 30 before). A date elsewhere in the text is
 * usually a quoted application or an earlier permit, and the motion's own
 * date is the safer chronology anchor.
 */
function issueDateNear(head: string, numberMatch: RegExpExecArray | null): string | null {
  if (!numberMatch) return null;
  const end = numberMatch.index + numberMatch[0].length;
  const afterWindow = head.slice(end, end + 60);
  const after = DATE.exec(afterWindow);
  if (after) return isoDay(after);
  const beforeWindow = head.slice(Math.max(0, numberMatch.index - 30), numberMatch.index);
  const all = [...beforeWindow.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{4})/gu)];
  return all.length ? isoDay(all[all.length - 1] as unknown as string[]) : null;
}

/** Read the operative decision from an official response's text. */
export function extractDecision(text: string | null | undefined): ExtractedDecision {
  const t = String(text ?? '');
  if (t.trim().length < 20) return { number: null, issueDate: null, outcome: 'UNDETERMINED', evidence: null, validUntil: null };
  const head = t.slice(0, 6000);
  const numberMatch = DECISION_NUMBER.exec(head) ?? ANY_NUMBER_NEAR.exec(head);
  const { outcome: resolved, hit } = resolveHits(collectHits(operativeText(t)));
  let outcome = resolved;
  const op = operativeText(t);
  const evidence = hit ? around(op, hit.index) : null;
  if (outcome === 'UNDETERMINED' && !hit && /(ინფორმაცია|ცნობა|განმარტება|information|reply|ответ)/iu.test(head)) outcome = 'INFORMATIONAL';
  // A validity / deadline date stated next to deadline wording.
  const vm = /(ვად\S*|მოქმედ\S*|deadline|valid\s+until|срок)[^0-9]{0,40}(\d{1,2})[./](\d{1,2})[./](\d{4})/iu.exec(t);
  const validUntil = vm ? isoDay([vm[0], vm[2], vm[3], vm[4]]) : null;
  return { number: numberMatch ? numberMatch[1] : null, issueDate: issueDateNear(head, numberMatch), outcome, evidence, validUntil };
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
