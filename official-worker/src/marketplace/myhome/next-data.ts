// Acquisition primitives copied from the live-verified standalone MyHome worker.
import { URL } from 'node:url';
export function buildNextDataUrl(searchUrl: string, buildId: string, locale = 'ka') {
  if (!/^[A-Za-z0-9_-]+$/.test(buildId) || !/^[a-z]{2}$/.test(locale)) throw new Error('Invalid Next metadata');
  const url = new URL(searchUrl);
  if (url.origin !== 'https://www.myhome.ge') throw new Error('Unexpected origin');
  url.pathname = `/_next/data/${buildId}/${locale}${url.pathname.replace(/\/$/,'') || '/index'}.json`;
  return url.href;
}
const transactions: Record<number,string> = {1:'sale',2:'rent',3:'mortgage',7:'daily_rent',10:'lease'};
const properties: Record<number,string> = {1:'apartment',2:'house',3:'cottage',4:'land',5:'commercial',6:'hotel'};
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function normalizeRoomCount(value:unknown):number|string|null {
  if(value === null || value === undefined || value === '') return null;
  if(typeof value === 'string' && /^\d+\+$/.test(value.trim())) return value.trim();
  const n=numeric(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function normalizeListing(raw: any) {
  if (!raw || !Number.isSafeInteger(raw.id) || !raw.dynamic_slug || !raw.dynamic_title) throw new Error('Unrecognized listing schema');
  return {source:'myhome.ge',source_id:String(raw.id),source_uuid:raw.uuid ?? null,
    source_url:`https://www.myhome.ge/udzravi-qoneba/${encodeURIComponent(raw.dynamic_slug)}-${raw.id}/`,
    transaction_type:transactions[raw.deal_type_id] ?? null,property_type:properties[raw.real_estate_type_id] ?? null,
    title:raw.dynamic_title,price:numeric(raw.price?.['2']?.price_total),currency:raw.price?.['2'] ? 'USD' : null,
    area_m2:raw.area_type_id === 1 ? numeric(raw.area) : null,yard_area_m2:numeric(raw.yard_area),rooms:normalizeRoomCount(raw.room),bedrooms:normalizeRoomCount(raw.bedroom),
    address:raw.address ?? null,city:raw.city_name ?? null,district:raw.district_name ?? null,
    latitude:numeric(raw.lat),longitude:numeric(raw.lng),
    images:(raw.images ?? []).map((x:any)=>x.large ?? x.thumb).filter(Boolean),raw_source_data:raw};
}
