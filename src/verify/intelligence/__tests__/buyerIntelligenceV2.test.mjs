import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildEvidencePackage } from '../evidencePackage.ts';
import { buildIntelligencePrompt } from '../prompt.ts';
import { parseReport, validateReport, finalizeReport, deterministicReport,
         MAX_HIGHLIGHTS, MAX_KEY_FINDINGS } from '../report.ts';
import { buildIntelligenceBundle } from '../bundle.ts';
import {
  buildMarketIntelligence, scoreComparable, median, mean, positioningFor, askingCagrPct,
} from '../marketIntelligence.ts';
import { buildLocationIntelligence, streetOf } from '../locationIntelligence.ts';
import {
  buildPeopleIntelligence, parseRegistryDirectors, looksLikePersonName,
  redactPersonalData, identityKey, toParticipantModel,
} from '../peopleIntelligence.ts';
import { buildFxContext, decomposeGelChange, parseNbgUsd } from '../fx.ts';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/* Code with comments stripped. Every "this must NOT appear" assertion below
 * runs against THIS, because the comments explaining a removal legitimately
 * name the thing that was removed. */
const code = (p) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/*
 * BUYER INTELLIGENCE v2 — the refinement pass.
 *
 * v1 fixed starvation: the model finally received the research. Reading the
 * reports it produced exposed the next problem — it had the evidence and
 * still wrote like an auditor. These tests hold the shape of that fix, plus
 * the market / location / people / FX layers that now do the reasoning the
 * model should never have been doing.
 */

/* ---------------------------------------------------------------- *
 * Market intelligence                                               *
 * ---------------------------------------------------------------- */

const SUBJECT = { project: 'Villion', address: 'თბილისი, კრწანისის ქუჩა 6', area: 94.1, rooms: 3, floor: 6 };

const comp = (over = {}) => ({
  project: 'Villion', address: 'თბილისი, კრწანისის ქუჩა, 6', area: '94.30',
  price: '174455', currency: 'USD', pricePerSqm: '1850', rooms: '3',
  comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE', ...over,
});

test('median and mean are correct, including the even-length case', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(mean([2, 4, 6]), 4);
});

test('market statistics are computed over the comparables, not guessed', () => {
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ pricePerSqm: '1800' }), comp({ pricePerSqm: '1850' }), comp({ pricePerSqm: '1900' }),
  ]);
  assert.equal(m.median, 1850);
  assert.equal(m.mean, 1850);
  assert.equal(m.min, 1800);
  assert.equal(m.max, 1900);
  assert.equal(m.count, 3);
  assert.equal(m.askingNotTransaction, true);
});

test('price per m2 is derived from total/area when the listing omits it', () => {
  const c = scoreComparable(SUBJECT, comp({ pricePerSqm: null, price: '180000', area: '90' }));
  assert.equal(c.pricePerSqm, 2000);
});

test('thousands separators and currency symbols parse correctly', () => {
  const c = scoreComparable(SUBJECT, comp({ pricePerSqm: '$1,850' }));
  assert.equal(c.pricePerSqm, 1850);
});

test('a same-project listing always outranks one from elsewhere', () => {
  const same = scoreComparable(SUBJECT, comp());
  // A NAMED development in another district is a peer project, not anonymous
  // market stock — that classification became reachable when PEER_PROJECT
  // stopped depending on the research layer volunteering the label. The
  // invariant this test exists for is unchanged: it must never outrank the
  // same building.
  const namedElsewhere = scoreComparable(SUBJECT, comp({
    project: 'Other', address: 'თბილისი, საბურთალო', comparableType: 'CITY',
  }));
  assert.ok(same.relevance > namedElsewhere.relevance);
  assert.equal(same.tier, 'SAME_PROJECT');
  assert.equal(namedElsewhere.tier, 'PEER_PROJECT');

  // An UNBRANDED listing elsewhere is still the wider market.
  const anonymous = scoreComparable(SUBJECT, comp({
    project: null, address: 'თბილისი, საბურთალო', comparableType: 'CITY',
  }));
  assert.equal(anonymous.tier, 'WIDER_MARKET');
  assert.ok(same.relevance > anonymous.relevance);
});

