import test from 'node:test';
import assert from 'node:assert/strict';
import { r2ByService, serviceOf } from '../../storageInventoryView.ts';

test('every R2 namespace and Supabase bucket maps to a HOMATCH service', () => {
  const cases = {
    'design-studio|catalog-public': 'design_studio', 'users|design-studio-thumbnails': 'design_studio',
    'users|property-photos': 'property', 'meta-ads-media|meta-ads-media': 'meta_ads',
    'deal-room-documents|deal-room-documents': 'contracts', 'users|deal-room-documents': 'contracts',
    'mortgage-offer-documents|mortgage-offer-documents': 'mortgage', 'users|developer-documents': 'developer',
    'voice-auditions|voice-auditions': 'voice', 'users|generated-reports': 'reports',
    'verify-evidence|': 'verify', 'dm-media|': 'communications', 'broker-logos|': 'brokers',
    'diagnostics|diagnostics': 'system', 'retention-selftest|': 'system', 'site-assets|site-assets': 'site',
  };
  for (const [k, want] of Object.entries(cases)) {
    const [ns, cat] = k.split('|');
    assert.equal(serviceOf(ns, cat || null), want, k);
  }
});

test('R2 usage groups active objects by service and never counts deleted ones', () => {
  const rows = [
    { namespace: 'design-studio', category: 'catalog-public', lifecycle: 'ACTIVE', objects: 10, bytes: 1000, last_upload: null },
    { namespace: 'users', category: 'design-studio-thumbnails', lifecycle: 'ACTIVE', objects: 2, bytes: 20, last_upload: null },
    { namespace: 'users', category: 'design-studio-thumbnails', lifecycle: 'DELETED', objects: 5, bytes: 500, last_upload: null },
    { namespace: 'meta-ads-media', category: 'meta-ads-media', lifecycle: 'ACTIVE', objects: 3, bytes: 300, last_upload: null },
  ];
  const out = r2ByService(rows);
  assert.deepEqual(out.map((u) => [u.service, u.objects, u.bytes]), [['design_studio', 12, 1020], ['meta_ads', 3, 300]]);
  assert.deepEqual(out[0].prefixes, ['design-studio/', 'users/<account>/design-studio-thumbnails/']);
});
