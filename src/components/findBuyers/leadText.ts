// Words for one Find Buyers lead, shared by the compact result card and the lead
// detail page: why the person may be relevant, how old the signal is, which
// languages the screen can name.
import { placeName } from '@/lib/placeNames';
import type { WhyMatched } from '@/services/findBuyers';

type T = (k: string, v?: Record<string, string>) => string;

/** The six languages HOMATCH can name (and translate into). */
export const LEAD_LANGS = new Set(['ka', 'ru', 'en', 'ar', 'he', 'tr']);

export function whyText(why: WhyMatched | null | undefined, t: T, lang: string): string | null {
  if (!why) return null;
  const what = why.bedrooms != null && why.bedrooms > 0
    ? t('fbx_what_bedrooms', { n: String(why.bedrooms) })
    : why.propertyType === 'HOUSE' ? t('fbx_what_house') : why.propertyType ? t('fbx_what_apartment') : t('fbx_what_property');
  const rawPlace = why.district ?? why.city ?? null;
  const place = rawPlace ? placeName(rawPlace.replace(/\b\w/g, (c) => c.toUpperCase()), lang) : null;
  const base = why.kind === 'REQUEST_POST'
    ? (place ? t('fbx_why_request', { what, place }) : t('fbx_why_request_noplace', { what }))
    : (place ? t('fbx_why_comment', { what, place }) : t('fbx_why_comment_noplace', { what }));
  const size = why.agreed.includes('area'); const price = why.agreed.includes('price');
  const agreed = size && price ? t('fbx_why_agreed_both') : size ? t('fbx_why_agreed_size') : price ? t('fbx_why_agreed_price') : '';
  return agreed ? `${base} ${agreed}` : base;
}

/** "today" / "1 day ago" / "N days ago", or null when the signal has no date. */
export function ageLabel(iso: string | null | undefined, t: T, now = Date.now()): string | null {
  if (!iso) return null;
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
  if (!Number.isFinite(days)) return null;
  return days === 0 ? t('fbx_today') : days === 1 ? t('fbx_one_day') : t('fbx_days', { count: String(days) });
}

/** The lead's detail page. */
export const leadHref = (propertyId: string, leadId: string) =>
  `/property/${encodeURIComponent(propertyId)}/buyers/lead/${encodeURIComponent(leadId)}`;
