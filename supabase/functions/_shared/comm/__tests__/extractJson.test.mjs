// The model is asked for JSON by instruction, not by a schema parameter.
//
// callLlm deliberately sends no structured-output parameter: every field in
// that request is one homatch-ai has been sending to the same key and model in
// production for months, and adding the one parameter it does NOT send is what
// kept "Generate with AI" broken after the endpoint itself was corrected.
//
// The cost of that choice is that the model is following an instruction, and a
// model following an instruction sometimes fences its object in ```json or
// writes a sentence before it. Those replies contain exactly the object that
// was asked for, and refusing them fails a request whose answer is right
// there. This is the reader that accepts them — and, just as importantly,
// still refuses text that contains no object at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * extractJson is module-private in a Deno edge file, which node cannot import.
 * It is small and pure, so the function body is read out of the source and
 * evaluated — that way this tests the SHIPPED implementation rather than a
 * copy of it that can drift.
 */
const SRC = readFileSync('supabase/functions/_shared/comm/llm.ts', 'utf8');
const start = SRC.indexOf('function extractJson(');
assert.ok(start > 0, 'extractJson not found in llm.ts — this test must not pass vacuously');
const end = SRC.indexOf('\n}', start) + 2;
// Longest annotations first: stripping ": string" before ": string[]" turns
// `const attempts: string[] = []` into `const attempts[] = []`, which is a
// syntax error rather than a test failure and tells you nothing.
const body = SRC.slice(start, end)
  .replace(/\(text: string\): unknown/g, '(text)')
  .replace(/: string\[\]/g, '')
  .replace(/: unknown/g, '')
  .replace(/: string/g, '');
// eslint-disable-next-line no-new-func
const extractJson = new Function(`${body}; return extractJson;`)();

test('a bare object is read', () => {
  const v = extractJson('{"purpose":"Call buyers","questions":["a","b"]}');
  assert.equal(v.purpose, 'Call buyers');
  assert.deepEqual(v.questions, ['a', 'b']);
});

test('a fenced object is read', () => {
  const v = extractJson('```json\n{"purpose":"Call buyers"}\n```');
  assert.equal(v.purpose, 'Call buyers');
});

test('a fence without a language tag is read', () => {
  const v = extractJson('```\n{"purpose":"x"}\n```');
  assert.equal(v.purpose, 'x');
});

test('an object introduced by a sentence is read', () => {
  const v = extractJson('Sure — here is the draft:\n{"purpose":"Call buyers"}\nHope that helps.');
  assert.equal(v.purpose, 'Call buyers');
});

test('Georgian content survives intact', () => {
  // The product is Georgian-first; a reader that mangles non-Latin text would
  // pass every ASCII test and destroy real output.
  const v = extractJson('{"purpose":"ყიდის ბინას თბილისში"}');
  assert.equal(v.purpose, 'ყიდის ბინას თბილისში');
});

test('nested objects and braces inside strings survive', () => {
  const v = extractJson('{"a":{"b":"}"},"c":"{"}');
  assert.equal(v.a.b, '}');
  assert.equal(v.c, '{');
});

test('text with no object at all is refused', () => {
  // Must be null, not {} — the caller falls back on null, and an empty object
  // would be saved as a successful generation that produced nothing.
  for (const junk of ['', '   ', 'I cannot help with that.', 'null', '42', '"a string"', '[1,2,3]']) {
    assert.equal(extractJson(junk), null, `${JSON.stringify(junk)} must not parse as an object`);
  }
});

test('an unterminated object is refused rather than half-read', () => {
  assert.equal(extractJson('{"purpose":"Call buy'), null);
});
