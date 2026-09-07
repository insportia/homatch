// TasTechnicalFacts.ts — 2026-09-07 "TAS DOCUMENT INTELLIGENCE — MAKE IT THE
// PRIMARY TECHNICAL ENGINE" mandate. GENERIC, project-agnostic extraction of
// structured technical facts (architect, structural engineer, foundation,
// MEP, revisions, etc.) out of a TAS official document's own raw text.
//
// GENERALIZATION RULE (explicit in the mandate): this file recognizes the
// GOVERNMENT FORM'S OWN FIELD LABELS (standard Georgian bureaucratic terms
// that appear on TAS permit/decision documents for ANY project) — never a
// specific project's VALUES. Recognizing "მთავარი არქიტექტორის სახელი და
// გვარი:" as a label is exactly the kind of "discover labels dynamically"
// work the mandate asks for; it is not the same thing as hardcoding
// "Villion" or "45 ხიმინჯი" — those would only ever come out the other end,
// as a VALUE this module found attached to a label, never baked into the
// label table itself. No project name, developer name, block name, pile
// count, or document count appears anywhere below.
//
// Pure, no I/O — safe to unit-test directly (not excluded by
// tsconfig.test.json, unlike the Playwright-touching files that call it).

export type TasTechnicalFactCategory =
  | 'PROJECT'
  | 'ARCHITECT'
  | 'STRUCTURAL'
  | 'GEOTECHNICAL'
  | 'FOUNDATION'
  | 'MEP'
  | 'LANDSCAPE'
  | 'MATERIAL'
  | 'PERMIT'
  | 'REVISION'
  | 'OWNER'
  | 'APPLICANT'
  | 'SUPERVISION'
  | 'OTHER';

export interface TasTechnicalFact {
  category: TasTechnicalFactCategory;
  key: string;
  value: string;
  /** HIGH: value found inline on the same line as its label (the form was
   * filled in directly next to the field). MEDIUM: value found on the
   * nearest following non-empty line (label and value rendered as separate
   * DOM nodes/table cells, a documented common pattern on these forms). */
  confidence: 'HIGH' | 'MEDIUM';
  /** The exact label text matched, kept for traceability/debugging — never
   * shown to a customer directly. */
  rawLabel: string;
}

interface LabelRule {
  re: RegExp;
  category: TasTechnicalFactCategory;
  key: string;
  /** When true, a match on this line becomes the "current role context" for
   * generic attribute labels (ორგანიზაცია/საიდენტიფიკაციო კოდი) that follow
   * on subsequent lines, until the next context-setting label is hit. */
  setsContext?: boolean;
}

// Context-setting role/section labels — specific enough on their own to
// name a category, and they also establish which category a following
// generic "ორგანიზაცია"/"საიდენტიფიკაციო კოდი" line belongs to.
const CONTEXT_LABEL_RULES: LabelRule[] = [
  { re: /მთავარი\s+არქიტექტორ(?:ის|ი)?\s*(?:\/?\s*სპეციალისტის)?\s*სახელი\s+და\s+გვარი/i, category: 'ARCHITECT', key: 'mainArchitectName', setsContext: true },
  { re: /თანაავტორ(?:ი|ები|თა)?/i, category: 'ARCHITECT', key: 'coAuthors', setsContext: true },
  { re: /არქიტექტურული\s+შესაბამისობის\s+სპეციალისტი/i, category: 'ARCHITECT', key: 'architecturalComplianceSpecialist', setsContext: true },
  { re: /კონსტრუქციული\s+დასკვნის\s+სპეციალისტი/i, category: 'STRUCTURAL', key: 'structuralReviewSpecialist', setsContext: true },
  { re: /ფუძეების?\s*\/?\s*საძირკვლების\s+საექსპერტო\s+შეფასება/i, category: 'FOUNDATION', key: 'foundationExpertAssessment', setsContext: true },
  { re: /საინჟინრო-?\s*გეოლოგიური\s+კვლევის\s+სპეციალისტი/i, category: 'GEOTECHNICAL', key: 'geotechnicalSpecialist', setsContext: true },
  { re: /მშენებლობის\s+ორგანიზების\s+გრაფიკის\s+სპეციალისტი/i, category: 'SUPERVISION', key: 'constructionScheduleSpecialist', setsContext: true },
];