test('the analysis is based on the narrowest band with enough listings', () => {
  const m = buildMarketIntelligence(SUBJECT, [
    comp({ pricePerSqm: '1800' }), comp({ pricePerSqm: '1900' }),
    comp({ project: 'Other', address: 'თბილისი, საბურთალო', comparableType: 'CITY', pricePerSqm: '900' }),
  ]);
  // The distant 900 must NOT drag the median down: it is not the micro-market.
  assert.equal(m.basis, 'SAME_PROJECT');
  assert.equal(m.median, 1850);
});

test('positioning thresholds are wide enough that noise is not a signal', () => {
  assert.equal(positioningFor(-15), 'BELOW_MARKET_RANGE');
  assert.equal(positioningFor(-6), 'ATTRACTIVE');
  assert.equal(positioningFor(-3), 'AROUND_MARKET');
  assert.equal(positioningFor(3), 'AROUND_MARKET');
  assert.equal(positioningFor(12), 'PREMIUM');
  assert.equal(positioningFor(25), 'SIGNIFICANT_PREMIUM');
});

test('with no subject price there is NO positioning — it is never invented', () => {
  const m = buildMarketIntelligence(SUBJECT, [comp(), comp({ pricePerSqm: '1900' })]);
  assert.equal(m.subjectPricePerSqm, undefined);
  assert.equal(m.positioning, undefined);
  assert.equal(m.deltaFromMedianPct, undefined);
});

test('with a subject price the delta is exact', () => {
  const m = buildMarketIntelligence(
    { ...SUBJECT, pricePerSqm: 1760 },
    [comp({ pricePerSqm: '1800' }), comp({ pricePerSqm: '1900' })]
  );
  assert.equal(m.median, 1850);
  assert.equal(m.deltaFromMedianPct, -4.9);
  assert.equal(m.positioning, 'ATTRACTIVE');
});

test('no comparables produces no market section rather than an empty one', () => {
  assert.equal(buildMarketIntelligence(SUBJECT, []), null);
  assert.equal(buildMarketIntelligence(SUBJECT, [{ project: 'x' }]), null);
});

test('CAGR refuses inputs that cannot support it', () => {
  assert.equal(askingCagrPct(1000, 1500, 2), 22.5);
  assert.equal(askingCagrPct(undefined, 1500, 2), null);
  assert.equal(askingCagrPct(1000, 1500, 0.2), null, 'a short span must not be annualised');
  assert.equal(askingCagrPct(0, 1500, 2), null);
});

/* ---------------------------------------------------------------- *
 * Location intelligence                                             *
 * ---------------------------------------------------------------- */

test('location is resolved from evidence, never invented', () => {
  const l = buildLocationIntelligence(['თბილისი, კრწანისის ქუჩა 6']);
  assert.equal(l.city, 'თბილისი');
  assert.equal(l.district, 'კრწანისი');
  assert.ok(l.street.includes('კრწანისის'));
  assert.ok(l.profile.likelyResidents.length);
});

test('an unrecognised area yields no characterisation at all', () => {
  const l = buildLocationIntelligence(['Somewhere unmapped 12']);
  assert.equal(l.district, undefined);
  assert.equal(l.profile, undefined);
});

test('no address at all is reported as minimal, not as a guess', () => {
  const l = buildLocationIntelligence([undefined, '']);
  assert.equal(l.minimal, true);
  assert.equal(l.profile, undefined);
});

test('streetOf does not hallucinate a street from a bare city name', () => {
  assert.equal(streetOf('თბილისი'), undefined);
});

