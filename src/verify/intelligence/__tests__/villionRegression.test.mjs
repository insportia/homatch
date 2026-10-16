// Regression: the owner's live paid run of 2026-10-10 (job 220ed087,
// Villion Krtsanisi Homes, Krtsanisi St. 6, parcel 01.18.06.019.055,
// requested unit 01.18.06.019.055.03.01.503). The strings below are the
// REAL stored values and decision evidence of that job (private persons'
// names and personal numbers replaced). The report claimed "accepted into
// operation" nine times, showed garbage "what changed" rows and a garbage
// project team; this file holds every one of those defects shut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTasIntelligence, officialHistoryView, cleanValue, cleanParticipantName } from '../tasIntelligence.ts';
import { revalidateDecision, legalClaims, COMMISSIONING_OPERATIVE } from '../legalStatus.ts';
import { resolveIdentity, parseCadastral } from '../propertyIdentity.ts';

// Real stored evidence windows (old worker read these as COMMISSIONED).
const BANNER_RULE = 'რმოების მთელ პერიოდში და მოიხსნას შენობა-ნაგებობის მშენებლობის დასრულების ან/და ექსპლუატაციაში მიღების შემდეგ. დაუშვებელია მისი სარეკლამო მიზნებისათვის გამოყენება. შენიშვნა:შენიშვნა: კონკრეტული წესები იხილეთ საქართველოს მთავრობის 2009 წლი';
const LAW_CITATION = 'საქართველოს მთავრობის 2019 წლის 31 მაისის No255 დადგენილებით დამტკიცებული მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების, ქალაქ თბილისის';
const INTERMEDIATE_HEAD = 'ის თარიღი: - განცხადების ნომერი: AR1639208 შემოსვლის თარიღი: 07/12/2018 შედეგი: შუალედური ქალაქ თბილისის მუნიციპალიტეტის საჯარო სამართლის იურიდიული პირი ქალაქ თბილისის მუნიციპალიტეტის არქიტექტურის სამსახური გადაწყვეტილება No 4343358 მიწის ნ';

const SHA = (c) => c.repeat(64);
const motion = (date, number, outcome, evidence) => ({ motionId: number, date, name: null, status: null, response: 'PDF', decisionNumber: number, decision: { number, outcome, evidence, issueDate: date, validUntil: null } });
const kase = (o) => ({ documentId: '1', registrationNumber: 'AR1', title: null, docType: null, status: null, date: '2018-12-07', cadastralCodes: ['01.18.06.019.055'], parties: [], values: [], technicalFacts: [], motions: [], attachments: [], ...o });

// Nine amendment-era cases whose decisions the old reader called COMMISSIONED.
const FALSE_COMMISSIONING = [
  ['897963', '2022-07-11', '6030016'], ['919535', '2022-12-30', '6272569'], ['965637', '2023-05-19', '6469126'],
  ['968595', '2023-09-21', '6673781'], ['990786', '2023-10-04', '6689190'], ['942605', '2023-10-30', '6732848'],
  ['1034439', '2024-07-26', '7152431'], ['1084312', '2025-05-30', '7496274'], ['1101896', '2026-03-11', '7839183'],
];