// Standalone fact labels — extracted independently of any surrounding
// context (each is specific enough to stand alone).
const STANDALONE_LABEL_RULES: LabelRule[] = [
  { re: /საპროექტო\s+ობიექტის\s+კონსტრუქციული\s+სქემა/i, category: 'STRUCTURAL', key: 'structuralScheme' },
  { re: /მაქსიმალური\s+კონსტრუქციული\s+მალი/i, category: 'STRUCTURAL', key: 'maxStructuralSpan' },
  { re: /საექსპერტო\s+შეფასების\s+ავტორი/i, category: 'OTHER', key: 'expertAssessmentAuthor' },
  { re: /ზედამხედველობ(?:ა|ას|ის)?\s+(?:ახორციელებს|ახორციელებდა)|ტექნიკური\s+ზედამხედველი/i, category: 'SUPERVISION', key: 'supervisionRole' },
  { re: /საძირკვლის\s+ტიპი/i, category: 'FOUNDATION', key: 'foundationType' },
  { re: /ხიმინჯ(?:ი|ები|ების|ისა)?/i, category: 'FOUNDATION', key: 'piles' },
  { re: /საინჟინრო-?\s*გეოლოგიური\s+კვლევა/i, category: 'GEOTECHNICAL', key: 'geologicalSurvey' },
  { re: /\bK1\b/, category: 'PERMIT', key: 'K1' },
  { re: /\bK2\b/, category: 'PERMIT', key: 'K2' },
  { re: /\bK3\b/, category: 'PERMIT', key: 'K3' },
  { re: /სართულ(?:ების|ის)?\s+რაოდენობა|სართულიანობა/i, category: 'PROJECT', key: 'floors' },
  { re: /შენობის\s+სიმაღლე/i, category: 'PROJECT', key: 'height' },
  { re: /სიღრმე/i, category: 'PROJECT', key: 'depth' },
  { re: /საერთო\s+ფართ(?:ი|ობა)|შენობის\s+საერთო\s+ფართ(?:ი|ობა)/i, category: 'PROJECT', key: 'totalArea' },
  { re: /საცხოვრებელი\s+ფართ(?:ი|ობა)/i, category: 'PROJECT', key: 'residentialArea' },
  { re: /კომერციული\s+ფართ(?:ი|ობა)/i, category: 'PROJECT', key: 'commercialArea' },
  { re: /პარკინგის\s+ფართ(?:ი|ობა)/i, category: 'PROJECT', key: 'parkingArea' },
  { re: /შენობის\s+კლას(?:ი|ის)|შენობის\s+კატეგორია/i, category: 'PROJECT', key: 'buildingClass' },
  { re: /ლიფტ(?:ი|ები|ების)?/i, category: 'MEP', key: 'elevator' },
  { re: /შენობის\s+ფუნქცია|დანიშნულება/i, category: 'PROJECT', key: 'buildingFunction' },
  { re: /(?:საპროექტო\s+)?პროექტის\s+რედაქცია/i, category: 'REVISION', key: 'projectRevision' },
  { re: /ნებართვის\s+რედაქცია/i, category: 'REVISION', key: 'permitRevision' },
  { re: /განმცხადებელი/i, category: 'APPLICANT', key: 'applicant' },
  { re: /ნაკვეთის\s+მესაკუთრე|მიწის\s+მესაკუთრე/i, category: 'OWNER', key: 'parcelOwner' },
];

// Generic attribute labels that only mean something in combination with a
// role/section context already established by CONTEXT_LABEL_RULES above —
// "ორგანიზაცია" alone could belong to the architect, the structural
// engineer, or the applicant, so it is tagged with whatever context is
// currently active rather than dumped into a meaningless top-level bucket.
const CONTEXTUAL_ATTRIBUTE_RULES: { re: RegExp; key: string }[] = [
  { re: /^\s*ორგანიზაცია/i, key: 'organization' },
  { re: /საიდენტიფიკაციო\s*(?:კოდი|ნომერი)/i, key: 'idCode' },
];

const PLACEHOLDER_VALUE_RE = /^[\s\-_.:։]{0,20}$/;
const NON_VALUE_PHRASES_RE = /^(N\/A|არ\s+არის\s+მითითებული|არ\s+მითითებულა|not\s+specified)$/i;

