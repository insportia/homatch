/*
 * Deep Search — the pieces every campaign surface shares: what HOMATCH is searching for
 * (the confirmed request, shown before, during and after), the honest result funnel, and
 * the customer's money (held → charged → released). Presentation only: every number is
 * the server's. Provider costs and margins never reach this file.
 */
import { Check, CircleHelp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CampaignCriteria, CampaignOutcome, CampaignSettlement, MatchCheck } from '@/services/paidCampaign';
import type { SearchIntelligenceBrief } from '@/research-core/marketplace/brief';
import { placeName } from '@/lib/placeNames';
import { resolvePlace } from '@/research-core/normalize/place';

const uiLang = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
/** A place in the interface language: Georgian / Russian tables, else the Latin name of a known place. */
export const placeText = (name: string | null | undefined) => {
  if (!name) return '';
  const lang = uiLang();
  if (lang === 'ka' || lang === 'ru') return placeName(name, lang);
  const key = resolvePlace(name)?.key;
  return key ? key.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : name;
};
import type { T } from '../format';
import { cx } from '../workspace/primitives';

const nf = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
const usd = (n: number) => `$${nf(Math.round(n))}`;
const span = (r: { min: number | null; max: number | null } | null, f: (n: number) => string = nf) =>
  !r ? null : r.min != null && r.max != null ? (r.min === r.max ? f(r.min) : `${f(r.min)}–${f(r.max)}`) : r.min != null ? `≥ ${f(r.min)}` : r.max != null ? `≤ ${f(r.max)}` : null;

/** The confirmed brief (before a campaign exists) in the same shape the server judges with. */
export function criteriaFromBrief(b: SearchIntelligenceBrief): CampaignCriteria {
  const tx = b.transactionType?.value;
  const types: Record<string, string> = { APARTMENT: 'APARTMENT', STUDIO: 'APARTMENT', HOUSE: 'HOUSE', VILLA: 'HOUSE', COUNTRY_HOUSE: 'HOUSE', LAND: 'LAND', COMMERCIAL: 'COMMERCIAL', OFFICE: 'COMMERCIAL' };
  const r = (f: { value: { min?: number | null; max?: number | null } } | null) => (f?.value ? { min: f.value.min ?? null, max: f.value.max ?? null } : null);
  const statuses = (b.buildingStatuses?.value ?? []).filter((s) => s !== 'ANY');
  return {
    transaction: tx && tx !== 'BUY' ? 'RENT' : 'SALE', city: b.city?.value ?? null, districts: b.districts?.value ?? [],
    propertyType: b.propertyType?.value ? types[b.propertyType.value] ?? null : null,
    priceUsd: r(b.price), areaSqm: r(b.area), rooms: r(b.rooms), bedrooms: r(b.bedrooms),
    buildingStatuses: statuses.length === 3 ? [] : statuses,
  };
}

/** The request as short human phrases, in the interface language. Unknown parts are left out. */
export function criteriaPhrases(t: T, c: CampaignCriteria): string[] {
  const out: string[] = [];
  out.push(t(c.transaction === 'RENT' ? 'fpc_c_rent' : 'fpc_c_buy'));
  if (c.propertyType) out.push(t(`fpc_type_${c.propertyType.toLowerCase()}`));
  const place = [c.districts.map(placeText).join(', '), placeText(c.city)].filter(Boolean).join(', ');
  if (place) out.push(place);
  const rooms = span(c.rooms); if (rooms) out.push(t('fpc_c_rooms', { n: rooms }));
  const beds = span(c.bedrooms); if (beds) out.push(t('fpc_c_bedrooms', { n: beds }));
  const area = span(c.areaSqm); if (area) out.push(t('fpc_c_area', { n: area }));
  const price = span(c.priceUsd, usd); if (price) out.push(price);
  if (c.buildingStatuses.length) out.push(c.buildingStatuses.map((s) => t(`fpc_build_${s.toLowerCase()}`)).join(' / '));
  return out;
}

