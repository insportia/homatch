// WHERE ON THE MAP — the geometry HOMATCH's own map draws with. Pure: no
// React, no network, so node:test can import it directly.
//
// Meta's location search answers with keys and names but no coordinates, so
// the map places a chosen city by matching it to this list of Georgian cities
// and Tbilisi districts (names in English, Georgian and Russian). A city that
// is not on the list is still targeted exactly as chosen — the map simply
// says it cannot draw it. A pin carries its own coordinates.
//
// Outlines (geoData.json) come from Natural Earth via world-atlas
// (public domain), simplified for a small, lazily loaded map.

export interface Place { id: string; en: string; ka: string; ru: string; lat: number; lng: number; kind: 'city' | 'district'; major?: boolean }

export const PLACES: Place[] = [
  { id: 'tbilisi', en: 'Tbilisi', ka: 'თბილისი', ru: 'Тбилиси', lat: 41.7151, lng: 44.8271, kind: 'city', major: true },
  { id: 'batumi', en: 'Batumi', ka: 'ბათუმი', ru: 'Батуми', lat: 41.6168, lng: 41.6367, kind: 'city', major: true },
  { id: 'kutaisi', en: 'Kutaisi', ka: 'ქუთაისი', ru: 'Кутаиси', lat: 42.2679, lng: 42.6946, kind: 'city', major: true },
  { id: 'rustavi', en: 'Rustavi', ka: 'რუსთავი', ru: 'Рустави', lat: 41.5495, lng: 44.993, kind: 'city' },
  { id: 'zugdidi', en: 'Zugdidi', ka: 'ზუგდიდი', ru: 'Зугдиди', lat: 42.5088, lng: 41.8709, kind: 'city', major: true },
  { id: 'gori', en: 'Gori', ka: 'გორი', ru: 'Гори', lat: 41.9842, lng: 44.1158, kind: 'city' },
  { id: 'poti', en: 'Poti', ka: 'ფოთი', ru: 'Поти', lat: 42.1462, lng: 41.6719, kind: 'city' },
  { id: 'kobuleti', en: 'Kobuleti', ka: 'ქობულეთი', ru: 'Кобулети', lat: 41.8214, lng: 41.7792, kind: 'city' },
  { id: 'khashuri', en: 'Khashuri', ka: 'ხაშური', ru: 'Хашури', lat: 41.9946, lng: 43.5992, kind: 'city' },
  { id: 'samtredia', en: 'Samtredia', ka: 'სამტრედია', ru: 'Самтредиа', lat: 42.1537, lng: 42.3383, kind: 'city' },
  { id: 'senaki', en: 'Senaki', ka: 'სენაკი', ru: 'Сенаки', lat: 42.2704, lng: 42.0679, kind: 'city' },
  { id: 'zestaponi', en: 'Zestaponi', ka: 'ზესტაფონი', ru: 'Зестафони', lat: 42.11, lng: 43.0522, kind: 'city' },
  { id: 'marneuli', en: 'Marneuli', ka: 'მარნეული', ru: 'Марнеули', lat: 41.4759, lng: 44.8081, kind: 'city' },
  { id: 'telavi', en: 'Telavi', ka: 'თელავი', ru: 'Телави', lat: 41.9198, lng: 45.4731, kind: 'city', major: true },
  { id: 'akhaltsikhe', en: 'Akhaltsikhe', ka: 'ახალციხე', ru: 'Ахалцихе', lat: 41.639, lng: 42.9826, kind: 'city' },
  { id: 'ozurgeti', en: 'Ozurgeti', ka: 'ოზურგეთი', ru: 'Озургети', lat: 41.9244, lng: 42.0068, kind: 'city' },
  { id: 'kaspi', en: 'Kaspi', ka: 'კასპი', ru: 'Каспи', lat: 41.9254, lng: 44.4255, kind: 'city' },
  { id: 'chiatura', en: 'Chiatura', ka: 'ჭიათურა', ru: 'Чиатура', lat: 42.2898, lng: 43.2822, kind: 'city' },
  { id: 'tskaltubo', en: 'Tskaltubo', ka: 'წყალტუბო', ru: 'Цхалтубо', lat: 42.3266, lng: 42.6003, kind: 'city' },
  { id: 'sagarejo', en: 'Sagarejo', ka: 'საგარეჯო', ru: 'Сагареджо', lat: 41.7337, lng: 45.3305, kind: 'city' },
  { id: 'gardabani', en: 'Gardabani', ka: 'გარდაბანი', ru: 'Гардабани', lat: 41.4605, lng: 45.092, kind: 'city' },
  { id: 'borjomi', en: 'Borjomi', ka: 'ბორჯომი', ru: 'Боржоми', lat: 41.8422, lng: 43.378, kind: 'city' },
  { id: 'bolnisi', en: 'Bolnisi', ka: 'ბოლნისი', ru: 'Болниси', lat: 41.4478, lng: 44.5394, kind: 'city' },
  { id: 'akhalkalaki', en: 'Akhalkalaki', ka: 'ახალქალაქი', ru: 'Ахалкалаки', lat: 41.4056, lng: 43.4862, kind: 'city' },
  { id: 'gurjaani', en: 'Gurjaani', ka: 'გურჯაანი', ru: 'Гурджаани', lat: 41.7429, lng: 45.8012, kind: 'city' },
  { id: 'mtskheta', en: 'Mtskheta', ka: 'მცხეთა', ru: 'Мцхета', lat: 41.8452, lng: 44.7188, kind: 'city' },
  { id: 'kvareli', en: 'Kvareli', ka: 'ყვარელი', ru: 'Кварели', lat: 41.9542, lng: 45.8128, kind: 'city' },
  { id: 'akhmeta', en: 'Akhmeta', ka: 'ახმეტა', ru: 'Ахмета', lat: 42.0315, lng: 45.2072, kind: 'city' },
  { id: 'kareli', en: 'Kareli', ka: 'ქარელი', ru: 'Карели', lat: 42.0213, lng: 43.8978, kind: 'city' },
  { id: 'lanchkhuti', en: 'Lanchkhuti', ka: 'ლანჩხუთი', ru: 'Ланчхути', lat: 42.0884, lng: 42.0306, kind: 'city' },
  { id: 'dusheti', en: 'Dusheti', ka: 'დუშეთი', ru: 'Душети', lat: 42.085, lng: 44.6942, kind: 'city' },
  { id: 'sachkhere', en: 'Sachkhere', ka: 'საჩხერე', ru: 'Сачхере', lat: 42.3453, lng: 43.4183, kind: 'city' },
  { id: 'lagodekhi', en: 'Lagodekhi', ka: 'ლაგოდეხი', ru: 'Лагодехи', lat: 41.8267, lng: 46.2767, kind: 'city' },
  { id: 'sighnaghi', en: 'Sighnaghi', ka: 'სიღნაღი', ru: 'Сигнахи', lat: 41.6191, lng: 45.9227, kind: 'city' },
  { id: 'martvili', en: 'Martvili', ka: 'მარტვილი', ru: 'Мартвили', lat: 42.4142, lng: 42.3791, kind: 'city' },
  { id: 'mestia', en: 'Mestia', ka: 'მესტია', ru: 'Местиа', lat: 43.045, lng: 42.729, kind: 'city' },
  { id: 'stepantsminda', en: 'Stepantsminda', ka: 'სტეფანწმინდა', ru: 'Степанцминда', lat: 42.6575, lng: 44.6431, kind: 'city' },
  { id: 'gudauri', en: 'Gudauri', ka: 'გუდაური', ru: 'Гудаури', lat: 42.4779, lng: 44.4777, kind: 'city' },
  { id: 'bakuriani', en: 'Bakuriani', ka: 'ბაკურიანი', ru: 'Бакуриани', lat: 41.75, lng: 43.5333, kind: 'city' },
  { id: 'ambrolauri', en: 'Ambrolauri', ka: 'ამბროლაური', ru: 'Амбролаури', lat: 42.5208, lng: 43.1622, kind: 'city' },
  { id: 'tetritskaro', en: 'Tetritskaro', ka: 'თეთრიწყარო', ru: 'Тетрицкаро', lat: 41.5444, lng: 44.4597, kind: 'city' },
  { id: 'tsalka', en: 'Tsalka', ka: 'წალკა', ru: 'Цалка', lat: 41.5947, lng: 44.0889, kind: 'city' },
  { id: 'ureki', en: 'Ureki', ka: 'ურეკი', ru: 'Уреки', lat: 41.9976, lng: 41.7765, kind: 'city' },
  { id: 'anaklia', en: 'Anaklia', ka: 'ანაკლია', ru: 'Анаклия', lat: 42.3961, lng: 41.5689, kind: 'city' },
  { id: 'gonio', en: 'Gonio', ka: 'გონიო', ru: 'Гонио', lat: 41.5617, lng: 41.5728, kind: 'city' },
  { id: 'sokhumi', en: 'Sokhumi', ka: 'სოხუმი', ru: 'Сухуми', lat: 43.0033, lng: 41.0153, kind: 'city' },
  // Tbilisi districts
  { id: 'vake', en: 'Vake', ka: 'ვაკე', ru: 'Ваке', lat: 41.7099, lng: 44.7516, kind: 'district' },
  { id: 'saburtalo', en: 'Saburtalo', ka: 'საბურთალო', ru: 'Сабуртало', lat: 41.7364, lng: 44.7612, kind: 'district' },
  { id: 'vera', en: 'Vera', ka: 'ვერა', ru: 'Вера', lat: 41.7114, lng: 44.7743, kind: 'district' },
  { id: 'mtatsminda', en: 'Mtatsminda', ka: 'მთაწმინდა', ru: 'Мтацминда', lat: 41.6957, lng: 44.7894, kind: 'district' },
  { id: 'old-tbilisi', en: 'Old Tbilisi', ka: 'ძველი თბილისი', ru: 'Старый Тбилиси', lat: 41.6903, lng: 44.8094, kind: 'district' },
  { id: 'isani', en: 'Isani', ka: 'ისანი', ru: 'Исани', lat: 41.692, lng: 44.8424, kind: 'district' },
  { id: 'didube', en: 'Didube', ka: 'დიდუბე', ru: 'Дидубе', lat: 41.755, lng: 44.79, kind: 'district' },
  { id: 'nadzaladevi', en: 'Nadzaladevi', ka: 'ნაძალადევი', ru: 'Надзаладеви', lat: 41.7656, lng: 44.7826, kind: 'district' },
  { id: 'gldani', en: 'Gldani', ka: 'გლდანი', ru: 'Глдани', lat: 41.7927, lng: 44.8126, kind: 'district' },
  { id: 'samgori', en: 'Samgori', ka: 'სამგორი', ru: 'Самгори', lat: 41.6966, lng: 44.8916, kind: 'district' },
  { id: 'krtsanisi', en: 'Krtsanisi', ka: 'კრწანისი', ru: 'Крцаниси', lat: 41.664, lng: 44.818, kind: 'district' },
  { id: 'chughureti', en: 'Chughureti', ka: 'ჩუღურეთი', ru: 'Чугурети', lat: 41.7166, lng: 44.802, kind: 'district' },
  { id: 'dighomi', en: 'Dighomi', ka: 'დიღომი', ru: 'Дигоми', lat: 41.771, lng: 44.744, kind: 'district' },
];

