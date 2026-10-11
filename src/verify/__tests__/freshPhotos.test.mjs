// Fresh photographs of the exact building: judgement, selection, sources,
// construction-status reconciliation, and the edge wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  judgeCandidate, selectFreshPhotos, buildFreshPhotoSearch, parseDayDate, licenceReusable,
  freshPhotoSubject, freshPhotoCenter, officialPhotoDates, freshPhotosNeeded, freshPhotosDue,
  reconcileConstructionStatus, constructionEvidenceFromReport, streetMentions, namesMatch, bearingDeg, freshPhotoId,
} from '../freshPhotos.ts';
import { parseCommons, commonsUrl } from '../../../supabase/functions/_shared/freshPhotos/commons.ts';
import { parseMapillary, mapillaryUrl } from '../../../supabase/functions/_shared/freshPhotos/mapillary.ts';
import { runFreshPhotoSearch } from '../../../supabase/functions/_shared/freshPhotos/search.ts';

const CENTER = { lat: 41.78529418768781, lng: 44.74318695384861 }; // job eeefada9 (CADASTRAL_PLAN)
const NOW = new Date('2026-10-11T12:00:00Z');

/** A point `d` metres from the centre, on bearing `b` degrees. */
function at(d, b) {
  const R = 6371008.8, br = (b * Math.PI) / 180, la = (CENTER.lat * Math.PI) / 180, lo = (CENTER.lng * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d / R) + Math.cos(la) * Math.sin(d / R) * Math.cos(br));
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d / R) * Math.cos(la), Math.cos(d / R) - Math.sin(la) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}

const SUBJECT = {
  developmentNames: [],
  streets: [{ name: 'კრისტიან სტივენის ქუჩა', number: '18' }],
  block: '1',
  multipleBlocks: false,
};
const CTX = { center: CENTER, subject: SUBJECT, newestOfficialPhotoDate: '2025-04-14', now: NOW };

const commons = (over = {}) => {
  const p = at(40, 200);
  return {
    source: 'WIKIMEDIA_COMMONS', sourceId: String(over.sourceId ?? '101'), sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
    imageUrl: 'https://upload.wikimedia.org/x.jpg', mime: 'image/jpeg',
    title: 'Residential building, Kristian Stiven Street 18, Tbilisi', description: null, categories: [],
    author: 'Photographer', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    capturedRaw: '2026-08-02 10:11:12', captureDateSource: 'EXIF', publishedRaw: '2026-09-01T00:00:00Z',
    lat: p.lat, lng: p.lng, heading: null, width: 1600, height: 1200, ...over,
  };
};
const mapillary = (over = {}) => {
  const p = at(over.d ?? 30, over.b ?? 90); // camera east-ish of the centre
  const facing = bearingDeg(p, CENTER);
  return {
    source: 'MAPILLARY', sourceId: String(over.sourceId ?? 'm1'), sourceUrl: 'https://www.mapillary.com/app/?pKey=m1', imageUrl: 'https://scontent/x.jpg',
    mime: 'image/jpeg', title: null, description: null, categories: [], author: 'mapper', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', capturedRaw: Date.parse('2026-06-20T08:00:00Z'), captureDateSource: 'PROVIDER_CAPTURE',
    publishedRaw: null, lat: p.lat, lng: p.lng, heading: over.heading ?? facing, ...over,
  };
};

test('dates: only a day-precise capture counts; publication stays separate', () => {
  assert.equal(parseDayDate('2024:05:14 10:00:00'), '2024-05-14');
  assert.equal(parseDayDate('<time class="dtstart" datetime="2026-08-02">2 August 2026</time>'), '2026-08-02');
  assert.equal(parseDayDate(Date.parse('2026-06-20T08:00:00Z')), '2026-06-20');
  assert.equal(parseDayDate('2024'), null);
  assert.equal(parseDayDate('May 2024'), null);
  assert.equal(parseDayDate(null), null);
  const j = judgeCandidate(commons(), CTX);
  assert.equal(j.accepted, true);
  assert.equal(j.capturedAt, '2026-08-02');
  assert.equal(j.publishedAt, '2026-09-01');
});

