// Market hierarchy, quality context and participant ownership.
//
// These pin the three things the live report was missing: it compared a
// project's units only to each other, it read price per square metre without
// reading the product behind it, and it carried directors while dropping the
// shareholders sitting in the very next block of the same extract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMarketIntelligence,
  qualityFactorsFrom,
  scoreComparable,
} from '../marketIntelligence.ts';
import { buildIntelligenceBundle } from '../bundle.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';
import {
  parseRegistryShareholders,
  buildPeopleIntelligence,
  redactPersonalData,
} from '../peopleIntelligence.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const SUBJECT = {
  project: 'VILLION Krtsanisi Homes',
  address: 'თბილისი, კრწანისის ქუჩა 6',
  area: 94.1,
  rooms: 3,
  floor: 6,
  currency: 'USD',
};

/** One listing in each band, so the hierarchy is exercised end to end. */
const COMPARABLES = [
  { project: 'VILLION Krtsanisi Homes', address: 'კრწანისის ქუჩა 6', area: '94.3', pricePerSqm: '1850', currency: 'USD', comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE' },
  { project: 'VILLION Krtsanisi Homes', address: 'კრწანისის ქუჩა 6', area: '88', pricePerSqm: '1870', currency: 'USD', comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE' },
  { project: 'Krtsanisi Residence', address: 'კრწანისის ქუჩა 12', area: '90', pricePerSqm: '1700', currency: 'USD', comparableType: 'MICRO_LOCATION' },
  { project: 'Krtsanisi Park', address: 'კრწანისის ქუჩა 20', area: '96', pricePerSqm: '1760', currency: 'USD', comparableType: 'MICRO_LOCATION' },
  { project: 'Ortachala Hills', address: 'თბილისი, კრწანისი, ორთაჭალის გზა 4', area: '92', pricePerSqm: '1600', currency: 'USD', comparableType: 'MICRO_LOCATION' },
  { project: 'Vake Boutique', address: 'თბილისი, ვაკე, ჭავჭავაძის 40', area: '95', pricePerSqm: '2400', currency: 'USD', comparableType: 'PEER_PROJECT' },
  { project: 'Saburtalo Sky', address: 'თბილისი, საბურთალო', area: '93', pricePerSqm: '1500', currency: 'USD', comparableType: 'PEER_PROJECT' },
];

/* ── the hierarchy ─────────────────────────────────────────────────── */

test('every band that has listings is published, not only the winning one', () => {
  const m = buildMarketIntelligence(SUBJECT, COMPARABLES);
  const tiers = m.tiers.map((t) => t.tier);
  // Narrowest first, always.
  assert.deepEqual(tiers, ['SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT'].filter((t) => tiers.includes(t)));
  assert.ok(tiers.includes('SAME_PROJECT'), 'the same-project band is missing');
  assert.ok(tiers.length >= 3, `only ${tiers.length} bands published — this is the same-project-only report again`);
  for (const t of m.tiers) {
    assert.ok(t.count > 0 && t.median > 0, `${t.tier} published with nothing in it`);
    assert.ok(t.min <= t.median && t.median <= t.max, `${t.tier} range is inconsistent`);
  }
});

test('the narrowest band with enough listings still drives the analysis', () => {
  const m = buildMarketIntelligence(SUBJECT, COMPARABLES);
  assert.equal(m.basis, 'SAME_PROJECT');
  assert.equal(m.basisCount, 2);
  // Publishing the wider bands must not drag the headline number around.
  assert.equal(m.median, 1860);
});

test('a comparable development ranks above open-market stock, never above location', () => {
  const peer = scoreComparable(SUBJECT, COMPARABLES[5]);
  const sameProject = scoreComparable(SUBJECT, COMPARABLES[0]);
  const sameDistrict = scoreComparable(SUBJECT, COMPARABLES[4]);
  assert.equal(peer.tier, 'PEER_PROJECT');
  assert.ok(peer.relevance < sameDistrict.relevance, 'a peer project outranked a district match');
  assert.ok(peer.relevance < sameProject.relevance, 'a peer project outranked the same building');
});

test('a single listing is shown as context but never carries the analysis', () => {
  const one = buildMarketIntelligence(SUBJECT, [COMPARABLES[0], COMPARABLES[5], COMPARABLES[6]]);
  // It appears in the hierarchy...
  assert.ok(one.tiers.some((t) => t.tier === 'SAME_PROJECT' && t.count === 1));
  // ...but two peer listings are what actually meet the minimum.
  assert.equal(one.basisCount >= 2, true);
});

test('no comparables at all means no market section, never an empty one', () => {
  assert.equal(buildMarketIntelligence(SUBJECT, []), null);
  assert.equal(buildMarketIntelligence(SUBJECT, [{ project: 'x', price: null }]), null);
});

/* ── quality is part of price ───────────────────────────────────────── */

test('quality factors are read from recorded evidence, never from the price', () => {
  const factors = qualityFactorsFrom(
    ['კონსიერჟი და 24-საათიანი დაცვა', 'OTIS-ის ლიფტი', 'პანორამული ალუმინის შემინვა'],
    undefined,
    undefined,
    'მიწისქვეშა პარკინგი'
  );
  const names = factors.map((f) => f.factor);
  assert.ok(names.includes('კონსიერჟი'));
  assert.ok(names.includes('პარკინგი'));
  assert.ok(names.includes('პანორამული შემინვა'));
  assert.ok(factors.every((f) => f.direction === 'SUPPORTS_PREMIUM'));
});

test('unfinished condition is carried as a discount factor, not as a defect', () => {
  const factors = qualityFactorsFrom([], 'თეთრი კარკასი', 'მშენებარე');
  assert.ok(factors.length >= 1);
  assert.ok(factors.every((f) => f.direction === 'SUPPORTS_DISCOUNT'));
});

test('no quality evidence means no quality claims', () => {
  assert.deepEqual(qualityFactorsFrom([], undefined, undefined, undefined), []);
  assert.deepEqual(qualityFactorsFrom(['   '], '', '', ''), []);
});

test('a quality factor never carries an invented monetary adjustment', () => {
  const src = read('src/verify/intelligence/marketIntelligence.ts');
  const block = src.slice(src.indexOf('export function qualityFactorsFrom'));
  assert.ok(!/adjust|usd|\$|percentAdjust/i.test(block.slice(0, 1200)),
    'a monetary adjustment is being attached to a qualitative factor');
});

test('the market research asks for the whole hierarchy, not just the building', () => {
  const agent = read('supabase/functions/research-agent/index.ts');
  assert.ok(/Work OUTWARD through the hierarchy/.test(agent), 'the hierarchy is not requested');
  for (const band of ['same street', 'micro-district', 'wider district', 'comparable developments']) {
    assert.ok(agent.includes(band), `the "${band}" band is never asked for`);
  }
  assert.ok(/Korter/.test(agent), 'a supported discovery source is missing');
  // ...and it must not be allowed to invent breadth it did not actually find.
  assert.ok(/never describe a band you did not search/.test(agent));
});

/* ── participants and ownership ─────────────────────────────────────── */

const REGISTRY_EXTRACT = [
  'ხელმძღვანელობა/წარმომადგენლობა',
  'კობა კვანტალიანი, 01001012345 ,ერთობლივი',
  'ლევან ჩაჩუა, 01001067890 ,ერთობლივი',
  'პარტნიორები',
  'კობა კვანტალიანი, 01001012345, 60%',
  'ლევან ჩაჩუა, 01001067890, 40%',
].join('\n');

test('shareholders are parsed from their own block, with their stated share', () => {
  const holders = parseRegistryShareholders(REGISTRY_EXTRACT, 'შპს „მილენიო გრუპი"');
  assert.equal(holders.length, 2);
  assert.ok(holders.every((h) => h.role === 'SHAREHOLDER'));
  assert.equal(holders.find((h) => h.name.includes('კვანტალიანი')).ownershipPct, 60);
  assert.equal(holders.find((h) => h.name.includes('ჩაჩუა')).ownershipPct, 40);
});

test('a partner with no stated share is kept, without a number attached', () => {
  const holders = parseRegistryShareholders('პარტნიორები\nნინო აბაშიძე, 01001011111', 'შპს X');
  assert.equal(holders.length, 1);
  assert.equal(holders[0].ownershipPct, undefined, 'a share was invented for an unstated one');
});

test('ownership is never inferred from a directorship', () => {
  const directorsOnly = ['ხელმძღვანელობა/წარმომადგენლობა', 'კობა კვანტალიანი, 01001012345 ,ერთობლივი'].join('\n');
  const holders = parseRegistryShareholders(directorsOnly, 'შპს X');
  assert.deepEqual(holders, [], 'a director was turned into a shareholder');
});

test('directors and shareholders survive together into the bundle', () => {
  const people = buildPeopleIntelligence({
    companyProfile: { name: 'შპს „მილენიო გრუპი"' },
    browserOfficial: { results: [{ extract: REGISTRY_EXTRACT }] },
  });
  // The same two people are both directors and partners here, which is the
  // ordinary shape of a small Georgian company — and exactly the case that
  // used to lose one of the two roles.
  const roles = new Set(people.people.flatMap((p) => p.roles ?? [p.role]));
  assert.ok(roles.has('DIRECTOR'), 'the directors were lost');
  assert.ok(roles.has('SHAREHOLDER'), 'the shareholders were lost');
  assert.equal(people.people.length, 2, 'the same person was listed twice');
  // The binding role leads, and the share survives the merge.
  assert.ok(people.people.every((p) => p.role === 'DIRECTOR'));
  assert.equal(people.people.find((p) => p.name.includes('კვანტალიანი')).ownershipPct, 60);
  assert.equal(people.representation, 'JOINT', 'joint representation was not preserved');
});

test('personal id numbers never survive into a participant record', () => {
  const people = buildPeopleIntelligence({
    companyProfile: { name: 'შპს X' },
    browserOfficial: { results: [{ extract: REGISTRY_EXTRACT }] },
  });
  const serialized = JSON.stringify(people);
  assert.ok(!/\b\d{9,11}\b/.test(serialized), 'a personal id reached the participant model');
  assert.equal(redactPersonalData('კობა კვანტალიანი, 01001012345').includes('01001012345'), false);
});

test('a percentage is never harvested out of a personal id', () => {
  // Redaction runs first, so there is no 11-digit number left for a stray
  // "%" to attach itself to.
  const holders = parseRegistryShareholders('პარტნიორები\nნინო აბაშიძე, 01001011111 100%', 'შპს X');
  assert.equal(holders.length, 1);
  assert.equal(holders[0].ownershipPct, 100);
  assert.ok(!/01001011111/.test(JSON.stringify(holders)));
});

test('the report shows ownership only when a share exists', () => {
  const src = read('src/components/verify/VerifyReport.tsx');
  assert.ok(/typeof p\.ownershipPct === 'number'/.test(src), 'ownership renders unconditionally');
});

/* ── the snapshot is the one path research text takes UNMODELLED ─────── */

test('portal links never reach the snapshot, only their text', () => {
  // Live report: amenities rendered as
  //   "გამწვანებული ეზო. ([villion.ge](https://villion.ge/...))"
  // putting a portal URL straight into the primary report.
  const report = {
    exactUnit: { code: '01.01.01.001.01.01.001' },
    publicResearch: {
      amenities: ['გამწვანებული ეზო. ([villion.ge](https://villion.ge/project))',
                  'კონსიერჟი https://example.com/x'],
    },
  };
  const b = buildIntelligenceBundle(report, buildEvidencePackage(report), null);
  const joined = b.snapshot.amenities.join(' | ');
  assert.ok(!/https?:/.test(joined), `a URL survived into the snapshot: ${joined}`);
  assert.ok(!/\]\(/.test(joined), 'markdown link syntax survived');
  // The readable part is kept — this is a cleanup, not a deletion.
  assert.ok(joined.includes('გამწვანებული ეზო'));
  assert.ok(joined.includes('კონსიერჟი'));
});

test('a portal name left behind as link text is dropped too', () => {
  // Stripping the URL out of "([villion.ge](https://...))" leaves
  // "(villion.ge)" — the link text WAS the domain, so the portal name
  // survived in the primary report anyway.
  const report = {
    exactUnit: { code: '01.01.01.001.01.01.001' },
    publicResearch: { amenities: [
      'გამწვანებული ეზო. ([villion.ge](https://villion.ge/p))',
      'საბავშვო მოედანი. (korter.ge)',
      'ჩაბარება — მწვანე კარკასი. (მწვანე კარკასი)',
      'პარკინგი (94.1 m2)',
    ] },
  };
  const a = buildIntelligenceBundle(report, buildEvidencePackage(report), null).snapshot.amenities;
  assert.ok(!/villion\.ge|korter\.ge/i.test(a.join(' ')), 'a portal domain survived');
  // Only a parenthetical that is ENTIRELY a domain goes.
  assert.ok(a.some((x) => x.includes('(მწვანე კარკასი)')), 'a real parenthetical was eaten');
  assert.ok(a.some((x) => x.includes('(94.1 m2)')), 'a measurement parenthetical was eaten');
});

test('an internal enum is omitted from the snapshot, never shown', () => {
  // Live report: "ტიპი MIXED_OR_UNKNOWN". It means "we do not know", so the
  // honest rendering is no row at all.
  const report = {
    exactUnit: { code: '01.01.01.001.01.01.001', propertyType: 'MIXED_OR_UNKNOWN' },
  };
  const b = buildIntelligenceBundle(report, buildEvidencePackage(report), null);
  assert.equal(b.snapshot.propertyType, undefined, 'an internal token reached the snapshot');
});

test('a real value that merely looks shouty is still shown', () => {
  const report = { exactUnit: { code: '01.01.01.001.01.01.001', propertyType: 'ბინა' } };
  const b = buildIntelligenceBundle(report, buildEvidencePackage(report), null);
  assert.equal(b.snapshot.propertyType, 'ბინა');
});

/* ── thin evidence stays honest about being thin ─────────────────────── */

const one = (over = {}) => ({
  project: 'VILLION Krtsanisi Homes', address: 'კრწანისის ქუჩა 6',
  area: '94', pricePerSqm: '1850', currency: 'USD',
  comparableType: 'SAME_PROJECT', listingStatus: 'ACTIVE', ...over,
});

test('rich same-project evidence carries the analysis and is not marked thin', () => {
  const m = buildMarketIntelligence(SUBJECT, [one(), one({ pricePerSqm: '1870' }), one({ pricePerSqm: '1830' })]);
  assert.equal(m.basis, 'SAME_PROJECT');
  assert.equal(m.basisIsThin, false);
  assert.equal(m.tiers.find((t) => t.tier === 'SAME_PROJECT').thin, false);
});

test('a single comparable is used, but never called a market', () => {
  // The exact shape the live report produced. The figures are real; what
  // must not happen is presenting them as a distribution.
  const m = buildMarketIntelligence(SUBJECT, [one()]);
  assert.equal(m.count, 1);
  assert.equal(m.median, 1850, 'a single asking price is still real information');
  assert.equal(m.basisIsThin, true, 'one listing was presented as a market');
  assert.ok(m.tiers.every((t) => t.thin), 'a one-listing band is not marked thin');
});

test('a thin basis is never labelled as a narrower band than the data spans', () => {
  // The defect: with one same-project listing and others elsewhere, basis was
  // stamped SAME_PROJECT while the median came from EVERY comparable — the
  // report said "in the same project" about a number that was not.
  //
  // When no single band has enough, the analysis is stitched across bands.
  // The honest label is then the WIDEST band the data reaches, never a
  // narrower one, and the whole thing is thin by definition: two listings
  // from two different bands do not describe either band.
  const order = ['SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT', 'WIDER_MARKET'];
  const mixed = [
    one(),
    one({ project: 'Krtsanisi Park', address: 'კრწანისის ქუჩა 20', comparableType: 'MICRO_LOCATION', pricePerSqm: '1700' }),
    one({ project: 'Vake Boutique', address: 'თბილისი, ვაკე', comparableType: 'PEER_PROJECT', pricePerSqm: '2400' }),
  ];
  const m = buildMarketIntelligence(SUBJECT, mixed);

  assert.equal(m.basisIsThin, true, 'a stitched comparison was presented as a solid one');
  // The label must resolve to a band that actually has listings...
  const row = m.tiers.find((t) => t.tier === m.basis);
  assert.ok(row, `basis ${m.basis} is not a band with any listings`);
  // ...and must be at least as wide as every band that contributed.
  const widestPresent = Math.max(...m.tiers.map((t) => order.indexOf(t.tier)));
  assert.equal(order.indexOf(m.basis), widestPresent,
    `basis ${m.basis} is narrower than the data it was computed from`);
  // basisCount describes what was USED, which is all of it.
  assert.equal(m.basisCount, 3);
});

test('peer, district and broader bands each carry the analysis when they are the narrowest with enough', () => {
  const district = [
    one({ project: 'A', address: 'თბილისი, კრწანისი, ორთაჭალის გზა 4', comparableType: 'MICRO_LOCATION', pricePerSqm: '1600' }),
    one({ project: 'B', address: 'თბილისი, კრწანისი, ორთაჭალის გზა 9', comparableType: 'MICRO_LOCATION', pricePerSqm: '1650' }),
  ];
  assert.equal(buildMarketIntelligence(SUBJECT, district).basis, 'SAME_DISTRICT');
  assert.equal(buildMarketIntelligence(SUBJECT, district).basisIsThin, false);

  const peers = [
    one({ project: 'Vake Boutique', address: 'თბილისი, ვაკე', comparableType: 'PEER_PROJECT', pricePerSqm: '2400' }),
    one({ project: 'Saburtalo Sky', address: 'თბილისი, საბურთალო', comparableType: 'PEER_PROJECT', pricePerSqm: '1500' }),
  ];
  assert.equal(buildMarketIntelligence(SUBJECT, peers).basis, 'PEER_PROJECT');
});

test('no usable comparables produces no market section at all', () => {
  assert.equal(buildMarketIntelligence(SUBJECT, []), null);
  assert.equal(buildMarketIntelligence(SUBJECT, [{ project: 'x' }, { project: 'y', price: 'n/a' }]), null);
});

test('the model is told to treat thin evidence as indicative, never as a rate', () => {
  const src = read('src/verify/intelligence/prompt.ts');
  assert.ok(/basisIsThin/.test(src), 'the prompt never hears about thin evidence');
  assert.ok(/NEVER describe one/.test(src) && /"the market"/.test(src),
    'the prompt does not forbid calling one listing the market');
  assert.ok(/never conclude a property/.test(src),
    'the prompt allows a verdict from a single comparable');
});

test('the report marks a thin comparison for the reader too', () => {
  const cmp = read('src/components/verify/VerifyReport.tsx');
  assert.ok(/verify_mkt_thin_note/.test(cmp), 'a thin comparison is presented as a market rate');
  assert.ok(/tr\.thin \?/.test(cmp), 'a thin band is not marked in the hierarchy');
  // Neutral, not alarming: this is a limit of the evidence, not a property risk.
  const bundle = read('src/i18n/translations.ts');
  const notes = bundle.split('verify_mkt_thin_note: ').slice(1);
  assert.equal(notes.length, 6);
  for (const n of notes) {
    assert.ok(!/(risk|რისკ|риск)/i.test(n.slice(0, 400)), 'thin evidence is framed as property risk');
  }
});

/* ── the peer band has to be reachable, or the hierarchy is fiction ──── */

test('a named development elsewhere is a peer, not anonymous market stock', () => {
  // PEER_PROJECT had never been produced in production: the research layer
  // labels a distant development MICRO_LOCATION more often than PEER_PROJECT,
  // and a comparable on a street with no district hint fell all the way to
  // WIDER_MARKET, beside arbitrary city stock.
  const named = scoreComparable(SUBJECT, {
    project: 'Villa Residence', address: 'თბილისი, გრიგოლ ვოლსკის ქუჩა',
    area: '95', pricePerSqm: '7776', currency: 'GEL', comparableType: 'MICRO_LOCATION',
  });
  assert.equal(named.tier, 'PEER_PROJECT', 'a named development is still treated as open-market stock');

  // ...and an unbranded listing genuinely is wider market.
  const anonymous = scoreComparable(SUBJECT, {
    address: 'თბილისი, სადგურის მოედანი', area: '95', pricePerSqm: '3000',
    currency: 'GEL', comparableType: 'MICRO_LOCATION',
  });
  assert.equal(anonymous.tier, 'WIDER_MARKET', 'an unbranded flat was promoted to a peer project');
});

test('a peer never outranks a location match', () => {
  const peer = scoreComparable(SUBJECT, { project: 'Vake Boutique', address: 'თბილისი, ვაკე', area: '95', pricePerSqm: '2400', currency: 'USD' });
  const district = scoreComparable(SUBJECT, { project: 'Ortachala Hills', address: 'თბილისი, კრწანისი, ორთაჭალის გზა 4', area: '92', pricePerSqm: '1600', currency: 'USD' });
  const sameProject = scoreComparable(SUBJECT, { project: 'VILLION Krtsanisi Homes', address: 'კრწანისის ქუჩა 6', area: '94', pricePerSqm: '1850', currency: 'USD' });
  assert.ok(peer.relevance < district.relevance, 'a peer outranked a district match');
  assert.ok(district.relevance < sameProject.relevance, 'a district match outranked the same building');
});

test('the research prompt asks for a usable band, not a token listing', () => {
  // A band holding ONE listing cannot carry a comparison — MIN_FOR_BASIS
  // refuses it — so asking for restraint produced bands that were, in
  // practice, unresearched. The instruction must be a floor.
  const agent = read('supabase/functions/research-agent/index.ts');
  assert.ok(/DEPTH PER BAND/.test(agent), 'there is no per-band depth instruction');
  assert.ok(/AT LEAST 3/.test(agent), 'no minimum is requested');
  assert.ok(/never stop at one/.test(agent), 'a single listing is still an acceptable band');
  // The anti-fabrication bound must survive alongside it.
  assert.ok(/never pad a band/.test(agent), 'the anti-padding rule was lost');
  assert.ok(/an honestly empty band is correct/.test(agent), 'an empty band is no longer allowed');
});
