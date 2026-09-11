import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildEvidencePackage, evidenceRichness, isPresentable,
} from '../evidencePackage.ts';
import { buildIntelligencePrompt } from '../prompt.ts';
import { parseReport, validateReport, finalizeReport, deterministicReport } from '../report.ts';

/*
 * BUYER INTELLIGENCE — the synthesis regression suite.
 *
 * The old synthesis was starved: extractClaims() never read `publicResearch`
 * at all, and the prompt reduced every surviving fact to a bare sentence. So
 * the model produced "a mortgage exists" while the research already knew the
 * same bank publicly finances the project.
 *
 * These tests hold the shape of the fix. The model is not called here — what
 * is under test is (a) that the evidence reaches it and (b) that nothing
 * ungrounded can get past the gate on the way back.
 */

/* ---------------------------------------------------------------- *
 * The real regression subject                                       *
 * ---------------------------------------------------------------- */

/*
 * Modelled on production job 64cfea71 for 01.18.06.019.055.03.01.601.
 * The FINDINGS are deliberately not asserted as truth anywhere — only that
 * IF the evidence package carries them, the pipeline treats them correctly.
 * A future re-run that finds different evidence must not fail this suite.
 */
const REAL_CASE = {
  exactUnit: { code: '01.18.06.019.055.03.01.601', area: '94.10', unitNumber: '601', floor: '6' },
  identifiedParent: { code: '01.18.06.019.055' },
  companyProfile: { name: 'შპს „მილენიო გრუპი"', idCode: '404670272', sourceBasis: 'REGISTRY_CONFIRMED' },
  publicResearch: {
    project: 'VILLION Krtsanisi Homes',
    developer: 'Millenio Group',
    legalCompany: 'შპს „მილენიო გრუპი"',
    companyId: '404670272',
    financingBank: 'სს „საქართველოს ბანკი"',
    partners: ['სს „საქართველოს ბანკი" — დეველოპერის მიერ დასახელებულია პროექტის დაფინანსების პარტნიორად; მშობელ ნაკვეთზე ამ ბანკის სასარგებლოდ რეგისტრირებული იპოთეკაც არის მითითებული.'],
    facts: [
      'VILLION Krtsanisi Homes მდებარეობს თბილისში, კრწანისის ქუჩა N6-ში.',
      'მშობელ ნაკვეთზე 01.18.06.019.055 სს „საქართველოს ბანკის" სასარგებლოდ იპოთეკაა რეგისტრირებული.',
    ],
    amenities: ['მიწისქვეშა პარკინგი', 'დახურული ეზო'],
    currentPhysicalStatus: 'ორივე ბლოკი ჩაბარებულად არის მითითებული. ეს ინფორმაცია არ ადასტურებს ოფიციალურ ექსპლუატაციაში მიღებას.',
    socialPublicFootprint: ['საჯაროდ ხელმისაწვდომია პროექტის სოციალური მედიის პროფილი.'],
    disputes: [],
    complaints: [],
    mediaCoverage: [],
  },
  legalStatus: {
    propertyEncumbrances: { label: 'ტვირთები', status: 'CONFIRMED_ATTENTION', note: 'დადასტურებულია საჯარო წყაროთი.' },
    debtorRegistry: { label: 'მოვალეთა რეესტრი', status: 'CONFIRMED_POSITIVE', note: 'უარყოფითი მტკიცებულება არ გამოვლენილა.' },
    taxpayerStatus: { label: 'გადასახადის გადამხდელის სტატუსი', status: 'HUMAN_VERIFICATION_REQUIRED', note: 'ავტომატური შემოწმება ვერ დასრულდა.' },
    commissioning: { label: 'ექსპლუატაციაში მიღება', status: 'NOT_CONFIRMED', note: 'საჯარო წყაროებით ვერ დადასტურდა.' },
  },
  market: {
    activeMedianPricePerSqm: '1850',
    activeMinPricePerSqm: '1700',
    activeMaxPricePerSqm: '1950',
    comparables: [
      { project: 'Villion', area: '94.30', price: '174455', currency: 'USD', pricePerSqm: '1850',
        comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE', url: 'https://example.invalid/l1',
        source: 'საჯარო უძრავი ქონების პლატფორმა', similarity: 'იგივე პროექტი; ფართობი თითქმის იდენტურია.' },
    ],
    priceDrivers: { reasoning: ['იმავე პროექტში 94.30 კვ.მ ერთეული 1850 დოლარი/კვ.მ ფასით არის მითითებული.'] },
  },
  unverified: ['შენობის ოფიციალურ ექსპლუატაციაში მიღება დამოუკიდებლად არ არის დადასტურებული.'],
};

