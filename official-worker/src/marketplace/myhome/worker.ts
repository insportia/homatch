// Acquisition primitives copied from the live-verified standalone MyHome worker.
import { URL } from 'node:url';
export type Criteria = {
  transaction: string | number; property: string | number;
  city?: string; district?: string;
  cityId?: number; urbanId?: number; districtId?: number;
  currency?: 'USD' | 'GEL'; minPrice?: number; maxPrice?: number;
  minArea?: number; maxArea?: number;
};
const deals = { sale: 1, rent: 2, mortgage: 3, daily_rent: 7, lease: 10,
  'იყიდება': 1, 'ქირავდება': 2, 'გირავდება': 3, 'ქირავდება დღიურად': 7, 'გაიცემა იჯარით': 10 };
const properties = { apartment: 1, house: 2, cottage: 3, land: 4, commercial: 5, hotel: 6,
  'ბინა': 1, 'სახლი': 2, 'აგარაკი': 3, 'მიწის ნაკვეთი': 4, 'კომერციული ფართი': 5, 'სასტუმრო': 6 };
function resolve(value: string | number, mapping: Record<string, number>): number {
  const id = typeof value === 'number' ? value : mapping[value.toLowerCase()];
  if (!Object.values(mapping).includes(id)) throw new Error(`Unsupported filter: ${value}`);
  return id;
}
function number(value: number, key: string): string {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
  return String(value);
}
export function buildSearchUrl(c: Criteria, page = 1): string {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page');
  const deal = resolve(c.transaction, deals), property = resolve(c.property, properties);
  const cityName = c.city?.toLowerCase(), districtName = c.district?.toLowerCase();
  if (cityName && !['tbilisi', 'თბილისი'].includes(cityName)) throw new Error('Unknown city name; supply cityId instead');
  if (districtName && !['krtsanisi', 'krwanisi', 'კრწანისი'].includes(districtName)) throw new Error('Unknown district name; supply verified IDs instead');
  if (districtName && !cityName && c.cityId !== 1) throw new Error('Krtsanisi requires Tbilisi');
  const city = c.cityId ?? (cityName ? 1 : undefined);
  const urban = c.urbanId ?? (districtName ? 65 : undefined);
  const district = c.districtId ?? (districtName ? 6 : undefined);
  if (cityName && city !== 1 || districtName && (urban !== 65 || district !== 6)) throw new Error('Conflicting location IDs');
  for (const [low, high] of [[c.minPrice, c.maxPrice], [c.minArea, c.maxArea]]) {
    if (low !== undefined && high !== undefined && low > high) throw new Error('Invalid range');
  }
  if (c.currency && !['USD', 'GEL'].includes(c.currency)) throw new Error('Unsupported currency');
  if (c.currency === 'GEL') throw new Error('GEL currency ID has not been verified');
  const dealSlugs: Record<number, string> = {1:'iyideba',2:'qiravdeba'};
  const propertySlugs: Record<number, string> = {1:'bina',2:'saxli'};
  const knownPath = city === 1 && urban === 65 && district === 6 && dealSlugs[deal] && propertySlugs[property];
  const url = new URL(knownPath ? `/udzravi-qoneba/${dealSlugs[deal]}/${propertySlugs[property]}/tbilisi/krwanisi/` : '/udzravi-qoneba/', 'https://www.myhome.ge');
  const values = {cities:city, urbans:urban, districts:district, currency_id:2, deal_types:deal,
    real_estate_types:property, price_from:c.minPrice, price_to:c.maxPrice, area_from:c.minArea,
    area_to:c.maxArea, area_types:1, page};
  for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, number(value,key));
  for (const id of [city, urban, district]) if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid location ID');
  return url.href;
}
export function deduplicate<T extends {source_id?: string | null; source_uuid?: string | null}>(items: T[]): T[] {
  const ids = new Set<string>(), uuids = new Set<string>();
  return items.filter(item => {
    if (!item.source_id && !item.source_uuid) throw new Error('Listing has no stable identity');
    const duplicate = !!(item.source_id && ids.has(item.source_id) || item.source_uuid && uuids.has(item.source_uuid));
    if (item.source_id) ids.add(item.source_id);
    if (item.source_uuid) uuids.add(item.source_uuid);
    return !duplicate;
  });
}