function isMeaningfulValue(candidate: string, rawLabel: string): boolean {
  const v = candidate.trim();
  if (!v) return false;
  if (PLACEHOLDER_VALUE_RE.test(v)) return false;
  if (NON_VALUE_PHRASES_RE.test(v)) return false;
  // A "value" that is really just the label repeated (a blank form
  // template) is not evidence of anything filled in.
  if (v.toLowerCase() === rawLabel.trim().toLowerCase()) return false;
  return true;
}

/** Strips a matched label (and any immediately following ':'/'-'/'—'
 * separator) off the front of a line, returning whatever text remains on
 * that same line — the candidate same-line value. */
function sameLineValue(line: string, match: RegExpExecArray): string {
  const after = line.slice(match.index + match[0].length);
  return after.replace(/^\s*[:：\-—።]\s*/, '').trim();
}

const MAX_CONTEXT_LOOKAHEAD_LINES = 6;

/**
 * Extracts structured technical facts from a TAS document's raw text.
 * Generic across ANY cadastral code/project — recognizes only the official
 * form's own field labels (see file header), never a specific project's
 * values. Returns [] for text with no recognizable official-form structure
 * at all (e.g. a cover letter, a stamp-only scan) — never a guessed fact.
 */
export function extractTasTechnicalFacts(rawText: string | null | undefined): TasTechnicalFact[] {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const facts: TasTechnicalFact[] = [];
  let currentContext: TasTechnicalFactCategory | null = null;
  let linesSinceContext = 0;

  const allLabelRules = [...CONTEXT_LABEL_RULES, ...STANDALONE_LABEL_RULES];
  const isAnyLabelLine = (line: string): boolean => allLabelRules.some((r) => r.re.test(line)) || CONTEXTUAL_ATTRIBUTE_RULES.some((r) => r.re.test(line));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    let matchedThisLine = false;
    for (const rule of allLabelRules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      matchedThisLine = true;
      const inline = sameLineValue(line, m);
      if (isMeaningfulValue(inline, m[0])) {
        facts.push({ category: rule.category, key: rule.key, value: inline, confidence: 'HIGH', rawLabel: m[0] });
      } else {
        // Look ahead to the nearest non-empty line that is not itself
        // another label (never let one field's label be consumed as the
        // previous field's value).
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const candidate = lines[j];
          if (!candidate || !candidate.trim()) continue;
          if (isAnyLabelLine(candidate)) break;
          if (isMeaningfulValue(candidate, m[0])) facts.push({ category: rule.category, key: rule.key, value: candidate.trim(), confidence: 'MEDIUM', rawLabel: m[0] });
          break;
        }
      }
      if (rule.setsContext) {
        currentContext = rule.category;
        linesSinceContext = 0;
      }
    }

    if (!matchedThisLine && currentContext) {
      for (const attr of CONTEXTUAL_ATTRIBUTE_RULES) {
        const m = attr.re.exec(line);
        if (!m) continue;
        const inline = sameLineValue(line, m);
        if (isMeaningfulValue(inline, m[0])) {
          facts.push({ category: currentContext, key: attr.key, value: inline, confidence: 'HIGH', rawLabel: m[0] });
        } else {
          for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
            const candidate = lines[j];
            if (!candidate || !candidate.trim()) continue;
            if (isAnyLabelLine(candidate)) break;
            if (isMeaningfulValue(candidate, m[0])) facts.push({ category: currentContext, key: attr.key, value: candidate.trim(), confidence: 'MEDIUM', rawLabel: m[0] });
            break;
          }
        }
      }
    }

    linesSinceContext++;
    // A role context does not apply indefinitely — once enough lines have
    // passed with no reinforcing label, generic attributes revert to being
    // ambiguous (dropped) rather than mis-attributed to a stale role.
    if (currentContext && linesSinceContext > MAX_CONTEXT_LOOKAHEAD_LINES) currentContext = null;
  }

  return facts;
}

/** Deduplicates facts (same category+key+value pair) that can legitimately
 * repeat across a document's several pages/sections — keeps the
 * highest-confidence occurrence. */
export function dedupeTasTechnicalFacts(facts: TasTechnicalFact[]): TasTechnicalFact[] {
  const byKey = new Map<string, TasTechnicalFact>();
  for (const f of facts) {
    const k = `${f.category}:${f.key}:${f.value.trim().toLowerCase()}`;
    const existing = byKey.get(k);
    if (!existing || (existing.confidence === 'MEDIUM' && f.confidence === 'HIGH')) byKey.set(k, f);
  }
  return [...byKey.values()];
}
