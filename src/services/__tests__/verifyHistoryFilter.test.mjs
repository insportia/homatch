// Pure-logic regression test for VerifyPage.tsx's VerifyHistorySidebar search/
// filter predicate. The component itself can't be rendered here (no React
// test renderer / jsdom available in this environment — see the session's
// own build-tooling notes), so the exact filter logic is copied verbatim and
// exercised directly. Keep this in sync with VerifyHistorySidebar's `filtered`
// computation whenever that logic changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function filterHistory(items, { typeFilter, q }) {
  const needle = q.trim().toLowerCase();
  return items.filter((j) => {
    if (typeFilter !== 'all' && j.mode !== typeFilter) return false;
    if (!needle) return true;
    const hay = [j.title, j.query, j.entity_name, j.project_name, j.address, j.developer_name, j.company_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(needle);
  });
}

const FIXTURES = [
  { id: '1', mode: 'cadastral', query: '01.18.06.019.055.03.01.603', title: null, entity_name: null, project_name: 'Villion', address: 'Krtsanisi St 6', developer_name: 'Millennio Group', company_name: null },
  { id: '2', mode: 'property', query: 'apartment for sale vake', title: 'My Vake flat check', entity_name: 'Vake Apartment', project_name: null, address: 'Vake, Tbilisi', developer_name: null, company_name: null },
  { id: '3', mode: 'cadastral', query: '01.10.02.001.001', title: null, entity_name: null, project_name: null, address: null, developer_name: null, company_name: 'JSC Some Developer' },
];

test('VerifyHistorySidebar filter: "all" type + no query returns everything, newest-first order preserved', () => {
  const out = filterHistory(FIXTURES, { typeFilter: 'all', q: '' });
  assert.deepEqual(out.map((x) => x.id), ['1', '2', '3']);
});

test('VerifyHistorySidebar filter: type filter narrows to just that mode', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'cadastral', q: '' }).map((x) => x.id), ['1', '3']);
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'property', q: '' }).map((x) => x.id), ['2']);
});

test('VerifyHistorySidebar filter: search matches project name (Villion fixture)', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: 'villion' }).map((x) => x.id), ['1']);
});

test('VerifyHistorySidebar filter: search matches address, is case-insensitive', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: 'KRTSANISI' }).map((x) => x.id), ['1']);
});

test('VerifyHistorySidebar filter: search matches a user-set title even when query text differs', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: 'vake flat' }).map((x) => x.id), ['2']);
});

test('VerifyHistorySidebar filter: search matches company name', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: 'some developer' }).map((x) => x.id), ['3']);
});

test('VerifyHistorySidebar filter: search matches the raw cadastral query string directly', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: '01.18.06.019.055.03.01.603' }).map((x) => x.id), ['1']);
});

test('VerifyHistorySidebar filter: no match returns empty array, never throws', () => {
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'all', q: 'nonexistent xyz' }), []);
});

test('VerifyHistorySidebar filter: type filter and search combine (AND, not OR)', () => {
  // "Villion" only exists on a cadastral-mode row — filtering to property mode
  // must exclude it even though the text would otherwise match.
  assert.deepEqual(filterHistory(FIXTURES, { typeFilter: 'property', q: 'villion' }), []);
});
