// One fact, one home.
//
// Measured on production job 81356bea, whole occurrences in the synthesis:
//
//   developer 35 · parking 14 · commissioning 9 · floors 6 · unit count 5
//
// The same facts explained in the summary, the key findings, the project
// section, the attention points and the final view. The fixtures below are
// written in the shape and language that report actually used.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sentences,
  numbersIn,
  topicsIn,
  addsSomethingNew,
  isParkingConfirmationPrompt,
  dedupeBlock,
  TOPIC_OWNER,
} from '../dedupe.ts';
import { finalizeReport } from '../report.ts';

/* ── the pieces ──────────────────────────────────────────────────────── */

test('sentences split Georgian prose without losing any of it', () => {
  const t = 'ორი 8-სართულიანი შენობა. სულ 42 ბინა. მიწისქვეშა პარკინგი.';
  const s = sentences(t);
  assert.equal(s.length, 3);
  assert.equal(s.join(' '), t);
});

test('numbers are compared regardless of thousands separators', () => {
  assert.deepEqual(numbersIn('ფასი 1,899 დოლარი'), ['1899']);
  assert.ok(numbersIn('185,000').includes('185000'));
});

test('a topic is recognised by the words a writer would really use', () => {
  assert.deepEqual(topicsIn('მიწისქვეშა პარკინგი 42 ადგილით'), ['PARKING']);
  assert.ok(topicsIn('ორი 8-სართულიანი შენობა').includes('BUILDING_SPEC'));
  assert.ok(topicsIn('დეველოპერი Millenio Group').includes('DEVELOPER'));
  // An unrelated sentence is never claimed by a topic.
  assert.deepEqual(topicsIn('ქონება მდებარეობს კრწანისში.'), []);
});

test('a repeat that carries a new number is not a repeat', () => {
  assert.equal(addsSomethingNew('პარკინგი 42 ადგილით.', 'მიწისქვეშა პარკინგი.'), true);
  assert.equal(addsSomethingNew('ასევე არის პარკინგი.', 'მიწისქვეშა პარკინგი 42 ადგილით.'), false);
  // The same number restated is still a repeat.
  assert.equal(addsSomethingNew('პარკინგი 42 ადგილით.', 'პარკინგი 42 ადგილით.'), false);
});

/* ── parking stops being a warning ───────────────────────────────────── */

test('a parking confirmation instruction is recognised in both languages', () => {
  assert.ok(isParkingConfirmationPrompt('ხელშეკრულებაში გადაამოწმეთ, შედის თუ არა პარკინგი.'));
  assert.ok(isParkingConfirmationPrompt('Confirm whether a parking space is included in the purchase.'));
  assert.ok(isParkingConfirmationPrompt('პარკინგის საკითხი უნდა შემოწმდეს ხელშეკრულებით.'));
});

test('describing parking as an amenity is not a warning', () => {
  assert.equal(isParkingConfirmationPrompt('პროექტს აქვს მიწისქვეშა პარკინგი 42 ადგილით.'), false);
  assert.equal(isParkingConfirmationPrompt('The project has underground parking.'), false);
});

test('a parking confirmation outside the project section is dropped', () => {
  const seen = new Map();
  const r = dedupeBlock(
    { block: 'attentionPoints', text: 'ხელშეკრულებაში გადაამოწმეთ, შედის თუ არა პარკინგი ფასში.' },
    seen
  );
  assert.equal(r.keep, '');
  assert.equal(r.removed.length, 1);
});

test('the project section may still state its own parking', () => {
  const seen = new Map();
  const r = dedupeBlock(
    { block: 'section', sectionKey: 'PROJECT', text: 'პროექტს აქვს მიწისქვეშა პარკინგი 42 ადგილით.' },
    seen
  );
  assert.ok(r.keep.includes('პარკინგი'), 'the project lost its own amenity');
});

/* ── ownership ───────────────────────────────────────────────────────── */

test('the owning section keeps the fact and later blocks lose the repeat', () => {
  const seen = new Map();
  const project = dedupeBlock(
    { block: 'section', sectionKey: 'PROJECT', text: 'ორი 8-სართულიანი შენობა და სულ 42 ბინა.' },
    seen
  );
  assert.ok(project.keep.includes('42'), 'the owner lost its own fact');

  const final = dedupeBlock({ block: 'finalView', text: 'პროექტში ორი 8-სართულიანი შენობაა.' }, seen);
  assert.equal(final.keep, '', 'the final view repeated the project section');
});

test('a later block keeps a sentence that adds a number the owner did not state', () => {
  const seen = new Map();
  dedupeBlock({ block: 'section', sectionKey: 'PROJECT', text: 'მიწისქვეშა პარკინგი.' }, seen);
  const market = dedupeBlock(
    { block: 'section', sectionKey: 'MARKET', text: 'პარკინგის ღირებულება ცალკეა, დაახლოებით 15000 დოლარი.' },
    seen
  );
  assert.ok(market.keep.includes('15000'), 'a genuinely new figure was removed');
});

