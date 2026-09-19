import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRegistryExtract } from '../../../../official-worker/src/evidence/RegistryExtractParser.ts';
import { registryExtractFor, applyRegistryExtract } from '../registryOverlay.ts';
import { buildCompanyIntelligence, representationRule, officialSourceUnavailable, uniqueText } from '../companyIntelligence.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';
import { buildIntelligenceBundle } from '../bundle.ts';

/*
 * THE DETERMINISTIC COMPANY CHAIN, END TO END.
 *
 * Production incident 2026-09-19. Three independent failures stacked:
 *
 *   1. Chromium could not launch in the worker, so no official document was
 *      retrieved by any job for days.
 *   2. RegistryExtractParser — which reads an entrepreneur-registry extract
 *      into exact fields including SHAREHOLDERS WITH PERCENTAGES — was
 *      imported by nothing except its own unit test.
 *   3. Nothing downstream consumed such a parse, and the model's schema has
 *      no ownership field, so ownership could only ever arrive as prose.
 *
 * (2) is the reason a green parser suite proved nothing. THIS test therefore
 * refuses to stop at the parser: it runs the REAL parser over the REAL
 * extract text and then follows the values all the way to what synthesis and
 * the UI actually read. A test that asserted parser output alone would have
 * passed happily throughout the entire incident.
 *
 * The fixture text is read from official-worker's own test file rather than
 * copied, so there is exactly one transcript of this document in the
 * repository and the two suites can never drift apart.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_FIXTURES = path.resolve(here, '../../../../official-worker/test/registryExtract.test.mjs');

function fixture(name) {
  const src = fs.readFileSync(WORKER_FIXTURES, 'utf8');
  const start = src.indexOf(`const ${name} = \``);
  assert.notEqual(start, -1, `fixture ${name} must exist in official-worker's test file`);
  const from = src.indexOf('`', start) + 1;
  const end = src.indexOf('`;', from);
  return src.slice(from, end);
}

/** The job document the worker now produces: a retrieved PDF carrying its
 * structured parse, exactly as EnregWorkflow.readPdf attaches it. */
function enregJob(extract, forEntity = { idCode: '404670272', name: 'შპს მილენიო გრუპი' }) {
  return {
    unavailable: false,
    results: [{
      source: 'enreg',
      status: 'SEARCH_CONFIRMED',
      forEntity,
      documents: [{
        url: 'https://enreg.reestri.gov.ge/extract.pdf',
        documentType: 'PDF_DOCUMENT',
        complete: true,
        registryExtract: extract,
      }],
    }],
  };
}

/* ------------------------------------------------------------------ *
 * The required fixture values, proven at the report input.            *
 * ------------------------------------------------------------------ */

