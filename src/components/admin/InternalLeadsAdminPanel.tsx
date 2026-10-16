// Admin — HOMATCH Leads: prices from the catalogue, the Premium segment rules (owner
// configuration by transaction × property type × country × city), and the unlock
// ledger kept separate from research revenue. A rule only decides the PRICE segment;
// it never touches a match score.

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Rule { id: string; transaction_type: 'SALE' | 'RENT'; property_type: string | null; country: string | null; city: string | null; min_budget_usd: number; active: boolean; note: string | null }
interface Overview {
  prices: { STANDARD: number; PREMIUM: number; active: boolean };
  rules: Rule[];
  unlocks: { standard: number; premium: number; standardCredits: number; premiumCredits: number; accounts: number; leads: number };
  crm: Record<string, number>;
}

export function InternalLeadsAdminPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ transactionType: 'SALE', propertyType: '', country: 'GE', city: '', minBudgetUsd: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('admin_internal_leads_overview', { p_days: 30 });
    if (e) { setError(e.message); return; }
    setData(d as Overview);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true); setError(null);
    const { error: e } = await supabase.rpc('admin_internal_lead_rule_save', { p: { ...draft, minBudgetUsd: Number(draft.minBudgetUsd) } });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setDraft((d) => ({ ...d, minBudgetUsd: '' }));
    void load();
  }

  async function toggle(rule: Rule) {
    const { error: e } = await supabase.rpc('admin_internal_lead_rule_save', { p: { id: rule.id, transactionType: rule.transaction_type, minBudgetUsd: rule.min_budget_usd, active: !rule.active } });
    if (e) setError(e.message); else void load();
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold">{t('admin_il_title')}</h2>
          <p className="text-xs text-muted-foreground">{t('admin_il_subtitle')}</p>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {data ? (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t('admin_il_price_standard')}</dt><dd className="font-semibold">{data.prices.STANDARD}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_il_price_premium')}</dt><dd className="font-semibold">{data.prices.PREMIUM}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_il_unlocks_30d')}</dt><dd className="font-semibold">{data.unlocks.standard} / {data.unlocks.premium}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t('admin_il_revenue_30d')}</dt><dd className="font-semibold">{Number(data.unlocks.standardCredits) + Number(data.unlocks.premiumCredits)}</dd></div>
            </dl>
            <table className="w-full text-sm">
              <thead><tr className="text-start text-xs text-muted-foreground">
                <th className="py-1 text-start">{t('admin_il_scope')}</th><th className="text-start">{t('admin_il_threshold')}</th><th className="text-start">{t('admin_il_state')}</th><th />
              </tr></thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5">{[r.transaction_type, r.property_type ?? '*', r.country ?? '*', r.city ?? '*'].join(' · ')}</td>
                    <td dir="ltr">${Number(r.min_budget_usd).toLocaleString('en-US')}</td>
                    <td>{r.active ? t('admin_il_active') : t('admin_il_inactive')}</td>
                    <td className="text-end"><Button size="sm" variant="outline" onClick={() => void toggle(r)}>{r.active ? t('admin_il_deactivate') : t('admin_il_activate')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <select className="h-9 rounded-md border px-2 text-sm" value={draft.transactionType} onChange={(e) => setDraft({ ...draft, transactionType: e.target.value })} aria-label={t('admin_il_transaction')}>
                <option value="SALE">SALE</option><option value="RENT">RENT</option>
              </select>
              <input className="h-9 rounded-md border px-2 text-sm" placeholder={t('admin_il_property_type')} value={draft.propertyType} onChange={(e) => setDraft({ ...draft, propertyType: e.target.value.toUpperCase() })} />
              <input className="h-9 rounded-md border px-2 text-sm" placeholder={t('admin_il_country')} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })} />
              <input className="h-9 rounded-md border px-2 text-sm" placeholder={t('admin_il_city')} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              <input className="h-9 rounded-md border px-2 text-sm" inputMode="numeric" placeholder={t('admin_il_threshold')} value={draft.minBudgetUsd} onChange={(e) => setDraft({ ...draft, minBudgetUsd: e.target.value })} />
              <Button size="sm" disabled={saving || !(Number(draft.minBudgetUsd) > 0)} onClick={() => void save()}>{t('admin_il_save')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('admin_il_note')}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
