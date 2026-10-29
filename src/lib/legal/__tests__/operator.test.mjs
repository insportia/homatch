// The operator change (owner, 2026-10-29): შპს „ულტრა ქონექშენ“, identification
// code 406378511, from the one legal config, with nothing invented around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ARCHIVED_EDITIONS, LEGAL_OPERATOR, PREVIOUS_OPERATOR_2026_10_25, editionFor, operatorDisplayName, operatorEntityLabelKey, operatorIdLabelKey,
} from '../operator.ts';

const ROOT = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

test('the operator is the LLC, with only the facts the owner gave', () => {
  assert.equal(LEGAL_OPERATOR.legalEntityType, 'llc');
  assert.equal(LEGAL_OPERATOR.legalEntityName, 'შპს „ულტრა ქონექშენ“', 'exact Georgian name and quotation marks');
  assert.equal(LEGAL_OPERATOR.identificationNumber, '406378511');
  assert.equal(LEGAL_OPERATOR.legalEntityNameLatin, null, 'no Latin name was provided, so none is shown');
  assert.equal(LEGAL_OPERATOR.registeredAddress, null, 'no address was provided');
  assert.equal(operatorEntityLabelKey(), 'legal_entity_llc');
  assert.equal(operatorDisplayName('ka', 'x'), 'შპს „ულტრა ქონექშენ“');
  const en = operatorDisplayName('en', 'Limited Liability Company');
  assert.ok(en.includes('შპს „ულტრა ქონექშენ“') && en.endsWith(', Limited Liability Company') && !en.includes('('));
  /* The previous operator survives only as the archived edition's identity. */
  const src = read('src/lib/legal/operator.ts');
  const current = src.slice(src.indexOf('export const LEGAL_OPERATOR'), src.indexOf('} as const;'));
  assert.ok(!/Tariel|Chachua|ტარიელ|01027085016/.test(current), 'the current operator block names only the LLC');
});

test('archived editions keep the operator they named, unchanged', () => {
  assert.deepEqual(ARCHIVED_EDITIONS.map((e) => e.version), ['2026-10-25']);
  const old = editionFor('terms', '2026-10-25');
  assert.equal(old.supersededOn, '2026-10-29');
  assert.deepEqual({ ...old.operator }, {
    legalEntityType: 'individual_entrepreneur',
    legalEntityName: 'ინდივიდუალური მეწარმე ტარიელი ჩაჩუა',
    legalEntityNameLatin: 'Tariel Chachua',
    identificationNumber: '01027085016',
    registeredAddress: null,
  });
  /* Rendered exactly as the 2026-10-25 pages rendered it. */
  assert.equal(operatorDisplayName('ka', 'ინდივიდუალური მეწარმე', PREVIOUS_OPERATOR_2026_10_25), 'ინდივიდუალური მეწარმე ტარიელი ჩაჩუა');
  assert.equal(operatorDisplayName('en', 'Individual Entrepreneur', PREVIOUS_OPERATOR_2026_10_25), 'Individual Entrepreneur Tariel Chachua');
  assert.equal(operatorEntityLabelKey(PREVIOUS_OPERATOR_2026_10_25), 'legal_entity_individual_entrepreneur');
  /* The company's label is an identification code; the archived edition keeps "ID No.". */
  assert.equal(operatorIdLabelKey(), 'legal_company_id_code');
  assert.equal(operatorIdLabelKey(PREVIOUS_OPERATOR_2026_10_25), 'legal_id_number');
  for (const doc of ['terms', 'privacy', 'cookies']) {
    assert.equal(editionFor(doc, '2026-10-25').operator, PREVIOUS_OPERATOR_2026_10_25, doc);
    for (const asked of [null, undefined, '', '1999-01-01', LEGAL_OPERATOR.versions[doc]]) {
      const e = editionFor(doc, asked);
      assert.equal(e.version, LEGAL_OPERATOR.versions[doc], `${doc} ${asked}`);
      assert.equal(e.operator.identificationNumber, '406378511');
      assert.equal(e.supersededOn, null);
    }
  }
});

