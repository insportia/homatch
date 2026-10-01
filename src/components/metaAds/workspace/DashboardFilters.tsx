// META ADS — global dashboard filters (goal, currency, period). Every value
// goes to metaDashboard(); the server validates each one. Campaign STATUS is
// not filtered here: the KPI controls filter by the canonical status
// (src/lib/metaAds/uiStatus.ts), so there is one status system, not two.
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SELECT_CLASS } from './format';

export interface DashboardFilterValue { goal: string; currency: string; from: string; to: string }
export const EMPTY_FILTERS: DashboardFilterValue = { goal: '', currency: '', from: '', to: '' };
export const FILTER_GOALS = ['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'MESSAGES', 'ENGAGEMENT', 'PROMOTE'];

export function DashboardFilters({ value, onChange, currencies, goals }: {
  value: DashboardFilterValue;
  onChange: (next: DashboardFilterValue) => void;
  currencies: string[];
  goals?: string[];
}) {
  const { t } = useLanguage();
  const set = (patch: Partial<DashboardFilterValue>) => onChange({ ...value, ...patch });
  const goalList = goals && goals.length ? goals : FILTER_GOALS;
  const dirty = Object.values(value).some(Boolean);

  return (
    <fieldset className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <legend className="sr-only">{t('mm_w_filters_label')}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_filter_goal')}</span>
          <select className={SELECT_CLASS} value={value.goal} onChange={e => set({ goal: e.target.value })}>
            <option value="">{t('mm_w_filter_any')}</option>
            {goalList.map(g => <option key={g} value={g}>{t(`mads_goal_${g.toLowerCase()}`)}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_filter_currency')}</span>
          <select className={SELECT_CLASS} value={value.currency} onChange={e => set({ currency: e.target.value })} dir="ltr">
            <option value="">{t('mm_w_filter_any')}</option>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_filter_from')}</span>
          <input type="date" className={SELECT_CLASS} value={value.from} max={value.to || undefined} dir="ltr"
            onChange={e => set({ from: e.target.value })} />
        </label>
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_filter_to')}</span>
          <input type="date" className={SELECT_CLASS} value={value.to} min={value.from || undefined} dir="ltr"
            onChange={e => set({ to: e.target.value })} />
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" className="h-10 w-full" disabled={!dirty} onClick={() => onChange(EMPTY_FILTERS)}>
            {t('mm_w_filter_reset')}
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
