// Listing activity is source evidence. Observing a listing today never dates it today.
export const MAX_LISTING_AGE_DAYS = 30;
const DAY = 86_400_000;
export interface ListingActivity {
  at: string | null;
  basis: 'UPDATED' | 'PUBLISHED' | 'UNKNOWN';
  ageDays: number | null;
  expired: boolean;
  invalidDate: boolean;
}

export function listingActivity(publishedAt: string | null | undefined, updatedAt: string | null | undefined, now = new Date()): ListingActivity {
  const parse = (value: string | null | undefined) => {
    // Only timezone-qualified source dates are reliable enough to compare globally.
    if (!value || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && ms <= now.getTime() ? ms : null;
  };
  const published = parse(publishedAt);
  const updated = parse(updatedAt);
  const useUpdate = updated !== null && (published === null || updated >= published);
  const ms = useUpdate ? updated : published;
  return {
    at: ms === null ? null : new Date(ms).toISOString(),
    basis: ms === null ? 'UNKNOWN' : useUpdate ? 'UPDATED' : 'PUBLISHED',
    ageDays: ms === null ? null : Math.floor((now.getTime() - ms) / DAY),
    expired: ms !== null && now.getTime() - ms > MAX_LISTING_AGE_DAYS * DAY,
    invalidDate: (!!publishedAt && published === null) || (!!updatedAt && updated === null) || (updated !== null && published !== null && updated < published),
  };
}