const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(city|town|municipality|district|region|г\.|город|район|ქალაქი|რაიონი)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The map point for a chosen place: its own coordinates, or a known Georgian place by name. */
export function placePoint(l: { type: string; name: string; countryCode?: string | null; lat?: number | null; lng?: number | null }): { lat: number; lng: number } | null {
  if (Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)) && l.lat != null && l.lng != null) return { lat: Number(l.lat), lng: Number(l.lng) };
  if (l.type !== 'city' && l.type !== 'pin') return null;
  if (l.countryCode && String(l.countryCode).toUpperCase() !== 'GE') return null;
  const n = norm(l.name);
  if (!n) return null;
  const hit = PLACES.find((p) => [p.en, p.ka, p.ru].some((x) => norm(x) === n))
    ?? PLACES.find((p) => [p.en, p.ka, p.ru].some((x) => n.startsWith(norm(x)) || norm(x).startsWith(n)));
  return hit ? { lat: hit.lat, lng: hit.lng } : null;
}

/* ── PROJECTION ────────────────────────────────────────────────────── */

const RAD = Math.PI / 180;
/** Web Mercator, in degree-like units: x = longitude, y = mercator(latitude). */
export function project(lng: number, lat: number): [number, number] {
  const phi = Math.max(-85, Math.min(85, lat)) * RAD;
  return [lng, -Math.log(Math.tan(Math.PI / 4 + phi / 2)) / RAD];
}

/** A circle of radius km around a point, as a ring of [lng, lat]. */
export function circleRing(lat: number, lng: number, km: number, steps = 64): Array<[number, number]> {
  const R = 6371;
  const d = km / R;
  const phi1 = lat * RAD;
  const l1 = lng * RAD;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(brng));
    const l2 = l1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
    out.push([l2 / RAD, phi2 / RAD]);
  }
  return out;
}

/** Ray casting: is the point inside any ring of [lng, lat]? */
export function insideRings(rings: Array<Array<[number, number]>>, lng: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The inverse of project(): a map coordinate back to longitude/latitude. */
export function unproject(x: number, y: number): { lng: number; lat: number } {
  return { lng: x, lat: (2 * Math.atan(Math.exp(-y * RAD)) - Math.PI / 2) / RAD };
}