const pkgOf = (r) => buildEvidencePackage(r);
const claims = (pkg) => pkg.items.map((i) => i.claim).join(' \n ');
const byCategory = (pkg, c) => pkg.items.filter((i) => i.category === c);

/* ---------------------------------------------------------------- *
 * THE ROOT CAUSE: research must reach the model                     *
 * ---------------------------------------------------------------- */

test('publicResearch reaches the evidence package — it previously reached nothing', () => {
  const pkg = pkgOf(REAL_CASE);
  assert.ok(claims(pkg).includes('VILLION'), 'the project never made it into the package');
  assert.ok(claims(pkg).includes('კრწანისის'), 'the location narrative was dropped');
  assert.equal(pkg.subject.developer, 'Millenio Group');
  assert.equal(pkg.subject.companyId, '404670272');
});

test('J. rich evidence produces a rich package across several tiers', () => {
  // The fixture above is a REDUCED stand-in for the production job: two
  // publicResearch facts where the real one has six, no technicalFacts, no
  // officialEvidence, one comparable instead of seven. It should therefore
  // read as MODERATE, not RICH — asserting RICH here would have meant tuning
  // the richness thresholds to a fixture rather than to real evidence.
  const pkg = pkgOf(REAL_CASE);
  assert.ok(pkg.items.length >= 12, `only ${pkg.items.length} evidence items`);
  assert.ok(pkg.tierCounts[1] > 0 && pkg.tierCounts[2] > 0 && pkg.tierCounts[3] > 0,
    'evidence did not span the official / project / market tiers');
  assert.notEqual(evidenceRichness(pkg), 'SPARSE');
});

test('J2. production-scale evidence reads as RICH and unlocks a full briefing', () => {
  // Volumes taken from production job 64cfea71: 24 technical facts, 6 official
  // evidence statements, 6 research facts, 7 comparables, 31 retrieved
  // documents. The counts are what matter here, not the values.
  const big = {
    ...REAL_CASE,
    technicalFacts: Array.from({ length: 24 }, (_, i) => ({
      key: `ფაქტი ${i}`, value: `მნიშვნელობა ${i}`, category: 'STRUCTURE',
      documentTitle: `ამონაწერი ${i}`, documentDate: '2025-07-14',
    })),
    officialEvidence: Array.from({ length: 6 }, (_, i) => ({ statement: `ოფიციალური დასკვნა ${i}` })),
    officialDocumentsRetrieved: Array.from({ length: 31 }, (_, i) => ({ title: `დოკუმენტი ${i}`, date: '2025-07-14' })),
    market: {
      ...REAL_CASE.market,
      comparables: Array.from({ length: 7 }, (_, i) => ({
        project: 'Villion', area: `9${i}`, price: `${170000 + i}`, currency: 'USD',
        pricePerSqm: '1850', comparableType: 'SAME_PROJECT',
      })),
    },
  };
  const pkg = pkgOf(big);
  assert.equal(evidenceRichness(pkg), 'RICH');
  assert.ok(pkg.tierCounts[1] >= 30, `tier 1 only has ${pkg.tierCounts[1]} items`);
  // Historical document listings are capped so they cannot dominate the model
  // context, but they are not dropped from the product — they stay in the
  // evidence drawer.
  assert.ok(pkg.tierCounts[5] <= 20);
});

test('K. sparse evidence stays sparse — no filler is manufactured', () => {
  const pkg = pkgOf({ exactUnit: { code: '01.01.01.001' } });
  assert.equal(pkg.items.length, 0);
  assert.equal(evidenceRichness(pkg), 'SPARSE');
  const report = deterministicReport(pkg);
  assert.equal(report.sections.length, 0);
  assert.ok(!report.summary.statement.includes('VILLION'));
});

/* ---------------------------------------------------------------- *
 * A / B. Mortgage in context                                        *
 * ---------------------------------------------------------------- */

