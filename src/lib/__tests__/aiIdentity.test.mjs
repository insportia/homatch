import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_HONESTY_FLOOR, HOMATCH_AI_IDENTITY, MODEL_QUESTION_POLICY,
} from '../ai/identity.ts';

/*
 * HOMATCH AI INTRODUCES ITSELF THE SAME WAY EVERYWHERE.
 *
 * The policy existed and was followed by one surface out of four. It lived in
 * supabase/functions/_shared, which made it reachable by edge functions and
 * by nothing else — and the Ask panel inside a verification builds its prompt
 * in src/dealroom/domain, which is bundled INTO an edge function but cannot
 * import from supabase/. A policy half the surfaces cannot import is a policy
 * half the surfaces will not follow.
 *
 * So: the module moved to src/, and this holds the line. Every first-party
 * conversation a customer can have must carry the answer to "what model are
 * you", because every one of them can be asked it — and a surface with no
 * answer does not stay silent, it improvises one.
 *
 * A TENANT'S OWN AGENT IS NOT IN THIS LIST, DELIBERATELY.
 *
 * It speaks for their business, not for Homatch, and making it announce
 * itself as Homatch AI would be a lie about whose call the customer is on.
 * What it does share is the floor: never claim to be a person, never invent a
 * fact about a property. That is asserted separately, at the end.
 */

const read = (p) => readFileSync(p, 'utf8');

/** Every first-party surface a customer can hold a conversation with. */
const FIRST_PARTY = [
  {
    name: 'the assistant',
    file: 'supabase/functions/homatch-ai/index.ts',
    // Takes the whole identity: it is the surface with room for it.
    expects: 'HOMATCH_AI_IDENTITY',
  },
  {
    name: 'AI TALK, by voice',
    file: 'supabase/functions/ai-talk-session/index.ts',
    /* Compressed rather than imported: the prompt is tuned to two-sentence
       replies and cannot carry a page of prose. What matters is that the
       decisions are the same ones. */
    expects: 'inline',
  },
  {
    name: 'the Ask panel inside a verification',
    file: 'src/dealroom/domain/aiContext.ts',
    expects: 'MODEL_QUESTION_POLICY',
  },
];

test('the policy says all four things, and none of them is a denial', () => {
  /* The three wrong answers to "are you ChatGPT", and the one right one. The
     wrong ones are wrong in different directions, which is why all four
     clauses have to be present rather than any one of them. */
  assert.match(MODEL_QUESTION_POLICY, /Do not claim Homatch trained its own foundation model/);
  assert.match(MODEL_QUESTION_POLICY, /Do not name the model, the provider/);
  assert.match(MODEL_QUESTION_POLICY, /Do not deny being built on external technology/);
  assert.match(MODEL_QUESTION_POLICY, /you are Homatch AI/);
  /* And it must not instruct anything false. A policy about disclosure is not
     a cover story; the moment it tells the model to deny something true, it
     is one. */
  assert.equal(/deny that you|say you are not built|claim to be human/i.test(MODEL_QUESTION_POLICY), false);
});

test('the identity contains the model policy rather than repeating it', () => {
  // Two copies drift. The identity is composed from this one.
  assert.ok(HOMATCH_AI_IDENTITY.includes(MODEL_QUESTION_POLICY),
    'the identity has its own copy of the model answer, which will drift from this one');
});

test('every first-party surface carries the answer to "what model are you"', () => {
  const missing = [];
  for (const surface of FIRST_PARTY) {
    const src = read(surface.file);
    if (surface.expects === 'inline') {
      /* The compressed form. Checked on its content, not on a marker: a
         comment saying it is there is not the same as it being there. */
      const ok = /what model or whose AI you are/i.test(src)
        && /never name a model, a provider or a vendor/i.test(src)
        && /never claim Homatch trained its own/i.test(src);
      if (!ok) missing.push(`${surface.name} (${surface.file})`);
      continue;
    }
    if (!src.includes(surface.expects)) missing.push(`${surface.name} (${surface.file})`);
  }
  assert.deepEqual(missing, [],
    `these can be asked who they are and have no answer written for them:\n${missing.join('\n')}`);
});