/* ---------------------------------------------------------------- *
 * People intelligence                                               *
 * ---------------------------------------------------------------- */

/*
 * Shaped exactly like the real registry extract in production job 64cfea71,
 * where the directorate block was being discarded wholesale. The NAMES are
 * fictional; the SHAPE is real.
 */
const REGISTRY_EXTRACT =
  'მმართველობის ორგანო\\nსაერთო კრება\\nდირექტორატი\\n' +
  'ხელმძღვანელობა/წარმომადგენლობა\\nდირექტორატი\\n' +
  'ნინო ბერიძე, 01015005319 ,ერთობლივი\\n' +
  'დავით მაისურაძე, 01012012287 ,ერთობლივი\\nკაპიტალი';

test('the registry directorate block is parsed — it was previously discarded', () => {
  const { people, representation } = parseRegistryDirectors(REGISTRY_EXTRACT, 'შპს ტესტი');
  assert.equal(people.length, 2);
  assert.equal(representation, 'JOINT');
  assert.deepEqual(people.map((p) => p.name), ['ნინო ბერიძე', 'დავით მაისურაძე']);
  assert.ok(people.every((p) => p.role === 'DIRECTOR' && p.certainty === 'REGISTERED'));
});

test('personal ID numbers never survive extraction', () => {
  const { people } = parseRegistryDirectors(REGISTRY_EXTRACT, 'შპს ტესტი');
  for (const p of people) {
    assert.ok(!/\d{9,}/.test(p.name), `an identity number survived in ${p.name}`);
    assert.ok(!/\d{9,}/.test(p.support ?? ''), 'an identity number survived in the support text');
  }
  assert.equal(redactPersonalData('ნინო ბერიძე, 01015005319 ,ერთობლივი'), 'ნინო ბერიძე,ერთობლივი');
  assert.ok(!redactPersonalData('a@b.com +995 555 12 34 56').includes('@'));
});

test('joint representation becomes signing advice, not an allegation', () => {
  const p = buildPeopleIntelligence({
    companyProfile: { name: 'შპს ტესტი' },
    browserOfficial: { results: [REGISTRY_EXTRACT] },
  });
  assert.equal(p.representation, 'JOINT');
  assert.ok(p.representationNote.includes('ერთობლივად'));
  assert.ok(/მინდობილობ|ორივე/.test(p.representationNote), 'the note must say what to check');
  assert.ok(!/რისკ|საფრთხ|პრობლემ/.test(p.representationNote), 'people must not be framed as risk');
});

test('a sentence fragment is never mistaken for a person', () => {
  // Both of these are REAL malformed entities from the production job.
  assert.equal(looksLikePersonName('სს NoAR11148112 განცხადებით მომართა ლევან'), false);
  assert.equal(looksLikePersonName('შპს მილენიო გრუპის დირექტორები საზოგადოების ხელმძღვანელობასა და'), false);
  assert.equal(looksLikePersonName('შპს მილენიო გრუპი'), false);
  assert.equal(looksLikePersonName('ნინო ბერიძე'), true);
  assert.equal(looksLikePersonName('Jane Doe'), true);
});

test('a role is never invented for a discovered name', () => {
  const p = buildPeopleIntelligence({
    companyProfile: { name: 'შპს ტესტი' },
    publicResearch: { directorsRepresentatives: ['ნინო ბერიძე'] },
  });
  const person = p.people.find((x) => x.name === 'ნინო ბერიძე');
  assert.equal(person.certainty, 'PUBLICLY_REPORTED');
  assert.notEqual(person.certainty, 'REGISTERED', 'a reported name was promoted to a registry fact');
});

test('the same name at a DIFFERENT entity is not merged into one person', () => {
  const a = { name: 'ნინო ბერიძე', role: 'DIRECTOR', entity: 'A', representation: 'UNKNOWN', certainty: 'REGISTERED', historical: false, sourceKind: 'OFFICIAL_REGISTRY' };
  const b = { ...a, entity: 'B' };
  assert.notEqual(identityKey(a), identityKey(b));
});

