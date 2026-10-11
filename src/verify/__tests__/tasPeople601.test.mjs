// Project team for the production report of unit 01.18.06.019.055.03.01.601
// (job 8ba97da9-…): the case files name the architects, the experts and the
// construction-organisation author, but the report showed only the applicant,
// the client and a garbled "•••305) ნაცვლად - შპს „ქეი-ელ-გრუპი“".
//
// Root causes (fixed in tasProfessionals.ts / tasCaseSources.ts):
//   1. free text was read only up to line 4000 — the newest case's expert
//      report sits at line ~15 400 (after 55 pages of drawings);
//   2. drawing title blocks and two reports are AcadNusx ("darejan SaTaSvili");
//   3. title blocks ("label" / "Name" on separate lines) and slash signatures
//      ("daamuSava: / b. gogolauri /") had no reader;
//   4. a masked personal number "(პ/ნ: •••305)" turned a decision clause into
//      "label: value", and the organisation reader kept the whole clause.
import test from 'node:test';
import assert from 'node:assert/strict';

import { job601Report, text1161121, TAS } from './fixtures/job601TasPeople.mjs';
import {
  extractTasProfessionals, asOrganizationName, asPersonName, asSignatureName, teamKey, tidyRoleLabel, buildProjectTeamV2,
} from '../intelligence/tasProfessionals.ts';
import { readCaseSources, redactPersonal, decodeAcadNusx, looksAcadNusx, textSections } from '../intelligence/tasCaseSources.ts';
import { buildOfficialDossier } from '../intelligence/officialDossier.ts';

const DL = (id) => `https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=${id}`;
const SAFETY_FILE = 'კრწანისის N6 - 41 ექსპერტიზა კორექტირება 2025,08,2_250821_115026.pdf';

const team = extractTasProfessionals(job601Report());
const by = (n) => team.find((m) => m.name === n);
const codes = (n) => (by(n)?.roles ?? []).map((r) => r.code);
const roleIn = (n, caseRef, code) => by(n)?.roles.find((r) => r.caseRef === caseRef && (!code || r.code === code));

test('the expert report deep in the newest case is read (no 4000-line cap)', () => {
  const lineOf = (needle) => text1161121().split('\n').findIndex((l) => l.includes(needle));
  assert.ok(lineOf('პროექტის მთავარი არქიტექტორი') > 4000, 'the fixture reproduces the production position');

  for (const n of ['დარეჯან შათაშვილი', 'დავით სორდია']) {
    const r = roleIn(n, 'AR11161121', 'CHIEF_ARCHITECT');
    assert.ok(r, `${n} is the project's chief architect in AR11161121`);
    assert.equal(r.roleText, 'პროექტის მთავარი არქიტექტორი');
    assert.equal(r.documentTitle, SAFETY_FILE);
    assert.equal(r.sourceUrl, DL('5418990'));
    assert.equal(by(n).group, 'ARCHITECTURE');
  }
  const vasil = roleIn('ვასილ ტატიაშვილი', 'AR11161121');
  assert.equal(vasil.code, 'SAFETY_ASSESSMENT');
  assert.equal(vasil.roleText, 'ექსპერტი: შენობა-ნაგებობის უსაფრთხოების წესებთან შესაბამისობის საექსპერტო დასკვნა');
  assert.equal(vasil.documentTitle, SAFETY_FILE);
  assert.equal(by('ვასილ ტატიაშვილი').group, 'SAFETY');
  assert.equal(by('ვასილ ტატიაშვილი').roles.length, 1, 'signature + header are one documented role');
});

test('AcadNusx title blocks, signatures and reports are read in Georgian', () => {
  assert.equal(decodeAcadNusx('darejan SaTaSvili'), 'დარეჯან შათაშვილი');
  assert.equal(decodeAcadNusx('/ia mSvidobaZe/'), '/ია მშვიდობაძე/');
  assert.equal(looksAcadNusx('proeqtis avtori'), true);
  for (const en of ['GSPublisherVersion 0.0.100.100', 'MEP  SYSTEMS', 'CARD', 'ფოსტა INFO']) assert.equal(looksAcadNusx(en), false, en);

  const author = roleIn('დარეჯან შათაშვილი', 'AR11161121', 'ARCHITECT');
  assert.equal(author.roleText, 'პროექტის ავტორი, არქიტექტორი', 'the title block\'s own wording');
  assert.equal(author.documentTitle, 'გენგეგმა.pdf');
  assert.equal(author.sourceUrl, DL('5418975'));

  const ia = roleIn('ია მშვიდობაძე', 'AR11161121');
  assert.equal(ia.code, 'GEOTECHNICAL_EXPERT_ASSESSMENT');
  assert.equal(ia.roleText, 'ხელმომწერი: საინჟინრო-გეოლოგიური კვლევის საექსპერტო შეფასება');
  assert.equal(ia.documentTitle, 'გეოლ ექსპერტიზა.pdf');
  assert.equal(by('ია მშვიდობაძე').group, 'GEOTECHNICAL');

  // The signature prints an initial: the name stays as printed, never expanded.
  const b = roleIn('ბ. გოგოლაური', 'AR11161121');
  assert.equal(b.code, 'CONSTRUCTION_ORGANIZATION_SCHEDULE');
  assert.equal(b.roleText, 'დაამუშავა: მშენებლობის ორგანიზაციის პროექტი');
  assert.equal(b.documentTitle, 'მოპი სატრანსპორტო ღობე.pdf');
  assert.equal(by('ბ. გოგოლაური').group, 'CONSTRUCTION_ORG');
  assert.ok(!by('ბელა გოგოლაური'), 'a first name the record does not print is not invented');
  assert.equal(asSignatureName('ბ. გოგოლაური'), 'ბ. გოგოლაური');
  assert.equal(asSignatureName('ა. ბ.'), null);

  // Engineering parts: the performing company per part.
  const jetex = by('ჯეტექს სოლუშენს');
  assert.equal(jetex.kind, 'ORGANIZATION');
  assert.deepEqual(jetex.roles.map((r) => r.scope).sort(), ['გაზმომარაგების პროექტი', 'გათბობა-ვენტილაციის პროექტი', 'ელექტრობის პროექტი'].sort());
  assert.ok(jetex.roles.every((r) => r.code === 'MEP_ENGINEER'));
});