test('a null capture date is rejected (NO_CAPTURE_DATE), even with a recent upload', () => {
  const j = judgeCandidate(commons({ capturedRaw: null, captureDateSource: null, publishedRaw: '2026-10-01T00:00:00Z' }), CTX);
  assert.equal(j.accepted, false);
  assert.equal(j.reason, 'NO_CAPTURE_DATE');
  assert.equal(j.publishedAt, '2026-10-01', 'the upload date is kept as publication only');
  assert.equal(judgeCandidate(commons({ capturedRaw: 'circa 2025' }), CTX).reason, 'NO_CAPTURE_DATE');
});

test('a newer web photo is accepted over older official photos; an older one is not', () => {
  assert.equal(judgeCandidate(commons({ capturedRaw: '2026-05-01' }), CTX).accepted, true);
  assert.equal(judgeCandidate(commons({ capturedRaw: '2024-09-01' }), CTX).reason, 'OLDER_THAN_OFFICIAL');
  assert.equal(judgeCandidate(commons({ capturedRaw: '2021-01-01' }), { ...CTX, newestOfficialPhotoDate: null }).reason, 'TOO_OLD');
  assert.equal(judgeCandidate(commons({ capturedRaw: '2027-01-01' }), CTX).reason, 'INVALID_CAPTURE_DATE');
  const toFresh = selectFreshPhotos([commons({ sourceId: 'a', capturedRaw: '2026-03-01', author: 'A' }), commons({ sourceId: 'b', capturedRaw: '2026-08-01', author: 'B' }), commons({ sourceId: 'c', capturedRaw: '2025-12-01', author: 'C' })], CTX);
  assert.deepEqual(toFresh.accepted.map((a) => a.candidate.sourceId), ['b', 'a'], 'newest two');
  assert.equal(toFresh.bySource.WIKIMEDIA_COMMONS.rejected.NOT_NEWEST, 1);
});

test('wrong building: distance, heading, other street / address / development', () => {
  const far = at(400, 10);
  assert.equal(judgeCandidate(commons({ lat: far.lat, lng: far.lng }), CTX).reason, 'TOO_FAR');
  assert.equal(judgeCandidate(commons({ lat: null, lng: null }), CTX).reason, 'NO_COORDINATES');
  assert.equal(judgeCandidate(mapillary(), CTX).accepted, true, 'close and facing the building');
  assert.equal(judgeCandidate(mapillary({ heading: (bearingDeg(at(30, 90), CENTER) + 180) % 360 }), CTX).reason, 'HEADING_MISMATCH');
  assert.equal(judgeCandidate(mapillary({ d: 120 }), CTX).reason, 'TOO_FAR', 'street imagery must be within 80 m');
  assert.equal(judgeCandidate(commons({ title: 'Building on Chavchavadze Avenue 12, Tbilisi' }), CTX).reason, 'OTHER_STREET');
  assert.equal(judgeCandidate(commons({ title: 'Kristian Stiven Street 22, Tbilisi' }), CTX).reason, 'OTHER_ADDRESS');
  const dev = { ...CTX, subject: { ...SUBJECT, developmentNames: ['Digomi Residence'] } };
  assert.equal(judgeCandidate(commons({ title: 'Archi Vake Residence, Tbilisi' }), dev).reason, 'OTHER_DEVELOPMENT');
  assert.equal(judgeCandidate(commons({ title: 'Digomi Residence, autumn 2026' }), dev).accepted, true);
  // Nearby but nothing ties it to the building: rejected, never assumed.
  assert.equal(judgeCandidate(commons({ title: 'Autumn trees, Tbilisi' }), CTX).reason, 'NOT_IDENTIFIED');
  // The depicted place stated separately and close to the centre does tie it.
  const obj = at(10, 0);
  assert.equal(judgeCandidate(commons({ title: 'Apartment block in Dighomi', objectLat: obj.lat, objectLng: obj.lng }), CTX).identity, 'OBJECT_LOCATION');
});

test('street names match across scripts', () => {
  assert.ok(namesMatch('kristian stiven', 'კრისტიან სტივენის ქუჩა'));
  assert.ok(!namesMatch('chavchavadze', 'კრისტიან სტივენის ქუჩა'));
  assert.deepEqual(streetMentions('18 Kristian Stiven Street, Digomi').map((s) => [s.name, s.number]), [['kristian stiven', '18']]);
});

