import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRegisterExtract } from '../propertyRegister.ts';

/*
 * REGRESSION (owner, 2026-10-31): the owner was read as nobody on every recent Verify and the
 * report dropped its owner row. Production extracts come in three owner layouts; each shape below
 * is the layout of a real failing job, with test names and numbers.
 */

const HEAD = 'ამონაწერი საჯარო რეესტრიდან\nრეგისტრაცია მომზადების თარიღი\n \nN 892024589088    -  11/10/2024 12:31:24\n \n11/10/2024 14:51:26\nსაკუთრების განყოფილება\nზონასექტორიკვარტალინაკვეთი\n011504016/015\nმისამართი: ქალაქი თბილისი , ქუჩა სატესტო , N\n32\nნაკვეთის საკუთრების ტიპი: საკუთრება\nნაკვეთის დანიშნულება: არასასოფლო სამეურნეო\nდაზუსტებული ფართობი: 400.00 კვ.მ.\n \n';
const TAIL = 'იპოთეკა\nსაგადასახადო გირავნობა: \n \nრეგისტრირებული არ არის\nვალდებულება\nყადაღა/აკრძალვა: \n \nრეგისტრირებული არ არის\nმოვალეთა რეესტრი: \n \nრეგისტრირებული არ არის\n         \nფიზიკური პირის მიერ არასამეწარმეო საქმიანობის ფარგლებში\n';

// 07fa2f3a / b6bba2ef: the current heading "მესაკუთრის განყოფილება".
const CURRENT = HEAD + 'მესაკუთრის განყოფილება\n \nგანცხადების რეგისტრაცია : ნომერი 882024714020 , თარიღი 20/05/2024 18:14:28 \n \nუფლების რეგისტრაცია: თარიღი  21/05/2024\n \n \nუფლების დამადასტურებელი დოკუმენტი:\nუძრავი ქონების ნასყიდობის ხელშეკრულება , დამოწმების თარიღი:21/05/2024 , საქართველოს იუსტიციის\nსამინისტროს საჯარო რეესტრის ეროვნული სააგენტო\n \n \nმესაკუთრეები:\n \nშპს \'\'სატესტო პალასი\'\' , ID ნომერი:400000001\n \n \nმესაკუთრე:აღწერა:\nშპს \'\'სატესტო პალასი\'\'\n \n' + TAIL;

// d84f06db / 176264ba: a building parcel — no heading, a long list across page breaks, foreign owners.
const coOwners = Array.from({ length: 30 }, (_, i) => `სატესტო მესაკუთრე${i + 1} ,P/N: ${String(10000000000 + i)}\n \n`);
const PARCEL = HEAD + 'შენობა-ნაგებობის ჩამონათვალი:შენობა\nN1 (მშენებარე), საერთო ფართობი:\n5615.8 კვ.მ. \n \nმესაკუთრეები:\n \n'
  + 'უცხო მოქალაქე , C/N: 00 0000000\n \n'
  + coOwners.slice(0, 15).join('')
  + '\n11/10/2023სრული ამონაწერი[შეთანხმებული](UNI)\nfile:///tmp/tomcat8-tomcat8-tmp/68562d27.html2/20\n'
  + coOwners.slice(15).join('')
  + TAIL;

// cc158dde: parcel owners, then the building's unit-owner table.
const UNITS = HEAD + 'მესაკუთრეები\n \nმესაკუთრეები:\nპირველი სატესტო ,P/N: 01000000001\nმეორე სატესტო ,P/N: 01000000002\nბინა ერთეულის მესაკუთრეები\nშპს "სატესტო" , ID ნომერი:400000002\n \n01.14.10.001.100.01.01.001\nშპს "სატესტო"საკუთრებაფართი(მშენებარე)\n' + TAIL;

test('current heading "მესაკუთრის განყოფილება": the owner, rights date and basis are read', () => {
  const e = parseRegisterExtract(CURRENT, '28818598');
  assert.deepEqual(e.owners, [{ kind: 'COMPANY', name: "შპს ''სატესტო პალასი''", companyId: '400000001' }]);
  assert.equal(e.ownershipRegisteredOn, '2024-05-21');
  assert.equal(e.ownershipBasis, 'PURCHASE');
  assert.equal(e.ownersTotal, undefined);
});

test('building parcel without a heading: owners are read across page breaks, counted, and no document number survives', () => {
  const e = parseRegisterExtract(PARCEL, '24479929');
  assert.equal(e.owners.length, 12);
  assert.equal(e.ownersTotal, 31);
  assert.deepEqual(e.owners[0], { kind: 'PERSON', name: 'უცხო მოქალაქე' });
  for (const o of e.owners) {
    assert.equal(o.kind, 'PERSON');
    assert.match(o.name, /^(?:სატესტო მესაკუთრე\d+|უცხო მოქალაქე)$/, `a page-break line or number read as an owner: ${o.name}`);
  }
  const json = JSON.stringify(e);
  assert.ok(!/0000000|1000000000\d|file:|tomcat|სრული ამონაწერი/.test(json), 'no passport, personal number or footer leaves the parser');
});

test('a building\'s unit-owner table is not read as the parcel\'s owners', () => {
  const e = parseRegisterExtract(UNITS, '1');
  assert.deepEqual(e.owners.map((o) => o.name), ['პირველი სატესტო', 'მეორე სატესტო']);
});

