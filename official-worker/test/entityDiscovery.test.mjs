import assert from 'node:assert/strict';
import { extractEntityCandidates, EntityLedger } from '../src/lib/entityDiscovery.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok - ${name}`); }

t('extractEntityCandidates: finds an LLC name with adjacent id code', () => {
  const text = 'განმცხადებელი: შპს ჰომათჩ ჯგუფი, საიდენტიფიკაციო კოდი 123456789, მისამართი ...';
  const cands = extractEntityCandidates(text);
  assert.equal(cands.length, 1);
  assert.match(cands[0].name, /^შპს/);
  assert.equal(cands[0].idCode, '123456789');
});

t('extractEntityCandidates: name-only mention (no nearby id code) is an incomplete candidate', () => {
  const text = 'წყარო ახსენებს შპს გამარჯვებულ კომპანიას დამატებითი დეტალების გარეშე.';
  const cands = extractEntityCandidates(text);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].idCode, null);
});

t('extractEntityCandidates: a bare 9-digit number far from any entity marker is never treated as an id code alone', () => {
  const text = 'ტელეფონის ნომერი: 599123456. ' + 'x'.repeat(300) + ' შპს სხვა კომპანია მოხსენიებულია აქ.';
  const cands = extractEntityCandidates(text);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].idCode, null); // the phone-like number is outside the window
});

t('extractEntityCandidates: no entities in plain text', () => {
  assert.deepEqual(extractEntityCandidates('უბრალო ტექსტი კომპანიების გარეშე'), []);
});

t('extractEntityCandidates: handles empty/null input', () => {
  assert.deepEqual(extractEntityCandidates(''), []);
  assert.deepEqual(extractEntityCandidates(null), []);
});

t('EntityLedger: dedupes the same entity mentioned twice with the same id code', () => {
  const l = new EntityLedger();
  l.add({ name: 'შპს ჰომათჩ', idCode: '123456789' }, { source: 'tas', sourceDocument: 'https://tas.ge/doc/1' });
  l.add({ name: 'შპს ჰომათჩ', idCode: '123456789' }, { source: 'napr', sourceDocument: 'https://napr.gov.ge/doc/2' });
  const all = l.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].discoveries.length, 2);
  assert.equal(all[0].status, 'CONFIRMED');
});

t('EntityLedger: upgrades an incomplete candidate once its id code is discovered later', () => {
  const l = new EntityLedger();
  l.add({ name: 'შპს გამარჯვებული', idCode: null }, { source: 'tas' });
  assert.equal(l.incomplete().length, 1);
  l.add({ name: 'შპს გამარჯვებული', idCode: '987654321' }, { source: 'mygov' });
  assert.equal(l.incomplete().length, 0);
  assert.equal(l.confirmed().length, 1);
  assert.equal(l.confirmed()[0].discoveries.length, 2);
});

t('EntityLedger: two different id codes under a similar name are kept as separate entities', () => {
  const l = new EntityLedger();
  l.add({ name: 'შპს ალფა', idCode: '111111111' }, {});
  l.add({ name: 'შპს ალფა', idCode: '222222222' }, {});
  assert.equal(l.confirmed().length, 2);
});

t('EntityLedger.scanText: end-to-end scan populates the ledger from raw text', () => {
  const l = new EntityLedger();
  l.scanText('მესაკუთრე: შპს მშენებელი, კოდი 555666777.', { source: 'tas', sourceDocument: 'https://tas.ge/x' });
  assert.equal(l.confirmed().length, 1);
  assert.equal(l.confirmed()[0].idCode, '555666777');
  assert.equal(l.confirmed()[0].discoveries[0].source, 'tas');
});

console.log(`\n${n} passed`);