test('the real Millenio extract reaches the report input with every registered fact intact', () => {
  const extract = parseRegistryExtract(fixture('MILENIO'));

  // The model's own reading: a name and nothing else of substance. This is
  // what production actually produced for the Villion job.
  const modelProfile = {
    name: 'შპს „მილენიო გრუპი“',
    idCode: null, legalForm: 'შპს', registrationDate: null, status: null,
    directors: [], representatives: [], historicalChanges: [],
    relatedProjects: ['Villion'], summary: 'Villion-ის პროექტის დეველოპერი.',
  };

  const browserOfficial = enregJob(extract);
  const matched = registryExtractFor(modelProfile, browserOfficial);
  assert.ok(matched, 'the extract must be adopted for the company it names');

  const companyProfile = applyRegistryExtract(modelProfile, matched);
  const report = { companyProfile, browserOfficial };

  // ---- the layer synthesis and the UI both read ----
  const company = buildCompanyIntelligence(report);
  assert.ok(company);

  assert.equal(company.status, 'REGISTRY_CONFIRMED');
  assert.equal(company.idCode, '404670272', 'COMPANY_ID');
  assert.equal(company.registrationDate, '28/03/2023', 'REGISTRATION_DATE');
  assert.match(company.legalForm, /შეზღუდული პასუხისმგებლობის საზოგადოება|შპს/, 'LEGAL_FORM');
  assert.match(company.registeredAddress, /კრწანისის ქუჩა, N6/, 'ADDRESS contains Krtsanisi St. N6');

  // Ownership — the fields that previously could not exist at all.
  assert.equal(company.ownership.length, 2, 'SHAREHOLDERS = 2');
  assert.deepEqual(
    company.ownership.map((o) => o.percentage).sort((a, b) => a - b),
    [50, 50],
    'OWNERSHIP_PERCENTAGES = 50 / 50'
  );
  assert.equal(company.ownershipTotal, 100, 'OWNERSHIP_TOTAL = 100');
  assert.equal(company.ownershipConsistent, true);

  assert.equal(company.directors.length, 2, 'DIRECTORS = 2');
  assert.equal(company.representationRule, 'JOINT', 'REPRESENTATION = JOINT');

  // The material registry finding.
  const pledge = company.encumbrances.find((e) => e.reference === 'R23757008');
  assert.ok(pledge, 'PLEDGE_REFERENCE = R23757008');
  assert.match(pledge.creditor, /საქართველოს ბანკი/, 'PLEDGE_COUNTERPARTY = Bank of Georgia');
  assert.equal(pledge.registeredAt, '19/12/2023', 'PLEDGE_DATE');
  // Scope is part of the finding, not a footnote.
  assert.equal(pledge.scope, 'COMPANY');

  // Evidence date and document, so the reader can date the claim.
  assert.equal(company.extractNumber, 'B24099518');
  assert.equal(company.extractPreparedAt, '15/08/2024');

  // ---- and the same values in the package/bundle synthesis is handed ----
  const pkg = buildEvidencePackage(report);
  const claims = pkg.items.map((i) => i.claim).join('\n');
  assert.match(claims, /404670272/, 'the identification code must reach the evidence package');
  assert.match(claims, /50%/, 'ownership percentages must reach the evidence package');
  assert.match(claims, /R23757008/, 'the registered pledge must reach the evidence package');

  const official = pkg.items.filter((i) => i.provenance === 'OFFICIAL_REGISTRY');
  assert.ok(official.length > 0, 'registry facts must be ranked as official evidence');
  assert.ok(
    official.some((i) => /R23757008/.test(i.claim) && i.tier === 1),
    'a registered charge is tier-1 evidence'
  );
  // The scope travels with the claim, so prose cannot silently relocate a
  // company pledge onto the buyer's apartment.
  assert.ok(
    pkg.items.some((i) => /R23757008/.test(i.claim) && /კომპანიის დონეზე/.test(i.claim)),
    'a company-level charge must say so in the claim itself'
  );

  const bundle = buildIntelligenceBundle(report, pkg, null);
  assert.ok(bundle.company, 'the bundle handed to synthesis must carry the company layer');
  assert.equal(bundle.company.idCode, '404670272');
  assert.equal(bundle.company.ownership.length, 2);
  assert.equal(bundle.company.encumbrances.length, 1);
});

/* ------------------------------------------------------------------ *
 * The model may explain official facts. It may not overwrite them.    *
 * ------------------------------------------------------------------ */

test('a model claim never overwrites a fact the registry stated', () => {
  const extract = parseRegistryExtract(fixture('MILENIO'));
  // A model that has confidently researched the wrong company.
  const wrong = {
    name: 'შპს სხვა კომპანია',
    idCode: '404670272',
    legalForm: 'სააქციო საზოგადოება',
    registrationDate: '01/01/2019',
    directors: ['ვიღაც სხვა'],
    shareholders: [{ name: 'ვიღაც სხვა', percentage: 100 }],
  };
  const profile = applyRegistryExtract(wrong, registryExtractFor(wrong, enregJob(extract)));
  const company = buildCompanyIntelligence({ companyProfile: profile, browserOfficial: enregJob(extract) });

  assert.equal(company.legalName, 'შპს მილენიო გრუპი', 'the registry name wins');
  assert.equal(company.registrationDate, '28/03/2023', 'the registry date wins');
  assert.match(company.legalForm, /შეზღუდული/, 'the registry legal form wins');
  assert.equal(company.ownership.length, 2, 'registered ownership replaces the invented holder');
  assert.ok(!company.ownership.some((o) => o.percentage === 100), 'the invented 100% holder is gone');
  assert.ok(company.registryFields.includes('shareholders'));
  assert.ok(company.registryFields.includes('registrationDate'));
});

/* ------------------------------------------------------------------ *
 * Strict entity matching. Two companies are not one company.          *
 * ------------------------------------------------------------------ */