const villion = () => ({
  exactUnit: { code: '01.18.06.019.055.03.01.503', verified: false },
  browserOfficial: {
    results: [{
      source: 'tas',
      tasApi: {
        accounting: { motions: 133, attachments: 440, attachmentOutcomes: { READ_TEXT: 276, SCAN_OR_IMAGE_ONLY: 53, NOT_PROCESSED_BUDGET: 103 } },
        cases: [
          kase({
            documentId: '639208', registrationNumber: 'AR1639208', date: '2018-12-07',
            parties: [{ kind: 'PERSON', name: 'პირველი განმცხადებელი', role: 'APPLICANT' }],
            technicalFacts: [
              { key: 'buildingFunction', value: 'არასასოფლო სამეურნეო' },
              { key: 'applicant', value: 'პირველი განმცხადებელი პ/ნ 01000000001' },
              { key: 'buildingFunction', value: '....ქმედებები: 1662.0' },
              { key: 'buildingFunction', value: '> ....ფუნქციური დანიშნულების ჯგუფი: რადგან მიწის ნაკვეთი მდებარეობს ზოგად საცხოვრებელ' },
              { key: 'buildingFunction', value: ';' },
              { key: 'floors', value: 'ან/და გაბარიტები.' },
              { key: 'geotechnicalSpecialist', value: '"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან შპს "რეალექსპერტი"-ს ექსპერტი გეოლოგიის დარგში.' },
              { key: 'coAuthors', value: 'ს - დავით ხაბულიანის სანოტარო წესით' },
            ],
            motions: [
              motion('2018-12-13', '4303543', 'DEFICIENCY', 'მიღების შემდეგ) აღნიშნული დოკუმენტი უნდა ატვირთოთ ამავე განაცხადის შესაბამის დახარვეზებულ ველში'),
              motion('2019-02-09', '4343358', 'APPROVED', INTERMEDIATE_HEAD),
              motion('2019-02-20', '4381827', 'COMMISSIONED', BANNER_RULE),
            ],
          }),
          kase({
            documentId: '668968', registrationNumber: 'AR1668968', date: '2021-09-16',
            technicalFacts: [
              { key: 'buildingFunction', value: 'არასასოფლო-სამეურნეომიზნობრივი დანიშნულება: არასასოფლო-სამეურნეო' },
              { key: 'buildingFunction', value: 'მრავალბინიანი საცხოვრებელი სახლიმრავალბინიანი საცხოვრებელი სახლი' },
              { key: 'depth', value: 'მინიმალური სიღრმე' },
            ],
          }),
          ...FALSE_COMMISSIONING.map(([doc, date, num]) => kase({
            documentId: doc, registrationNumber: `AR1${doc}`, date,
            cadastralCodes: ['01.18.06.019.055', '01.18.06.019.055.01.01.503'],
            motions: [motion(date, num, 'COMMISSIONED', LAW_CITATION)],
          })),
        ],
      },
    }],
  },
});

test('Villion: no "accepted into operation" from a cited law, a banner rule or an intermediate result', () => {
  assert.equal(revalidateDecision({ outcome: 'COMMISSIONED', evidence: BANNER_RULE }).outcome, 'UNDETERMINED');
  assert.equal(revalidateDecision({ outcome: 'COMMISSIONED', evidence: LAW_CITATION }).outcome, 'UNDETERMINED');
  assert.equal(revalidateDecision({ outcome: 'APPROVED', evidence: INTERMEDIATE_HEAD }).outcome, 'INTERMEDIATE');
  // A real act still counts.
  assert.equal(revalidateDecision({ outcome: 'COMMISSIONED', evidence: 'ვბრძანებ: შენობა-ნაგებობა მიღებულ იქნეს ექსპლუატაციაში' }).outcome, 'COMMISSIONED');

  const intel = buildTasIntelligence(villion(), '2026-10-10T16:00:00Z');
  assert.ok(intel.available);
  assert.equal(intel.timeline.filter((e) => e.kind === 'COMMISSIONING').length, 0, 'no commissioning events');
  assert.notEqual(intel.officialStatus.state, 'COMMISSIONED');
  const approved = intel.legalClaims.find((c) => c.key === 'COMMISSIONING_APPROVED');
  const applied = intel.legalClaims.find((c) => c.key === 'COMMISSIONING_APPLIED');
  assert.equal(approved.status, 'NOT_VERIFIED');
  assert.equal(applied.status, 'NOT_VERIFIED', 'not verified — which is not the same as "never applied"');

  const view = officialHistoryView(intel);
  assert.ok(!view.milestones.some((m) => m.kind === 'COMMISSIONING' || m.outcome === 'COMMISSIONED'));
  assert.ok(!view.milestones.some((m) => m.kind === 'OTHER' && !m.outcome), 'no bare reference-number milestones');
  assert.ok(view.legal.length >= 5);
});

test('Villion: OCR fragments and doubled PDF text never become "what changed" history', () => {
  assert.equal(cleanValue('buildingFunction', '....ქმედებები: 1662.0'), null);
  assert.equal(cleanValue('buildingFunction', ';'), null);
  assert.equal(cleanValue('buildingFunction', '> ....ფუნქციური დანიშნულების ჯგუფი: რადგან მიწის ნაკვეთი მდებარეობს ზოგად საცხოვრებელ'), null);
  assert.equal(cleanValue('buildingFunction', 'არასასოფლო-სამეურნეომიზნობრივი დანიშნულება: არასასოფლო-სამეურნეო'), null, 'a land category is not a building use');
  assert.equal(cleanValue('floors', 'ან/და გაბარიტები.'), null);
  assert.equal(cleanValue('buildingFunction', 'მრავალბინიანი საცხოვრებელი სახლიმრავალბინიანი საცხოვრებელი სახლი'), 'მრავალბინიანი საცხოვრებელი სახლი');
  assert.equal(cleanValue('floors', '9'), '9');

  const view = officialHistoryView(buildTasIntelligence(villion(), '2026-10-10T16:00:00Z'));
  for (const e of view.evolution) {
    assert.doesNotMatch(`${e.from} ${e.to}`, /\.\.\.\.|ქმედებები|რადგან|ან\/და|^;$/u, `garbage evolution row: ${e.from} → ${e.to}`);
  }
});

