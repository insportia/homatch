// ssgeHonesty.test.mjs — Verify never claims SS.ge was checked when it was not.
// Production 2026-10-23 (job a5be9fcd): SS.ge answered Cloudflare 403 on every
// district request; the ledger recorded FAILED with BLOCKED attempts and 0 listings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerOutcomes } from '../providerOutcomes.ts';

const ledger = {
  myhome: { status: 'COMPLETE', listings: 96, attempts: [{ scope: 'DISTRICT', status: 'COMPLETE', returned: 48 }] },
  ssge: { status: 'FAILED', listings: 0, attempts: [{ scope: 'DISTRICT', status: 'BLOCKED', error: 'SSGE_ACQUISITION_FAILED', returned: 0 }] },
};

test('a blocked SS.ge run is FAILED with no evidence, MyHome stays VERIFIED', () => {
  const out = providerOutcomes({ _marketplaceLedger: ledger, browserOfficial: { results: [] } });
  const ssge = out.find((o) => o.provider === 'ssge');
  const myhome = out.find((o) => o.provider === 'myhome');
  assert.equal(ssge.state, 'FAILED');
  assert.equal(ssge.evidenceCount, 0);
  assert.notEqual(ssge.state, 'VERIFIED');
  assert.equal(myhome.state, 'VERIFIED');
});

test('an SS.ge status the ledger cannot name is NOT_VERIFIED, never VERIFIED', () => {
  const out = providerOutcomes({ _marketplaceLedger: { ssge: { status: 'BLOCKED', listings: 0 } }, browserOfficial: { results: [] } });
  assert.equal(out.find((o) => o.provider === 'ssge').state, 'NOT_VERIFIED');
});
