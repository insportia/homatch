import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMarketIntelligence } from '../marketIntelligence.ts';
import { selectComparables } from '../comparableSelection.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SYNTH = fs.readFileSync(
  path.resolve(here, '../../../../supabase/functions/verify-synthesis/index.ts'), 'utf8'
);
const code = SYNTH.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ================================================================== *
 * `force: true` — what it costs, and who may spend it.
 *
 * Skipping the persisted report means a model call on demand. Two
 * separate exposures, and only one of them was ever closed:
 *
 *   cross-user   already impossible, via RLS rather than a check here:
 *                research_jobs.SELECT is `auth.uid() = user_id`, so the
 *                read returns nothing for somebody else's job and the
 *                function answers 404
 *   repetition   NOT closed. Nothing stopped the OWNER of a job calling
 *                force in a loop, each iteration buying another synthesis
 *
 * A rebuild is only legitimate when the code that builds the report has
 * changed. That does not happen twice a minute.
 * ================================================================== */

test('a forced rebuild is refused while a recent one exists', () => {
  assert.match(code, /FORCE_COOLDOWN_MS/, 'the cooldown must exist');
  const guard = code.slice(code.indexOf('const FORCE_COOLDOWN_MS'), code.indexOf('const projection'));

  // Only forced rebuilds are affected; a normal read is untouched.
  assert.match(guard, /if \(body\?\.force && !internal\)/);
  // The service role keeps the legitimate use: reassembly after a deploy.
  assert.match(guard, /!internal/);
  // Too soon is not forbidden — and the caller is told when it will not be.
  assert.match(guard, /429/);
  assert.match(guard, /retryAfterSeconds/);
  // It is keyed on when the report was actually built.
  assert.match(guard, /job\.synthesis_at/);
  assert.match(code, /select\('id,result_json,status,synthesis_json,synthesis_state,synthesis_at'\)/);
});

test('a cached read is not affected by the guard', () => {
  // The persisted-report branch must still return without any rebuild.
  assert.match(
    code,
    /if \(job\.synthesis_state === 'READY' && job\.synthesis_json && !body\?\.force\)/,
    'returning to a finished case must remain a read'
  );
});

test('cross-user protection stays where it belongs', () => {
  // The job is read through the CALLER's client so the SELECT policy
  // applies. A service-role client here would silently defeat RLS.
  assert.match(
    code,
    /const \{ data: job, error \} = await supabase\s*\n\s*\.from\('research_jobs'\)/,
    'the job must be read through the caller-scoped client, never the service client'
  );
  assert.match(code, /if \(!job\) return json\(\{ error: 'not found' \}, 404\)/);
});

/* ================================================================== *
 * Ranking happens BEFORE truncation.
 * ================================================================== */

const comp = (over = {}) => ({
  pricePerSqm: 1800, currency: 'USD', area: 60, reasons: [],
  listingStatus: 'active', ...over,
});

test('the shortlist never drops a stronger band for a weaker one', () => {
  // Twelve citywide listings scoring well, and one same-project listing
  // scoring poorly. If truncation came first the local one would be lost.
  const raw = [
    ...Array.from({ length: 12 }, (_, i) => comp({ address: `Gldani ${i}`, pricePerSqm: 1900 + i })),
    comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6', pricePerSqm: 2100 }),
  ];
  const m = buildMarketIntelligence(
    { project: 'Villion', address: 'კრწანისის ქუჩა 6', area: 60 },
    raw
  );
  assert.ok(m, 'a market must be produced');
  assert.equal(m.closest[0].tier, 'SAME_PROJECT', 'the strongest band must survive truncation');
  assert.ok(m.ranked.length > m.closest.length, 'the full ranked pool must be exposed');
  assert.equal(m.ranked[0].tier, 'SAME_PROJECT', 'and it carries the same ordering');
});

test('selection reads the full pool, so city context can exist at all', () => {
  const m = buildMarketIntelligence(
    { project: 'Villion', address: 'კრწანისის ქუჩა 6', area: 60 },
    [
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6' }),
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6', pricePerSqm: 1850 }),
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6', pricePerSqm: 1870 }),
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6', pricePerSqm: 1890 }),
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6', pricePerSqm: 1910 }),
      ...Array.from({ length: 6 }, (_, i) => comp({ address: `დიდი დიღომი ${i}`, pricePerSqm: 1500 + i })),
    ]
  );
  // From the five-item shortlist this bucket could never be filled: all five
  // are local. From the ranked pool it can.
  const fromShortlist = selectComparables(m.closest);
  const fromPool = selectComparables(m.ranked);
  assert.equal(fromShortlist.context.length, 0, 'the shortlist cannot describe the wider market');
  assert.ok(fromPool.context.length > 0, 'the ranked pool can');
  assert.ok(fromPool.rawCount > fromShortlist.rawCount, 'and reports the real basis');
});

test('wider-market listings still never enter the direct set', () => {
  const m = buildMarketIntelligence(
    { project: 'Villion', address: 'კრწანისის ქუჩა 6', area: 60 },
    [
      comp({ project: 'Villion', address: 'კრწანისის ქუჩა 6' }),
      ...Array.from({ length: 20 }, (_, i) => comp({ address: `ნაძალადევი ${i}`, pricePerSqm: 2500 + i })),
    ]
  );
  const sel = selectComparables(m.ranked);
  assert.ok(
    sel.direct.every((d) => d.tier !== 'WIDER_MARKET'),
    'no citywide listing may be presented as a direct comparable'
  );
  assert.ok(sel.direct.length >= 1, 'the genuinely local listing is still shown');
  assert.equal(sel.directIsThin, true, 'and one listing is reported as thin, not as a price picture');
});