test('A. financing context travels WITH the mortgage so it can be read together', () => {
  const pkg = pkgOf(REAL_CASE);
  const financing = byCategory(pkg, 'FINANCING');
  assert.ok(financing.length, 'the financing partner never reached the model');
  assert.ok(financing.some((f) => f.claim.includes('საქართველოს ბანკ')));
  // And it must be labelled as the developer's claim, not as registry fact.
  assert.ok(financing.every((f) => f.certainty === 'CLAIMED'));

  const { user } = buildIntelligencePrompt(pkg);
  assert.ok(user.includes('დაფინანსების პარტნიორად'), 'financing context is missing from the prompt');
});

test('B. a mortgage with NO explanatory context carries no invented context', () => {
  const bare = {
    exactUnit: { code: '01.02.03.004' },
    rightsAndRestrictions: { mortgages: ['იპოთეკა რეგისტრირებულია.'] },
  };
  const pkg = pkgOf(bare);
  assert.ok(byCategory(pkg, 'ENCUMBRANCE').length, 'the mortgage was lost');
  assert.equal(byCategory(pkg, 'FINANCING').length, 0, 'financing context was invented from nothing');
});

test('the prompt tells the model to read context before raising alarm, in both directions', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/CONTEXT BEFORE ALARM/.test(system));
  assert.ok(/does not prove the buyer's\s*\n?own unit is unencumbered|does not prove the buyer/.test(system),
    'the prompt must forbid the opposite overstatement too');
});

/* ---------------------------------------------------------------- *
 * C. Source failure is not conflict and not risk                    *
 * ---------------------------------------------------------------- */

test('C. an unavailable check becomes "could not confirm", never a finding', () => {
  const pkg = pkgOf(REAL_CASE);
  const labels = pkg.unavailable.map((u) => u.label).join(' ');
  assert.ok(labels.includes('გადასახადის'), 'the incomplete RS check was not carried as unavailable');
  assert.ok(labels.includes('ექსპლუატაციაში'), 'unconfirmed commissioning was not carried as unavailable');

  // ...and it must NOT also appear as positive evidence.
  const asEvidence = pkg.items.filter((i) => i.category === 'LEGAL_CHECK');
  assert.ok(!asEvidence.some((i) => i.claim.includes('ავტომატური შემოწმება ვერ დასრულდა')),
    'an unfinished check leaked into the evidence as though it were a result');

  const { system } = buildIntelligencePrompt(pkg);
  // v3 goes further than v2's "turn the gap into advice": a low-value gap
  // should not be written about AT ALL, and a gap may never be phrased as
  // the thing not existing.
  assert.ok(/NOT FOUND IS NOT ABSENT/.test(system));
  assert.ok(/LOW-VALUE NEGATIVES DO NOT GO IN THE REPORT AT ALL/.test(system));
  assert.ok(/CONFIRMED material issue is the opposite/.test(system));
});

test('C2. the RS.ge check is marked human-assistable so the questionnaire can finish it', () => {
  const pkg = pkgOf(REAL_CASE);
  const rs = pkg.unavailable.find((u) => u.label.includes('გადასახადის'));
  assert.ok(rs);
  assert.equal(rs.humanAssistable, true);
  const commissioning = pkg.unavailable.find((u) => u.label.includes('ექსპლუატაციაში'));
  assert.equal(commissioning.humanAssistable, false, 'only HUMAN_VERIFICATION_REQUIRED is human-assistable');
});

/* ---------------------------------------------------------------- *
 * D / E / F. Provenance is never laundered                          *
 * ---------------------------------------------------------------- */

test('D. a developer statement is labelled CLAIMED, never CONFIRMED', () => {
  const pkg = pkgOf(REAL_CASE);
  const dev = pkg.items.filter((i) => i.provenance === 'DEVELOPER_STATEMENT');
  assert.ok(dev.length);
  assert.ok(dev.every((i) => i.certainty === 'CLAIMED'),
    'a developer claim was promoted to a stronger certainty');
});

test('E. a social signal is the weakest tier and never CONFIRMED', () => {
  const pkg = pkgOf(REAL_CASE);
  const social = pkg.items.filter((i) => i.provenance === 'SOCIAL_SIGNAL');
  assert.ok(social.length);
  assert.ok(social.every((i) => i.tier === 4 && i.certainty === 'UNCONFIRMED'));
  const { system } = buildIntelligencePrompt(pkg);
  assert.ok(/SOCIAL_SIGNAL\s+weakest/.test(system));
});

