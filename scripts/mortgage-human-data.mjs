/*
 * The humanised Mortgage copy, in six parts, applied by
 * scripts/mortgage-human-apply.mjs.
 *
 * WHY IT IS SPLIT
 *
 * One file of this size is unreviewable, and the six parts are six
 * different jobs: the page and its answer, the checklist, the contract
 * topics, the state subsidy, the page furniture, and the advanced
 * inputs the browser gate caught after the rest was written.
 * Each part's header says what was wrong with the copy it replaces,
 * which is the part worth reading before changing any of it.
 *
 * THE STANDARD ALL SIX ARE HELD TO
 *
 * A person who has never taken a loan understands every sentence the
 * first time. In Georgian specifically: second person singular, one
 * thought per sentence, no semicolons, no em dashes, no heading ending
 * in a full stop, no parenthesis carrying an internal label, and none
 * of the constructions that mark a sentence as translated rather than
 * written — "არა მხოლოდ X, არამედ Y", "მნიშვნელოვანია აღინიშნოს",
 * "შესაბამისად", "აღნიშნული".
 *
 * The subsidy questions are the one deliberate exception to the
 * singular: they ask about a household, the owner wrote them in the
 * plural, and a question addressed to two people reads better that way.
 */
import { PART_1 } from './mortgage-human-data-1.mjs';
import { PART_2 } from './mortgage-human-data-2.mjs';
import { PART_3 } from './mortgage-human-data-3.mjs';
import { PART_4 } from './mortgage-human-data-4.mjs';
import { PART_5 } from './mortgage-human-data-5.mjs';
import { PART_6 } from './mortgage-human-data-6.mjs';

const PARTS = [PART_1, PART_2, PART_3, PART_4, PART_5, PART_6];

/* A key written twice in two parts would silently take whichever came
   last, and the two authors would each believe theirs was live. */
const seen = new Set();
for (const part of PARTS) {
  for (const key of Object.keys(part)) {
    if (seen.has(key)) {
      console.error(`[mortgage-human] FATAL: "${key}" is defined in more than one part`);
      process.exit(1);
    }
    seen.add(key);
  }
}

export const MORTGAGE_HUMAN_STRINGS = Object.assign({}, ...PARTS);
