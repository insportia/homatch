// HOMATCH RESEARCH CORE — identifiers.
//
// Two kinds, and mixing them up has real consequences.
//
// A RANDOM id is for a thing that happens once: a run, a task attempt. Two
// identical runs must not collide.
//
// A DETERMINISTIC id is for a thing that IS its inputs: an observation, a
// cache key, a coalescing key. The same inputs must always produce the same
// id, or coalescing stops coalescing and the cache stops hitting — silently,
// and only under load, which is the worst time to find out.

import { sha256Hex } from './sha256.ts';

/**
 * `crypto.randomUUID` is a platform global in Deno, Node 19+ and browsers, so
 * this needs no import. The fallback exists for a non-secure browser context,
 * where randomUUID is absent; it is not used on any server path.
 */
function randomHex(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex().slice(0, 20)}`;
}

/**
 * Same inputs, same id, forever.
 *
 * The separator matters: joining parts with nothing lets ("ab","c") and
 * ("a","bc") produce one id, which would merge two different observations.
 * A unit separator cannot appear in a URL, a hash or a source key.
 */
export function deterministicId(
  prefix: string,
  ...parts: Array<string | number | null | undefined>
): string {
  const material = parts
    .map((p) => (p === null || p === undefined ? '' : String(p)))
    .join('\u001f');
  return `${prefix}_${sha256Hex(material).slice(0, 20)}`;
}

let counter = 0;

/** Monotonic sequence used for FIFO tie-breaking inside a priority class. */
export function nextSequence(): number {
  counter += 1;
  return counter;
}