test('an extract is never adopted for a company it does not identify', () => {
  const milenio = parseRegistryExtract(fixture('MILENIO'));
  const artitexi = parseRegistryExtract(fixture('ARTITEXI'));

  // Job 3aa36828: 404670272 and 405068386 are DIFFERENT companies that the
  // pipeline once carried under one name.
  assert.equal(milenio.idCode, '404670272');
  assert.equal(artitexi.idCode, '405068386');

  const wantMilenio = { name: 'შპს მილენიო გრუპი', idCode: '404670272' };
  assert.equal(
    registryExtractFor(wantMilenio, enregJob(artitexi, { idCode: '405068386' })),
    null,
    'a different company\'s extract must not be adopted on an id-code mismatch'
  );

  // Two extracts and no id to choose between them: adopt nothing.
  const ambiguous = {
    unavailable: false,
    results: [{
      source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: null,
      documents: [{ registryExtract: milenio }, { registryExtract: artitexi }],
    }],
  };
  assert.equal(registryExtractFor({}, ambiguous), null, 'ambiguity must resolve to nothing, not to the first row');

  // A name that merely looks similar is not a match.
  assert.equal(
    registryExtractFor({ name: 'შპს მილენიო' }, enregJob(milenio, { idCode: null })),
    null,
    'a partial name must not adopt an extract'
  );
});

/* ------------------------------------------------------------------ *
 * "We could not look" is not "we looked and found nothing".           *
 * ------------------------------------------------------------------ */

test('a failed official source is reported as unavailable, never as an absence of ownership', () => {
  // Exactly the shape the incident produced: the browser never launched.
  const report = {
    companyProfile: {
      name: 'შპს „მილენიო გრუპი“', idCode: null, directors: [], shareholders: [],
      sourceBasis: 'WEB_RESEARCH_ONLY',
    },
    browserOfficial: { unavailable: true, results: [] },
    reconciledIdentity: { developer: 'შპს „მილენიო გრუპი“' },
  };

  assert.equal(officialSourceUnavailable(report), true);

  const company = buildCompanyIntelligence(report);
  assert.equal(company.status, 'SOURCE_UNAVAILABLE');
  assert.equal(company.registryBacked, false);
  assert.deepEqual(company.ownership, [], 'no ownership is invented to fill the gap');
  // The point of the status: a renderer can now say the check did not run,
  // instead of reporting an empty result as a finding about the company.
  assert.notEqual(company.status, 'REGISTRY_CONFIRMED');
  assert.notEqual(company.status, 'WEB_RESEARCH_ONLY');
});

test('a company with no registry backing and a working source stays WEB_RESEARCH_ONLY', () => {
  const company = buildCompanyIntelligence({
    companyProfile: { name: 'შპს ტესტი', sourceBasis: 'WEB_RESEARCH_ONLY' },
    browserOfficial: { unavailable: false, results: [{ source: 'enreg', status: 'NO_RESULT_CONFIRMED', documents: [] }] },
  });
  assert.equal(company.status, 'WEB_RESEARCH_ONLY');
});

test('no company at all renders nothing rather than an empty company section', () => {
  assert.equal(buildCompanyIntelligence({ companyProfile: null, browserOfficial: { unavailable: false, results: [] } }), null);
  assert.equal(buildCompanyIntelligence({}), null);
});

/* ------------------------------------------------------------------ *
 * Representation is read, not counted.                                *
 * ------------------------------------------------------------------ */

test('representation rule reflects what the registry wrote', () => {
  assert.equal(representationRule([{ name: 'a', representation: 'ერთობლივი' }, { name: 'b', representation: 'ერთობლივი' }]), 'JOINT');
  assert.equal(representationRule([{ name: 'a', representation: 'ერთპიროვნული' }]), 'SOLE');
  assert.equal(representationRule([{ name: 'a', representation: 'ერთობლივი' }, { name: 'b', representation: 'ერთპიროვნული' }]), 'MIXED');
  // Two directors do NOT imply joint representation.
  assert.equal(representationRule([{ name: 'a', representation: null }, { name: 'b', representation: null }]), 'UNKNOWN');
  assert.equal(representationRule([]), 'UNKNOWN');
});

/* ------------------------------------------------------------------ *
 * Only registered charges are findings.                               *
 * ------------------------------------------------------------------ */

