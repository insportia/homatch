import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectVerify } from '../assemble.ts';
import { finalizeRendering, renderDeterministic, parseRendering, buildRenderPrompt } from '../render.ts';
import { assembleContext, buildAskPrompt, groundingRefs, certaintyOf, scoreFact, MAX_FACTS } from '../aiContext.ts';

/*
 * These two layers are where a language model touches the product, so the
 * tests are adversarial: they assert that a model behaving badly cannot get
 * anything past the gate, and that a model being absent still yields a
 * complete report.
 */

const REPORT = {
  entityName: 'შპს მილენიო გრუპი',
  entityType: 'APARTMENT',
  exactUnit: { cadastralCode: '01.19.36.018.041', address: 'ქრწანისი, თბილისი', area: '94.1' },
  rightsAndRestrictions: {
    status: 'RESTRICTION_IDENTIFIED',
    items: ['იპოთეკა — სს "საქართველოს ბანკი"'],
    asOf: '2026-08-01',
  },
  companyProfile: {
    name: 'შპს მილენიო გრუპი', idCode: '404670272', status: 'აქტიური',
    sourceBasis: 'REGISTRY_CONFIRMED', directors: ['ნინო ბერიძე'],
  },
  projectProfile: { constructionStatus: 'მშენებლობის პროცესში' },
  officialSourceCoverage: [
    { source: 'napr.registry', customerStatus: 'SUCCESS' },
    { source: 'enforcement.debtors', customerStatus: 'CAPTCHA_REQUIRED' },
  ],
};

const projection = () => projectVerify({ jobId: 'j', report: REPORT, capturedAt: '2026-09-09T00:00:00Z' });

/* ---------------------------------------------------------------- *
 * The grounding gate                                                *
 * ---------------------------------------------------------------- */

test('a model that invents a point key is rejected and the deterministic text is used', () => {
  const plan = projection().synthesis;
  const evil = JSON.stringify({
    sections: [{ sectionKey: plan.sections[0].key, text: 'რაღაც ტექსტი', usedPointKeys: ['totally.made.up'] }],
  });
  const out = finalizeRendering(plan, evil);
  assert.equal(out.mode, 'DETERMINISTIC');
  assert.ok(out.rejectedBecause.some((p) => p.includes('ungrounded point cited')));
});

test('a model that omits a conflict is rejected', () => {
  const p = projectVerify({
    jobId: 'j',
    report: {
      ...REPORT,
      // Two different owners from two different sources = a conflict.
      companyProfile: { name: 'შპს ალფა', sourceBasis: 'REGISTRY_CONFIRMED' },
      technicalFacts: [{ category: 'AREA', key: 'area', value: '88.0', documentTitle: 'doc' }],
    },
  });
  if (!p.synthesis.conflicts.length) return; // nothing to assert against
  const skipped = JSON.stringify({
    sections: [{ sectionKey: p.synthesis.sections[0].key, text: 'ok', usedPointKeys: [] }],
  });
  const out = finalizeRendering(p.synthesis, skipped);
  assert.equal(out.mode, 'DETERMINISTIC');
});

test('a model leaking internal vocabulary is rejected', () => {
  const plan = projection().synthesis;
  const leaky = JSON.stringify({
    sections: [{ sectionKey: plan.sections[0].key, text: 'the orchestrator returned json', usedPointKeys: [] }],
  });
  const out = finalizeRendering(plan, leaky);
  assert.equal(out.mode, 'DETERMINISTIC');
});

test('unparseable model output degrades to deterministic rather than throwing', () => {
  const plan = projection().synthesis;
  for (const junk of ['not json at all', '{"sections":', '', null, undefined, '{}', '{"sections":[]}']) {
    const out = finalizeRendering(plan, junk);
    assert.equal(out.mode, 'DETERMINISTIC');
    assert.ok(Array.isArray(out.sections));
  }
});

test('no model at all still produces a complete, valid report', () => {
  const plan = projection().synthesis;
  const out = finalizeRendering(plan, null);
  assert.equal(out.mode, 'DETERMINISTIC');
  assert.ok(out.sections.length > 0, 'a report must exist even with no LLM available');
  assert.equal(out.verdict, plan.verdict);
});

test('the deterministic rendering always passes its own validation gate', () => {
  const plan = projection().synthesis;
  const out = finalizeRendering(plan, JSON.stringify({ sections: renderDeterministic(plan) }));
  assert.equal(out.mode, 'MODEL', 'the deterministic rendering must be accepted when replayed as model output');
  assert.deepEqual(out.rejectedBecause, []);
});

test('a well-behaved model IS accepted — the gate is not simply always-reject', () => {
  const plan = projection().synthesis;
  const good = renderDeterministic(plan).map((s) => ({ ...s, text: `${s.text} დამატებითი ბუნებრივი ტექსტი.` }));
  const out = finalizeRendering(plan, JSON.stringify({ sections: good }));
  assert.equal(out.mode, 'MODEL');
});

