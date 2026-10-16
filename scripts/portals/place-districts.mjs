#!/usr/bin/env node
/* TEMPORARY (PR #210): which place shown on Place.ge cards each district_id selects.
 * Read-only, one results page per id, paced; removed before merge. */
import { PORTAL_UA, robotsRules, robotsAllows } from '../../official-worker/src/marketplace/portals/acquire.mjs';
const rules = robotsRules(await (await fetch('https://place.ge/robots.txt', { headers: { 'user-agent': PORTAL_UA } })).text());
const probes = [['region_id=6&district_id=65'], ['region_id=6&district_id=64'], ['region_id=6&district_id=68'], ['region_id=6&district_id=69'], ['region_id=6&district_id=70'], ['region_id=6'], ['region_id=1&district_id=2'], ['region_id=4&district_id=44'],
  ['selected_places=' + encodeURIComponent(JSON.stringify(['d65']))], ['district_id%5B%5D=65&region_id%5B%5D=6']];
for (const [id] of probes) {
  const url = `https://place.ge/ge/ads?type=for_sale&object_type=flat&city_id=1&mode=list&${id}`;
  if (!robotsAllows(rules, url)) { console.log('PLACEDIST', id, 'robots'); continue; }
  const res = await fetch(url, { headers: { 'user-agent': PORTAL_UA, 'accept-language': 'ka' } });
  const html = await res.text();
  const places = [...html.matchAll(/<div><strong>[^<]+<\/strong>,[^<]*<br\s*\/?>([^<]*)<\/div>/g)].map((m) => m[1].split(',').slice(0, 2).join(',').trim());
  const counts = places.reduce((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {});
  console.log('PLACEDIST', id, res.status, JSON.stringify(counts));
  await new Promise((r) => setTimeout(r, 2500));
}
