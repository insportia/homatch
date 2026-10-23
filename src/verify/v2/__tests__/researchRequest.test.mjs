// researchRequest.test.mjs — V2 research routing, caching order and compact context (src/verify/v2/researchRequest.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { marketOfficialContext, parseResearchTuning, RESEARCH_PROMPT_CACHE_KEY, stablePrefixPrompt, v2ResearchRequest, withoutEmpty } from '../researchRequest.ts';

const BASE = 'RULES '.repeat(50);

test('an unset or malformed tuning means exactly what V1 sends', () => {
  for (const v of [null, undefined, 'x', [], {}, { identity: 'luna' }, { market: { model: 'gpt-4o', reasoningEffort: 'max', searchContextSize: 'huge' } }]) {
    assert.deepEqual(parseResearchTuning(v), {}, JSON.stringify(v));
  }
  const r = v2ResearchRequest('MARKET', `brief ${BASE} rest`, BASE, null, 'gpt-5.6-terra', true);
  assert.equal(r.model, 'gpt-5.6-terra');
  assert.deepEqual(r.extra, { prompt_cache_key: RESEARCH_PROMPT_CACHE_KEY }, 'no reasoning or tools override without a setting');
});

test('a stage setting routes only that stage', () => {
  const tuning = { official_collection: { model: 'gpt-5.6-luna', reasoningEffort: 'low' }, public_research: { searchContextSize: 'low' } };
  assert.deepEqual(parseResearchTuning(tuning), tuning);
  const off = v2ResearchRequest('OFFICIAL_COLLECTION', BASE, BASE, tuning, 'gpt-5.6-terra', true);
  assert.equal(off.model, 'gpt-5.6-luna');
  assert.deepEqual(off.extra.reasoning, { effort: 'low' });
  assert.equal(off.extra.tools, undefined);
  const pr = v2ResearchRequest('PUBLIC_RESEARCH', BASE, BASE, tuning, 'gpt-5.6-terra', true);
  assert.equal(pr.model, 'gpt-5.6-terra');
  assert.deepEqual(pr.extra.tools, [{ type: 'web_search', search_context_size: 'low' }]);
  assert.equal(v2ResearchRequest('MARKET', BASE, BASE, tuning, 'gpt-5.6-terra', true).model, 'gpt-5.6-terra');
});

test('a stage can cap its web searches (each $0.01 whatever the model); 0 sends no web tool', () => {
  const tuning = parseResearchTuning({
    identity: { model: 'gpt-5.6-luna', maxSearches: 2 }, public_research: { maxSearches: 0 },
    market: { maxSearches: 11 }, official_collection: { maxSearches: 1.5 },
  });
  assert.deepEqual(tuning, { identity: { model: 'gpt-5.6-luna', maxSearches: 2 }, public_research: { maxSearches: 0 } }, 'out-of-range and fractional caps are dropped');
  assert.equal(v2ResearchRequest('IDENTITY', BASE, BASE, tuning, 'gpt-5.6-terra', true).extra.max_tool_calls, 2);
  const none = v2ResearchRequest('PUBLIC_RESEARCH', BASE, BASE, tuning, 'gpt-5.6-terra', true).extra;
  assert.deepEqual(none.tools, []);
  assert.equal(none.max_tool_calls, undefined);
  assert.equal(v2ResearchRequest('MARKET', BASE, BASE, tuning, 'gpt-5.6-terra', true).extra.max_tool_calls, undefined);
});