export function CriteriaSummary({ t, criteria, dark, originalText, editHref }: { t: T; criteria: CampaignCriteria; dark?: boolean; originalText?: string | null; editHref?: string | null }) {
  return (
    <div className={cx('rounded-2xl border p-4', dark ? 'border-white/10 bg-white/[0.04]' : 'border-border bg-card')} data-campaign-criteria>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cx('text-2xs font-semibold uppercase tracking-[0.14em]', dark ? 'text-[hsl(var(--gold))]' : 'text-[hsl(var(--gold-ink))]')}>{t('fpc_criteria_title')}</p>
        {editHref ? <a href={editHref} className={cx('text-xs font-semibold underline underline-offset-4', dark ? 'text-white/80' : 'text-foreground/80')} data-action="campaign-edit-criteria">{t('fpc_criteria_edit')}</a> : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('fpc_criteria_title')}>
        {criteriaPhrases(t, criteria).map((p) => (
          <li key={p} className={cx('max-w-full rounded-full border px-2.5 py-1 text-xs font-medium', dark ? 'border-white/15 text-white/90' : 'border-border bg-muted/40 text-foreground')}><bdi>{p}</bdi></li>
        ))}
      </ul>
      <p className={cx('mt-2 text-xs leading-relaxed', dark ? 'text-white/60' : 'text-muted-foreground')}>{t('fpc_criteria_strict')}</p>
      {originalText ? <p className={cx('mt-2 border-s-2 ps-3 text-xs italic leading-relaxed', dark ? 'border-white/20 text-white/60' : 'border-border text-muted-foreground')}><bdi>“{originalText}”</bdi></p> : null}
    </div>
  );
}

/** Counts up once to the server's number (instantly under reduced motion). */
export function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(run ? 0 : target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!run || reduce || target <= 0) { setValue(target); return; }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, run]);
  return value;
}

/** The headline is matching properties; raw volume is a collapsed technical detail. */
export function ResultFunnel({ t, outcome, dark, animate }: { t: T; outcome: CampaignOutcome; dark?: boolean; animate?: boolean }) {
  const exact = useCountUp(outcome.exact, !!animate);
  const potential = useCountUp(outcome.potential, !!animate);
  const muted = dark ? 'text-white/60' : 'text-muted-foreground';
  return (
    <div className="space-y-3" data-campaign-funnel>
      <div className="grid grid-cols-2 gap-2">
        <div className={cx('rounded-2xl border p-3', dark ? 'border-[hsl(var(--gold)/0.45)] bg-[hsl(var(--gold)/0.08)]' : 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.08)]')}>
          <p className="font-display text-3xl font-semibold tabular-nums leading-none" data-funnel-exact={outcome.exact}>{nf(exact)}</p>
          <p className={cx('mt-1.5 text-xs font-semibold leading-snug', dark ? 'text-white/85' : 'text-foreground')}>{t('fpc_exact_label')}</p>
        </div>
        <div className={cx('rounded-2xl border p-3', dark ? 'border-white/10 bg-white/[0.04]' : 'border-border bg-card')}>
          <p className="font-display text-3xl font-semibold tabular-nums leading-none" data-funnel-potential={outcome.potential}>{nf(potential)}</p>
          <p className={cx('mt-1.5 text-xs font-semibold leading-snug', dark ? 'text-white/85' : 'text-foreground')}>{t('fpc_potential_label')}</p>
        </div>
      </div>
      <details className={cx('group rounded-xl border px-3 py-2 text-xs', dark ? 'border-white/10' : 'border-border')} data-funnel-details>
        <summary className={cx('cursor-pointer select-none font-semibold', muted)}>{t('fpc_funnel_details')}</summary>
        <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {([
            ['fpc_f_fetched', outcome.fetched], ['fpc_f_candidates', outcome.candidates], ['fpc_f_unique', outcome.unique],
            ['fpc_f_duplicates', outcome.duplicates], ['fpc_f_alternative', outcome.alternative], ['fpc_f_rejected', outcome.rejected],
          ] as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3"><dt className={muted}>{t(k)}</dt><dd className="tabular-nums">{nf(v)}</dd></div>
          ))}
        </dl>
        {Object.keys(outcome.rejectedBy ?? {}).length ? (
          <p className={cx('mt-2 leading-relaxed', muted)}>
            {t('fpc_f_rejected_why')}{' '}
            {Object.entries(outcome.rejectedBy).sort((a, b) => Number(b[1]) - Number(a[1])).map(([r, n]) => `${t(`fpc_reason_${r.toLowerCase()}`)} ${n}`).join(' · ')}
          </p>
        ) : null}
        <p className={cx('mt-2 leading-relaxed', muted)}>{t('fpc_f_note')}</p>
      </details>
    </div>
  );
}

