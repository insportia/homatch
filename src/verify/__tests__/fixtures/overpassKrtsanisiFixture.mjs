/*
 * FIXTURE — a hand-built Overpass API response, NOT real OpenStreetMap data.
 *
 * Shaped exactly like what `buildOverpassQuery()` gets back from
 * overpass-api.de (`out center tags` for places and stops, `out body` for
 * route relations), placed around the Villion parcel centre on Krtsanisi St
 * (01.18.06.019.055, ms.gov.ge map centre 41.6765159, 44.8246494). Names,
 * ids, offsets and route numbers are plausible inventions for testing; the
 * sandbox cannot reach Overpass, so nothing here was fetched.
 */

export const FIXTURE_CENTER = { lat: 41.6765159, lng: 44.8246494 };

const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LNG = 111195 * Math.cos((FIXTURE_CENTER.lat * Math.PI) / 180);

/** A point `north` metres north and `east` metres east of the centre. */
export function at(north, east) {
  return {
    lat: +(FIXTURE_CENTER.lat + north / M_PER_DEG_LAT).toFixed(7),
    lon: +(FIXTURE_CENTER.lng + east / M_PER_DEG_LNG).toFixed(7),
  };
}

const node = (id, north, east, tags) => ({ type: 'node', id, ...at(north, east), tags });
const way = (id, north, east, tags) => ({ type: 'way', id, center: at(north, east), tags });

export const OVERPASS_KRTSANISI_FIXTURE = {
  version: 0.6,
  generator: 'Overpass API 0.7.62 (fixture)',
  osm3s: {
    timestamp_osm_base: '2026-10-10T20:58:12Z',
    copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.',
  },
  elements: [
    /* daily needs */
    node(1001, 150, 0, { shop: 'supermarket', name: 'Carrefour', 'name:ka': 'კარფური', brand: 'Carrefour', 'brand:wikidata': 'Q217599' }),
    node(1002, -560, 120, { shop: 'supermarket', name: 'Carrefour Express', 'name:ka': 'კარფური ექსპრესი', brand: 'Carrefour', 'brand:wikidata': 'Q217599' }),
    node(1003, 0, 250, { shop: 'convenience', name: 'Nikora', 'name:ka': 'ნიკორა', brand: 'Nikora' }),
    node(1004, -200, -310, { shop: 'bakery', name: 'პურის სახლი' }),
    node(1005, 120, -150, { amenity: 'pharmacy', name: 'PSP', 'name:ka': 'პსპ', brand: 'PSP' }),
    node(1006, -250, 240, { amenity: 'pharmacy', name: 'Aversi', 'name:ka': 'ავერსი', brand: 'Aversi' }),
    node(1007, 300, 300, { amenity: 'pharmacy', name: 'Pharmadepot', 'name:ka': 'ფარმადეპო', brand: 'Pharmadepot' }),
    /* children */
    way(2001, -220, 230, { amenity: 'school', name: 'Public School No. 144', 'name:ka': 'თბილისის №144 საჯარო სკოლა' }),
    way(2002, 380, -350, { amenity: 'kindergarten', 'name:ka': 'საბავშვო ბაგა-ბაღი „მზიური“' }),
    /* health */
    way(3001, 260, 110, { amenity: 'hospital', name: 'New Hospitals', 'name:ka': 'ნიუ ჰოსპიტალსი', healthcare: 'hospital' }),
    node(3002, 640, 0, { amenity: 'dentist', name: 'Dental Studio' }),
    /* green space and leisure */
    way(4001, 300, -290, { leisure: 'park', 'name:ka': 'კრწანისის სკვერი' }),
    node(4002, -130, 120, { leisure: 'playground' }),
    way(4003, -700, 400, { leisure: 'garden', access: 'private', name: 'Private garden' }),
    way(4004, 820, -100, { leisure: 'park', name: 'Rike Park', 'name:ka': 'რიყის პარკი' }),
    node(4005, -450, -520, { leisure: 'fitness_centre', name: 'Fitness One' }),
    /* food and services */
    node(5001, 90, 80, { amenity: 'cafe', name: 'Coffee Lab', 'name:ka': 'ქოფი ლაბი' }),
    node(5002, 200, 260, { amenity: 'cafe', name: 'Entrée', brand: 'Entrée' }),
    node(5003, -310, 100, { amenity: 'restaurant', 'name:ka': 'სამიკიტნო' }),
    node(5004, 220, -60, { shop: 'hairdresser', 'name:ka': 'სილამაზის სალონი „ნინო“' }),
    node(5005, -350, -300, { amenity: 'bank', name: 'TBC Bank', 'name:ka': 'თიბისი ბანკი', brand: 'TBC Bank' }),
    /* outside the 1 km radius: must be ignored even if returned */
    way(9901, 1300, 0, { amenity: 'school', 'name:ka': 'შორეული სკოლა' }),
    /* stops: a platform and its unnamed stop position, a second stop, an unnamed one */
    node(7001, 60, 70, { highway: 'bus_stop', public_transport: 'platform', bus: 'yes', name: 'Krtsanisi St', 'name:ka': 'კრწანისის ქუჩა' }),
    node(7002, 65, 90, { public_transport: 'stop_position', bus: 'yes' }),
    node(7003, -400, 160, { highway: 'bus_stop', name: 'Ortachala Bridge', 'name:ka': 'ორთაჭალის ხიდი' }),
    node(7004, 540, -150, { highway: 'bus_stop' }),
    /* routes serving those stops */
    { type: 'relation', id: 8001, tags: { type: 'route', route: 'bus', ref: '330', name: 'Bus 330: Ortachala → Vake' },
      members: [{ type: 'node', ref: 7002, role: 'stop' }, { type: 'node', ref: 7001, role: 'platform' }, { type: 'node', ref: 6999, role: 'platform' }] },
    { type: 'relation', id: 8002, tags: { type: 'route', route: 'bus', ref: '330', name: 'Bus 330: Vake → Ortachala' },
      members: [{ type: 'node', ref: 7001, role: 'platform' }] },
    { type: 'relation', id: 8003, tags: { type: 'route', route: 'bus', ref: '371' },
      members: [{ type: 'node', ref: 7003, role: 'platform' }] },
    { type: 'relation', id: 8004, tags: { type: 'route', route: 'share_taxi', ref: '459' },
      members: [{ type: 'node', ref: 7003, role: 'platform' }] },
    { type: 'relation', id: 8005, tags: { type: 'route', route: 'bus', name: 'Unnumbered shuttle' },
      members: [{ type: 'node', ref: 7004, role: 'platform' }] },
  ],
};
