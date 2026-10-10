// TAS property intelligence: consolidation, chronology, supersession,
// conflicts, participants, story, digest completeness, evidence budget, and
// the customer-report contract (no URLs, no repeated paragraphs, visual ids
// only from official TAS visuals).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTasIntelligence, tasDigest, normalizeRole, eventKind, valueIdentity } from '../tasIntelligence.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';
import { finalizeReport, deterministicReport, removeRepeatedSentences, validateReport, parseReport } from '../report.ts';
import { buildIntelligencePrompt } from '../prompt.ts';

const SHA = (c) => c.repeat(64);
const kase = (o) => ({ documentId: '1', registrationNumber: 'AR1', title: 't', docType: null, status: null, date: '2016-01-01', parties: [], values: [], technicalFacts: [], motions: [], attachments: [], ...o });

const report = () => ({
  officialVisuals: [
    { id: SHA('a'), role: 'LATEST_RENDER', kind: 'RENDER', date: '2024-05-10', width: 1600, height: 900 },
    { id: SHA('b'), role: 'EARLIEST_RENDER', kind: 'RENDER', date: '2016-02-01', width: 1600, height: 900 },
  ],
  browserOfficial: {
    results: [
      {
        source: 'tas',
        tasApi: {
          reconciliation: { sourceTotal: 4, reconciled: true },
          accounting: { motions: 9, attachments: 40, responses: { PDF: 5, HTML: 1 }, attachmentOutcomes: { READ_TEXT: 20, LOW_TEXT: 3, SCAN_OR_IMAGE_ONLY: 5, UNSUPPORTED_FORMAT: 10, NOT_PROCESSED_BUDGET: 2 } },
          cases: [
            kase({
              documentId: '639208', registrationNumber: 'AR639208', docType: 'არქიტექტურული პროექტის შეთანხმება', date: '2016-01-15',
              parties: [
                { role: 'APPLICANT', name: 'გიორგი ბერიძე', kind: 'PERSON' },
                { role: 'დამკვეთი', name: 'შპს მაგალითი დეველოპმენტი', kind: 'ORGANIZATION', organizationId: '405123456' },
              ],
              values: [
                { key: 'v1', label: 'სართულიანობა', value: '9' },
                { key: 'v2', label: 'შენობის სიმაღლე', value: '38,5 მ' },
              ],
              technicalFacts: [{ category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო კაპანაძე' }],
              motions: [{ motionId: '1', date: '2016-02-01', name: 'შეთანხმება დამტკიცდა', status: 'დასრულებული' }],
            }),
            kase({
              documentId: '761052', registrationNumber: 'AR761052', docType: 'მშენებლობის ნებართვა', date: '2018-03-01',
              values: [
                { key: 'v1', label: 'სართულიანობა', value: '9' },
                { key: 'v2', label: 'შენობის სიმაღლე', value: '38.5 m' },
                { key: 'v3', label: 'მშენებლობის დასრულების ვადა', value: '31.12.2020' },
              ],
              technicalFacts: [
                { category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო კაპანაძე' },
                { category: 'FOUNDATION', key: 'foundationType', value: 'ფილისებრი რკინაბეტონის ფილა' },
              ],
            }),
            kase({
              documentId: '1101896', registrationNumber: 'AR1101896', docType: 'ნებართვაში ცვლილება', date: '2023-06-01',
              values: [
                { key: 'v1', label: 'სართულიანობა', value: '12' },
                { key: 'v3', label: 'მშენებლობის დასრულების ვადა', value: '31.12.2026' },
                { key: 'v4', label: 'K2', value: '3.2' },
              ],
              technicalFacts: [{ category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო კაპანაძე-ბერიძე' }],
            }),
            kase({
              documentId: '1161121', registrationNumber: 'AR1161121', docType: 'კოეფიციენტის ცვლილება', date: '2023-06-01',
              values: [{ key: 'v4', label: 'K2', value: '3.4' }],
            }),
          ],
        },
        documents: [],
      },
    ],
  },
});

test('vocabulary: roles, event kinds and value identity across languages', () => {
  assert.equal(normalizeRole('დამკვეთი'), 'CLIENT');
  assert.equal(normalizeRole('Architect'), 'ARCHITECT');
  assert.equal(normalizeRole('Заказчик'), 'CLIENT');
  assert.equal(normalizeRole('APPLICANT'), 'APPLICANT');
  assert.equal(eventKind('ნებართვის ვადის გაგრძელება'), 'EXTENSION');
  assert.equal(eventKind('ნებართვაში ცვლილება'), 'AMENDMENT');
  assert.equal(eventKind('მშენებლობის ნებართვა'), 'PERMIT');
  assert.equal(eventKind('უარი ნებართვაზე'), 'REFUSAL');
  assert.equal(valueIdentity('38,5 მ'), valueIdentity('38.5 m'));
});

test('one fact per matter+value, all sources kept; later values supersede; old facts are kept, not dropped', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  assert.ok(t.available);
  const height = t.facts.filter((f) => f.key === 'height');
  assert.equal(height.length, 1, '38,5 მ and 38.5 m are the same fact');
  assert.equal(height[0].sources.length, 2);
  assert.equal(height[0].status, 'CURRENT');
  const floors = t.facts.filter((f) => f.key === 'floors');
  assert.equal(floors.length, 2);
  const old = floors.find((f) => f.value === '9');
  assert.equal(old.status, 'SUPERSEDED');
  assert.equal(old.supersededBy, '12');
  assert.equal(old.sources.length, 2, 'repeated 9-floor value is one fact with two sources');
  assert.equal(floors.find((f) => f.value === '12').status, 'CURRENT');
  const deadline = t.facts.filter((f) => f.key === 'constructionDeadline');
  assert.equal(deadline.find((f) => f.value === '31.12.2026').status, 'CURRENT');
  assert.equal(deadline.find((f) => f.value === '31.12.2020').status, 'SUPERSEDED');
});

test('same-date contradictory official values are CONFLICTING, never silently resolved', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  const k2 = t.facts.filter((f) => f.key === 'K2');
  assert.deepEqual(k2.map((f) => f.status), ['CONFLICTING', 'CONFLICTING']);
  assert.equal(t.conflicts.length, 1);
  assert.deepEqual(t.conflicts[0].values.map((v) => v.value).sort(), ['3.2', '3.4']);
});

test('timeline is ordered by real dates, not document ids', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  const dates = t.timeline.map((e) => e.date);
  assert.deepEqual(dates, dates.slice().sort());
  assert.ok(t.timeline.some((e) => e.kind === 'AMENDMENT' && e.date === '2023-06-01'));
});

test('participants: exact identity only, applicant never becomes owner; verified private applicants are named in their role', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  const arch = t.participants.filter((p) => p.roles.includes('ARCHITECT'));
  assert.equal(arch.length, 2, 'similar names are NOT merged');
  const nino = arch.find((p) => p.name === 'ნინო კაპანაძე');
  assert.equal(nino.cases, 2);
  assert.equal(nino.current, false, 'a later document names a different architect');
  assert.equal(arch.find((p) => p.name === 'ნინო კაპანაძე-ბერიძე').current, true);
  const applicant = t.participants.find((p) => p.name === 'გიორგი ბერიძე');
  assert.deepEqual(applicant.roles, ['APPLICANT']);
  // Owner, 2026-10-10: verified private participants are named — as what the documents say they are.
  assert.equal(applicant.customerVisible, true);
  assert.ok(!t.participants.some((p) => p.roles.includes('PARCEL_OWNER')));
  const org = t.participants.find((p) => p.organizationId === '405123456');
  assert.deepEqual(org.roles, ['CLIENT']);
  assert.equal(org.customerVisible, true);
});

test('story: chapters in order, ending with TODAY; visuals linked to the chapter they explain', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  const keys = t.story.map((c) => c.key);
  assert.equal(keys[keys.length - 1], 'TODAY');
  assert.ok(keys.includes('CHANGES') || keys.includes('RECENT'));
  const earliest = t.visuals.find((v) => v.role === 'EARLIEST_RENDER');
  assert.ok(earliest.chapter && earliest.chapter !== 'TODAY');
  assert.equal(t.coverage.implementation, 'API_FIRST');
  assert.equal(t.coverage.attachmentsAccounted, 40);
  assert.equal(t.coverage.reconciled, true);
});

