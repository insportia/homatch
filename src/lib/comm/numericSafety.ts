/*
 * A NUMBER THAT CHANGED MAGNITUDE ON ITS WAY THROUGH.
 *
 * Physical test on v110, production session 7d01064e, 2026-09-20 01:53:53Z.
 * The owner said a hundred and twenty THOUSAND. The session stored this:
 *
 *   { currency: "USD", budgetMax: 120000000, locations: ["varketili"] }
 *
 * A hundred and twenty MILLION dollars, for an apartment in Varketili, written
 * into the session as a fact and used as one.
 *
 * WHERE IT HAPPENED, AND WHERE IT DID NOT.
 *
 * Not in the parser: extractDeterministic reads "120 ათასი დოლარი" as 120,000
 * and "120 მილიონი დოლარი" as 120,000,000, both correctly, and it already
 * outranks the model on digits. Not in the arbitration either -- every one of
 * that session's seven turns reported batch_final_chars 0, selected_source
 * LIVE, selection_reason LIVE_ONLY. There was only ever ONE transcript.
 *
 * So the recogniser wrote მილიონი where the speaker said ათასი: one morpheme,
 * and the number it governs moves by a factor of a thousand. Nothing
 * downstream could tell, because nothing downstream was looking.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It does not correct numbers. Guessing that 120,000,000 "meant" 120,000 is
 * the same class of error as the one being fixed, made by us instead of the
 * recogniser. It refuses to let an implausible magnitude become an
 * authoritative property fact, and it notices when two transcripts of one
 * breath disagree about a number -- which is a semantic conflict, not a
 * length difference, and must never be settled by whichever string is longer.
 */

/** A money-shaped quantity found in a transcript, with the scale that governs it. */
export interface Magnitude {
  /** The value as written, after its multiplier. */
  value: number;
  /** The multiplier word that produced it, for reporting a scale conflict. */
  scale: 'unit' | 'thousand' | 'million';
}

const SCALES: Array<{ re: RegExp; scale: Magnitude['scale']; times: number }> = [
  // Georgian, Russian, Turkish, Arabic, Hebrew and English, in that order of
  // how often this product hears them. Stems only: Georgian declines these
  // ("ათასი", "ათასამდე", "ათასზე"), so anchoring the end would miss most of
  // the real sentences.
  { re: /(\d[\d.,]*)\s*(?:ათას|тысяч|тыс\.?|bin|ألف|آلاف|אלף|אלפים|k\b|thousand)/iu, scale: 'thousand', times: 1_000 },
  { re: /(\d[\d.,]*)\s*(?:მილიონ|миллион|млн\.?|milyon|مليون|ملايين|מיליון|m\b|million)/iu, scale: 'million', times: 1_000_000 },
];

const numeric = (raw: string): number => Number(raw.replace(/,/g, '').replace(/\.(?=\d{3}\b)/g, ''));

/**
 * Every money magnitude in a transcript, with the scale word that set it.
 *
 * Scale words only. A bare "120" is a number but not a magnitude claim, and
 * two transcripts differing on a bare number is ordinary recogniser noise --
 * it is the SCALE that moves a price by three orders of magnitude.
 */
export function magnitudes(text: string): Magnitude[] {
  const found: Magnitude[] = [];
  for (const { re, scale, times } of SCALES) {
    const all = new RegExp(re.source, 'giu');
    for (const m of String(text ?? '').matchAll(all)) {
      const n = numeric(m[1]);
      if (Number.isFinite(n)) found.push({ value: n * times, scale });
    }
  }
  return found;
}

/**
 * Do two transcripts of the SAME utterance disagree about a magnitude?
 *
 * Only a scale disagreement counts. One recogniser hearing 120 and the other
 * 121 is noise; one hearing thousand and the other million is two different
 * facts, and the difference between them is the whole incident.
 */
export function numericConflict(a: string, b: string): { conflict: boolean; reason: string | null } {
  const left = magnitudes(a);
  const right = magnitudes(b);
  if (!left.length || !right.length) return { conflict: false, reason: null };

  const scales = (m: Magnitude[]) => [...new Set(m.map((x) => x.scale))].sort().join(',');
  if (scales(left) !== scales(right)) {
    return { conflict: true, reason: `SCALE_DISAGREEMENT:${scales(left)}|${scales(right)}` };
  }
  const biggest = (m: Magnitude[]) => Math.max(...m.map((x) => x.value));
  const l = biggest(left);
  const r = biggest(right);
  // An order of magnitude apart is not two hearings of one number.
  if (l > 0 && r > 0 && (l / r >= 10 || r / l >= 10)) {
    return { conflict: true, reason: `MAGNITUDE_DISAGREEMENT:${l}|${r}` };
  }
  return { conflict: false, reason: null };
}

/*
 * WHAT A HOME IN THIS MARKET CAN COST.
 *
 * Deliberately generous at both ends -- this is a sanity band, not a price
 * model, and it exists to catch a factor-of-a-thousand slip rather than to
 * have an opinion about the market. Tbilisi residential runs from roughly
 * twenty thousand dollars to a few million at the very top; fifty million is
 * far outside anything this assistant will ever legitimately be told, and
 * 120,000,000 is outside it by a factor of more than two.
 *
 * The floor catches the other direction: "120" alone, when the scale word was
 * lost, is not a budget either.
 */
export const BUDGET_FLOOR = 1_000;
export const BUDGET_CEILING = 50_000_000;

export type BudgetVerdict = 'PLAUSIBLE' | 'IMPLAUSIBLY_HIGH' | 'IMPLAUSIBLY_LOW';

export function judgeBudget(value: number | null | undefined): BudgetVerdict | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value > BUDGET_CEILING) return 'IMPLAUSIBLY_HIGH';
  if (value < BUDGET_FLOOR) return 'IMPLAUSIBLY_LOW';
  return 'PLAUSIBLE';
}

/**
 * A budget the session is allowed to treat as a fact.
 *
 * Returns null for an implausible one rather than a corrected number. The
 * session then simply does not know the budget, which is the truth, and asking
 * again costs one short question. Writing 120,000,000 into `budgetMax` cost a
 * whole conversation built on a number nobody said.
 */
export function safeBudget(value: number | null | undefined): { value: number | null; verdict: BudgetVerdict | null } {
  const verdict = judgeBudget(value);
  return { value: verdict === 'PLAUSIBLE' ? (value as number) : null, verdict };
}