test('no people evidence produces no people — never a placeholder', () => {
  const p = buildPeopleIntelligence({ companyProfile: { name: 'შპს ტესტი' } });
  assert.deepEqual(p.people, []);
  assert.equal(p.representation, 'UNKNOWN');
  assert.equal(p.representationNote, undefined);
});

test('the participant model is ready for contract-signatory comparison', () => {
  const p = buildPeopleIntelligence({
    companyProfile: { name: 'შპს ტესტი' },
    browserOfficial: { results: [REGISTRY_EXTRACT] },
  });
  const model = toParticipantModel(p, 'შპს ტესტი');
  assert.equal(model.representation, 'JOINT');
  assert.equal(model.authorisedSignatories.length, 2);
  assert.ok(model.authorisedSignatories.every((x) => x.name && x.role));
  // No internal ids, no support text, no personal data in the contract model.
  assert.deepEqual(Object.keys(model.authorisedSignatories[0]).sort(), ['certainty', 'name', 'role']);
});

test('a historical role is carried as historical, not as current', () => {
  const p = buildPeopleIntelligence({
    companyProfile: { name: 'შპს ტესტი', historicalChanges: ['2024 წელს დირექტორი შეიცვალა.'] },
  });
  assert.ok(p.corporateChanges.length);
  assert.ok(p.people.every((x) => x.historical === false || x.asOf));
});

/* ---------------------------------------------------------------- *
 * FX                                                                *
 * ---------------------------------------------------------------- */

test('FX decomposition separates the currency from the property', () => {
  const fx = buildFxContext(
    { date: '2024-01-01', gelPerUsd: 2.65 },
    { date: '2026-01-01', gelPerUsd: 2.7 }
  );
  assert.ok(fx);
  assert.equal(fx.gelDepreciationPct, 1.9);
  const d = decomposeGelChange(10, fx);
  assert.equal(d.totalGelPct, 10);
  assert.equal(d.fxAttributedPct, 1.9);
  assert.equal(d.realPct, 8.1);
});

test('FX refuses a span too short to mean anything', () => {
  assert.equal(
    buildFxContext({ date: '2026-01-01', gelPerUsd: 2.6 }, { date: '2026-03-01', gelPerUsd: 2.8 }),
    null
  );
});

test('FX is impossible without both rates', () => {
  assert.equal(buildFxContext(null, { date: '2026-01-01', gelPerUsd: 2.7 }), null);
  assert.equal(buildFxContext({ date: '2024-01-01', gelPerUsd: 0 }, { date: '2026-01-01', gelPerUsd: 2.7 }), null);
  assert.equal(decomposeGelChange(10, null), null);
});

test('the NBG payload parses, and anything malformed yields null', () => {
  const ok = parseNbgUsd([{ currencies: [{ code: 'USD', rate: 2.71, quantity: 1 }] }], '2026-01-01');
  assert.equal(ok.gelPerUsd, 2.71);
  assert.equal(parseNbgUsd({}, '2026-01-01'), null);
  assert.equal(parseNbgUsd([{ currencies: [{ code: 'EUR', rate: 3 }] }], '2026-01-01'), null);
});

test('the prompt states that FX is not appreciation', () => {
  const pkg = buildEvidencePackage({ publicResearch: { facts: ['x'] } });
  const { system, user } = buildIntelligencePrompt(pkg, undefined);
  assert.ok(/NEVER\s+evidence that the property will appreciate/.test(system));
  assert.ok(user.includes('fxIsNotAppreciation'));
});

/* ---------------------------------------------------------------- *
 * The report contract                                               *
 * ---------------------------------------------------------------- */

