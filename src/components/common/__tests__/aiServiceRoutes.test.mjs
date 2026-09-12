import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * THE AI MAY ONLY SEND PEOPLE WHERE HOMATCH ACTUALLY GOES.
 *
 * The system prompt names the products and the route each one starts from.
 * A route that is renamed or removed in the router turns that sentence into
 * an assistant confidently directing a customer to a 404 — and nothing else
 * in the build would notice, because a prompt is a string.
 *
 * So: every path the prompt mentions must be a path the router serves. This
 * reads both files and compares them, which needs no model and no network.
 */

const prompt = readFileSync('supabase/functions/homatch-ai/index.ts', 'utf8');
const routes = readFileSync('src/routes.tsx', 'utf8');

/** Every `path: '/…'` the router registers. */
const registered = new Set(
  [...routes.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]),
);

/** The paths named inside the service list, e.g. "Mortgage (/mortgage)". */
const mentioned = [...prompt.matchAll(/\((\/[a-z0-9/-]+)\)\s+—/g)].map((m) => m[1]);

test('the prompt actually names some services', () => {
  // Guards the guard: a regex that silently matches nothing would make the
  // assertion below vacuously true.
  assert.ok(mentioned.length >= 5, `expected the service list to name paths, found ${mentioned.length}`);
});

test('every route the AI can recommend is registered in the router', () => {
  for (const path of mentioned) {
    assert.ok(
      registered.has(path),
      `the AI prompt offers "${path}", which src/routes.tsx does not serve`,
    );
  }
});

test('the prompt keeps the help-first and one-per-reply rules', () => {
  // These are the sentences that stop the assistant becoming a salesman.
  // If a future edit drops them, the behaviour regresses silently.
  assert.match(prompt, /Answer the question first/i);
  assert.match(prompt, /At most ONE per reply/i);
  assert.match(prompt, /Do not mention the same one again in the next turn/i);
  assert.match(prompt, /most replies should end without one/i);
});

test('the prompt still forbids inventing capability', () => {
  assert.match(prompt, /Never describe a capability Homatch does not have/i);
  assert.match(prompt, /never name a destination that is not on this list/i);
});

test('outreach is scoped to people who actually do outreach', () => {
  // Email and calls are the two easiest to mis-recommend to a buyer.
  assert.match(prompt, /Only relevant to somebody who is actually doing outreach/i);
});