test('licence: CC0 / PD / CC BY / CC BY-SA kept; NC, ND, GFDL-only and unknown refused', () => {
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-self']) assert.ok(licenceReusable(ok), ok);
  for (const no of ['CC BY-NC-SA 4.0', 'CC BY-ND 4.0', 'GFDL', 'Fair use', '', null, 'All rights reserved']) assert.ok(!licenceReusable(no), String(no));
  assert.equal(judgeCandidate(commons({ license: 'CC BY-NC 2.0', licenseUrl: null }), CTX).reason, 'LICENCE_NOT_REUSABLE');
  assert.equal(judgeCandidate(commons({ title: 'AI-generated view of Kristian Stiven Street 18' }), CTX).reason, 'AI_GENERATED');
  assert.equal(judgeCandidate(commons({ mime: 'image/svg+xml' }), CTX).reason, 'UNSUPPORTED_MEDIA');
});

test('several blocks: DEVELOPMENT scope unless the photo names the subject block', () => {
  const multi = { ...CTX, subject: { ...SUBJECT, multipleBlocks: true, block: 'ts' } };
  assert.equal(judgeCandidate(commons(), multi).scope, 'DEVELOPMENT');
  assert.equal(judgeCandidate(commons({ title: 'Kristian Stiven Street 18, block C' }), multi).reason, 'OTHER_BLOCK');
  assert.equal(judgeCandidate(commons({ title: 'Kristian Stiven Street 18, ბლოკი ც' }), multi).scope, 'BUILDING');
  assert.equal(judgeCandidate(commons(), CTX).scope, 'BUILDING', 'one documented building');
  const subj = freshPhotoSubject({ identity: { building: '01', documentedBuildings: ['01', '02'] } }, {});
  assert.equal(subj.multipleBlocks, true);
  assert.equal(freshPhotoSubject({ identity: { building: '01', documentedBuildings: ['01'] } }, {}).multipleBlocks, false);
});

test('duplicates are dropped', () => {
  const s = selectFreshPhotos([commons({ sourceId: 'x' }), commons({ sourceId: 'x' }), commons({ sourceId: 'y' })], CTX);
  assert.equal(s.accepted.length, 1);
  assert.equal(s.bySource.WIKIMEDIA_COMMONS.rejected.DUPLICATE, 2);
});

test('subject, centre and official photo dates from the stored report (eeefada9 shape)', () => {
  const sj = {
    location: { street: 'კრისტიან სტივენის ქუჩა N18', city: 'თბილისი', neighborhood: { center: { ...CENTER, basis: 'CADASTRAL_PLAN' } } },
    identity: { building: '01', documentedBuildings: ['01'] },
    officialDocuments: [{ documentId: '1087185', caseRef: 'AR11087185', caseDate: '2025-04-14' }, { documentId: '95157', caseRef: 'AR195157', caseDate: '2012-12-04' }],
    officialVisuals: [
      { kind: 'PHOTO', documentId: '1087185', date: null, exifDate: null },
      { kind: 'PHOTO', documentId: '95157', date: null, exifDate: null },
      { kind: 'RENDER', documentId: '1110027' },
    ],
  };
  const rj = { projectProfile: { name: 'Kristian Stiven Street, 18', address: '18 Kristian Stiven Street, Digomi, Tbilisi', aliases: [] } };
  const subj = freshPhotoSubject(sj, rj);
  assert.deepEqual(subj.developmentNames, []);
  assert.ok(subj.streets.every((s) => s.number === '18'));
  assert.equal(subj.block, '1');
  assert.equal(freshPhotoCenter(sj, rj).basis, 'CADASTRAL_PLAN');
  assert.equal(freshPhotoCenter({}, {}), null);
  const dates = officialPhotoDates(sj);
  assert.deepEqual(dates.map((d) => [d.date, d.kind, d.caseRef]), [['2025-04-14', 'DOCUMENT', 'AR11087185'], ['2012-12-04', 'DOCUMENT', 'AR195157']]);
  assert.equal(freshPhotosNeeded(sj, NOW), true, 'only document dates');
  assert.equal(freshPhotosNeeded({ officialVisuals: [{ kind: 'PHOTO', dates: { capture: { date: '2026-09-01', source: 'EXIF' } } }] }, NOW), false);
});

test('24 h rule', () => {
  const t = NOW.getTime();
  assert.equal(freshPhotosDue(null, t), true);
  assert.equal(freshPhotosDue({ checkedAt: new Date(t - 3600e3).toISOString() }, t), false);
  assert.equal(freshPhotosDue({ checkedAt: new Date(t - 3600e3).toISOString() }, t, true), true);
  assert.equal(freshPhotosDue({ checkedAt: new Date(t - 25 * 3600e3).toISOString() }, t), true);
});