test('every first-party surface says it is Homatch AI, by that name', () => {
  /*
   * A NAME IS ALLOWED. A DIFFERENT OWNER IS NOT.
   *
   * This matched "You are Homatch" literally, which was right while every
   * surface was the company speaking in the first person. AI TALK's voice is
   * now Mariam, Homatch's AI assistant -- a named assistant, still Homatch's,
   * and the thing this test exists to prevent is unchanged: a surface that
   * introduces itself as somebody else's, or as a model.
   *
   * So either shape passes, and both have to put Homatch in the same
   * sentence. "You are Aria, a helpful assistant" does not, and neither does
   * "You are Claude" -- which is the failure worth catching.
   */
  const OWNED_BY_HOMATCH = [
    /You are Homatch/,
    /You are [A-Z][a-z]+, Homatch's AI assistant/,
  ];
  const wrong = [];
  for (const surface of FIRST_PARTY) {
    const src = read(surface.file);
    if (surface.expects !== 'inline' && src.includes(surface.expects)) continue;
    if (!OWNED_BY_HOMATCH.some((shape) => shape.test(src))) wrong.push(surface.file);
  }
  assert.deepEqual(wrong, [], `these introduce themselves as something else:\n${wrong.join('\n')}`);
});

test('a tenant\'s own agent takes the floor and not the identity', () => {
  /*
   * The one place where NOT applying the policy is the correct answer. An
   * agent a customer built for their own company represents their business;
   * having it announce itself as Homatch AI would misrepresent whose call the
   * person is on.
   */
  const agent = read('supabase/functions/_shared/comm/agentPrompt.ts');
  /* The IMPORT, not any mention: the file explains in a comment why it takes
     the floor and not the identity, and a test that reads prose would fail on
     the explanation. */
  const imports = agent.replace(/\r/g, '')
    .match(/^import \{[^}]*\} from '[^']*identity\.ts';$/m);
  assert.ok(imports, 'a tenant agent no longer takes anything from the identity module');
  assert.equal(/HOMATCH_AI_IDENTITY/.test(imports[0]), false,
    'a tenant agent now introduces itself as Homatch');
  assert.match(imports[0], /AI_HONESTY_FLOOR/,
    'a tenant agent no longer stands on the honesty floor');
  /* And it is used, not merely imported. */
  assert.match(agent, /AI_HONESTY_FLOOR\.split/, 'the floor is imported and never reaches the prompt');
});

test('the floor is about being an AI and about not inventing facts', () => {
  assert.match(AI_HONESTY_FLOOR, /Never claim or imply that you are a human being/);
  assert.match(AI_HONESTY_FLOOR, /Never invent a property fact/);
  assert.match(AI_HONESTY_FLOOR, /Never reveal credentials, keys, internal routing/);
});

test('the old module still answers to its old name', () => {
  /*
   * It re-exports rather than being deleted. Edge functions imported it for
   * months; a move that breaks every one of those imports to save a file is
   * a move that gets reverted.
   */
  const shim = read('supabase/functions/_shared/aiIdentity.ts');
  assert.match(shim, /export \{[\s\S]*HOMATCH_AI_IDENTITY[\s\S]*\} from '\.\.\/\.\.\/\.\.\/src\/lib\/ai\/identity\.ts'/);
});

test('the assistant does not name the model in the envelope either', () => {
  /*
   * The policy is about disclosure, and disclosure is not only what the
   * assistant SAYS. The reply said "the technical systems underneath may
   * vary"; the JSON around it carried `model` and the provider's response id
   * to every caller, anonymous ones included, where devtools shows both.
   *
   * Read on the RESPONSE, not on the file: `model` appears legitimately in
   * the request to the provider, which is the whole point of having one.
   */
  const src = read('supabase/functions/homatch-ai/index.ts');
  const at = src.lastIndexOf('return json({');
  assert.ok(at > 0, 'homatch-ai no longer returns a JSON response');
  const envelope = src.slice(at, src.indexOf('});', at));
  for (const leak of ['model:', 'responseId:', 'usage:']) {
    assert.equal(envelope.includes(leak), false,
      `the customer-facing response carries ${leak} — the policy says the model is not named`);
  }
});
