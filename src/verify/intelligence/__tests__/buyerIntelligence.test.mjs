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
  assert.ok(!report.executiveSummary.includes('VILLION'));
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
  assert.ok(/UNAVAILABLE IS NOT A CONFLICT/.test(system));
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
    sections: [{ key: 'LEGAL', title: 't', body: 'b', cites: [] }],
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება' },
  }));
  assert.equal(parsed.contractUpload.recommend, true);
  assert.ok(parsed.contractUpload.text.includes('ხელშეკრულება'));
});

test('I. the prompt forbids generic actions and demands a reason for each', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/ACTIONS MUST BE SPECIFIC/.test(system));
  assert.ok(/Not "check the mortgage"/.test(system));
  assert.ok(/why am I doing this/.test(system));
});

/* ---------------------------------------------------------------- *
 * L / M. Grounding                                                  *
 * ---------------------------------------------------------------- */

test('L. a citation that does not resolve to real evidence is rejected', () => {
  const pkg = pkgOf(REAL_CASE);
  const bad = JSON.stringify({
    overallView: { label: 'POSITIVE', statement: 'ყველაფერი რიგზეა.' },
    executiveSummary: 'ეს ქონება სრულიად უპრობლემოა.',
    sections: [{ key: 'LEGAL', title: 'სამართლებრივი', body: 'ბანკს პრეტენზია არ აქვს.', cites: ['e9999'] }],
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
    sections: [{ key: 'LEGAL', title: 'სამართლებრივი', body: 'ა'.repeat(300), cites: [] }],
    unconfirmed: [{ item: 'x', why: 'y' }],
  });
  const check = validateReport(pkg, parseReport(bad));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('no citation')));
});

test('a report that omits the unconfirmed checks is refused', () => {
  const pkg = pkgOf(REAL_CASE);
  assert.ok(pkg.unavailable.length);
  const omits = JSON.stringify({
    overallView: { label: 'POSITIVE', statement: 'ok' },
    executiveSummary: 'ok',
    sections: [{ key: 'LEGAL', title: 't', body: 'b', cites: [pkg.items[0].id] }],
    unconfirmed: [],
  });
  const check = validateReport(pkg, parseReport(omits));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('omitted them')));
});

test('a well-grounded report IS accepted — the gate is not always-reject', () => {
  const pkg = pkgOf(REAL_CASE);
  const good = JSON.stringify({
    overallView: { label: 'MOSTLY_POSITIVE', statement: 'საერთო სურათი პოზიტიურია.' },
    executiveSummary: 'პირველი აბზაცი.\n\nმეორე აბზაცი.',
    sections: [{ key: 'LEGAL', title: 'სამართლებრივი სურათი', body: 'იპოთეკა რეგისტრირებულია.', cites: [pkg.items[0].id] }],
    attentionPoints: [{ point: 'იპოთეკა', why: 'გავლენას ახდენს რეგისტრაციაზე', cites: [pkg.items[0].id] }],
    unconfirmed: [{ item: 'ექსპლუატაცია', why: 'ოფიციალური აქტით' }],
    buyerActions: [{ action: 'მოითხოვეთ განმუხტვის მექანიზმი წერილობით', why: 'რომ ერთეული გათავისუფლდეს', cites: [pkg.items[0].id] }],
    finalView: 'დასკვნა.',
    contractUpload: { recommend: true, text: 'ატვირთეთ ხელშეკრულება.' },
  });
  const final = finalizeReport(pkg, good);
  assert.equal(final.mode, 'MODEL', final.rejectedBecause.join('; '));
  assert.equal(final.buyerActions.length, 1);
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
    overallView: { label: 'MIXED', statement: 's' }, executiveSummary: 'e',
    sections: [{ key: 'LEGAL', title: 't', body: 'b', cites: [pkg.items[0].id] }],
    unconfirmed: [{ item: 'i', why: 'w' }],
  }) + '\n```';
  assert.equal(finalizeReport(pkg, wrapped).mode, 'MODEL');
});

/* ---------------------------------------------------------------- *
 * Noise removal                                                     *
 * ---------------------------------------------------------------- */

test('mis-decoded historical text never reaches the report', () => {
  assert.equal(isPresentable('ნორმალური ქართული ტექსტი'), true);
  assert.equal(isPresentable('  broken'), false);
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
  assert.ok(/Repetition is the main defect/.test(system));
});

test('the prompt carries the certainty vocabulary instead of good/bad/unknown', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  for (const word of ['CONFIRMED', 'CORROBORATED', 'REPORTED', 'CLAIMED', 'OBSERVED', 'UNCONFIRMED']) {
    assert.ok(system.includes(word), `certainty band ${word} missing from the prompt`);
  }
  assert.ok(/Never flatten these into good \/ bad \/ unknown/.test(system));
});

test('physical completion and legal commissioning are kept apart', () => {
  const { system } = buildIntelligencePrompt(pkgOf(REAL_CASE));
  assert.ok(/PHYSICAL COMPLETION IS NOT LEGAL COMMISSIONING/.test(system));
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
  for (const call of [
    'stripEvidenceIds(readable(r.overallView.statement))',
    'stripEvidenceIds(readable(s.title))',
    'stripEvidenceIds(readable(a.point))',
    'stripEvidenceIds(readable(a.action))',
    'stripEvidenceIds(readable(u.item))',
  ]) {
    assert.ok(cmp.includes(call), `${call} is missing — ids can still render there`);
  }
});

test('a citation chip never shows the raw provenance enum', () => {
  const cmp = read('src/components/verify/VerifyReport.tsx');
  // The live report rendered DERIVED / OFFICIAL_DOCUMENT / DEVELOPER_STATEMENT
  // as source labels because the fallback was `e.source || e.provenance`.
  assert.ok(!/\{e\.source \|\| e\.provenance\}/.test(cmp), 'the raw enum fallback is back');
  assert.ok(cmp.includes('PROVENANCE_KEY'), 'provenance is not translated for the customer');
  assert.ok(cmp.includes('isHumanSource'), 'an internal token can still be used as a label');

  // Every provenance the package can emit must have a customer-facing name.
  const pkgSrc = read('src/verify/intelligence/evidencePackage.ts');
  const union = pkgSrc.slice(pkgSrc.indexOf('export type Provenance'), pkgSrc.indexOf(";", pkgSrc.indexOf('export type Provenance')));
  const values = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(values.length >= 8, 'the provenance vocabulary was not found');
  for (const v of values) {
    assert.ok(cmp.includes(`${v}: 'verify_src_`), `${v} has no customer-facing source label`);
  }
});