test('Commons and Mapillary responses parse into candidates', () => {
  assert.match(commonsUrl(CENTER), /generator=geosearch.*ggsradius=150.*ggsnamespace=6/);
  const cam = at(35, 180);
  const json = { query: { pages: [{
    pageid: 555, title: 'File:Kristian Stiven Street 18 2026.jpg',
    coordinates: [{ lat: cam.lat, lon: cam.lng, primary: true }],
    imageinfo: [{
      timestamp: '2026-09-03T10:00:00Z', url: 'https://upload.wikimedia.org/a.jpg', thumburl: 'https://upload.wikimedia.org/thumb/a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kristian_Stiven_Street_18_2026.jpg',
      width: 4000, height: 3000, mime: 'image/jpeg',
      extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, Artist: { value: '<a href="x">Nino</a>' }, DateTimeOriginal: { value: '2026-08-30' }, Categories: { value: 'Buildings in Tbilisi|Digomi' } },
      commonmetadata: [{ name: 'DateTimeOriginal', value: '2026:08:29 17:02:11' }],
    }],
  }, { pageid: 556, title: 'File:Map.svg', imageinfo: [{ url: 'https://upload.wikimedia.org/m.svg', mime: 'image/svg+xml', extmetadata: {} }] }] } };
  const [a, b] = parseCommons(json);
  assert.equal(a.author, 'Nino');
  assert.equal(a.capturedRaw, '2026:08:29 17:02:11');
  assert.equal(a.captureDateSource, 'EXIF');
  assert.equal(a.imageUrl, 'https://upload.wikimedia.org/thumb/a.jpg');
  assert.equal(judgeCandidate(a, CTX).accepted, true);
  assert.equal(judgeCandidate(b, CTX).reason, 'UNSUPPORTED_MEDIA');

  assert.match(mapillaryUrl(CENTER), /bbox=/);
  assert.doesNotMatch(mapillaryUrl(CENTER), /access_token/, 'the token never travels in the URL');
  const p = at(25, 45);
  const [m] = parseMapillary({ data: [{ id: '42', captured_at: Date.parse('2026-07-01T09:00:00Z'), computed_compass_angle: bearingDeg(p, CENTER), computed_geometry: { coordinates: [p.lng, p.lat] }, thumb_1024_url: 'https://scontent/42.jpg', creator: { username: 'u' } }] });
  assert.equal(m.license, 'CC BY-SA 4.0');
  const j = judgeCandidate(m, CTX);
  assert.equal(j.accepted, true);
  assert.equal(j.identity, 'HEADING');
  assert.equal(j.capturedAt, '2026-07-01');
});

function fakeFetch(routes) {
  return async (url) => {
    for (const [re, resp] of routes) if (re.test(url)) return typeof resp === 'function' ? resp(url) : resp;
    return new Response('nope', { status: 404 });
  };
}
const jsonResp = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });

test('search: no image found → NONE_FOUND; rights-restricted sources recorded, never fetched; Mapillary skipped without a key', async () => {
  const seen = [];
  const r = await runFreshPhotoSearch({
    jobId: 'eeefada9-8c9f-4d2d-bc12-b24931b4aff8', center: { ...CENTER, basis: 'CADASTRAL_PLAN' }, subject: SUBJECT, newestOfficialPhotoDate: '2025-04-14',
    store: async () => true, now: () => NOW,
    fetchImpl: async (url, init) => { seen.push([url, init?.headers?.['User-Agent']]); return jsonResp({ batchcomplete: true, query: { pages: [] } }); },
  });
  assert.equal(r.status, 'NONE_FOUND');
  assert.deepEqual(r.photos, []);
  const by = Object.fromEntries(r.sources.map((s) => [s.source, s.status]));
  assert.equal(by.WIKIMEDIA_COMMONS, 'SEARCHED');
  assert.equal(by.MAPILLARY, 'SKIPPED_NO_KEY');
  for (const s of ['DEVELOPER_SITE', 'SOCIAL_MEDIA', 'LISTING_PORTALS', 'KORTER']) assert.equal(by[s], 'SKIPPED_RIGHTS', s);
  assert.equal(seen.length, 1, 'one Commons request, nothing else');
  assert.match(seen[0][0], /^https:\/\/commons\.wikimedia\.org\/w\/api\.php\?/);
  assert.equal(seen[0][1], 'HOMATCH-Verify/1.0 (https://homatch.live)');
});

