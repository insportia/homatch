import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * TAS_MAP — the parcel's map view reaches the result (F5, 2026-10-22).
 *
 * Every completed Verify job stored no coordinates: the worker recorded the
 * ms.gov.ge START view (MS_MAP_URL) as finalUrl, overwrote it with the NAPR
 * page, and returned frameUrls: [] — so the map view after the parcel search,
 * whose URL hash carries the centre, never left the browser. Proven on job
 * 61c1c38c: its TAS_MAP task result holds the start URL three times and no
 * other ms.gov.ge view. The worker now keeps the views it saw after the
 * parcel was focused and returns them as frameUrls, which the report's
 * reader (centerFromBrowserOfficial) already scans.
 */
const src = readFileSync(fileURLToPath(new URL('../src/workflows/tasmap/TasMapWorker.ts', import.meta.url)), 'utf8');

test('the map view is recorded after the parcel is focused and after its info window opens', () => {
  const focused = src.indexOf("fsm.transition('PARCEL_FOCUSED');");
  const popup = src.indexOf("fsm.transition('INFO_POPUP_OPENED');");
  assert.ok(focused > 0 && popup > focused);
  assert.match(src.slice(focused, focused + 120), /noteMapView\(\);/);
  assert.match(src.slice(popup, popup + 120), /noteMapView\(\);/);
});

test('only ms.gov.ge views other than the start view are kept, and they are returned as frameUrls', () => {
  assert.match(src, /\/ms\\\.gov\\\.ge\\\/msmap\\\/#C=\/\.test\(u\) && u !== MS_MAP_URL/);
  assert.match(src, /frameUrls: \[\.\.\.mapViews\]/);
  assert.ok(!/^\s+frameUrls: \[\],/m.test(src), 'the result still drops every map view');
});