test('F. registry evidence is never crowded out by social noise', () => {
  const noisy = {
    ...REAL_CASE,
    publicResearch: {
      ...REAL_CASE.publicResearch,
      socialPublicFootprint: Array.from({ length: 200 }, (_, i) => `სოციალური პოსტი ${i}`),
    },
  };
  const pkg = pkgOf(noisy);
  const tier4 = pkg.items.filter((i) => i.tier === 4).length;
  const tier1 = pkg.items.filter((i) => i.tier === 1).length;
  assert.ok(tier4 <= 12, `social evidence was not capped (${tier4})`);
  assert.ok(tier1 > 0, 'registry evidence was pushed out');
  assert.equal(pkg.truncated, true);
});

/* ---------------------------------------------------------------- *
 * G. Asking prices                                                  *
 * ---------------------------------------------------------------- */

test('G. listings are carried as OBSERVED asking prices, never as sales', () => {
  const pkg = pkgOf(REAL_CASE);
  const market = byCategory(pkg, 'MARKET');
  assert.ok(market.length);
  assert.ok(market.every((i) => i.provenance === 'MARKET_LISTING' && i.certainty === 'OBSERVED'));
  assert.equal(pkg.market.askingNotTransaction, true);
  assert.equal(pkg.market.sameProjectCount, 1);

  const { system, user } = buildIntelligencePrompt(pkg);
  assert.ok(/ASKING price\. Never call it a sale price/.test(system));
  assert.ok(user.includes('askingPricesAreNotSalePrices'));
});

/* ---------------------------------------------------------------- *
 * H / I. Contract CTA and specific actions                          *
 * ---------------------------------------------------------------- */

test('H. the output contract requires a contract-upload recommendation', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(system.includes('"contractUpload"'));
  const parsed = parseReport(JSON.stringify({
    overallView: { label: 'MIXED', statement: 'x' }, executiveSummary: 'x',
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', cites: [] }],
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება' },
  }));
  assert.equal(parsed.contractUpload.recommend, true);
  assert.ok(parsed.contractUpload.text.includes('ხელშეკრულება'));
});

test('I. advice is contextual, because the generic checklist is gone', () => {
  // This used to require buyerActions to be titled and reasoned. That rule
  // existed to stop the checklist rendering as a bare "1 2 3" — and the
  // checklist itself is now removed, so the rule it protected is moot. What
  // replaces it is a placement rule: advice must live where it means
  // something.
  const { system, user } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  // Next steps came back as a bounded, evidence-anchored list — but the
  // checklist that had to be deleted must stay deleted, and the model is told
  // so by name.
  assert.ok(/There is NO "buyerActions" field and there is no pre-purchase checklist/.test(system));
  assert.ok(/nextSteps is NOT it/.test(system));
  assert.ok(/signing authority with PEOPLE, negotiation with MARKET/.test(system));
  assert.ok(/NEVER write a step whose reason is that our research could not retrieve something/.test(system));
  // The incomplete checks still reach the model — as context for that advice,
  // never as something to print.
  assert.ok(Array.isArray(JSON.parse(user).contextForAdvice));
});

/* ---------------------------------------------------------------- *
 * L / M. Grounding                                                  *
 * ---------------------------------------------------------------- */

test('L. a citation that does not resolve to real evidence is rejected', () => {
  const pkg = pkgOf(REAL_CASE);
  const bad = JSON.stringify({
    overallView: { label: 'POSITIVE', statement: 'ყველაფერი რიგზეა.' },
    executiveSummary: 'ეს ქონება სრულიად უპრობლემოა.',
    sections: [{ key: 'SNAPSHOT', title: 'სამართლებრივი', body: 'ბანკს პრეტენზია არ აქვს.', cites: ['e9999'] }],
    unconfirmed: [{ item: 'x', why: 'y' }],
  });
  const check = validateReport(pkg, parseReport(bad));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('ungrounded citation e9999')));

  const final = finalizeReport(pkg, bad);
  assert.equal(final.mode, 'DETERMINISTIC', 'ungrounded prose was shown to the customer');
});