test('"not registered" rows never become encumbrances', () => {
  const artitexi = parseRegistryExtract(fixture('ARTITEXI'));
  // Every row in this extract is "not registered".
  assert.ok(artitexi.encumbrances.length > 0, 'the parser still reads the rows');
  assert.ok(artitexi.encumbrances.every((e) => !e.registered));

  const profile = applyRegistryExtract({ idCode: '405068386' }, registryExtractFor({ idCode: '405068386' }, enregJob(artitexi, { idCode: '405068386' })));
  const company = buildCompanyIntelligence({ companyProfile: profile, browserOfficial: enregJob(artitexi, { idCode: '405068386' }) });

  assert.deepEqual(company.encumbrances, [], 'an unregistered row is the registry answering a question, not a finding');
  // The rest of that company still arrives, including its five-way split.
  assert.equal(company.ownership.length, 5);
  assert.equal(company.ownershipTotal, 100);
  assert.equal(company.representationRule, 'SOLE');
});

/* ------------------------------------------------------------------ *
 * Personal identification numbers must not travel into a report.      *
 * ------------------------------------------------------------------ */

test('the overlay carries names and shares, never personal id numbers', () => {
  const extract = parseRegistryExtract(fixture('MILENIO'));
  // The extract itself does contain them.
  assert.ok(extract.shareholders.some((s) => s.idNumber));
  const profile = applyRegistryExtract({ idCode: '404670272' }, registryExtractFor({ idCode: '404670272' }, enregJob(extract)));
  const serialized = JSON.stringify({
    directors: profile.directors, shareholders: profile.shareholders,
  });
  assert.equal(/\b\d{11}\b/.test(serialized), false, 'no 11-digit personal id may reach the profile');
});

/* ------------------------------------------------------------------ *
 * NO FACT TWICE — the live Villion report, 2026-09-19.               *
 *                                                                     *
 * The owner's real run showed each director twice. The stored data    *
 * was clean and peopleIntelligence was clean; the duplication was in  *
 * RENDERING — CompanyOwnershipCard and the older CompanyProfileCard   *
 * both drew `companyProfile.directors` into the same column. Removing *
 * the older card is the fix, and carrying its remaining fields into   *
 * this section is what keeps the fix from deleting information.       *
 * ------------------------------------------------------------------ */

test('each director and shareholder appears exactly once', () => {
  const extract = parseRegistryExtract(fixture('MILENIO'));
  const profile = applyRegistryExtract({ idCode: '404670272' }, registryExtractFor({ idCode: '404670272' }, enregJob(extract)));
  const company = buildCompanyIntelligence({ companyProfile: profile, browserOfficial: enregJob(extract) });

  const directors = company.directors.map((d) => d.name);
  const holders = company.ownership.map((o) => o.name);

  assert.equal(directors.length, 2, 'exactly two directors');
  assert.equal(new Set(directors).size, 2, 'and no repeated name');
  for (const name of ['კობა კვანტალიანი', 'ლევან ჩაჩუა']) {
    assert.equal(
      directors.filter((d) => d === name).length, 1,
      `${name} must appear exactly once as a director`
    );
    assert.equal(holders.filter((h) => h === name).length, 1, `${name} must hold one stake`);
  }
});

test('only one component renders the company facts', () => {
  const page = fs.readFileSync(
    path.resolve(here, '../../../pages/VerifyPage.tsx'), 'utf8'
  );
  const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(
    /<CompanyProfileCard\b/.test(code), false,
    'the legacy company card must not render alongside COMPANY & OWNERSHIP'
  );
  assert.match(code, /<CompanyOwnershipCard report=\{report\}\/>/);
});

test('the fields only the old card showed are carried, not dropped', () => {
  const company = buildCompanyIntelligence({
    companyProfile: {
      name: 'შპს მილენიო გრუპი',
      representatives: ['ნინო ბერიძე', 'ნინო ბერიძე'],
      historicalChanges: ['სახელის ცვლილება 2024', 'სახელის ცვლილება 2024.'],
      relatedProjects: ['Villion', '«Villion»'],
      registryFields: ['name'],
    },
    browserOfficial: { unavailable: false, results: [{ source: 'enreg', documents: [] }] },
  });
  // Present…
  assert.deepEqual(company.representatives, ['ნინო ბერიძე']);
  assert.deepEqual(company.relatedProjects, ['Villion']);
  assert.equal(company.historicalChanges.length, 1);
  // …and deduplicated on harmless differences only.
  assert.equal(uniqueText(['A', 'a', ' A ', 'A.']).length, 1);
  assert.equal(uniqueText(['Villion', 'Villion Two']).length, 2, 'genuinely different entries survive');
});