const RICH = {
  exactUnit: { code: '01.01.01.001.01.01.001', area: '94.10', floor: '6', unitNumber: '601' },
  companyProfile: { name: 'შპს ტესტი', idCode: '404670272', sourceBasis: 'REGISTRY_CONFIRMED' },
  browserOfficial: { results: [REGISTRY_EXTRACT] },
  publicResearch: {
    project: 'Test Project', developer: 'Test Dev', legalCompany: 'შპს ტესტი', companyId: '404670272',
    facts: ['პროექტი მდებარეობს თბილისში, კრწანისის ქუჩა 6-ში.'],
    partners: ['ბანკი — დაფინანსების პარტნიორად არის მითითებული.'],
    amenities: ['პარკინგი'],
  },
  legalStatus: {
    taxpayerStatus: { label: 'გადასახადის გადამხდელის სტატუსი', status: 'HUMAN_VERIFICATION_REQUIRED', note: 'ვერ დასრულდა.' },
    commissioning: { label: 'ექსპლუატაციაში მიღება', status: 'NOT_CONFIRMED', note: 'ვერ დადასტურდა.' },
  },
  market: { comparables: [comp(), comp({ pricePerSqm: '1900' })] },
};

test('there is NO "unconfirmed" field left in the report contract', () => {
  const src = read('src/verify/intelligence/report.ts');
  assert.ok(!/unconfirmed/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'the deficit field is back in the contract');
  const { system, user } = buildIntelligencePrompt(buildEvidencePackage(RICH));
  // v3 removed the checklist too, so the field it fed is gone as well.
  assert.ok(/There is NO "buyerActions" field/.test(system));
  assert.ok(/contextForAdvice/.test(user));
  assert.ok(!/turnTheseIntoAdvice/.test(user), 'the advice list is still named after a deficit');
});

test('incomplete checks reach the model as advice, not as a deficit list', () => {
  const pkg = buildEvidencePackage(RICH);
  assert.ok(pkg.unavailable.length, 'the incomplete checks were lost');
  const { user } = buildIntelligencePrompt(pkg);
  const parsed = JSON.parse(user);
  // Present as CONTEXT for advice, and never as a list to print back.
  assert.ok(Array.isArray(parsed.contextForAdvice));
  assert.equal(parsed.unconfirmed, undefined);
  assert.equal(parsed.couldNotBeConfirmed, undefined);
  assert.equal(parsed.turnTheseIntoAdvice, undefined);
});

test('a key finding with no consequence is rejected — that is a fact list', () => {
  // The v2 rules these replace required buyerActions to exist and to be
  // titled. Both existed to stop the checklist rendering as a meaningless
  // "1 2 3", and the checklist is gone. The equivalent failure now is a
  // finding that states something without saying why the buyer should care.
  const pkg = buildEvidencePackage(RICH);
  const noWhy = JSON.stringify({
    summary: {
      label: 'BALANCED', statement: 'ok',
      highlights: [{ dimension: 'LEGAL_CONTEXT', sentiment: 'BALANCED', headline: 'h', detail: 'd', cites: [pkg.items[0].id] }],
    },
    keyFindings: [{ finding: 'რაღაც დადგინდა.', whyItMatters: '', sentiment: 'BALANCED', cites: [pkg.items[0].id] }],
    sections: [{ key: 'LEGAL', title: 't', body: 'b', cites: [pkg.items[0].id] }],
  });
  const check = validateReport(pkg, parseReport(noWhy));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('does not say why it matters')));
});

test('the findings shortlist and the highlights are both capped', () => {
  const pkg = buildEvidencePackage(RICH);
  const id = pkg.items[0].id;
  const many = JSON.stringify({
    summary: {
      label: 'BALANCED', statement: 'ok',
      highlights: Array.from({ length: 12 }, (_, i) => ({
        dimension: 'PROJECT_QUALITY', sentiment: 'BALANCED',
        headline: 'h' + i, detail: 'd', cites: [id],
      })),
    },
    keyFindings: Array.from({ length: 20 }, (_, i) => ({
      finding: 'f' + i, whyItMatters: 'w', sentiment: 'BALANCED', cites: [id],
    })),
    sections: [{ key: 'LEGAL', title: 't', body: 'b', cites: [id] }],
  });
  const parsed = parseReport(many);
  assert.equal(parsed.summary.highlights.length, MAX_HIGHLIGHTS);
  assert.equal(parsed.keyFindings.length, MAX_KEY_FINDINGS);
});

