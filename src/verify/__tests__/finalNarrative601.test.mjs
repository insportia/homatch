// Final narrative pass for the .601 report (job 8ba97da9-…): technical facts
// explained, project mathematics, the three-track story, the buyer
// assessment, the editorial post-processor and the documented team.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as F from './fixtures/job601Narrative.mjs';
import { extractTechnicalSpecs } from '../intelligence/technicalSpecs.ts';
import { projectMath } from '../intelligence/projectMath.ts';
import { explainTechnical } from '../intelligence/technicalExplained.ts';
import { extractProjectSignals, projectStory } from '../intelligence/projectStory.ts';
import { buildBuyerAssessment, finalBuyerAssessment, assessmentProblems } from '../intelligence/buyerAssessment.ts';
import { replaceDashes, fixBrands, stripProvenanceOpening } from '../intelligence/editorial.ts';
import { polishReport } from '../intelligence/report.ts';
import { teamGroupsV2 } from '../reportPresentation.ts';
import { VERIFY_FINAL_NARRATIVE_STRINGS } from '../../../scripts/verify-final-narrative-i18n-data.mjs';

const NOW = '2026-10-11T00:00:00Z';
const raw = F.rawResult601();
const specs = extractTechnicalSpecs(raw, NOW);
const approved = specs.map((s) => ({ ...s, status: 'APPROVED' }));
const get = (k) => specs.find((s) => s.key === k);
const signals = extractProjectSignals(raw);
const story = projectStory({ history: F.HISTORY_601, signals, specs: approved });
const synth = {
  unitLegalPosition: F.UNIT_LEGAL_POSITION, officialHistory: F.HISTORY_601, report: { projectSignals: signals },
  projectTeamV2: F.PROJECT_TEAM_V2_LIVE, market: { basisIsThin: true, valuation: { state: 'INSUFFICIENT_EVIDENCE' } }, location: { nearby: [1, 2] },
};
const all = (x) => JSON.stringify(x);

test('specs: the wrapped K-1/K-2/K-3 lines are read; the form\'s built-up area is not the K-1 footprint', () => {
  assert.equal(get('k1Area').numeric, 1170.8);
  assert.equal(get('builtUpArea').numeric, 7793.7);
  assert.equal(get('landscapingArea').numeric, 797.9);
  assert.equal(get('K1').numeric, 0.5);
  assert.equal(get('K2').numeric, 2.4);
  assert.equal(get('K3').numeric, 0.4);
  assert.equal(get('buildingVolume').unit, 'მ³');
});

test('project math: coefficients computed only from consistent inputs; saleable area never derived', () => {
  const pm = projectMath(specs);
  const k = Object.fromEntries(pm.coefficients.map((c) => [c.id, c]));
  assert.equal(k.K2.result, 2.44);
  assert.equal(k.K1.consistent, true);
  assert.equal(k.K3.consistent, true);
  assert.ok(pm.flags.some((f) => f.id === 'BUILT_UP_NOT_FOOTPRINT'));
  assert.equal(pm.breakdown.consistent, true, 'the documented parts add up to 6 946.7');
  assert.equal(pm.grossMinusK2, 1704.4);
  assert.deepEqual(pm.missing.find((m) => m.id === 'SALEABLE').needs, ['SALES_PLAN']);
  // The persisted v4 row: a "K-1 area" larger than the plot is flagged, never computed.
  const v4 = projectMath([{ key: 'k1Area', numeric: 7793.7, status: 'APPROVED' }, { key: 'landArea', numeric: 2145, status: 'APPROVED' }]);
  assert.ok(v4.flags.some((f) => f.id === 'K1_AREA_EXCEEDS_LAND'));
  assert.ok(!v4.coefficients.some((c) => c.id === 'K1'));
});

test('technical explained: glossary cards, provenance openings removed, finishes line practical', () => {
  const cards = explainTechnical({ specs, publicResearch: F.PUBLIC_RESEARCH, team: F.PROJECT_TEAM_V2_LIVE });
  const topics = cards.map((c) => c.topic);
  for (const t of ['STRUCTURE', 'FACADE', 'WINDOWS', 'INSULATION', 'ENERGY', 'MEP', 'LIFTS', 'FINISHES']) assert.ok(topics.includes(t), t);
  assert.equal(cards.find((c) => c.topic === 'MEP').source, 'OFFICIAL');
  assert.ok(!/ოფიციალური ინფორმაციის მიხედვით|არ არის გამოქვეყნებ/.test(all(cards)));
  assert.match(cards.find((c) => c.topic === 'FINISHES').verify, /მესაკუთრესთან ან გაყიდვების წარმომადგენელთან/);
  assert.ok(!/[—–]/.test(all(cards)));
});

