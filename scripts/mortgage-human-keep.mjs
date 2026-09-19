/**
 * "This language already says it correctly; leave it alone."
 *
 * Part 7 fixes a Georgian register and an English dash on copy whose
 * Russian, Turkish, Arabic and Hebrew were written and reviewed when it
 * shipped and remain correct. Retyping four languages to move a piece of
 * punctuation is how a good translation acquires a mistake.
 *
 * In its own module because the parts import it and the index imports
 * the parts: put it in the index and the cycle leaves it uninitialised
 * at the moment a part evaluates.
 */
export const KEEP = Symbol.for('mortgage-human:keep');