test('M. NO EVIDENCE = NO FACT: a long uncited section is refused', () => {
  const pkg = pkgOf(REAL_CASE);
  const bad = JSON.stringify({
    overallView: { label: 'POSITIVE', statement: 'ok' },
    executiveSummary: 'ok',
    sections: [{ key: 'SNAPSHOT', title: 'სამართლებრივი', body: 'ა'.repeat(300), cites: [] }],
    unconfirmed: [{ item: 'x', why: 'y' }],
  });
  const check = validateReport(pkg, parseReport(bad));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('no citation')));
});

test('a report with no summary is refused — the verdict is not optional', () => {
  const pkg = pkgOf(REAL_CASE);
  const noSummary = JSON.stringify({
    summary: { label: 'POSITIVE', statement: '', highlights: [] },
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', cites: [pkg.items[0].id] }],
  });
  const check = validateReport(pkg, parseReport(noSummary));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('no summary statement')));
  assert.ok(check.problems.some((p) => p.includes('summary has no highlights')));
});

test('"we did not find it" may never be written as "it does not exist"', () => {
  const pkg = pkgOf(REAL_CASE);
  const absent = JSON.stringify({
    summary: {
      label: 'BALANCED', statement: 'ok',
      highlights: [{ dimension: 'PROJECT_QUALITY', sentiment: 'BALANCED', headline: 'h', detail: 'd', cites: [pkg.items[0].id] }],
    },
    sections: [{
      key: 'PROJECT', title: 'პროექტი',
      body: 'ლანდშაფტის არქიტექტორის სახელი არ სახელდება.',
      cites: [pkg.items[0].id],
    }],
  });
  const check = validateReport(pkg, parseReport(absent));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('states absence as fact')),
    'the epistemic guard did not fire');
});

test('a registry statement of genuine absence stays sayable', () => {
  // The guard must not swallow a real finding: "no encumbrance is registered"
  // is established BY a source, not inferred from our own silence.
  const pkg = pkgOf(REAL_CASE);
  const legitimate = JSON.stringify({
    summary: {
      label: 'POSITIVE', statement: 'ok',
      highlights: [{ dimension: 'LEGAL_CONTEXT', sentiment: 'POSITIVE', headline: 'h', detail: 'd', cites: [pkg.items[0].id] }],
    },
    sections: [{
      key: 'SNAPSHOT', title: 'სამართლებრივი',
      body: 'რეესტრის ჩანაწერით ყადაღა რეგისტრირებული არ არის.',
      cites: [pkg.items[0].id],
    }],
  });
  assert.equal(validateReport(pkg, parseReport(legitimate)).ok, true);
});

test('provenance may not be used as a prefix on paragraph after paragraph', () => {
  const pkg = pkgOf(REAL_CASE);
  const id = pkg.items[0].id;
  const repetitive = JSON.stringify({
    summary: {
      label: 'BALANCED', statement: 'ok',
      highlights: [{ dimension: 'PROJECT_QUALITY', sentiment: 'BALANCED', headline: 'h', detail: 'd', cites: [id] }],
    },
    sections: [1, 2, 3, 4].map((n) => ({
      key: ['SNAPSHOT', 'MARKET', 'PROJECT', 'LOCATION'][n - 1],
      title: 't' + n,
      body: 'საჯაროდ გამოქვეყნებულ პროექტის მასალებში მითითებულია რაღაც.',
      cites: [id],
    })),
  });
  const check = validateReport(pkg, parseReport(repetitive));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('provenance phrase')));
});

test('a well-grounded report IS accepted — the gate is not always-reject', () => {
  const pkg = pkgOf(REAL_CASE);
  const good = JSON.stringify({
    summary: {
      label: 'POSITIVE',
      statement: 'საერთო სურათი პოზიტიურია.',
      highlights: [
        { dimension: 'LEGAL_CONTEXT', sentiment: 'BALANCED', headline: 'იპოთეკა', detail: 'პროექტის დაფინანსებაა.', cites: [pkg.items[0].id] },
      ],
    },
    keyFindings: [{ finding: 'იპოთეკა რეგისტრირებულია.', whyItMatters: 'გავლენას ახდენს რეგისტრაციაზე.', sentiment: 'ATTENTION', cites: [pkg.items[0].id] }],
    sections: [{ key: 'SNAPSHOT', title: 'სამართლებრივი სურათი', body: 'იპოთეკა რეგისტრირებულია.', cites: [pkg.items[0].id] }],
    attentionPoints: [{ point: 'იპოთეკა', why: 'გავლენას ახდენს რეგისტრაციაზე', cites: [pkg.items[0].id] }],
    finalView: 'დასკვნა.',
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება.' },
  });
  const final = finalizeReport(pkg, good);
  assert.equal(final.mode, 'MODEL', final.rejectedBecause.join('; '));
  assert.equal(final.keyFindings.length, 1);
  // Only the evidence actually cited is offered as sources.
  assert.ok(final.evidenceUsed.length >= 1);
  assert.ok(final.evidenceUsed.every((e) => e.id === pkg.items[0].id));
});