/** Held → charged → released. A hold is never called a charge. */
const SETTLE_STATES = new Set(['HELD', 'SETTLING', 'SETTLED', 'RELEASED']);

export function SettlementCard({ t, s: raw, dark }: { t: T; s: CampaignSettlement; dark?: boolean }) {
  const s = SETTLE_STATES.has(String(raw.status)) ? raw : { ...raw, status: 'SETTLING' };
  const final = s.status === 'SETTLED' || s.status === 'RELEASED';
  const row = (k: string, v: string, strong = false) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cx('shrink-0', dark ? 'text-white/60' : 'text-muted-foreground')}>{t(k)}</dt>
      <dd className={cx('min-w-0 text-end tabular-nums', strong && 'font-semibold text-[hsl(var(--gold))]')}>{v}</dd>
    </div>
  );
  const cr = (n: number | null | undefined) => (n == null ? '—' : t('fpi_paid_credits_n', { n }));
  return (
    <div className={cx('rounded-2xl border p-4 text-sm', dark ? 'border-white/10 bg-white/[0.04]' : 'border-border bg-card')} data-campaign-settlement={s.status}>
      <p className="flex items-center justify-between gap-2 font-semibold">
        <span>{t('fpc_money_title')}</span>
        <span className={cx('rounded-full border px-2 py-0.5 text-2xs font-semibold', final ? 'border-[hsl(152_46%_40%/0.4)] text-[hsl(152_50%_45%)]' : 'border-white/20 text-current opacity-80')}>{t(`fpc_settle_${String(s.status).toLowerCase()}`)}</span>
      </p>
      <dl className="mt-2 space-y-1.5">
        {row('fpc_money_reserved', cr(s.reservedCredits))}
        {row(final ? 'fpc_money_charged' : 'fpc_money_used_pending', final ? cr(s.chargedCredits) : t('fpc_money_pending'), final)}
        {row('fpc_money_released', final ? cr(s.releasedCredits) : '—')}
      </dl>
      <p className={cx('mt-2 text-xs leading-relaxed', dark ? 'text-white/55' : 'text-muted-foreground')}>{t(final ? 'fpc_money_final_note' : 'fpc_money_hold_note')}</p>
    </div>
  );
}

function actualText(t: T, c: MatchCheck): string | null {
  if (!c.actual) return null;
  if (c.key === 'propertyType') return t(`fpc_type_${c.actual.toLowerCase()}`);
  if (c.key === 'buildingStatus') return t(`fpc_build_${c.actual.toLowerCase()}`);
  if (c.key === 'transaction') return t(c.actual === 'RENT' ? 'fpc_c_rent' : 'fpc_c_buy');
  if (c.key === 'price') return usd(Number(c.actual));
  if (c.key === 'district' || c.key === 'city') return placeText(c.actual);
  return c.actual;
}

export function CheckRow({ t, c }: { t: T; c: MatchCheck }) {
  const actual = actualText(t, c);
  const Icon = c.state === 'MATCH' ? Check : c.state === 'FAIL' ? X : CircleHelp;
  const tone = c.state === 'MATCH' ? 'text-[hsl(152_46%_32%)]' : c.state === 'FAIL' ? 'text-[hsl(0_66%_44%)]' : 'text-[hsl(32_78%_36%)]';
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs leading-snug" data-check={c.key} data-check-state={c.state}>
      <Icon className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', tone)} aria-hidden="true" strokeWidth={2.5} />
      <span className="min-w-0">
        <span className="font-semibold">{t(`fpc_check_${c.key}`)}</span>{' '}
        <span className="text-muted-foreground">{t(`fpc_state_${c.state.toLowerCase()}`)}{actual ? <>: <bdi>{actual}</bdi></> : null}</span>
      </span>
    </li>
  );
}
