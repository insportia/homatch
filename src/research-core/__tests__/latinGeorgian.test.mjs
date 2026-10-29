// Georgian typed in Latin letters ("translit") is read by the same deterministic demand rules
// as Georgian script: a buyer or tenant writing "viyidi bina vakeshi" is still a lead, a
// seller or landlord is still supply, and noise stays noise. No model anywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { isLatinGeorgian, latinGeorgianToScript } from '../findBuyers/latinGeorgian.ts';

const CASES = [
  // buyers
  ['viyidi bina vakeshi 2 sadzinebliani', 'BUY_SEEKER'],
  ['vyidulob binas saburtaloze 80000$-mde', 'BUY_SEEKER'],
  ['vqidulob 3 otaxian binas gldanshi', 'BUY_SEEKER'],
  ['gamarjobat, vezeb binas sayidlad tbilisshi, biujeti 60 atasi dolari', 'BUY_SEEKER'],
  ['vezeb kerzo saxls sayidlad digomshi', 'BUY_SEEKER'],
  ['mainteresebs bina batumshi zghvastan, viyidi', 'BUY_SEEKER'],
  ['vyidulob akhalashenebul binas saburtaloze', 'BUY_SEEKER'],
  ['veZeb binas sayidlad isanshi, 2 otaxiani', 'BUY_SEEKER'],
  // tenants
  ['vqiraob binas isanshi tveshi 300 lari', 'RENT_SEEKER'],
  ['mchirdeba bina qirit vakeshi, 2 otaxiani, 500$', 'RENT_SEEKER'],
  ["mch'irdeba bina qirit saburtaloze", 'RENT_SEEKER'],
  ['veZeb saqiravo binas didubeshi grdzelvadianad', 'RENT_SEEKER'],
  ['mchirdeba dgiurad bina batumshi', 'RENT_SEEKER'],
  ['minda vikirao bina gldanshi', 'RENT_SEEKER'],
  // sellers and landlords
  ['iyideba 2 otaxiani bina saburtaloze 75000$ mesakutre', 'SALE_OFFER'],
  ['iqideba sakhli digomshi, fasi 150 000 dolari', 'SALE_OFFER'],
  ['vyidi binas isanshi, shuamavlis gareshe', 'SALE_OFFER'],
  ['gaqidvaze maqvs bina saburtaloze, damirekat', 'SALE_OFFER'],
  ['qiravdeba bina vakeshi, 600$ tveshi, axali remontit', 'RENT_OFFER'],
  ['gamoqiravebuli bina gldanshi, kiravdeba 400 larad', 'RENT_OFFER'],
  ['gavaqiraveb 1 otaxian binas tbilisshi', 'RENT_OFFER'],
  // noise
  ['gilocavt dabadebis dges!', 'IRRELEVANT'],
  ['vin ici kargi restorani vakeshi?', 'IRRELEVANT'],
  ['samushao mchirdeba, mzareulis vakansia', 'JOB'],
];

test('translit posts: buyers and tenants are leads, sellers and landlords are supply, noise is noise', () => {
  assert.ok(CASES.length >= 20);
  const failures = CASES.map(([text, role]) => [text, role, classifyDemand(text).role]).filter(([, want, got]) => want !== got);
  console.log(`latin-georgian regression: ${CASES.length - failures.length}/${CASES.length} passed`);
  assert.deepEqual(failures, []);
  for (const [text] of CASES.filter(([, r]) => r !== 'IRRELEVANT' && r !== 'JOB')) {
    assert.ok(classifyDemand(text).evidence.includes('latin_georgian'), text);
  }
});

test('translit reads exactly like the same post in Georgian script', () => {
  const pairs = [
    ['viyidi bina vakeshi 2 sadzinebliani', 'ვიყიდი ბინა ვაკეში 2 საძინებლიანი'],
    ['mchirdeba bina qirit vakeshi', 'მჭირდება ბინა ქირით ვაკეში'],
    ['iqideba sakhli digomshi', 'იყიდება სახლი დიღომში'],
  ];
  for (const [latin, script] of pairs) {
    assert.equal(latinGeorgianToScript(latin), script);
    const a = classifyDemand(latin), b = classifyDemand(script);
    assert.equal(a.role, b.role, latin);
    assert.deepEqual(a.districts, b.districts, latin);
  }
});

test('digraphs, apostrophe letters and chat capitals; digits are never letters', () => {
  assert.equal(latinGeorgianToScript('vqidulob sakhls kh gh sh ch zh dz ts'), 'ვყიდულობ სახლს ხ ღ შ ჩ ჟ ძ ც');
  assert.equal(latinGeorgianToScript("vyidulob binas ch'ina t'ivi"), 'ვყიდულობ ბინას ჭინა ტივი');
  assert.equal(latinGeorgianToScript('veZeb binas'), 'ვეძებ ბინას');
  assert.equal(latinGeorgianToScript('vyidulob 3 otaxian binas 80000$'), 'ვყიდულობ 3 ოთახიან ბინას 80000$');
});

test('English, Turkish and Georgian-script text are left alone', () => {
  for (const text of ['Tbilisi Vake apartment for rent 800 usd', 'kiralik daire Tiflis Vake 500 dolar', 'Bina satılık, Batum', 'ვყიდულობ ბინას', 'Looking for a flat in Vake, budget 120k']) {
    assert.equal(isLatinGeorgian(text), false, text);
    assert.equal(latinGeorgianToScript(text), text);
  }
});