test('search: accepted photo is copied under <jobId>/fresh/ and recorded; no centre → NO_LOCATION; failure → FAILED', async () => {
  const cam = at(30, 200);
  const stored = [];
  const r = await runFreshPhotoSearch({
    jobId: 'job-1', center: { ...CENTER, basis: 'CADASTRAL_PLAN' }, subject: SUBJECT, newestOfficialPhotoDate: '2025-04-14', now: () => NOW,
    store: async (path, bytes, mime) => { stored.push([path, bytes.length, mime]); return true; },
    fetchImpl: fakeFetch([
      [/commons\.wikimedia\.org/, jsonResp({ query: { pages: [{ pageid: 9, title: 'File:Kristian Stiven Street 18.jpg', coordinates: [{ lat: cam.lat, lon: cam.lng, primary: true }], imageinfo: [{ thumburl: 'https://upload.wikimedia.org/t.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:K.jpg', mime: 'image/jpeg', timestamp: '2026-09-10T00:00:00Z', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, DateTimeOriginal: { value: '2026-09-01 12:00' }, Artist: { value: 'A' } } }] }] } })],
      [/upload\.wikimedia\.org/, jpeg],
    ]),
  });
  assert.equal(r.status, 'FOUND');
  assert.equal(r.photos.length, 1);
  const p = r.photos[0];
  assert.equal(p.id, await freshPhotoId('WIKIMEDIA_COMMONS', '9'));
  assert.equal(p.path, `job-1/fresh/${p.id}.jpg`);
  assert.equal(p.capturedAt, '2026-09-01');
  assert.equal(p.captureDateSource, 'PROVIDER_CAPTURE');
  assert.equal(p.publishedAt, '2026-09-10');
  assert.equal(p.scope, 'BUILDING');
  assert.deepEqual(stored, [[p.path, 4, 'image/jpeg']]);

  const none = await runFreshPhotoSearch({ jobId: 'j', center: null, subject: SUBJECT, newestOfficialPhotoDate: null, store: async () => true, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(none.status, 'NO_LOCATION');

  const failed = await runFreshPhotoSearch({ jobId: 'j', center: { ...CENTER, basis: 'X' }, subject: SUBJECT, newestOfficialPhotoDate: null, store: async () => true, fetchImpl: async () => new Response('forbidden', { status: 403 }) });
  assert.equal(failed.status, 'FAILED');
  assert.equal(buildFreshPhotoSearch({ center: { ...CENTER, basis: 'X' }, sources: [], photos: [], searchedAt: NOW.toISOString() }).status, 'NONE_FOUND');
});

test('construction status: an old unfinished photo never overrides newer completion evidence', () => {
  const s = reconcileConstructionStatus({
    now: NOW,
    officialPhotos: [{ date: '2013-06-07', dateKind: 'DOCUMENT', depicts: 'UNFINISHED' }],
    freshPhotos: [{ capturedAt: '2026-08-01', depicts: 'COMPLETE' }],
    register: [{ extractDate: '2026-06-22', underConstruction: true }],
    commissioning: [],
  });
  assert.equal(s.physical.state, 'COMPLETE_AS_OF');
  assert.equal(s.physical.date, '2026-08-01');
  assert.equal(s.physical.basis, 'FRESH_PHOTO_CAPTURE');
  assert.deepEqual(s.physical.superseded.map((x) => x.state), ['UNFINISHED_AS_OF']);
  assert.equal(s.commissioning.state, 'REGISTERED_UNDER_CONSTRUCTION_AS_OF', 'register mark stays a legal fact, separate');
  assert.equal(s.commissioning.date, '2026-06-22');
  assert.equal(s.occupancy.state, 'NOT_DOCUMENTED');

  const withAct = reconcileConstructionStatus({
    now: NOW,
    officialPhotos: [{ date: '2025-04-14', dateKind: 'DOCUMENT', depicts: 'UNFINISHED' }],
    commissioning: [{ date: '2026-02-01', basis: 'COMMISSIONING_ACT' }],
    register: [{ extractDate: '2026-06-22', underConstruction: true }],
  });
  assert.equal(withAct.physical.state, 'COMPLETE_AS_OF');
  assert.equal(withAct.physical.basis, 'COMMISSIONING_RECORD');
  assert.equal(withAct.commissioning.state, 'COMMISSIONED');
  assert.deepEqual(withAct.commissioning.conflicts.map((c) => c.date), ['2026-06-22'], 'a later register still marking მშენებარე is shown as a conflict');
});

test('construction status: no newer evidence is never "still unfinished"', () => {
  const s = reconcileConstructionStatus({ now: NOW, officialPhotos: [{ date: '2025-04-14', dateKind: 'DOCUMENT', depicts: 'UNFINISHED' }] });
  assert.equal(s.physical.state, 'UNFINISHED_AS_OF');
  assert.equal(s.physical.date, '2025-04-14');
  assert.equal(s.physical.basis, 'OFFICIAL_PHOTO_DOCUMENT_DATE');
  assert.equal(s.physical.stale, true, 'over a year old: "as of", never "currently"');
  assert.ok(!/STILL|CURRENT/.test(s.physical.state));
  const empty = reconcileConstructionStatus({ now: NOW });
  for (const k of ['physical', 'occupancy', 'commissioning']) assert.equal(empty[k].state, 'NOT_DOCUMENTED', k);
  // Undated evidence cannot be ordered and is ignored.
  assert.equal(reconcileConstructionStatus({ now: NOW, officialPhotos: [{ date: null, dateKind: 'DOCUMENT', depicts: 'UNFINISHED' }] }).physical.state, 'NOT_DOCUMENTED');
  // eeefada9 shape: register "მშენებარე" (22.06.2026), document-dated photos, no content classification.
  const ev = constructionEvidenceFromReport({
    propertyRegister: { latest: { issuedAt: '2026-06-22T11:58:07', unitUnderConstruction: true, buildingsUnderConstruction: true } },
    officialDocuments: [{ documentId: '1087185', caseRef: 'AR11087185', caseDate: '2025-04-14' }],
    officialVisuals: [{ kind: 'PHOTO', documentId: '1087185' }],
  }, NOW);
  const r = reconcileConstructionStatus(ev);
  assert.equal(r.physical.state, 'PHOTO_DOCUMENTED_AS_OF');
  assert.equal(r.physical.date, '2025-04-14');
  assert.equal(r.commissioning.state, 'REGISTERED_UNDER_CONSTRUCTION_AS_OF');
  assert.equal(r.occupancy.state, 'NOT_DOCUMENTED');
});

test('wiring: research-agent has fresh_photos with the recover_visuals trust model; verify-synthesis carries and signs freshPhotos', () => {
  const ra = readFileSync('supabase/functions/research-agent/index.ts', 'utf8');
  const i = ra.indexOf("=== 'fresh_photos'");
  assert.ok(i > 0, 'action dispatched');
  const block = ra.slice(i, ra.indexOf("=== 'refresh_market'"));
  assert.match(block, /bearer\.charCodeAt\(i\) !== svcKey\.charCodeAt\(i\)/, 'service key compared in full');
  assert.match(block, /\.eq\('user_id', user\.id\)/, 'otherwise only the owner');
  assert.match(block, /same && preAuthBody\?\.force === true/, 'only the service role forces');
  const fn = ra.slice(ra.indexOf('async function freshJobPhotos'), ra.indexOf('LIVE COUNTERS FOR THE RESEARCH NETWORK'));
  assert.match(fn, /storage\.from\(VISUAL_BUCKET\)/, 'bucket constant, not a literal');
  assert.match(fn, /_freshPhotos/);
  assert.match(fn, /freshPhotosDue\(/);
  assert.match(fn, /pricing_state: 'ZERO_REAL'/);
  assert.match(fn, /cost_usd: 0/);

  const vs = readFileSync('supabase/functions/verify-synthesis/index.ts', 'utf8');
  assert.match(vs, /freshPhotos: rj\?\._freshPhotos \?\? null/, 'carried at build time');
  const fc = vs.slice(vs.indexOf('async function forCustomer'), vs.indexOf('function officialDocumentPages'));
  assert.match(fc, /rest\.freshPhotos/);
  assert.match(fc, /storage\.from\(VISUAL_BUCKET\)\.createSignedUrls\(paths, VISUAL_URL_TTL_SECONDS\)/, 'same bucket and TTL as officialVisuals');
  assert.match(fc, /const \{ path: _path, \.\.\.photo \} = p/, 'the bucket path never reaches the customer');
  assert.match(vs, /action: 'fresh_photos'/);
  assert.match(vs, /await freshPhotosBeforeBuild\(job\)/);
});