test('a sentence about nothing we track is never touched', () => {
  const seen = new Map();
  const t = 'ქონება მდებარეობს კრწანისში, ცენტრთან ახლოს.';
  assert.equal(dedupeBlock({ block: 'finalView', text: t }, seen).keep, t);
});

test('every topic has an owning section', () => {
  for (const [topic, owner] of Object.entries(TOPIC_OWNER)) {
    assert.ok(['PROJECT', 'PEOPLE', 'MARKET', 'LOCATION', 'LEGAL'].includes(owner),
      `${topic} is owned by a section that does not exist`);
  }
});

/* ── the whole report ────────────────────────────────────────────────── */

const repetitiveReport = () =>
  JSON.stringify({
    summary: {
      label: 'BALANCED',
      statement: 'პროექტში ორი 8-სართულიანი შენობაა და სულ 42 ბინა.',
      highlights: [{ headline: 'დაბალსიმჭიდროვიანი პროექტი.', dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE', detail: '', cites: [] }],
    },
    keyFindings: [
      {
        finding: 'პროექტს აქვს მიწისქვეშა პარკინგი.',
        whyItMatters: 'პარკინგი ზრდის ბინის ღირებულებას.',
        dimension: 'PROJECT',
        sentiment: 'POSITIVE',
        cites: [],
      },
      {
        finding: 'დეველოპერია Millenio Group.',
        whyItMatters: 'დეველოპერის გამოცდილება მნიშვნელოვანია.',
        dimension: 'PROJECT',
        sentiment: 'BALANCED',
        cites: [],
      },
    ],
    sections: [
      { key: 'PROJECT', title: 'პროექტი', body: 'ორი 8-სართულიანი შენობა, სულ 42 ბინა და მიწისქვეშა პარკინგი.', metrics: [], cites: [] },
      { key: 'PEOPLE', title: 'ხალხი', body: 'დეველოპერია Millenio Group.', metrics: [], cites: [] },
    ],
    attentionPoints: [
      { point: 'გადაამოწმეთ, შედის თუ არა პარკინგი ფასში.', why: 'პარკინგი შეიძლება ცალკე იყიდებოდეს.', cites: [] },
      { point: 'დამოუკიდებელი იურიდიული შემოწმება.', why: 'ხელშეკრულებამდე.', cites: [] },
    ],
    finalView: 'პროექტში ორი 8-სართულიანი შენობაა და აქვს მიწისქვეშა პარკინგი. დეველოპერია Millenio Group.',
    contractUpload: { recommend: true, text: '' },
  });

const countAll = (r, re) => {
  const blob = [
    r.summary?.statement ?? '',
    ...r.keyFindings.map((f) => f.finding),
    ...r.sections.map((s) => s.body),
    ...r.attentionPoints.flatMap((a) => [a.point, a.why]),
    r.finalView,
  ].join(' ');
  return (blob.match(re) ?? []).length;
};

test('a repetitive report collapses to one mention per fact', () => {
  const final = finalizeReport({ items: [] }, repetitiveReport());
  // The fixture must be a report the evidence gate ACCEPTS, otherwise this
  // would be measuring the deterministic fallback instead of the dedupe.
  assert.equal(final.mode, 'MODEL', 'the fixture was rejected before dedupe ran');

  assert.equal(countAll(final, /პარკინგ/g), 1, 'parking is still repeated');
  assert.equal(countAll(final, /სართულიან/g), 1, 'the building spec is still repeated');
  assert.equal(countAll(final, /Millenio/g), 1, 'the developer is still repeated');
});

test('the owning section is the one that kept each fact', () => {
  const final = finalizeReport({ items: [] }, repetitiveReport());
  const project = final.sections.find((s) => s.key === 'PROJECT');
  const people = final.sections.find((s) => s.key === 'PEOPLE');
  assert.ok(/პარკინგ/.test(project.body), 'PROJECT lost parking');
  assert.ok(/სართულიან/.test(project.body), 'PROJECT lost the building spec');
  assert.ok(/Millenio/.test(people.body), 'PEOPLE lost the developer');
});

test('the parking warning is gone but the real attention point survives', () => {
  const final = finalizeReport({ items: [] }, repetitiveReport());
  assert.ok(!final.attentionPoints.some((a) => /პარკინგ/.test(`${a.point} ${a.why}`)),
    'parking is still an attention point');
  assert.ok(final.attentionPoints.some((a) => /იურიდიული/.test(a.point)),
    'a genuine attention point was removed with it');
});

test('nothing is invented and no block is emptied into nonsense', () => {
  const final = finalizeReport({ items: [] }, repetitiveReport());
  assert.ok(final.summary.statement.length > 0, 'the summary was emptied');
  assert.ok(final.sections.every((s) => s.body.trim().length > 0), 'a section was emptied');
  assert.ok(Array.isArray(final.keyFindings));
});