test('unparseable model output degrades to the deterministic report, never a 500', () => {
  const pkg = pkgOf(REAL_CASE);
  const final = finalizeReport(pkg, 'not json at all');
  assert.equal(final.mode, 'DETERMINISTIC');
  assert.ok(final.sections.length, 'the fallback produced nothing to read');
  // Every deterministic sentence IS an evidence claim, so it is true by
  // construction and passes its own gate.
  const recheck = validateReport(pkg, final);
  assert.equal(recheck.ok, true, recheck.problems.join('; '));
});

test('markdown fences around valid JSON are tolerated', () => {
  const pkg = pkgOf(REAL_CASE);
  const wrapped = '```json\n' + JSON.stringify({
    summary: {
      label: 'BALANCED', statement: 's',
      highlights: [{ dimension: 'LEGAL_CONTEXT', sentiment: 'BALANCED', headline: 'h', detail: 'd', cites: [pkg.items[0].id] }],
    },
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', cites: [pkg.items[0].id] }],
  }) + '\n```';
  assert.equal(finalizeReport(pkg, wrapped).mode, 'MODEL');
});

/* ---------------------------------------------------------------- *
 * Noise removal                                                     *
 * ---------------------------------------------------------------- */

test('mis-decoded historical text never reaches the report', () => {
  assert.equal(isPresentable('ნორმალური ქართული ტექსტი'), true);
  // Written as escapes, not as raw bytes: a real NUL in a source file is
  // precisely what src/verify/__tests__/sourceHygiene.test.mjs exists to
  // catch, and a fixture must not be indistinguishable from the bug.
  assert.equal(isPresentable('\u0000\u0001 broken'), false);
  assert.equal(isPresentable('����������������'), false);
  assert.equal(isPresentable('   '), false);

  const pkg = pkgOf({
    ...REAL_CASE,
    technicalFacts: [{ key: 'x', value: '������������������������', category: 'STRUCTURE' }],
  });
  assert.ok(!claims(pkg).includes('���'), 'mojibake reached the customer report');
});

/* ---------------------------------------------------------------- *
 * Anti-repetition and the model contract                            *
 * ---------------------------------------------------------------- */

test('the prompt forbids restating the same finding in every section', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/SAY IT ONCE/.test(system));
  assert.ok(/Repetition was the single/.test(system));
});

test('the prompt carries the certainty vocabulary instead of good/bad/unknown', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  for (const word of ['CONFIRMED', 'CORROBORATED', 'REPORTED', 'CLAIMED', 'OBSERVED', 'UNCONFIRMED']) {
    assert.ok(system.includes(word), `certainty band ${word} missing from the prompt`);
  }
  assert.ok(/never good\/bad\/unknown/.test(system));
});

test('physical completion and legal commissioning are kept apart', () => {
  // v2 carries this as concrete worked examples in the advice rule rather
  // than as a standalone heading: an unconfirmed commissioning status must
  // become "worth confirming", never a contradiction.
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/PHYSICAL COMPLETION IS NOT LEGAL COMMISSIONING/.test(system));
  assert.ok(/ექსპლუატაციაში მიღების აქტუალური სტატუსის გადამოწმება ღირს/.test(system));
  // ...and it must be said ONCE, in LEGAL, not repeated as a contradiction.
  assert.ok(/inside SNAPSHOT, once/.test(system));
});

test('the prompt never leaks raw research internals or the whole report', () => {
  const { user } = buildIntelligencePrompt(pkgOf({ ...REAL_CASE, browserOfficial: { huge: 'x'.repeat(50000) } }));
  assert.ok(!user.includes('browserOfficial'), 'the raw browser dump reached the prompt');
  assert.ok(user.length < 60000, `prompt is ${user.length} chars — the budget is not holding`);
});