test('digest: every HIGH fact and event survives any budget; archived detail is counted, never hidden', () => {
  const t = buildTasIntelligence(report(), '2026-10-08T00:00:00Z');
  const d = tasDigest(t, () => null, 50);
  for (const f of t.facts.filter((x) => x.materiality === 'HIGH')) assert.ok(d.text.includes(f.value), f.value);
  assert.ok(d.archivedFacts + d.archivedEvents > 0);
  assert.match(d.text, /Archived ≠ absent/);
  assert.ok(!/გიორგი ბერიძე/.test(d.text), 'private applicant not handed to the writer');
});

test('evidence package: TAS history has its own budget — 60 registry items and the history both survive', () => {
  const r = report();
  r.publicResearch = { facts: Array.from({ length: 70 }, (_, i) => `რეესტრის ფაქტი ნომერი ${i} ამ ქონებაზე`) };
  const pkg = buildEvidencePackage(r);
  const tasItems = pkg.items.filter((i) => i.tasRef);
  assert.ok(tasItems.length >= 8);
  assert.equal(pkg.items.filter((i) => i.tier === 1 && !i.tasRef).length, 60);
  assert.ok(pkg.tas.available);
  for (const [ref, id] of Object.entries(pkg.tasCite)) assert.ok(pkg.items.find((i) => i.id === id && i.tasRef === ref));
  assert.ok(tasItems.some((i) => i.historical), 'superseded values are carried as history');
});

