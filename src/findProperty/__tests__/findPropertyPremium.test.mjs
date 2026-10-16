import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedMs, formatElapsed } from '../elapsed.ts';
import { requirementKey, requirementLabel, AMENITY_CODES } from '../requirementLabels.ts';
import { cardRecommendation, detailInsights, sentenceCase } from '../recommendation.ts';
import { budgetFor, createField, stepField, stillField, seedOf, setMode } from '../motion/searchField.ts';

/* The elapsed clock reads only server timestamps. */
test('elapsed: running counts from createdAt; terminal stops at completedAt or shows nothing', () => {
  const createdAt = '2026-10-16T10:00:00.000Z', start = Date.parse(createdAt);
  assert.equal(elapsedMs({ createdAt, terminal: false }, start + 65_000), 65_000);
  assert.equal(elapsedMs({ createdAt, terminal: false }, start - 5_000), 0, 'clock skew never goes negative');
  assert.equal(elapsedMs({ createdAt, terminal: true, completedAt: '2026-10-16T10:12:30.000Z' }, start + 9e9), 750_000, 'a finished search does not keep counting');
  assert.equal(elapsedMs({ createdAt, terminal: true }, start + 1e6), null, 'no completion time: no invented duration');
  assert.equal(elapsedMs({ createdAt: 'nope', terminal: false }, start), null);
  assert.equal(formatElapsed(7_000), '0:07');
  assert.equal(formatElapsed(725_400), '12:05');
  assert.equal(formatElapsed(3_729_000), '1:02:09');
});

/* Every code a label is asked for becomes a real key; an unknown one becomes a generic phrase, never itself. */
test('requirement labels: known codes map to keys, unknown codes never render raw', () => {
  for (const a of AMENITY_CODES) {
    assert.equal(requirementKey(a), `fpp_amenity_${a}`);
    assert.equal(requirementKey(`REQUIRED_${a}`), `fpp_amenity_${a}`);
  }
  assert.equal(requirementKey('DISTRICT'), 'fpp_req_DISTRICT');
  assert.equal(requirementKey('SOMETHING_NEW'), null);
  const t = (k) => `«${k}»`;
  assert.equal(requirementLabel('SOMETHING_NEW', t), '«fpp_req_OTHER»');
});

const t = (k, v = {}) => `_${k}${Object.keys(v).length ? `(${Object.entries(v).map(([a, b]) => `${a}=${b}`).join(',')})` : ''}`;
const join = (items) => items.join(' + ');
const base = {
  group: 'BEST', reasons: [{ code: 'DISTRICT_MATCH' }, { code: 'VERIFIED_RECENTLY' }, { code: 'HAS_PARKING' }, { code: 'RENOVATED' }],
  upgrade: null, unverified: ['AREA', 'REQUIRED_BALCONY'], tradeoffs: ['FLOOR_NOT_STATED', 'SELLER_UNKNOWN'],
  intelligence: { section: 'BEST', strong: true, warnings: ['PRICE_CONFLICT'], preferences: { confirmed: ['ELEVATOR'], mentioned: ['TERRACE'], unconfirmed: ['BALCONY'], contradicted: ['POOL'] } },
};

test('card recommendation: at most two server reasons, then what to ask, with no duplicates', () => {
  const r = cardRecommendation(base, t, join);
  assert.equal(r.lead, '_mps_reason_DISTRICT_MATCH(n=0) · _mps_reason_HAS_PARKING(n=0)', 'VERIFIED_RECENTLY is not a recommendation');
  assert.equal(r.ask, '_fpp_rec_ask(list=_fpp_req_AREA + _fpp_amenity_BALCONY + _fpp_req_FLOOR_RANGE)', 'REQUIRED_BALCONY and BALCONY are one thing; a not-stated tradeoff is an unknown');
  const upgrade = cardRecommendation({ ...base, group: 'UPGRADE', upgrade: { advantages: [{ code: 'MORE_AREA', delta: -12 }] } }, t, join);
  assert.equal(upgrade.lead, '_mps_adv_MORE_AREA(n=12)');
  const bare = cardRecommendation({ group: 'MORE', reasons: [], unverified: [], intelligence: null }, t, join);
  assert.deepEqual(bare, { lead: null, ask: null }, 'nothing known, nothing said');
});