test('Villion: the project team holds names, not CV lines or notarial fragments; no personal numbers', () => {
  assert.equal(cleanParticipantName('"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან შპს "რეალექსპერტი"-ს ექსპერტი გეოლოგიის დარგში.'), null);
  assert.equal(cleanParticipantName('ს - დავით ხაბულიანის სანოტარო წესით'), null);
  assert.equal(cleanParticipantName('პირველი განმცხადებელი პ/ნ 01000000001'), 'პირველი განმცხადებელი');
  assert.equal(cleanParticipantName('შპს მილენიო გრუპი'), 'შპს მილენიო გრუპი');

  const intel = buildTasIntelligence(villion(), '2026-10-10T16:00:00Z');
  for (const p of intel.participants) {
    assert.doesNotMatch(p.name, /\d{8,}|წლიდან|წესით/u, p.name);
  }
  const team = officialHistoryView(intel).team ?? [];
  assert.ok(!team.some((m) => /იმკ-91|სანოტარო/u.test(m.name)));
});

test('Villion: unit …03.01.503 and …01.01.503 are different apartments — an unresolved identity question', () => {
  assert.deepEqual(parseCadastral('01.18.06.019.055.03.01.503'), { code: '01.18.06.019.055.03.01.503', parcel: '01.18.06.019.055', building: '03', section: '01', unit: '503' });
  const id = resolveIdentity('01.18.06.019.055.03.01.503', villion().browserOfficial);
  assert.equal(id.status, 'UNRESOLVED_MISMATCH');
  assert.deepEqual(id.nearMatches, ['01.18.06.019.055.01.01.503']);
  assert.equal(id.unitDocumented, false);
  assert.deepEqual(id.documentedBuildings, ['01']);
  // The exact unit documented and nothing near it → confirmed.
  // Asking for the unit the papers DO name is confirmed.
  assert.equal(resolveIdentity('01.18.06.019.055.01.01.503', villion().browserOfficial).status, 'CONFIRMED');
  assert.equal(resolveIdentity('01.18.06.019.055.01.01.503', { codes: ['01.18.06.019.055.01.01.503'] }).status, 'CONFIRMED');
  // Parcel-only request.
  assert.equal(resolveIdentity('01.18.06.019.055', villion().browserOfficial).status, 'PARCEL_ONLY');
});

test('legal claims: another block\'s permit is only PARTIALLY_CONFIRMED for the target building', () => {
  const claims = legalClaims([{ date: '2022-01-01', caseRef: 'AR1', block: '01', decision: { number: '1', outcome: 'PERMIT_ISSUED', evidence: 'ნებართვა გაიცეს' } }], { block: '03' });
  assert.equal(claims.find((c) => c.key === 'PERMIT_ISSUED').status, 'PARTIALLY_CONFIRMED');
  const own = legalClaims([{ date: '2022-01-01', caseRef: 'AR1', block: '03', decision: { number: '1', outcome: 'PERMIT_ISSUED', evidence: 'ნებართვა გაიცეს' } }], { block: '03' });
  assert.equal(own.find((c) => c.key === 'PERMIT_ISSUED').status, 'CONFIRMED');
  const revoked = legalClaims([
    { date: '2022-01-01', caseRef: 'AR1', block: null, decision: { number: '1', outcome: 'PERMIT_ISSUED', evidence: '' } },
    { date: '2023-01-01', caseRef: 'AR2', block: null, decision: { number: '2', outcome: 'SUSPENDED', evidence: '' } },
  ]);
  assert.equal(revoked.find((c) => c.key === 'PERMIT_ISSUED').status, 'CONFLICTING');
  for (const c of claims) assert.ok(['CONFIRMED', 'PARTIALLY_CONFIRMED', 'CONFLICTING', 'NOT_VERIFIED', 'NOT_APPLICABLE'].includes(c.status));
});

test('the report-side operative rule and the worker rule stay identical', () => {
  const worker = readFileSync(new URL('../../../../official-worker/src/workflows/tas/api/decisions.ts', import.meta.url), 'utf8');
  const m = /outcome: 'COMMISSIONED', re: \/(.+?)\/giu/.exec(worker);
  assert.ok(m, 'worker COMMISSIONED rule found');
  assert.equal(m[1], COMMISSIONING_OPERATIVE.source, 'keep official-worker decisions.ts and legalStatus.ts in sync');
});