test('prompt: carries the official history, visual ids and the untrusted-content rule', () => {
  const pkg = buildEvidencePackage(report());
  const { system, user } = buildIntelligencePrompt(pkg);
  assert.match(system, /UNTRUSTED CONTENT/);
  assert.match(system, /propertyStory/);
  const u = JSON.parse(user);
  assert.match(u.officialHistory, /CURRENT DOCUMENTED POSITION/);
  assert.equal(u.officialVisuals.length, 2);
});

test('report: URLs in customer prose are rejected; visual ids are limited to official TAS visuals', () => {
  const pkg = buildEvidencePackage(report());
  const cite = Object.values(pkg.tasCite)[0];
  const raw = (story) => JSON.stringify({
    summary: { label: 'BALANCED', statement: 'პროექტი ოფიციალურად შეთანხმებულია.', highlights: [{ dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE', headline: 'ნებართვა', detail: 'x', cites: [cite] }] },
    keyFindings: [], sections: [{ key: 'PROJECT', title: 'პროექტი', body: 'მოკლე.', metrics: [], cites: [cite] }],
    currentStatus: { statement: 'ნებართვა მოქმედებს.', items: [{ label: 'ვადა', value: '31.12.2026', date: '2023-06-01', cites: [cite] }] },
    propertyStory: { chapters: [story] },
    visualCaptions: [{ visualId: SHA('a'), caption: 'ვიზუალიზაცია', explanation: 'დამტკიცებული პროექტი.', cites: [] }, { visualId: SHA('f'), caption: 'ყალბი', explanation: 'x', cites: [] }],
    attentionPoints: [], nextSteps: [], finalView: '', contractUpload: { recommend: true, text: '' },
  });
  const bad = finalizeReport(pkg, raw({ key: 'APPROVALS', title: 'ნებართვა', period: '', body: 'იხილეთ https://docs.tbilisi.gov.ge/DownloadServlet?x=1', visualIds: [], cites: [cite] }));
  assert.equal(bad.mode, 'DETERMINISTIC');
  assert.ok(bad.rejectedBecause.some((p) => /URL/.test(p)));
  const good = finalizeReport(pkg, raw({ key: 'APPROVALS', title: 'ნებართვა', period: '2016', body: 'პროექტი 2016 წელს შეთანხმდა.', visualIds: [SHA('b'), SHA('c')], cites: [cite] }));
  assert.equal(good.mode, 'MODEL');
  assert.deepEqual(good.propertyStory.chapters[0].visualIds, [SHA('b')]);
  assert.deepEqual(good.visualCaptions.map((v) => v.visualId), [SHA('a')]);
});

test('deterministic fallback still tells the story and the current position, without dumping raw text', () => {
  const pkg = buildEvidencePackage(report());
  const r = deterministicReport(pkg);
  assert.ok(r.currentStatus.items.some((i) => i.value === '31.12.2026'));
  assert.ok(r.propertyStory.chapters.length >= 2);
  assert.equal(r.visualCaptions.length, 2);
  assert.ok(!r.sections.some((s) => /AR\d{6}|docs\.tbilisi/.test(s.body)), 'TAS items are told as story, not dumped into a section');
  // Prose only: visual ids are structural references the UI resolves, not text.
  const prose = [
    r.currentStatus.statement, ...r.currentStatus.items.flatMap((i) => [i.label, i.value]),
    ...r.propertyStory.chapters.flatMap((c) => [c.title, c.body]),
    ...r.visualCaptions.flatMap((v) => [v.caption, v.explanation]),
  ].join(' ');
  assert.ok(!/https?:|DownloadServlet|[a-f0-9]{64}|405123456|გიორგი ბერიძე/.test(prose));
});

test('no repeated paragraphs: a long sentence met once is not printed again later', () => {
  const sentence = 'მშენებლობის ნებართვის ვადა 2026 წლის 31 დეკემბრამდე გაგრძელდა, რაც პროექტს დასრულების დროს აძლევს.';
  const r = removeRepeatedSentences({
    summary: { label: 'BALANCED', statement: sentence, highlights: [] },
    currentStatus: { statement: sentence, items: [] },
    propertyStory: { chapters: [{ key: 'RECENT', title: 'x', period: '', body: `${sentence} შემდეგ ახალი ეტაპი დაიწყო და პროექტი განვითარდა.`, visualIds: [], cites: [] }] },
    keyFindings: [], sections: [{ key: 'PROJECT', title: 'p', body: sentence, metrics: [], cites: [] }], attentionPoints: [], nextSteps: [],
    finalView: sentence, contractUpload: { recommend: true, text: '' }, mode: 'MODEL', rejectedBecause: [], evidenceUsed: [],
  });
  const all = JSON.stringify(r);
  assert.equal(all.split('2026 წლის 31 დეკემბრამდე').length - 1, 1);
  assert.match(r.propertyStory.chapters[0].body, /ახალი ეტაპი/);
});

test('legacy (browser) TAS results still produce intelligence from document technical facts', () => {
  const t = buildTasIntelligence({ browserOfficial: { results: [{ source: 'tas', documents: [
    { id: 'd1', title: 'ნებართვა', date: '2019-05-01', technicalFacts: [{ category: 'PROJECT', key: 'floors', value: '10' }] },
    { id: 'd2', title: 'ცვლილება', date: '2021-05-01', technicalFacts: [{ category: 'PROJECT', key: 'floors', value: '11' }] },
  ] }] } }, '2026-10-08T00:00:00Z');
  assert.equal(t.coverage.implementation, 'LEGACY');
  assert.equal(t.facts.find((f) => f.value === '10').status, 'SUPERSEDED');
});

test('no TAS result: intelligence is unavailable and the package is unchanged in shape', () => {
  const t = buildTasIntelligence({}, '2026-10-08T00:00:00Z');
  assert.equal(t.available, false);
  const pkg = buildEvidencePackage({});
  assert.equal(pkg.tas, undefined);
  assert.equal(parseReport('{"summary":{"statement":"x","highlights":[]},"sections":[]}').propertyStory, undefined);
  assert.equal(validateReport(pkg, null).ok, false);
});