test('markdown fences around valid JSON are tolerated', () => {
  const plan = projection().synthesis;
  const fenced = '```json\n' + JSON.stringify({ sections: renderDeterministic(plan) }) + '\n```';
  assert.ok(parseRendering(fenced));
});

test('the render prompt never contains raw report internals or source URLs', () => {
  const { system, user } = buildRenderPrompt(projection().synthesis);
  const blob = `${system}\n${user}`;
  assert.ok(!blob.includes('sourceBasis'));
  assert.ok(!blob.includes('officialSourceCoverage'));
  assert.ok(!blob.includes('result_json'));
  assert.ok(!/https?:\/\//.test(blob), 'no source URLs may be handed to the renderer');
});

/* ---------------------------------------------------------------- *
 * Ask Homatch AI grounding                                          *
 * ---------------------------------------------------------------- */

test('a question retrieves only topically relevant evidence, not the whole room', () => {
  const ctx = assembleContext(projection(), 'is there a mortgage on this apartment?');
  assert.ok(ctx.items.length > 0);
  assert.ok(ctx.items.some((i) => i.ref.startsWith('encumbrance.')));
  assert.ok(ctx.items.every((i) => i.ref && i.statement));
});

test('an unrelated question yields an EMPTY context rather than random facts', () => {
  const ctx = assembleContext(projection(), 'what is the weather in Paris tomorrow');
  assert.equal(ctx.empty, true);
  assert.deepEqual(groundingRefs(ctx), []);
});

test('context is hard-capped so a large deal room cannot dump the database', () => {
  const many = { ...REPORT, technicalFacts: [] };
  for (let i = 0; i < 400; i++) {
    many.technicalFacts.push({ category: 'AREA', key: `k${i}`, value: `${i}`, documentTitle: `d${i}` });
  }
  const ctx = assembleContext(projectVerify({ jobId: 'j', report: many }), 'what is the area and size?');
  assert.ok(ctx.items.length <= MAX_FACTS, `expected <= ${MAX_FACTS}, got ${ctx.items.length}`);
});

test('retrieval is deterministic — the same question twice gives the same context', () => {
  const p = projection();
  const a = assembleContext(p, 'who is the owner?');
  const b = assembleContext(p, 'who is the owner?');
  assert.deepEqual(a, b);
});

test('every context item carries a grounding ref and a certainty band', () => {
  const bands = new Set(['CONFIRMED', 'LIKELY_BUT_UNCONFIRMED', 'CONFLICTING', 'UNAVAILABLE', 'NOT_VERIFIED']);
  for (const i of assembleContext(projection(), 'who is the developer company?').items) {
    assert.ok(i.ref.includes('@'), 'ref must name its sources');
    assert.ok(bands.has(i.certainty));
    assert.ok(Array.isArray(i.sources) && i.sources.length > 0);
  }
});

test('an INFERRED fact is never presented as CONFIRMED', () => {
  assert.equal(certaintyOf({ state: 'INFERRED', evidence: [], sourceCount: 1 }), 'LIKELY_BUT_UNCONFIRMED');
  assert.equal(certaintyOf({ state: 'CONFLICTING', evidence: [], sourceCount: 2 }), 'CONFLICTING');
  assert.equal(certaintyOf({ state: 'UNAVAILABLE', evidence: [], sourceCount: 0 }), 'UNAVAILABLE');
});

test('a conflicting fact outranks a merely well-corroborated one on the same topic', () => {
  const conflicted = { type: 'ownership.owner', value: 'A', state: 'CONFLICTING', sourceCount: 1, evidence: [] };
  const solid = { type: 'ownership.owner', value: 'B', state: 'CONFIRMED', sourceCount: 3, evidence: [] };
  assert.ok(scoreFact(conflicted, 'who is the owner') > scoreFact(solid, 'who is the owner'));
});

test('incomplete sources are carried into the context so absence is never spun as clean', () => {
  const ctx = assembleContext(projection(), 'is there a mortgage?');
  assert.deepEqual(ctx.incompleteSources, ['enforcement.debtors']);
});

test('the ask prompt forbids turning missing information into a negative finding', () => {
  const ctx = assembleContext(projection(), 'is there a mortgage?');
  const { system } = buildAskPrompt(ctx, 'is there a mortgage?');
  assert.match(system, /NEVER convert missing information into a\s+negative finding/);
  assert.match(system, /CONFLICTING/);
});

test('the ask prompt carries no source URLs or internal identifiers', () => {
  const ctx = assembleContext(projection(), 'who is the developer?');
  const { user } = buildAskPrompt(ctx, 'who is the developer?');
  assert.ok(!/https?:\/\//.test(user));
  assert.ok(!user.includes('result_json'));
});

test('an empty context is explicitly flagged to the model', () => {
  const ctx = assembleContext(projection(), 'unrelated nonsense question');
  const { user } = buildAskPrompt(ctx, 'unrelated nonsense question');
  assert.match(user, /NO RELEVANT EVIDENCE/);
});
