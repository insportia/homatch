// The project story keeps the model's chapters (the owner's editorial
// baseline) and drops only the continuity the records do not show
// (owner, 2026-10-11, job eeefada9 Dighomi).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { guardStoryContinuity, earlierDifferentProject, stripListMarkers, periodLabel } from '../intelligence/storyGuard.ts';

// Production chapter text (synthesis_json.report.propertyStory, read 2026-10-11).
const CHAPTERS = [
  { key: 'EARLIEST', title: 'პროექტის პირველი ეტაპი', period: '2012-2013', body: 'ამ ნაკვეთთან დაკავშირებული საპროექტო ისტორია 2012 წლიდან იწყება. 2012 წლის 13 დეკემბერს გაიცა პირველი მშენებლობის ნებართვა, რომლის მოქმედების პერიოდიც 2013 წლისთვის იყო განსაზღვრული. იმ დროის დოკუმენტებში დამკვეთად და განმცხადებლად ვაჟა კულალაღაშვილი ფიქსირდება, მთავარ არქიტექტორად კი გიორგი როსტიაშვილი. 2013 წელს პროცესს დაემატა ილია ხავთასი და ნოე სოხაძე არქიტექტორისა და სპეციალისტის როლით. ეს ეტაპი აჩვენებს, რომ მიწის ნაკვეთს პროექტირების ისტორია დიდი ხნით ადრე ჰქონდა, ვიდრე დღევანდელი დეველოპერული კომპანია დარეგისტრირდებოდა. ძველი ნებართვა მოგვიანებით შეცვალა ახალმა საპროექტო ვერსიებმა, ამიტომ მისი ცალკე არსებობა დღევანდელი შენობის საბოლოო სახეს არ განსაზღვრავს.' },
  { key: 'INITIAL_PROJECT', title: 'ახალი პროექტის ჩამოყალიბება', period: '2023', body: '2023 წლის ივლისში პროექტის ფუნქცია საცხოვრებელი ობიექტიდან მრავალბინიან საცხოვრებელ სახლად განისაზღვრა. 10 აგვისტოს დამტკიცდა მიწის ნაკვეთის გამოყენების პირობები. პროექტის ახალი ფორმირება დაემთხვა შპს „ჯეო სითი დიღომის“ რეგისტრაციას 2023 წლის 27 ივლისს. ეს არის ის მომენტი, როცა ძველი საპროექტო ისტორია ახალ დეველოპერულ ორგანიზაციასთან ერთიანდება. შემდეგი პერიოდი უკვე მრავალბინიანი სახლის კორექტირებას, ტექნიკურ მაჩვენებლებსა და ნებართვების განახლებას დაეთმო.' },
  { key: 'APPROVALS', title: 'პროექტის დამტკიცება და ნებართვები', period: '2024-2025', body: '2024 წელს პროექტმა რამდენიმე ადმინისტრაციული ეტაპი გაიარა. 29 ივლისს შეთანხმდა პროექტი, ხოლო 2 სექტემბერს გაიცა მშენებლობის ნებართვა, რომელმაც 2012 წლის ძველი ნებართვა ჩაანაცვლა. 30 აპრილს გაიცა შემდეგი ნებართვა, რომელიც მოგვიანებით 2025 წლის 30 დეკემბერს დამტკიცებულმა შესწორებულმა პროექტმა ჩაანაცვლა.' },
  { key: 'CONSTRUCTION', title: 'შენობის ფორმა და სამშენებლო აღწერა', period: '2025-2026', body: 'რეესტრში შენობა და კონკრეტული ბინა მშენებარედ არის აღნიშნული.' },
  { key: 'TODAY', title: 'რას ნიშნავს ეს დღეს', period: '2026', body: 'პროექტს აქვს დამტკიცებული შესწორებული ვერსია.' },
];
// projectSignals.evolution (abridged to what the guard reads).
const EVOLUTION = [
  { filedOn: '2012-10-12', nomenclature: ['•  მიწის ნაკვეთის სამშენებლოდ გამოყენების პირობები'], acts: [{ buildingType: 'ინდივიდუალური საცხოვრებელი სახლ' }] },
  { filedOn: '2012-12-04', nomenclature: ['•  ინდივიდუალური ერთბინიანი საცხოვრებელი სახლი', '•  III კლასი'], acts: [{ buildingType: 'ინდივიდუალური საცხოვრებელი სახლ' }] },
  { filedOn: '2013-07-06', nomenclature: ['•  ინდივიდუალური ერთბინიანი საცხოვრებელი სახლი'], acts: [{ buildingType: 'ინდივიდუალური საცხოვრებელი სახლ' }] },
  { filedOn: '2023-07-26', nomenclature: ['საცხოვრებელი ობიექტები', 'მრავალბინიანი საცხოვრებელი სახლი'], acts: [{ buildingType: 'მრავალბინიანი საცხოვრებელი სახლ' }] },
  { filedOn: '2024-03-12', nomenclature: ['მრავალბინიანი საცხოვრებელი სახლი', 'IV კლასი'], acts: [] },
];