test('similar surnames are never merged; nobody the texts do not name is invented', () => {
  assert.notEqual(teamKey('PERSON', 'გოგა რეხვიაშვილი'), teamKey('PERSON', 'გიორგი რეხვიაშვილი'));
  assert.notEqual(teamKey('PERSON', 'ბ. გოგოლაური'), teamKey('PERSON', 'ბელა გოგოლაური'));
  // Two Rekhviashvilis with different assessments stay two people.
  const merged = buildProjectTeamV2([], [
    { name: 'გოგა რეხვიაშვილი', roles: ['EXPERT_REVIEW'] },
    { name: 'გიორგი რეხვიაშვილი', roles: ['STRUCTURAL_ENGINEER'] },
  ], []);
  assert.equal(merged.filter((m) => /რეხვიაშვილი$/.test(m.name)).length, 2);
  // The retained texts of this job do not name either Rekhviashvili in a role
  // (the adjacent-building file is a scan; "საექსპერტო დასკვნები.pdf" lies past
  // the stored 300 000-character cut) — so neither appears.
  assert.ok(!team.some((m) => /რეხვიაშვილ/.test(m.name)));
  // Each name is one member; every role carries case + public source.
  assert.equal(new Set(team.map((m) => teamKey(m.kind, m.name))).size, team.length);
  for (const m of team) for (const r of m.roles) {
    assert.ok(r.caseRef, `${m.name}: case`);
    assert.match(r.sourceUrl ?? '', /^https:\/\/docs\.tbilisi\.gov\.ge\//, `${m.name}: source`);
  }
});

test('directors, applicants and CV qualifications are never shown as architects', () => {
  // ლევან ჩაჩუა: applicant and the client company's director — never a designer.
  assert.equal(by('ლევან ჩაჩუა').group, 'DEVELOPER');
  assert.ok(!by('ლევან ჩაჩუა').roles.some((r) => /ARCHITECT|AUTHOR|ENGINEER|DESIGN/.test(r.code)));
  assert.ok(!by('ზურაბ მაისურაძე'), 'a director named in a decision is not a team member');
  // Tatiashvili's CV says "ბაკალავრის ხარისხი: არქიტექტორი" — a qualification, not his role here.
  assert.deepEqual(codes('ვასილ ტატიაშვილი'), ['SAFETY_ASSESSMENT']);
  // Mshvidobadze's CV ("…ს ექსპერტი გეოლოგიის დარგში", "ინჟინერ-მშენებლის") adds nothing.
  assert.deepEqual(codes('ია მშვიდობაძე'), ['GEOTECHNICAL_EXPERT_ASSESSMENT']);
  // Lezhava: on every drawing's title block without a printed role, and the applicant of AR11026464.
  assert.deepEqual(codes('გიორგი ლეჟავა').sort(), ['APPLICANT', 'DRAWING_TITLE_BLOCK']);
  assert.equal(by('გიორგი ლეჟავა').group, 'OTHER', 'not promoted to architecture');
  assert.match(roleIn('გიორგი ლეჟავა', 'AR11161121').roleText, /როლი მითითებული არ არის/);
  // A recurring drawing label is not a person.
  assert.ok(!team.some((m) => /სივრცე|ნიშნული|ბლოკი/.test(m.name)));

  // Synthetic: anything after a CV heading is the CV, not a project role.
  const synthetic = job601Report({ pad: 10 });
  const doc = synthetic.browserOfficial.results[0].documents[0];
  doc.rawText += '\n[undated · cv.pdf]\nCV - სანიმუშო პირი\nარქიტექტორი: ნიკა სანიმუშო\nკონსტრუქტორი: ლაშა სანიმუშო';
  const t2 = extractTasProfessionals(synthetic);
  assert.ok(!t2.some((m) => /სანიმუშო/.test(m.name)));
});

test('a decision clause yields the clean client organisation, never the clause', () => {
  const org = by('შპს „ქეი-ელ-გრუპი“');
  assert.ok(org, 'the client company is recovered');
  assert.equal(org.kind, 'ORGANIZATION');
  assert.equal(org.group, 'DEVELOPER');
  assert.deepEqual(org.roles.map((r) => [r.code, r.roleText, r.caseRef]), [['DEVELOPER', 'დამკვეთი', 'AR11026464']]);
  assert.ok(!team.some((m) => /•|ნაცვლად|დაფიქსირ|შეტანა|\(პ\/ნ/.test(m.name)), team.map((m) => m.name).join(' | '));
  assert.ok(!team.some((m) => m.roles.some((r) => /•|ნაცვლად|\(პ\/ნ/.test(r.roleText))));

  assert.equal(asOrganizationName('•••305) ნაცვლად - შპს „ქეი-ელ-გრუპი“'), 'შპს „ქეი-ელ-გრუპი“');
  assert.equal(asOrganizationName('•••305) ნაცვლად დაფიქსირდეს შპს'), null);
  assert.equal(asOrganizationName('შ.პ.ს. "არტიტექსი"'), 'შპს „არტიტექსი“');
  assert.equal(asOrganizationName('ქ. თბილისის მუნიციპალიტეტის სსიპ'), null, 'the reviewing authority');
  assert.doesNotMatch(redactPersonal('დამკვეთად ნინო ბერიძის (პ/ნ: •••000) ნაცვლად'), /•|პ\/ნ|\(|\)/);
});

test('form labels read as roles; the architect\'s firm is attached', () => {
  assert.equal(tidyRoleLabel('.მთავარი არქიტექტორის/სპეციალისტი სახელი და გვარი.'), 'მთავარი არქიტექტორი/სპეციალისტი');
  assert.equal(tidyRoleLabel('.დამკვეთ(ებ)ის სახელი და გვარი.'), 'დამკვეთი');
  const r = roleIn('დარეჯან შათაშვილი', 'AR11084312');
  assert.equal(r.code, 'CHIEF_ARCHITECT');
  assert.equal(r.roleText, 'მთავარი არქიტექტორი/სპეციალისტი');
  assert.equal(by('დარეჯან შათაშვილი').organization, 'შპს „არტიტექსი“');
  assert.equal(by('შპს „არტიტექსი“').roles[0].code, 'ARCHITECTURAL_ORGANIZATION');
  // Junk the old reader produced from the same texts.
  for (const junk of ['ქ. თბილისის მუნიციპალიტეტის სსიპ', 'გამოყენებული წესები', 'მრავალბინიანი საცხოვრებელი სახლი'])
    assert.ok(!team.some((m) => m.name === junk), junk);
  assert.equal(asPersonName('გამოყენებული წესები'), null);
  assert.equal(asPersonName('სატუმბი სივრცე'), null);
});

test('attachment sections keep their own file names', () => {
  const secs = textSections(text1161121(5));
  assert.deepEqual(secs.map((s) => s.fileName).filter(Boolean), ['გენგეგმა.pdf', 'გეგმები 16,09,2026.pdf', 'momijnave.pdf', SAFETY_FILE, 'მოპი სატრანსპორტო ღობე.pdf', 'გეოლ ექსპერტიზა.pdf']);
  assert.equal(readCaseSources(job601Report({ pad: 5 }))[0].caseRef, 'AR11161121');
});

test('the dossier carries the team into projectTeamV2 and the priority digest, without personal data', () => {
  const dossier = buildOfficialDossier(job601Report(), null, '2026-10-11T07:00:00Z');
  const names = dossier.projectTeamV2.map((m) => m.name);
  for (const n of ['დარეჯან შათაშვილი', 'დავით სორდია', 'ვასილ ტატიაშვილი', 'ია მშვიდობაძე', 'ბ. გოგოლაური', 'გიორგი ლეჟავა', 'შპს „ქეი-ელ-გრუპი“'])
    assert.ok(names.includes(n), n);
  const p1 = dossier.priorityCases.find((c) => c.caseRef === 'AR11161121');
  for (const n of ['დარეჯან შათაშვილი', 'დავით სორდია', 'ვასილ ტატიაშვილი', 'ია მშვიდობაძე', 'ბ. გოგოლაური'])
    assert.ok(p1.people.some((p) => p.name === n), `priority digest lists ${n}`);
  const groups = Object.fromEntries(dossier.projectTeamV2.map((m) => [m.name, m.group]));
  assert.equal(groups['დარეჯან შათაშვილი'], 'ARCHITECTURE');
  assert.equal(groups['ვასილ ტატიაშვილი'], 'SAFETY');
  assert.equal(groups['ია მშვიდობაძე'], 'GEOTECHNICAL');
  assert.equal(groups['ბ. გოგოლაური'], 'CONSTRUCTION_ORG');
  const json = JSON.stringify(dossier.projectTeamV2);
  assert.doesNotMatch(json, /•|\d{11}|პ\/ნ|@|ტელ/);
  assert.equal(TAS('1161121'), 'https://docs.tbilisi.gov.ge/architect/public.html?docId=1161121');
});