/* ---------------------------------------------------------------- *
 * Wiring                                                            *
 * ---------------------------------------------------------------- */

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('verify-synthesis uses the evidence package, not the starved plan', () => {
  const fn = read('supabase/functions/verify-synthesis/index.ts');
  assert.ok(fn.includes('buildEvidencePackage'), 'the function still builds no evidence package');
  assert.ok(fn.includes('buildIntelligencePrompt'));
  assert.ok(fn.includes('finalizeReport'));
  assert.ok(!fn.includes('buildRenderPrompt'), 'the starved prompt is still wired in');
});

test('the contract CTA reuses the Verification Case documents tab, not a second upload path', () => {
  const page = read('src/pages/VerifyPage.tsx');
  assert.ok(page.includes('onUploadContract'), 'the report CTA is not wired');
  assert.ok(/\?tab=documents/.test(page), 'the CTA does not land on the case documents tab');
});

test('the raw evidence explorer is still reachable underneath the report', () => {
  const cmp = read('src/components/verify/VerifyReport.tsx');
  assert.ok(cmp.includes('verify_report_evidence_toggle'), 'the evidence drawer was removed');
  assert.ok(cmp.includes('<details'), 'the evidence detail is no longer collapsible');
});

/* ---------------------------------------------------------------- *
 * No internal token on a customer screen                            *
 * ---------------------------------------------------------------- *
 *
 * All three of these were found on the LIVE production report for
 * 01.18.06.019.055.03.01.601 after the first deploy of this pipeline.
 */

test('a JSON group key is never used as a source label', () => {
  // rightsAndRestrictions is shaped { items: [...] }. Passing that key
  // through put the literal word "items" on screen as a source.
  const pkg = pkgOf({
    exactUnit: { code: '01.02.03.004' },
    rightsAndRestrictions: { items: ['იპოთეკა რეგისტრირებულია.'] },
  });
  const enc = byCategory(pkg, 'ENCUMBRANCE');
  assert.ok(enc.length, 'the encumbrance was lost');
  assert.ok(enc.every((i) => i.source === undefined),
    `a shape key leaked as a source: ${enc.map((i) => i.source).join(', ')}`);
});

test('the prompt forbids writing evidence ids into the prose', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/PUT THE IDS IN `cites`, NEVER IN THE PROSE/.test(system));
});

test('the UI strips evidence ids the model writes into prose anyway', () => {
  // A model instruction is a request; the boundary is the control. The live
  // report came back with "...ტვირთებისგან. (e7, e8)" despite the rule.
  const cmp = read('src/components/verify/VerifyReport.tsx');
  assert.ok(cmp.includes('stripEvidenceIds'), 'nothing strips leaked ids');
  // Every customer-visible string must go through it, not just paragraphs.
  // v2 composes the strip with readable() in one helper, so every call site
  // gets both and a new field cannot skip one.
  assert.ok(/const clean = \(s: unknown\): string => stripEvidenceIds\(readable\(/.test(cmp));
  for (const call of [
    'clean(summary.statement)', 'clean(s.title)',
    'clean(a.point)', 'clean(f.finding)', 'clean(h.headline)',
  ]) {
    assert.ok(cmp.includes(call), `${call} is missing — ids can still render there`);
  }
});

test('no provenance label of any kind reaches the primary report', () => {
  // v1 translated the enum so DERIVED stopped appearing. v2 goes further and
  // removes the chips entirely: a provenance label under every paragraph broke
  // the reading rhythm, and sources belong in the evidence drawer. That is a
  // stronger guarantee — there is no label left to get wrong.
  const cmp = read('src/components/verify/VerifyReport.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/\{e\.source \|\| e\.provenance\}/.test(cmp), 'the raw enum fallback is back');
  assert.ok(!/const Citations/.test(cmp), 'the provenance chip component is back');

  const pkgSrc = read('src/verify/intelligence/evidencePackage.ts');
  const union = pkgSrc.slice(pkgSrc.indexOf('export type Provenance'), pkgSrc.indexOf(';', pkgSrc.indexOf('export type Provenance')));
  const values = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(values.length >= 8, 'the provenance vocabulary was not found');
  for (const v of values) {
    assert.ok(!cmp.includes(v), `${v} can still reach the customer surface`);
  }
});