test('a well-formed v2 report is accepted', () => {
  const pkg = buildEvidencePackage(RICH);
  const good = JSON.stringify({
    summary: {
      label: 'POSITIVE',
      statement: 'საერთო სურათი დადებითია.',
      highlights: [
        { dimension: 'MARKET_POSITION', sentiment: 'POSITIVE', headline: 'ბაზართან შესაბამისი ფასი', detail: 'იმავე პროექტის დონეზეა.', cites: [pkg.items[0].id] },
        { dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE', headline: 'დაბალი სიმჭიდროვე', detail: 'ბუტიკური ფორმატი.', cites: [pkg.items[0].id] },
      ],
    },
    keyFindings: [{ finding: 'ფასი ბაზრის დონეზეა.', whyItMatters: 'მოლაპარაკების სივრცე შეზღუდულია.', sentiment: 'BALANCED', cites: [pkg.items[0].id] }],
    sections: [{ key: 'MARKET', title: 'ფასი', body: 'ბაზარი', metrics: [{ label: 'მედიანა', value: '1,850 $/მ²' }], cites: [pkg.items[0].id] }],
    attentionPoints: [],
    finalView: 'დასკვნა.',
    contractUpload: { recommend: true, text: 'ატვირთეთ.' },
  });
  const final = finalizeReport(pkg, good);
  assert.equal(final.mode, 'MODEL', final.rejectedBecause.join('; '));
  assert.equal(final.summary.highlights.length, 2);
  assert.equal(final.sections[0].metrics[0].value, '1,850 $/მ²');
});

test('the deterministic fallback still produces a summary and passes its own gate', () => {
  const pkg = buildEvidencePackage(RICH);
  const d = deterministicReport(pkg);
  assert.ok(d.summary.statement, 'the fallback has no verdict at all');
  assert.ok(d.summary.highlights.length, 'the fallback has no highlights');
  assert.ok(d.keyFindings.every((f) => f.whyItMatters));
  // It must never trip the epistemic guard: it only ever restates evidence.
  assert.equal(validateReport(pkg, d).ok, true);
});

/* ---------------------------------------------------------------- *
 * The bundle                                                        *
 * ---------------------------------------------------------------- */

test('the bundle assembles snapshot, market, location, people and self-checks', () => {
  const pkg = buildEvidencePackage(RICH);
  const b = buildIntelligenceBundle(RICH, pkg, null);
  assert.equal(b.snapshot.area, '94.10');
  assert.equal(b.snapshot.floor, '6');
  assert.ok(b.market.count >= 2);
  assert.equal(b.location.district, 'კრწანისი');
  assert.equal(b.people.people.length, 2);
  assert.equal(b.participants.representation, 'JOINT');
});

test('self-checks carry the cadastral code and the company id to paste', () => {
  const pkg = buildEvidencePackage(RICH);
  const b = buildIntelligenceBundle(RICH, pkg, null);
  const property = b.selfChecks.find((c) => c.kind === 'PROPERTY_EXTRACT');
  const taxpayer = b.selfChecks.find((c) => c.kind === 'TAXPAYER_REGISTRY');
  assert.equal(property.copyValue, '01.01.01.001.01.01.001');
  assert.ok(property.url.includes('my.gov.ge'));
  assert.equal(taxpayer.copyValue, '404670272');
  assert.ok(taxpayer.url.includes('rs.ge'));
});

test('no cadastral code means no property self-check — never an empty one', () => {
  const b = buildIntelligenceBundle({}, buildEvidencePackage({}), null);
  assert.equal(b.selfChecks.length, 0);
});

/* ---------------------------------------------------------------- *
 * Presentation                                                      *
 * ---------------------------------------------------------------- */

const REPORT_TSX = () => read('src/components/verify/VerifyReport.tsx');

test('the primary report renders NO provenance chips', () => {
  const src = REPORT_TSX();
  assert.ok(!/const Citations/.test(src), 'the provenance chip component is back');
  assert.ok(!/PROVENANCE_KEY/.test(src), 'provenance labels are back in the primary report');
  // Sources live in the drawer instead.
  assert.ok(src.includes('verify_report_evidence_toggle'));
});

test('the primary report cannot render a portal URL from evidence', () => {
  const src = code('src/components/verify/VerifyReport.tsx');
  assert.ok(!/e\.url/.test(src), 'evidence URLs are rendered in the primary report again');
  assert.ok(!/myhome|ss\.ge/i.test(src), 'a listing portal is named on the customer surface');
  // The ONLY url the report may render is an official self-check portal.
  const urls = [...src.matchAll(/(\w+)\.url/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)], ['c'], `unexpected url source(s): ${urls.join(', ')}`);
});