test('the report model is chosen per V2 job; V1 and unset keep the default', async () => {
  const { reportModelFor } = await import('../researchRequest.ts');
  const v2 = (research) => ({ _engine: { version: 'V2', research } });
  assert.equal(reportModelFor(v2({ report: { model: 'gpt-5.6-terra' } }), 'gpt-5.6-luna'), 'gpt-5.6-terra');
  assert.equal(reportModelFor(v2({}), 'gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(reportModelFor(v2({ report: { model: 'gpt-4o' } }), 'gpt-5.6-luna'), 'gpt-5.6-luna', 'only priced models');
  assert.equal(reportModelFor({ _engine: { version: 'V1', research: { report: { model: 'gpt-5.6-terra' } } } }, 'gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(reportModelFor(null, 'gpt-5.6-luna'), 'gpt-5.6-luna');
  const vs = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/verify-synthesis/index.ts', import.meta.url)), 'utf8');
  assert.match(vs, /const reportModel = reportModelFor\(rj, MODEL\);/);
  assert.match(vs, /model: reportModel,\n\s+input: \[/);
  assert.match(vs, /synthesisModel: reportModel,/);
  assert.match(vs, /reportConsumption\(usage, usage\?\.model \|\| MODEL\)/, 'cost is priced at the model that wrote it');
});

test('BASE moves to the front; what preceded it follows, in order; nothing is lost', () => {
  const text = `KNOWN\nELIGIBILITY\n${BASE}\nAnswer strings in English. Query=X.`;
  const out = stablePrefixPrompt(text, BASE);
  assert.ok(out.startsWith(BASE));
  assert.equal(out, `${BASE}\nKNOWN\nELIGIBILITY\n\nAnswer strings in English. Query=X.`);
  assert.equal([...out].sort().join(''), [...`${text}\n`].sort().join(''), 'same characters (plus one separator)');
  assert.equal(stablePrefixPrompt(`${BASE} tail`, BASE), `${BASE} tail`, 'already first: unchanged');
  assert.equal(stablePrefixPrompt('no base here', BASE), 'no base here');
});

test('empty values are dropped and nothing else', () => {
  assert.deepEqual(withoutEmpty({ a: null, b: '', c: [], d: {}, e: 0, f: false, g: 'x', h: [null, '', 'y', { z: null }], i: { j: { k: [] } } }), { e: 0, f: false, g: 'x', h: ['y'] });
});

test('MARKET reads the official stage\'s price-relevant fields; the documents list is not repeated', () => {
  const o = {
    officialEvidence: ['7,800 m² non-agricultural plot'], landProfile: { landCategory: 'non-agricultural' },
    rightsAndRestrictions: { status: 'NONE_FOUND_IN_CHECKED_SOURCE', items: [] },
    companyProfile: { name: 'Co', idCode: '204873388', status: 'active', directors: ['A'], summary: 'long' },
    tasTechnicalFacts: [{ key: 'floors', value: '5' }], documents: [{ title: 'Permit', url: 'u', facts: ['7,800 m²'] }],
    conflicts: [], facts: ['x'], unverified: ['y'],
  };
  const m = marketOfficialContext(o);
  assert.deepEqual(Object.keys(m).sort(), ['company', 'landProfile', 'officialEvidence', 'rightsAndRestrictions', 'technicalFacts']);
  assert.deepEqual(m.company, { name: 'Co', idCode: '204873388', status: 'active' });
});

test('research-agent applies all of it to V2 jobs only', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');
  assert.match(src, /const v2 = engineOf\(j\.result_json\) === 'V2' \? v2ResearchRequest\(s, text, BASE, j\.result_json\?\._engine\?\.research, m, tools\) : null;/);
  assert.match(src, /const p = v2 \? await createOpenAIResponse\(k, v2\.model, v2\.input, tools, v2\.extra\) : await createOpenAIResponse\(k, m, text, tools\);/);
  // V1 embeds are byte-identical: ctx() is the identity for V1.
  assert.match(src, /const ctx = \(x: any\) => \(v2 \? withoutEmpty\(x\) : x\);/);
  assert.match(src, /Official=\$\{JSON\.stringify\(v2 \? marketOfficialContext\(p\.official\) : p\.official \|\| \{\}\)\.slice\(0, 16000\)\}/);
  // Routing is stamped once at creation, for V2 jobs only.
  assert.match(src, /const stamped = engine\.version === 'V2' \? \{ \.\.\.engine, research: parseResearchTuning\(await adminSettingJson\(sb, VERIFY_V2_RESEARCH_SETTING_KEY\)\) \} : engine;/);
  assert.equal((src.match(/VERIFY_V2_RESEARCH_SETTING_KEY/g) ?? []).length, 2);
});