test('story: grouped events, three tracks, audit finding, no commissioning, case numbers only as evidence', () => {
  assert.deepEqual(signals.auditFinding, { caseRef: 'AR11101896', decisionNumber: '7585702', date: '2025-08-21', fineRequested: true });
  const tr = Object.fromEntries(story.tracks.map((t) => [t.track, t]));
  assert.equal(tr.CONSTRUCTION.state, 'STARTED_DOCUMENTED');
  assert.equal(tr.PERMIT.state, 'PERMIT_IN_FORCE');
  assert.match(tr.PERMIT.text, /2028 წლის 11 მარტს/);
  assert.equal(tr.COMMISSIONING.state, 'NO_ACT_SEEN');
  const permit = story.events.find((e) => e.id === 'permit-2026-03-11');
  assert.ok(permit.evidence.some((x) => x.decisionNumber === '7839183'));
  assert.ok(permit.evidence.some((x) => x.decisionNumber === '7496274'), 'supersedes 7496274');
  assert.equal(story.events.find((e) => e.id.startsWith('approval-2022')).count, 4);
  const pending = story.events.find((e) => e.id === 'pending-AR11161121');
  assert.equal(pending.stage, 'PROPOSED');
  assert.match(pending.changed, /ემთხვევა/);
  const prose = story.events.map((e) => `${e.what} ${e.changed ?? ''} ${e.why}`).join(' ') + story.tracks.map((t) => t.text).join(' ');
  assert.ok(!/AR\d{6,}|\b7\d{6}\b/.test(prose), 'numbers stay in the evidence');
  assert.ok(!/ექსპლუატაციაში მიღებულია|არ დაწყებულა,|[—–]/.test(prose));
});

test('buyer assessment: facts kept, concerns never dropped, guard refuses percentages and inspection claims', () => {
  const a = buildBuyerAssessment(synth);
  assert.match(a.synthesis.find((s) => s.area === 'LEGAL').text, /2023 წლის 19 დეკემბერს.*2026 წლის 24 აგვისტოს გაუქმდა/);
  assert.ok(a.concerns.some((c) => /აუდიტ/.test(c)));
  assert.ok(a.concerns.some((c) => /განაცხად/.test(c)));
  assert.ok(a.concerns.some((c) => /საბაზრო/.test(c)));
  assert.deepEqual(assessmentProblems(a), []);
  assert.ok(!all(a).includes(F.OWNER), 'the private owner is never named here');
  assert.equal(finalBuyerAssessment({ narrative: 'სანდოა 95%-ით.' }, synth).source, 'DETERMINISTIC');
  assert.equal(finalBuyerAssessment({ narrative: 'HOMATCH-მა ბინა ადგილზე დაათვალიერა.' }, synth).source, 'DETERMINISTIC');
  const m = finalBuyerAssessment({ narrative: 'პროექტი მყარ საფუძველზე დგას, თუმცა რამდენიმე საკითხი გასარკვევია.', concerns: ['ფასი მაღალია.'] }, synth);
  assert.equal(m.source, 'MODEL');
  assert.ok(m.concerns.some((c) => /აუდიტ/.test(c)) && m.concerns.some((c) => /განაცხად/.test(c)));
});