test('the archived Terms keep their own fee text, which still exists in all six languages', async () => {
  const terms = read('src/pages/TermsPage.tsx');
  assert.match(terms, /archived = useLegalEdition\('terms'\)\.version === '2026-10-25'/);
  const { translations } = await import(new URL('src/i18n/translations.ts', ROOT).href);
  for (const k of ['terms_s4_title', 'terms_s4_body1', 'terms_s4_body2', 'terms_s4_body3', 'terms_s4_stripe', 'terms_s4_refund', 'legal_entity_individual_entrepreneur']) {
    assert.ok(terms.includes(`'${k}'`) || k === 'legal_entity_individual_entrepreneur', `${k} rendered by the archived edition`);
    for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) assert.ok(translations[lang][k], `${k} kept in ${lang}`);
  }
  assert.equal(translations.en.terms_s4_stripe, 'Credits are purchased through our payment processor, Stripe. Credit balances do not expire.');
  const layout = read('src/components/legal/LegalLayout.tsx');
  assert.match(layout, /useLegalEdition\(doc\)/);
  assert.match(layout, /data-legal-archived/);
  assert.match(layout, /\?version=\$\{e\.version\}/);
});

test('the label key exists in all six languages', async () => {
  const { translations } = await import(new URL('src/i18n/translations.ts', ROOT).href);
  const want = {
    en: 'Limited Liability Company', ka: 'შეზღუდული პასუხისმგებლობის საზოგადოება',
    ru: 'Общество с ограниченной ответственностью', tr: 'Limited Şirket',
    ar: 'شركة ذات مسؤولية محدودة', he: 'חברה בערבון מוגבל',
  };
  for (const [lang, value] of Object.entries(want)) assert.equal(translations[lang].legal_entity_llc, value, lang);
  assert.equal(translations.ka.legal_company_id_code, 'საიდენტიფიკაციო კოდი');
  assert.equal(translations.en.legal_company_id_code, 'Identification code');
  for (const lang of ['ru', 'tr', 'ar', 'he']) assert.ok(translations[lang].legal_company_id_code && translations[lang].legal_company_id_code !== 'Identification code', lang);
  assert.equal(translations.en.legal_id_number, 'ID No.', 'the archived edition keeps its original label');
});

test('the published versions equal the database row the migration writes', () => {
  assert.deepEqual({ ...LEGAL_OPERATOR.versions }, { terms: '2026-10-29', privacy: '2026-10-29', cookies: '2026-10-29' });
  const dir = new URL('supabase/migrations/', ROOT);
  const latest = readdirSync(dir).filter((f) => /policy_versions/.test(f)).sort().at(-1);
  const sql = readFileSync(new URL(latest, dir), 'utf8');
  for (const doc of ['terms', 'privacy']) assert.ok(sql.includes(`'${doc}', '${LEGAL_OPERATOR.versions[doc]}'`), `${doc} seeded at the client's version`);
  assert.match(sql, /set version\s+= '2026-10-29'/);
  assert.match(sql, /reaccept_existing = true/, 'a new operator is a material change');
});

test('every surface reads the operator from the config', () => {
  for (const f of ['src/components/home/sections/SiteFooter.tsx', 'src/components/legal/LegalLayout.tsx']) {
    const src = read(f);
    assert.match(src, /operatorEntityLabelKey\(/, f);
    assert.doesNotMatch(src, /legal_entity_individual_entrepreneur/, f);
  }
  /* Structured data already existed (For Expats articles): its publisher carries the legal identity. */
  const seo = read('src/components/expats/ExpatSeo.tsx');
  assert.match(seo, /legalName: LEGAL_OPERATOR\.legalEntityName/);
  assert.match(seo, /value: LEGAL_OPERATOR\.identificationNumber/);
});

test('the Terms fee section describes plans, not credit sales through Stripe', () => {
  const terms = read('src/pages/TermsPage.tsx');
  for (const k of ['terms_sub_title', 'terms_sub_plans', 'terms_sub_trial', 'terms_sub_included', 'terms_sub_third_party', 'terms_sub_credits', 'terms_sub_cancel', 'terms_sub_provider', 'terms_sub_refund']) {
    assert.ok(terms.includes(`'${k}'`), k);
  }
  /* The current edition's branch renders none of the credit/Stripe keys. */
  const current = terms.slice(terms.indexOf(': <>', terms.indexOf("terms_s4_refund")));
  for (const gone of ['terms_s4_stripe', 'terms_s4_body1', 'terms_s4_body3', 'terms_s4_refund']) assert.ok(!current.includes(`'${gone}'`), gone);
});
