// Two findings from rendering production job eeefada9 (2026-10-11):
//   - a 2013 render was captioned "უახლესი რენდერი" (the worker named the
//     latest render before newer ones were recovered; stored visuals carry
//     no date);
//   - shareholders' personal numbers survived in people[].support because an
//     escaped "\n" glued them to a letter, defeating the \b boundary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assignRenderRoles } from '../intelligence/tasIntelligence.ts';
import { redactPersonalData, redactPeopleSupport } from '../intelligence/peopleIntelligence.ts';
import { withoutLatestClaims } from '../visualCatalog.ts';

test('render roles follow dates: the 2025 photomontage is the latest, the 2013 render is not', () => {
  const v = [
    { id: 'a', kind: 'RENDER', role: 'LATEST_RENDER', date: null, documentId: '144566' },
    { id: 'b', kind: 'RENDER', role: 'SUPPORTING', date: null, documentId: '1110027' },
    { id: 'c', kind: 'RENDER', role: 'SUPPORTING', date: null, documentId: '95157' },
    { id: 'd', kind: 'PHOTO', role: 'SUPPORTING', date: null, documentId: '1087185' },
  ];
  assignRenderRoles(v, new Map([['144566', '2013-07-06'], ['1110027', '2025-09-23'], ['95157', '2012-12-04'], ['1087185', '2025-04-14']]));
  assert.deepEqual(v.map((x) => x.role), ['SUPPORTING', 'LATEST_RENDER', 'EARLIEST_RENDER', 'SUPPORTING']);
  // Nothing dated: roles are left as the worker set them.
  const u = [{ id: 'x', kind: 'RENDER', role: 'LATEST_RENDER', date: null, documentId: null }];
  assignRenderRoles(u, new Map());
  assert.equal(u[0].role, 'LATEST_RENDER');
});

test('a visual outside the latest-design tab never calls itself the latest', () => {
  const v = { id: 'a', role: 'LATEST_RENDER', title: 'უახლესი რენდერი', explanation: { what: 'ეს არის პროექტის უახლესი რენდერი, პროექტის მასშტაბში.', interesting: 'მასალა უახლეს საპროექტო ხედს წარმოადგენს.', buyerMeaning: 'შეგიძლიათ შეაფასოთ დაგეგმილი არქიტექტურული იერსახე.', uncertain: 'რენდერი ვერ ადასტურებს, როგორ არის შენობა რეალურად შესრულებული.' } };
  const out = withoutLatestClaims(v);
  assert.equal(out.role, 'SUPPORTING');
  assert.equal(out.title, null);
  assert.equal(out.explanation.what, '');
  assert.equal(out.explanation.interesting, '');
  assert.match(out.explanation.buyerMeaning, /არქიტექტურული იერსახე/);
  const plain = { id: 'b', role: 'SUPPORTING', title: 'ფასადი', explanation: { what: 'ფასადის ნახაზი.', interesting: '', buyerMeaning: '', uncertain: '' } };
  assert.equal(withoutLatestClaims(plain), plain);
  const src = readFileSync(join(import.meta.dirname, '..', 'visualCatalog.ts'), 'utf8');
  assert.match(src, /visual: chapter === 'LATEST' \? r\.v : withoutLatestClaims\(r\.v\)/);
});

test('personal numbers never survive, even glued to an escaped line break', () => {
  assert.equal(redactPersonalData('მამუკა ბარათაშვილი,\\n01234567890'), 'მამუკა ბარათაშვილი');
  assert.equal(redactPersonalData('ID 01234567890; ტელ 555 12 34 56'), 'ID; ტელ');
  const people = redactPeopleSupport({ people: [{ name: 'ა', support: 'ა,\\n01234567890' }, { name: 'ბ' }] });
  assert.doesNotMatch(JSON.stringify(people), /\d{9,11}/);
  // The read path redacts stored reports too.
  const vs = readFileSync(join(import.meta.dirname, '..', '..', '..', 'supabase/functions/verify-synthesis/index.ts'), 'utf8');
  const fc = vs.slice(vs.indexOf('async function forCustomer'), vs.indexOf('async function forCustomer') + 800);
  assert.match(fc, /redactPeopleSupport\(rest\.people\)/);
});

test('sweep 2026-10-11: stored prose loses personal numbers on read; identifiers and company numbers stay', async () => {
  const { scrubPersonalNumbersDeep } = await import('../intelligence/peopleIntelligence.ts');
  const out = scrubPersonalNumbersDeep({
    report: { sections: [{ body: 'განმცხადებელი ვაჟა პ/ნ 01234567890, კომპანია 424619256, განცხადება 882026515135.' }, { body: 'მეორე 01234567891 და მესამე 01234567892' }] },
    evidence: [{ claim: 'X,\\n01234567890', url: 'https://x/01234567890' }],
    id: '01234567890',
  });
  const text = JSON.stringify(out.report) + out.evidence[0].claim;
  assert.doesNotMatch(text, /(?<!\d)\d{11}(?!\d)/);
  assert.match(text, /424619256/);
  assert.match(text, /882026515135/);
  assert.equal(out.id, '01234567890');
  assert.equal(out.evidence[0].url, 'https://x/01234567890');
  const vs = readFileSync(join(import.meta.dirname, '..', '..', '..', 'supabase/functions/verify-synthesis/index.ts'), 'utf8');
  assert.match(vs, /scrubPersonalNumbersDeep\(rest\[k\]\)/);
});

test('sweep 2026-10-11: technical cards on a parking space lose apartment wording', async () => {
  const { guardReportForKind } = await import('../intelligence/kindGuard.ts');
  const r = guardReportForKind({ technicalExplained: [{ key: 'k2', what: 'კ-2 შენობის საერთო ფართის კოეფიციენტია.', why: 'ბინის სითბოს დანაკარგი ამაზეა დამოკიდებული.', buyerMeaning: '', verify: 'ბინაში ნახეთ ფანჯრები.' }] }, 'PARKING');
  const c = r.technicalExplained[0];
  assert.match(c.what, /კ-2/);
  assert.doesNotMatch(`${c.why} ${c.verify}`, /ბინ/);
});
