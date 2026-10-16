// FIND BUYERS — the VILLION production baseline (2026-10-09). The 37 leads
// that campaign displayed as "qualified", with their original multilingual
// text, re-judged by the qualification pipeline. Before: 37 shown, 4 of them
// genuine purchase requests. Expected after: job seekers, rental seekers,
// rental/sale advertisements, agents and the duplicate are rejected with an
// explicit reason; the genuine buyers are kept or rejected only for a
// confirmed budget mismatch; nobody is Strong (no buyer stated a compatible
// budget AND a compatible location).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { requalifyLeads, summarize } from '../findBuyers/requalify.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/villionCampaignLeads.json', import.meta.url), 'utf8'));
const dna = buildPropertyDna(fixture.property);
const now = Date.parse(fixture.campaign.evaluatedAt);
const leads = fixture.leads.map((l) => ({ id: String(l.n), text: l.text, publishedAt: l.at, url: l.url, author: l.author ?? null }));
const rows = requalifyLeads(leads, dna, { now });
const byN = new Map(rows.map((r) => [Number(r.id), r]));

for (const l of fixture.leads) {
  test(`lead ${l.n} (${l.lang}): ${l.expected.allowedRoles.join('|')} → ${l.expected.category}`, () => {
    const r = byN.get(l.n);
    assert.ok(l.expected.allowedRoles.includes(r.reading.role), `role ${r.reading.role} for: ${l.text.slice(0, 80)} [${r.reading.evidence}]`);
    assert.equal(r.qualification.category, l.expected.category, `category for: ${l.text.slice(0, 80)} reasons=${r.qualification.reasons} lim=${r.qualification.limitations}`);
    if (l.expected.reason) assert.ok(r.qualification.reasons.includes(l.expected.reason), `reasons ${r.qualification.reasons} lack ${l.expected.reason}`);
    if (l.expected.category === 'REJECTED') assert.ok(r.qualification.reasons.length > 0, 'a rejection always has a reason');
  });
}

test('baseline comparison: 37 shown before → only genuine buyers shown after, none Strong', () => {
  const s = summarize(rows);
  assert.equal(fixture.campaign.displayedBefore, 37);
  assert.equal(s.byCategory.STRONG, 0);
  assert.equal(s.shown, 2, JSON.stringify(s));
  const genuine = fixture.leads.filter((l) => l.expected.genuineBuyer).map((l) => l.n);
  for (const r of rows) {
    if (r.qualification.category !== 'REJECTED') assert.ok(genuine.includes(Number(r.id)), `non-genuine lead shown: ${r.id}`);
  }
  /* Every genuine purchase request is read as a buyer. */
  for (const n of genuine) assert.equal(byN.get(n).reading.role, 'BUY_SEEKER', `lead ${n}`);
  assert.ok(s.byReason.JOB_SEARCH >= 13);
  assert.ok(s.byReason.WRONG_TRANSACTION >= 7);
});

test('unknown is never compatible: the instalment buyer has an unknown budget and only a city', () => {
  const r = byN.get(12);
  assert.equal(r.qualification.budgetFit, 'UNKNOWN');
  assert.equal(r.qualification.locationFit, 'CITY');
  assert.ok(r.qualification.limitations.includes('BUDGET_UNKNOWN'));
  /* The 10,000 GEL is a down payment, not a budget. */
  assert.equal(r.reading.budget, null);
  assert.equal(r.reading.downPayment?.amount, 10000);
});

test('confirmed mismatches are explicit: $50–70k and $53k budgets vs $213,840', () => {
  for (const n of [7, 11]) {
    const r = byN.get(n);
    assert.equal(r.qualification.budgetFit, 'INCOMPATIBLE', `lead ${n}`);
    assert.ok(r.reading.budget.max <= 70000);
  }
  const r6 = byN.get(6);
  assert.equal(r6.qualification.locationFit, 'INCOMPATIBLE');
  assert.equal(r6.qualification.requirementsFit, 'COMPATIBLE'); // "სამ ოთახიან" = 3 rooms, as the property
  assert.ok(r6.qualification.limitations.includes('LOCATION_OTHER_AREA'));
});

test('the repost by the same author is one candidate', () => {
  assert.equal(byN.get(13).duplicateOf, '12');
  assert.equal(byN.get(12).duplicateOf, null);
});