test('editorial: dashes, brands, repeated provenance openings and repeated sentences', () => {
  assert.equal(replaceDashes('პროექტი — კარგია. 2022–2025 წლებში'), 'პროექტი, კარგია. 2022-2025 წლებში');
  assert.equal(fixBrands('ახლოს არის Karpuri და Pharma Depo.'), 'ახლოს არის კარფური და ფარმადეპო.');
  assert.equal(stripProvenanceOpening('ოფიციალური ინფორმაციის მიხედვით, ფასადი ალუმინისაა.'), 'ფასადი ალუმინისაა.');
  const rep = 'ბინაზე რეგისტრირებული იპოთეკა 2026 წლის 24 აგვისტოს გაუქმდა და ამონაწერი სხვა დატვირთვას არ აჩვენებს.';
  const r = polishReport({
    summary: { label: 'BALANCED', statement: `ოფიციალური ინფორმაციის მიხედვით, პროექტს ნებართვა აქვს. ${rep}`, highlights: [] },
    keyFindings: [], sections: [{ key: 'PROJECT', title: 'პროექტი', body: `ოფიციალური ინფორმაციის მიხედვით, ფასადი — ალუმინისაა. ${rep}`, metrics: [], cites: [] }],
    attentionPoints: [], nextSteps: [], finalView: 'საჯაროდ ხელმისაწვდომი ინფორმაციის მიხედვით, ახლოს Karpuri-ა.',
    contractUpload: { recommend: true, text: '' }, mode: 'MODEL', rejectedBecause: [], evidenceUsed: [],
  });
  assert.match(r.summary.statement, /^ოფიციალური ინფორმაციის მიხედვით/, 'the basis is established once');
  assert.equal(r.sections[0].body, 'ფასადი, ალუმინისაა.');
  assert.equal(r.finalView, 'ახლოს კარფური-ა.');
});

test('team: legend fragments never render; each card carries its filing scope', () => {
  const cards = teamGroupsV2(F.PROJECT_TEAM_V2_LIVE).flatMap((g) => g.cards);
  const names = cards.map((c) => c.name);
  for (const junk of ['განგაშისა და', 'საქვეითე გადასასვლელი', 'საავტომობილო გადაადგილება', 'საშუალებები და პირობითი აღნიშვნები']) assert.ok(!names.includes(junk), junk);
  for (const n of ['დარეჯან შათაშვილი', 'დავით სორდია', 'ვასილ ტატიაშვილი', 'ია მშვიდობაძე', 'ბ. გოგოლაური', 'გიორგი ლეჟავა', 'ჯეტექს სოლუშენს']) assert.ok(names.includes(n), n);
  const sordia = cards.find((c) => c.name === 'დავით სორდია');
  assert.deepEqual(sordia.participation.single, { caseRef: 'AR11161121', date: '2026-09-17' });
  assert.equal(cards.find((c) => c.name === 'ჯეტექს სოლუშენს').group, 'ENGINEERING');
  const ui = fs.readFileSync(new URL('../../components/verify/PeopleBehind.tsx', import.meta.url), 'utf8');
  assert.match(ui, /verify_fn_part_one/);
  assert.ok(!/continuously/i.test(ui));
});

test('copy: six locales, placeholders intact, no em dashes, house terminology', () => {
  for (const [key, values] of Object.entries(VERIFY_FINAL_NARRATIVE_STRINGS)) {
    assert.equal(values.length, 6, key);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of values) {
      assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
      assert.ok(!/—/.test(v), `${key}: em dash`);
    }
  }
  const txt = Object.values(VERIFY_FINAL_NARRATIVE_STRINGS).flat().join('\n');
  assert.ok(!/confirmed buyer|შესატყვისი|ტბილისი/i.test(txt));
  const used = new Set();
  for (const f of ['TechnicalExplained', 'ProjectMath', 'ProjectStory', 'BuyerAssessment', 'PeopleBehind', 'OfficialIntelligence']) {
    for (const m of fs.readFileSync(new URL(`../../components/verify/${f}.tsx`, import.meta.url), 'utf8').matchAll(/'(verify_fn_[a-z0-9_]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(VERIFY_FINAL_NARRATIVE_STRINGS[k], `${k} has no copy`);
});

test('legend fragments from job dbf04e48 never render as people; real names do', async () => {
  const { legendFragment, plausibleName } = await import('../reportPresentation.ts');
  for (const junk of ['ასახული კოეფიციენტში', 'არსებული საზღრები']) assert.equal(legendFragment(junk), true, junk);
  for (const name of ['ზურაბი კულალაღაშვილი', 'გურამ ფშავლიშვილი', 'მიხეილ ჯინჭარაძე', 'დარეჯან შათაშვილი']) {
    assert.equal(legendFragment(name), false, name);
    assert.equal(plausibleName(name), true, name);
  }
  assert.equal(legendFragment('შპს ჯეო სითი დიღომი', true), false);
});
