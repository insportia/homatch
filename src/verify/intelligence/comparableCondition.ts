// HOMATCH — what state a flat is actually in.
//
// In Georgia this is not a detail, it is most of the price. A black frame is
// bare concrete; a green frame has screed, plaster and utilities brought to
// the door; a white frame is ready to decorate; a renovated flat you can move
// into. The gap between the ends of that ladder is routinely thirty or forty
// per cent of the price per square metre.
//
// Which makes the comparison the report does on the buyer's behalf worthless
// if it ignores it. Reading a renovated flat's asking price against a median
// built from green-frame listings and calling the result "a 28% premium" is
// not an error of precision — it is the wrong answer, delivered confidently.
//
// The research layer returns condition as free text, and a look at what is
// actually in production shows why nothing downstream could use it: thirteen
// distinct spellings across two scripts for what are really five states,
// including "მწვანე კარკასი", "green frame", "პრემიუმ მწვანე კარკასი" and
// "შავი/მწვანე კარკასი" — all the same rung, written four ways.
//
// So this normalises to a ladder. It does NOT price the rungs: no monetary
// adjustment is invented anywhere in this module, because the data does not
// support one. Knowing that two things are not comparable is worth stating
// on its own.

/**
 * The ladder, bare to finished.
 *
 * Ordered, because the distance between two rungs is the useful quantity —
 * a green frame and a white frame are neighbours, a black frame and a
 * renovated flat are not the same product at all.
 */
export const CONDITION_LADDER = [
  'BLACK_FRAME',
  'GREEN_FRAME',
  'WHITE_FRAME',
  'RENOVATED',
  'NEWLY_RENOVATED',
] as const;

export type ConditionGrade = (typeof CONDITION_LADDER)[number];

/*
 * Patterns, most specific first, because the loose ones overlap.
 *
 * "შავი/მწვანე კარკასი" — offered as either — must not be read as a plain
 * black frame, and "ახალი გარემონტებული" must not match the older-renovation
 * pattern that shares a word with it. Order is the whole mechanism, so each
 * entry says what it is doing here rather than only what it matches.
 */
const PATTERNS: ReadonlyArray<readonly [ConditionGrade, RegExp]> = [
  // Explicitly new work. Checked before the general renovation pattern,
  // which its words also satisfy.
  ['NEWLY_RENOVATED', /ახალი\s*(გა)?რემონტ|ახალი\s*რემონტით|newly\s*renovated|brand[-\s]?new\s*renovation/u],
  // An older renovation. Real, liveable, and not the same as new work.
  ['RENOVATED', /ძველი\s*(გა)?რემონტ|გარემონტებულ|რემონტით|renovated|refurbished/u],
  // Finished to a habitable standard without the word "renovation".
  ['RENOVATED', /დასრულებულ|turn[-\s]?key|move[-\s]?in\s*ready|ready\s*to\s*(live|move)/u],
  ['WHITE_FRAME', /თეთრი\s*კარკას|white\s*frame/u],
  // Offered as either black or green: the safe reading is the LOWER rung,
  // because that is what a buyer is guaranteed to be getting.
  ['BLACK_FRAME', /შავი\s*\/\s*მწვანე|შავი\s*ან\s*მწვანე|black\s*\/\s*green/u],
  ['GREEN_FRAME', /მწვანე\s*კარკას|green\s*frame/u],
  ['BLACK_FRAME', /შავი\s*კარკას|black\s*frame|bare\s*shell/u],
];

/**
 * The rung a free-text condition sits on, or null.
 *
 * Null is a real answer and the common one: roughly a third of production
 * comparables carry no condition at all. Null must never be treated as any
 * particular state — an unlabelled listing is unknown, not bare, and not
 * finished.
 */
export function conditionGrade(raw: unknown): ConditionGrade | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  /*
   * Idempotent: a value that is already a rung comes back as itself.
   *
   * Not decoration. A ScoredComparable carries the NORMALISED grade, so
   * anything downstream that reads one and asks this question again — the
   * condition mix does exactly that — would otherwise get null for every
   * listing and report a set of known conditions as entirely unknown. Caught
   * that way, by a test asserting a mismatch that had silently stopped being
   * detectable.
   */
  const alreadyAGrade = CONDITION_LADDER.find((g) => g.toLowerCase() === t);
  if (alreadyAGrade) return alreadyAGrade;
  for (const [grade, re] of PATTERNS) {
    if (re.test(t)) return grade;
  }
  return null;
}

/**
 * How far apart two states are on the ladder, or null when either is unknown.
 *
 * 0 is the same rung, 4 is bare concrete against a new renovation.
 */
export function conditionDistance(a: unknown, b: unknown): number | null {
  const ga = conditionGrade(a);
  const gb = conditionGrade(b);
  if (!ga || !gb) return null;
  return Math.abs(CONDITION_LADDER.indexOf(ga) - CONDITION_LADDER.indexOf(gb));
}

/** What the set of comparables is actually made of. Counts only, never a guess. */
export interface ConditionMix {
  /** How many comparables sit on each rung. Unknown ones are not here. */
  grades: Partial<Record<ConditionGrade, number>>;
  /** Comparables whose condition was never stated. */
  unknown: number;
  /**
   * The rung most of the comparables sit on, when one clearly dominates.
   *
   * Only set when a single rung holds more than half of the comparables whose
   * condition IS known, and at least two do. A plurality of three listings
   * split 2/1 is not a characterisation of a market.
   */
  dominant: ConditionGrade | null;
}

export function conditionMix(conditions: readonly unknown[]): ConditionMix {
  const grades: Partial<Record<ConditionGrade, number>> = {};
  let unknown = 0;
  for (const c of conditions) {
    const g = conditionGrade(c);
    if (!g) { unknown += 1; continue; }
    grades[g] = (grades[g] ?? 0) + 1;
  }
  const known = Object.values(grades).reduce((a, b) => a + b, 0);
  let dominant: ConditionGrade | null = null;
  if (known >= 2) {
    for (const g of CONDITION_LADDER) {
      if ((grades[g] ?? 0) * 2 > known) { dominant = g; break; }
    }
  }
  return { grades, unknown, dominant };
}
