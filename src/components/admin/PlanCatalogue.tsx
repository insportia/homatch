import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { listPlansForAdmin, updatePlan, type PlanPatch } from '@/services/billing';
import type { BillingPlanRow } from '@/types/billing';

/**
 * THE PRICE CARD, EDITABLE.
 *
 * WHAT THIS IS FOR
 *
 * /pricing renders billing_plans. Until now the only way to change a plan
 * name, a price, a monthly Credit grant, the "Most Popular" badge, the order
 * of the cards or whether a plan appears at all was to edit a seed and ship.
 * The commercial packaging is still being decided, so that made every pricing
 * decision a deploy.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *
 * Add a plan, remove a plan, rename a plan's CODE, or touch the internal
 * margin lever. Those are not missing features:
 *
 *   A plan's code is the value user_subscriptions and
 *   product_plan_entitlements join on. Changing it in place orphans every row
 *   that points at it, and a new plan without its entitlement rows is a plan
 *   that entitles nobody to anything. Both belong in a migration, next to the
 *   rows they need.
 *
 *   profit_share_to_customer_bps is internal economics. It is not readable by
 *   a customer and not writable from a browser.
 *
 * The database enforces all of that with column-scoped grants, so this form
 * is the convenient shape of the rule rather than the rule itself.
 *
 * PRICES ARE NOT SET HERE EITHER
 *
 * The figures below are whatever is currently in the catalogue. Nothing in
 * this product proposes a price: the owner decides them, types them here, and
 * the public page follows within one page load.
 */
export function PlanCatalogue() {
  const { t } = useLanguage();
  const [plans, setPlans] = useState<BillingPlanRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PlanPatch>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    listPlansForAdmin()
      .then(setPlans)
      .catch((e: Error) => { setFailed(e.message); setPlans([]); });
  }, []);

  const patch = (code: string, next: PlanPatch) =>
    setDrafts(d => ({ ...d, [code]: { ...d[code], ...next } }));

  const value = <K extends keyof PlanPatch>(plan: BillingPlanRow, key: K): PlanPatch[K] => {
    const draft = drafts[plan.code];
    if (draft && key in draft) return draft[key];
    return (plan as unknown as PlanPatch)[key];
  };

  const dirty = (code: string) => Object.keys(drafts[code] ?? {}).length > 0;

  const save = async (plan: BillingPlanRow) => {
    const next = drafts[plan.code];
    if (!next) return;
    setSaving(plan.code);
    try {
      await updatePlan(plan.code, next);
      setPlans(list => (list ?? []).map(p => (p.code === plan.code ? { ...p, ...next } as BillingPlanRow : p)));
      setDrafts(d => { const { [plan.code]: _drop, ...rest } = d; return rest; });
      toast.success(`${plan.code} saved`);
    } catch (e) {
      // The message is shown rather than swallowed: the likeliest failure is a
      // privilege error, and "it did not save" without saying why is the kind
      // of thing an admin retries five times.
      toast.error(e instanceof Error ? e.message : t('admin_plans_read_failed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin_plans_title')}</CardTitle>
        <CardDescription>{t('admin_plans_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plans === null && <Skeleton className="h-40 w-full" />}

        {failed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {t('admin_plans_read_failed')}: {failed}
          </p>
        )}

        {plans?.map(plan => (
          <div key={plan.code} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[13px] uppercase tracking-widest text-muted-foreground">
                  {plan.code}
                </p>
                <p className="truncate text-base font-semibold text-foreground">
                  {String(value(plan, 'name') ?? plan.name)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {value(plan, 'enabled') ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <Switch
                    checked={Boolean(value(plan, 'enabled'))}
                    onCheckedChange={v => patch(plan.code, { enabled: v })}
                    aria-label={`${plan.code} — ${t('admin_plans_visible')}`}
                  />
                </span>
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={!dirty(plan.code) || saving === plan.code}
                  onClick={() => void save(plan)}
                >
                  {saving === plan.code
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Save className="h-4 w-4" />}
                  {t('admin_plans_save')}
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('admin_plans_f_name')} hint={t('admin_plans_h_name')}>
                <Input
                  value={String(value(plan, 'name') ?? '')}
                  onChange={e => patch(plan.code, { name: e.target.value })}
                />
              </Field>
              <Field label={t('admin_plans_f_price')} hint={t('admin_plans_h_price')}>
                <Input
                  type="number"
                  min={0}
                  value={Number(value(plan, 'monthly_price_cents') ?? 0)}
                  onChange={e => patch(plan.code, { monthly_price_cents: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('admin_plans_f_credits')} hint={t('admin_plans_h_credits')}>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={Number(value(plan, 'membership_credits_grant') ?? 0)}
                  onChange={e => patch(plan.code, { membership_credits_grant: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('admin_plans_f_rollover')} hint={t('admin_plans_h_rollover')}>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={Number(value(plan, 'membership_rollover_cap') ?? 0)}
                  onChange={e => patch(plan.code, { membership_rollover_cap: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('admin_plans_f_tier')} hint={t('admin_plans_h_tier')}>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={String(value(plan, 'quality_tier') ?? 'STANDARD')}
                  onChange={e => patch(plan.code, { quality_tier: e.target.value as BillingPlanRow['quality_tier'] })}
                  aria-label={`${plan.code} — ${t('admin_plans_f_tier')}`}
                >
                  <option value="STANDARD">STANDARD</option>
                  <option value="ENHANCED">ENHANCED</option>
                  <option value="MAXIMUM">MAXIMUM</option>
                </select>
              </Field>
              <Field label={t('admin_plans_f_priority')} hint={t('admin_plans_h_priority')}>
                <Input
                  type="number"
                  min={0}
                  value={Number(value(plan, 'priority_level') ?? 0)}
                  onChange={e => patch(plan.code, { priority_level: Number(e.target.value) })}
                />
              </Field>
              <Field label={t('admin_plans_f_label')} hint={t('admin_plans_h_label')}>
                <Input
                  value={String(value(plan, 'marketing_label_key') ?? '')}
                  onChange={e => patch(plan.code, { marketing_label_key: e.target.value || null })}
                />
              </Field>
              <Field label={t('admin_plans_f_badge')} hint={t('admin_plans_h_badge')}>
                <Input
                  value={String(value(plan, 'badge_key') ?? '')}
                  onChange={e => patch(plan.code, { badge_key: e.target.value || null })}
                />
              </Field>
              <Field label={t('admin_plans_f_sort')} hint={t('admin_plans_h_sort')}>
                <Input
                  type="number"
                  value={Number(value(plan, 'sort_order') ?? 0)}
                  onChange={e => patch(plan.code, { sort_order: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        ))}

        {plans?.length === 0 && !failed && (
          <p className="text-sm text-muted-foreground">
            {t('admin_plans_empty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Label className="text-sm">{label}</Label>
      {children}
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}