test('detail insights: unknowns are "not stated — ask", never absent; contradictions only from evidence', () => {
  const d = detailInsights(base, t, join);
  assert.ok(d.advantages.includes('_fpp_confirmed_item(feature=_fpp_amenity_ELEVATOR)'));
  const kinds = Object.fromEntries(d.limitations.map((l) => [l.text, l.kind]));
  assert.equal(kinds['_fpp_contradicted_item(feature=_fpp_amenity_POOL)'], 'contradicted');
  assert.equal(kinds['_fpp_unknown_item(feature=_fpp_amenity_BALCONY)'], 'unknown');
  assert.equal(kinds['_fpp_mentioned_item(feature=_fpp_amenity_TERRACE)'], 'mentioned');
  assert.equal(kinds['_mps_tradeoff_SELLER_UNKNOWN'], 'tradeoff');
  assert.equal(kinds['_fpr_warning_PRICE_CONFLICT'], 'warning');
  assert.ok(!d.limitations.some((l) => l.text === '_mps_tradeoff_FLOOR_NOT_STATED'), 'a not-stated tradeoff is phrased as an unknown');
  assert.match(d.summary, /^_fpp_sum_BEST _fpp_sum_advantages\(n=4\) _fpp_sum_ask\(list=.+\) _fpp_sum_check\(n=3\)$/);
  assert.equal(sentenceCase('balcony'), 'Balcony');
  assert.equal(sentenceCase('აივანი'), 'აივანი', 'Georgian is never turned into Mtavruli');
});

/* The motion engine: seeded, bounded, and its two states are the server's. */
test('search field: deterministic, in bounds, budgeted, settles when the search is terminal', () => {
  const b = budgetFor(800, 220, false), low = budgetFor(360, 180, true);
  assert.ok(low.nodes < b.nodes && low.particles < b.particles && low.fps === 30);
  const a = createField(seedOf('search-1'), 800, 220, b), c = createField(seedOf('search-1'), 800, 220, b);
  for (let i = 0; i < 600; i++) { stepField(a, 1 / 60); stepField(c, 1 / 60); }
  assert.deepEqual(a.trail.at(-1), c.trail.at(-1), 'same seed, same picture');
  assert.ok(a.head.x >= 0 && a.head.x <= 800 && a.head.y >= 0 && a.head.y <= 220);
  assert.ok(a.branches.length <= b.branches);
  setMode(a, 'SETTLED');
  for (let i = 0; i < 600; i++) stepField(a, 1 / 60);
  assert.equal(a.branches.length, 0, 'no new reach once the search ended');
  assert.ok(a.head.speed < 1, 'the head comes to rest');
  const s1 = stillField(7, 400, 200, low, 'SEARCHING'), s2 = stillField(7, 400, 200, low, 'SEARCHING');
  assert.deepEqual(s1.head, s2.head, 'reduced motion draws one stable frame');
});

test('motion sources never use Math.random or invent numbers', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/findProperty/motion/searchField.ts', 'src/findProperty/motion/drawField.ts', 'src/components/findProperty/SearchField.tsx']) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /Math\.random/, f);
    assert.doesNotMatch(src, /fillText|strokeText/, `${f} draws no text, so it can show no count or percentage`);
  }
  const field = readFileSync('src/components/findProperty/SearchField.tsx', 'utf8');
  for (const need of ['requestAnimationFrame', 'ResizeObserver', 'visibilitychange', 'prefers-reduced-motion', 'aria-hidden="true"']) assert.ok(field.includes(need), need);
});