test('the earlier project on the parcel is recognised from the records', () => {
  assert.deepEqual(earlierDifferentProject(EVOLUTION), { kind: 'SINGLE_HOUSE', fromYear: '2012', toYear: '2013', currentFromYear: '2023' });
  // Same kind of building throughout: nothing to say.
  assert.equal(earlierDifferentProject(EVOLUTION.slice(3)), null);
  assert.equal(earlierDifferentProject(null), null);
});

test('unsupported continuity is removed; the documented facts and all five chapters stay', () => {
  const out = guardStoryContinuity(CHAPTERS, EVOLUTION);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((c) => c.title), CHAPTERS.map((c) => c.title));
  const all = out.map((c) => c.body).join(' ');
  assert.doesNotMatch(all, /ერთიანდება/);
  assert.doesNotMatch(all, /ძველი ნებართვა მოგვიანებით შეცვალა/);
  assert.doesNotMatch(all, /2012 წლის ძველი ნებართვა ჩაანაცვლა/);
  // The documented part of the cut sentence survives.
  assert.match(out[2].body, /2 სექტემბერს გაიცა მშენებლობის ნებართვა\./);
  // A later replacement that does not touch the earlier project stays verbatim.
  assert.match(out[2].body, /30 აპრილს გაიცა შემდეგი ნებართვა, რომელიც მოგვიანებით 2025 წლის 30 დეკემბერს/);
  // Names, dates and the company registration date are untouched.
  assert.match(out[0].body, /გიორგი როსტიაშვილი/);
  assert.match(out[1].body, /2023 წლის 27 ივლისს/);
  // The earlier project is named once, in the first chapter.
  assert.match(out[0].body, /2012–2013 წლების საქმეები ამავე მიწის ნაკვეთზე ინდივიდუალური ერთბინიანი საცხოვრებელი სახლის პროექტს ეხებოდა/);
  assert.equal((all.match(/ინდივიდუალური ერთბინიანი საცხოვრებელი სახლის პროექტს ეხებოდა/g) ?? []).length, 1);
  assert.doesNotMatch(all, /—/);
});

test('idempotent, and untouched without an earlier different project', () => {
  const once = guardStoryContinuity(CHAPTERS, EVOLUTION);
  assert.deepEqual(guardStoryContinuity(once, EVOLUTION), once);
  assert.deepEqual(guardStoryContinuity(CHAPTERS, EVOLUTION.slice(3)), CHAPTERS);
});

test('stray list markers and period ranges', () => {
  assert.equal(stripListMarkers('1.\nპირველი აბზაცი\n2. მეორე'), 'პირველი აბზაცი\nმეორე');
  assert.equal(periodLabel('2012-2013'), '2012–2013');
  assert.equal(periodLabel('2026'), '2026');
  assert.equal(periodLabel(''), null);
});

test('wiring: the narrative is primary and the technical chronology is one disclosure', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const oi = readFileSync(join(root, 'src/components/verify/OfficialIntelligence.tsx'), 'utf8');
  const block = oi.slice(oi.indexOf('export const PropertyStoryBlock'), oi.indexOf('const StoryChaptersDisclosure'));
  assert.match(block, /guardStoryContinuity\(/);
  // Narrative chapters render before the detailed chronology disclosure.
  assert.ok(block.indexOf('{chaptersList}') > -1 && block.indexOf('{chaptersList}') < block.indexOf('<StoryDetailsDisclosure'));
  assert.match(oi, /verify_v7_story_details/);
  // No numbered list for the narrative.
  assert.doesNotMatch(block.slice(block.indexOf('const chaptersList'), block.indexOf('return (')), /<ol/);
  const vs = readFileSync(join(root, 'supabase/functions/verify-synthesis/index.ts'), 'utf8');
  assert.match(vs, /keepStoryOnRebuild\(/);
});

test('an automatic rebuild keeps the stored v6+ chapters; a first build takes the new ones', async () => {
  const { keepStoryOnRebuild } = await import('../intelligence/storyGuard.ts');
  const prev = { _logicVersion: 6, report: { propertyStory: { chapters: CHAPTERS } } };
  const fresh = { chapters: [{ key: 'X', title: 'ახალი', body: 'ახალი ტექსტი.' }] };
  const kept = keepStoryOnRebuild(prev, fresh, { autoUpgrade: true, evolution: EVOLUTION });
  assert.deepEqual(kept.chapters.map((c) => c.title), CHAPTERS.map((c) => c.title));
  assert.doesNotMatch(kept.chapters[1].body, /ერთიანდება/);
  assert.deepEqual(keepStoryOnRebuild(prev, fresh, { autoUpgrade: false, evolution: EVOLUTION }).chapters.map((c) => c.key), ['X']);
  assert.deepEqual(keepStoryOnRebuild({ _logicVersion: 5, report: prev.report }, fresh, { autoUpgrade: true, evolution: null }).chapters.map((c) => c.key), ['X']);
  assert.equal(keepStoryOnRebuild({}, undefined, { autoUpgrade: true, evolution: null }), undefined);
});
