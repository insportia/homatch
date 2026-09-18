// The wait before the first spoken word, and where it actually went.
//
// MEASURED on the deployed path, per turn, from the function's own trace:
//
//   stage              before        after
//   llm_started_ms     ~700 (inferred)  33-93    three DB round trips in series
//   llm_headers_ms     ~840 median      ~456     time to response headers
//   llm_think_ms       ~500, tail 2592  ~340     headers to the first word
//   llm_input_tokens   1791             1365
//
// The single largest cause was not the prompt and not the connection. It was
// that the reasoning level being asked for did not exist on this model:
//
//   "Unsupported value: 'minimal' is not supported with the 'gpt-5.6-luna'
//    model. Supported values are: 'none', 'low', ..."
//
// so every request 400'd once and fell back to 'low' -- one step ABOVE the
// floor -- for the life of the isolate, silently. The provider names 'none'
// in the very error it returns.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const llm = readFileSync('supabase/functions/_shared/comm/llm.ts', 'utf8');
const talk = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test("'none' is a level this code can ask for", () => {
  // It was not in the type at all, so the floor was unreachable by design.
  assert.ok(/'none' \| 'minimal' \| 'low' \| 'medium' \| 'high'/.test(llm));
});

test('a spoken turn asks for no reasoning at all', () => {
  const t = strip(talk);
  assert.ok(/reasoningEffort: 'none'/.test(t), 'a voice reply is not a reasoning problem');
  assert.ok(!/reasoningEffort: 'minimal'/.test(t), "'minimal' is refused by this model");
});

test('a refused floor falls back once and says why', () => {
  const l = strip(llm);
  assert.ok(/floorRefused/.test(l), 'both floor names must be recoverable');
  assert.ok(/wanted === 'minimal' \|\| wanted === 'none'/.test(l));
  // The fallback used to be silent, which is how a permanent downgrade goes
  // unnoticed for weeks.
  assert.ok(/low_effort_refused/.test(llm), 'a silent downgrade must be logged');
});

test('the stages of the wait are measured apart, not as one number', () => {
  // "The model is slow" is three problems: getting the request accepted,
  // reading the prompt, and thinking. They have different fixes.
  for (const field of ['llm_started_ms', 'llm_headers_ms', 'llm_think_ms',
    'llm_input_tokens', 'llm_effort']) {
    assert.ok(talk.includes(field), `${field} must be on the turn trace`);
  }
});

test('nothing the model does not need waits in front of it', () => {
  const t = strip(talk);
  // Two Supabase round trips used to run in series before the request was
  // even built. The abuse check now starts at the top of the handler and the
  // turn counter is no longer awaited at all.
  assert.ok(/const abuseCheck = turnContainsAbuse\(sb, said\);/.test(t));
  assert.ok(/await abuseCheck/.test(t), 'its answer is still used');
  assert.ok(/void sb\.from\('comm_talk_sessions'\)/.test(t),
    'the turn counter must not be awaited on the path to the model');
  assert.ok(/turn_count_failed/.test(talk), 'but a failure must still be recorded');
});

test('the prompt is smaller and still carries every rule', () => {
  // Compression is only safe if the RULES survived it; the prose did not.
  for (const rule of [
    'never name a model, a provider or a vendor',
    'never claim Homatch trained its own',
    'NO access to any listing',
    'Never guarantee anything',
    'Never ask for a name, phone number, email',
    'Write "Homatch" in Latin letters',
    // Was 'LENGTH FOLLOWS THE QUESTION'. The rule did not go; the heading did,
    // when the prompt was cut from 2,595 tokens to about 2,000 because the
    // model's first token was 84% of the latency on a real phone.
    'MATCH THEM',
    'Take your length, register and energy from theirs',
  ]) {
    // Compared lowercased rather than as a pattern: these are sentences, not
    // regexes, and a rule that survived compression as "Never claim..."
    // rather than "never claim..." survived.
    assert.ok(talk.toLowerCase().includes(rule.toLowerCase()),
      `the compressed prompt dropped: ${rule}`);
  }
  // And the action protocol has to survive too, or the buttons stop working.
  assert.ok(/ACTION_MARKER/.test(talk) && /destinationMenu\(\)/.test(talk));
  assert.ok(/OBJECTIVE_MET/.test(talk) && /FAREWELL/.test(talk)
    && /HANDED_OFF/.test(talk) && /NOTHING_ACTIONABLE/.test(talk) && /ABUSE/.test(talk));
});
