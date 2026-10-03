// Find Property — presentation helpers. Pure; every word goes through i18n.

import type { BriefField, NumericRange, SearchIntelligenceBrief } from '@/research-core/marketplace/brief';
import type { RequirementKey } from '@/research-core/marketplace/readiness';

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** USD as the approved copy writes it ("$162,000") in every language. */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

export function pct(value: number, digits = 1): string {
  return `${(Math.round(value * 1000) / 10).toFixed(digits).replace(/\.0$/, '')}%`;
}

/** "შემოწმებულია 3 წუთის წინ" — only from a real verification time. */
export function checkedAgo(iso: string | null | undefined, t: T, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return t('mps_checked_minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24 && new Date(at).toDateString() === new Date(now).toDateString()) return t('mps_checked_today');
  if (hours < 24) return t('mps_checked_hours', { n: hours });
  return t('mps_checked_days', { n: Math.round(hours / 24) });
}

/** "80 დან 110 მ² მდე", "$120,000 დან $160,000 მდე", or one end. */
export function rangeText(r: NumericRange, t: T, kind: 'price' | 'area' | 'count'): string {
  const fmt = (v: number) => (kind === 'price' ? usd(v) : num(v));
  const unit = kind === 'area' ? 'area' : 'plain';
  if (r.min !== null && r.max !== null) {
    if (r.min === r.max) return kind === 'area' ? t('mps_value_area', { v: fmt(r.min) }) : fmt(r.min);
    return t(`mps_range_${unit}`, { min: fmt(r.min), max: fmt(r.max) });
  }
  if (r.min !== null) return t(`mps_from_${unit}`, { v: fmt(r.min) });
  if (r.max !== null) return t(`mps_upto_${unit}`, { v: fmt(r.max) });
  return '—';
}

export interface CriterionChip {
  key: RequirementKey | 'renovation' | 'parking' | 'furnished';
  label: string;
  proposed: boolean;
}

const status = (f: BriefField<unknown> | null) => f?.status === 'PROPOSED';

/** What HOMATCH understood, as short chips, in question order. */
export function criteriaChips(b: SearchIntelligenceBrief, t: T): CriterionChip[] {
  const chips: CriterionChip[] = [];
  if (b.transactionType) chips.push({ key: 'transactionType', label: t(`mps_tx_${b.transactionType.value}`), proposed: status(b.transactionType) });
  if (b.propertyType) chips.push({ key: 'propertyType', label: t(`mps_pt_${b.propertyType.value}`), proposed: status(b.propertyType) });
  const places = [...(b.districts?.value ?? [])];
  if (b.city && !places.length) places.push(b.city.value);
  if (places.length) chips.push({ key: 'location', label: places.join(' · '), proposed: status(b.city) });
  if (b.rooms) chips.push({ key: 'rooms', label: countText(b.rooms.value, t, 'rooms'), proposed: status(b.rooms) });
  if (b.bedrooms) chips.push({ key: 'bedrooms', label: countText(b.bedrooms.value, t, 'bedrooms'), proposed: status(b.bedrooms) });
  if (b.area) chips.push({ key: 'area', label: rangeText(b.area.value, t, 'area'), proposed: status(b.area) });
  if (b.buildingStatuses) chips.push({ key: 'buildingStatus', label: b.buildingStatuses.value.map((s) => t(`mps_bs_${s}`)).join(t('mps_or')), proposed: status(b.buildingStatuses) });
  if (b.renovationPreferences) chips.push({ key: 'renovation', label: b.renovationPreferences.value.map((s) => t(`mps_rn_${s}`)).join(t('mps_or')), proposed: status(b.renovationPreferences) });
  if (b.parking?.value === true) chips.push({ key: 'parking', label: t('mps_amenity_PARKING'), proposed: false });
  if (b.price) chips.push({ key: 'price', label: rangeText(b.price.value, t, 'price'), proposed: status(b.price) });
  return chips;
}

export function countText(r: NumericRange, t: T, what: 'rooms' | 'bedrooms'): string {
  if (r.min !== null && r.max !== null && r.min === r.max) return t(`mps_${what}_n`, { n: r.min });
  if (r.min !== null && r.max === null) return t(`mps_${what}_from`, { n: r.min });
  return t(`mps_${what}_range`, { min: r.min ?? 0, max: r.max ?? r.min ?? 0 });
}

/** The label of a missing requirement ("ფასის დიაპაზონი"). */
export const requirementLabel = (k: RequirementKey, t: T) => t(`mps_req_${k}`);