test('there is no "could not confirm" block in the primary report', () => {
  const src = REPORT_TSX();
  assert.ok(!/unconfirmed/i.test(src), 'the deficit block is back on the customer surface');
  assert.ok(!src.includes('verify_ir_unconfirmed_title'));
});

test('the report shows a summary, snapshot, price position, people and self-checks', () => {
  const src = REPORT_TSX();
  // People became CompanyGraph: the flat list said "director, company" and
  // drew nothing, so it could not show who binds whom or who owns what.
  for (const c of ['SummaryHero', 'KeyFindings', 'Snapshot', 'PriceBar', 'CompanyGraph', 'SelfChecks']) {
    assert.ok(new RegExp(`const ${c}`).test(src), `${c} is missing from the report`);
  }
});

test('emphasis comes from structured metrics, not from regexing prose', () => {
  const src = REPORT_TSX();
  assert.ok(/const Metrics/.test(src), 'there is no metric rendering at all');
  assert.ok(/s\.metrics\?\.length/.test(src), 'metrics are not read from the section');
  // Highlighting arbitrary generated Georgian with patterns emphasises the
  // wrong half of a sentence and breaks the moment the wording changes.
  assert.ok(!/dangerouslySetInnerHTML|\.replace\(\/\b\(/.test(src),
    'the renderer is pattern-highlighting model prose');
});

/* ---------------------------------------------------------------- *
 * Loading + lifecycle                                               *
 * ---------------------------------------------------------------- */

test('no fake percentage progress anywhere in the Verify page', () => {
  const page = read('src/pages/VerifyPage.tsx');
  assert.ok(!/progress\?\.percent/.test(page), 'the percentage is back');
  // The percentage is back, but VerifyPage must not be the thing computing
  // it: a number derived from page state is a number that resets when the
  // page does. It belongs to verify/progress.ts, from server facts.
  assert.ok(!/\$\{pct\}%/.test(page), 'VerifyPage renders its own percentage again');
  assert.ok(page.includes('<ResearchStream'), 'the research stream is not wired');
});

test('the elapsed clock is the SERVER\'s, not this component\'s mount', () => {
  // This assertion used to demand the opposite, and was right at the time:
  // while the browser was the research engine, the component's mount really
  // was the start of the run. Research now outlives the tab, so a customer
  // can start a check, leave, and come back twelve minutes later — and a
  // mount-time clock would tell them 00:00. That is not a smaller version of
  // the truth, it is a different number.
  const stream = read('src/components/verify/ResearchStream.tsx');
  assert.ok(!/React\.useRef\(Date\.now\(\)\)/.test(stream),
    'the clock is owned by the component again — it will reset on remount');
  assert.ok(/createdAt/.test(stream), 'the stream no longer reads the server start time');
  assert.ok(/elapsedMs\(/.test(stream), 'elapsed time is not computed from the server timestamp');

  // Whatever drives repainting must not carry a dependency: a timer effect
  // that depends on a prop can be torn down before it ever ticks.
  const effect = stream.slice(stream.indexOf('setInterval'));
  assert.ok(/\}, \[\]\);/.test(effect.slice(0, 300)),
    'the interval effect has a dependency again');
});

test('the percentage is reconstructed from server facts, never accumulated', () => {
  const src = code('src/components/verify/ResearchStream.tsx');
  assert.ok(src.includes('estimateProgress('), 'the estimate is not computed by the shared module');
  // A percentage held in state is a percentage that resets. The whole
  // guarantee is that it is derived on every render from created_at + stage.
  assert.ok(!/useState[^;]*pct|setPct/.test(src), 'the percentage is being stored in state again');
  assert.ok(!/remaining|დარჩენილ/i.test(src), 'a remaining-time estimate is back');
  assert.ok(src.includes('verify_progress_estimated'),
    'the percentage is not labelled as an estimate');
});

test('the loading stream never names a source, provider or internal state', () => {
  const src = code('src/components/verify/ResearchStream.tsx');
  for (const leak of ['rs.ge', 'my.gov', 'napr', 'enreg', 'rstax', 'mygov', 'playwright', 'browserless', 'openai']) {
    assert.ok(!src.toLowerCase().includes(leak), `the stream leaks "${leak}"`);
  }
});

test('research finishing does not end the wait — the report must exist too', () => {
  const page = read('src/pages/VerifyPage.tsx');
  const at = page.indexOf("status==='COMPLETE'");
  const block = page.slice(at, at + 700);
  assert.ok(/loadSynthesis\(id\)\.finally\(\(\)=>setLoading\(false\)\)/.test(block),
    'loading still ends before the report is ready — COMPLETED + EMPTY is possible again');
});

test('the CAPTCHA participation message is gone from the waiting UI', () => {
  const notice = code('src/components/research/ResearchDepthNotice.tsx');
  assert.ok(!/CAPTCHA/i.test(notice), 'the CAPTCHA participation message is back');
  assert.ok(!/10–30|10-30/.test(notice), 'the unmeasured 10-30 minute promise is back');
});

/* ---------------------------------------------------------------- *
 * CAPTCHA-gated sources are no longer planned                       *
 * ---------------------------------------------------------------- */

test('RS.ge and my.gov are no longer scheduled by the worker plan', () => {
  const ctx = read('official-worker/src/orchestrator/ResearchContext.ts');
  assert.ok(/\['TAS_MAP', 'tas'\]/.test(ctx), 'mygov is still planned for cadastral runs');
  assert.ok(/for \(const source of \['enreg', 'debtor'\] as const\)/.test(ctx), 'rstax is still planned per entity');
});

test('the research agent no longer queues rstax', () => {
  const agent = read('supabase/functions/research-agent/index.ts');
  assert.ok(!agent.includes("['enreg', 'rstax', 'debtor']"), 'rstax is still queued');
  assert.ok(agent.includes("['enreg', 'debtor']"));
});

test('every OTHER research source remains active', () => {
  const ctx = read('official-worker/src/orchestrator/ResearchContext.ts');
  for (const kept of ['TAS_MAP', 'tas', 'enreg', 'napr', 'debtor']) {
    assert.ok(ctx.includes(`'${kept}'`), `${kept} was removed and should not have been`);
  }
});

test('the workflows themselves are kept, not deleted', () => {
  assert.ok(fs.existsSync(path.join(process.cwd(), 'official-worker/src/workflows/mygov')),
    'the mygov workflow was deleted rather than unscheduled');
});
