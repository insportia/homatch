// HOMATCH Admin — the levers that run the business.
//
// WHAT THIS REPLACED
//
// PlanCatalogue, which edited the price, the monthly credit grant and the
// profit-share of FREE, VIP and PREMIUM. There are no plans, so there is
// nothing there to edit; and the pricing controls that remain on this page
// were written in untranslated English as "Base — POTENTIAL" and
// "Multiplier — COGS".
//
// WHAT IT IS INSTEAD
//
// Each control is named after the DECISION rather than the column, and the
// line underneath says what moves when you move it -- including, where it
// matters, what does NOT move. "Changing this does not touch balances anyone
// already holds" is the sentence that lets somebody edit the first field
// without being afraid of it.
//
// EVERY VALUE IS A ROW IN admin_settings, written through admin_set_setting,
// which audits who changed what. Nothing here writes a table directly.
//
// THE PAYMENT SECTION IS READ-ONLY, AND THAT IS THE POINT
//
// Provider capabilities are facts about what an adapter can do, declared in
// the adapter. Making them editable would let an operator tick "can save a
// card without charging it" for an API with no such call, and the first
// person to discover the lie would be a customer.

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, Loader2, AlertTriangle, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { getAdminSettings, updateAdminSetting } from '@/services/api';
import { getPaymentCapabilities, type ProviderCapabilityReport } from '@/services/billing';

/**
 * A control, described once.
 *
 * `toStored` and `fromStored` exist because the friendly unit and the stored
 * unit are not always the same: an owner thinks in dollars and percentages,
 * admin_settings holds cents and basis points. Doing that conversion here,
 * declaratively, is what keeps it out of six different onChange handlers.
 */
type Control = {
  key: string;
  labelKey: TranslationKey;
  hintKey?: TranslationKey;
  kind: 'number' | 'switch' | 'list';
  suffix?: string;
  fromStored?: (v: unknown) => string;
  toStored?: (v: string) => unknown;
};

const GROUPS: Array<{ titleKey: TranslationKey; controls: Control[] }> = [
  {
    titleKey: 'owner_group_credits',
    controls: [
      { key: 'credits_per_usd', labelKey: 'owner_f_credits_per_usd', hintKey: 'owner_h_credits_per_usd', kind: 'number' },
      {
        key: 'billing_min_topup_cents',
        labelKey: 'owner_f_min_topup',
        hintKey: 'owner_h_min_topup',
        kind: 'number',
        suffix: '$',
        fromStored: (v) => (Number(v ?? 0) / 100).toString(),
        toStored: (v) => Math.round(Number(v) * 100),
      },
    ],
  },
  {
    titleKey: 'owner_group_welcome',
    controls: [
      { key: 'card_activation_bonus_enabled', labelKey: 'owner_f_welcome_enabled', kind: 'switch' },
      { key: 'card_activation_bonus_credits', labelKey: 'owner_f_welcome_credits', hintKey: 'owner_h_welcome_credits', kind: 'number' },
      { key: 'card_activation_reminder_cooldown_hours', labelKey: 'owner_f_welcome_cooldown', kind: 'number' },
      { key: 'card_activation_max_reminders', labelKey: 'owner_f_welcome_max_reminders', hintKey: 'owner_h_welcome_reminders', kind: 'number' },
    ],
  },
  {
    titleKey: 'owner_group_budgets',
    controls: [
      {
        key: 'search_budget_presets',
        labelKey: 'owner_f_budget_presets',
        hintKey: 'owner_h_budget_presets',
        kind: 'list',
        fromStored: (v) => (Array.isArray(v) ? v.join(', ') : ''),
        /* Anything that is not a positive number is dropped rather than
           stored as NaN, and the result is sorted so the ladder is always
           presented low to high however it was typed. */
        toStored: (v) => v.split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b),
      },
      { key: 'search_budget_recommended', labelKey: 'owner_f_budget_recommended', kind: 'number' },
      { key: 'search_budget_allow_custom', labelKey: 'owner_f_budget_custom', kind: 'switch' },
    ],
  },
  {
    titleKey: 'owner_group_margins',
    controls: [
      {
        key: 'billing_min_gross_margin_bps',
        labelKey: 'owner_f_min_margin',
        hintKey: 'owner_h_min_margin',
        kind: 'number',
        suffix: '%',
        fromStored: (v) => (Number(v ?? 0) / 100).toString(),
        toStored: (v) => Math.round(Number(v) * 100),
      },
    ],
  },
];

export function OwnerControls() {
  const { t } = useLanguage();
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [caps, setCaps] = React.useState<ProviderCapabilityReport | null>(null);

  React.useEffect(() => {
    let alive = true;
    void Promise.all([getAdminSettings(), getPaymentCapabilities()]).then(([rows, report]) => {
      if (!alive) return;
      const map: Record<string, unknown> = {};
      for (const row of rows) map[row.key] = row.value;
      setValues(map);
      const next: Record<string, string> = {};
      for (const g of GROUPS) {
        for (const c of g.controls) {
          if (c.kind === 'switch') continue;
          next[c.key] = c.fromStored ? c.fromStored(map[c.key]) : String(map[c.key] ?? '');
        }
      }
      setDrafts(next);
      setCaps(report);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const save = async (c: Control, raw: string | boolean) => {
    setSaving(c.key);
    try {
      const next = typeof raw === 'boolean' ? raw : (c.toStored ? c.toStored(raw) : Number(raw));
      await updateAdminSetting(c.key, next, 'Owner controls');
      setValues((v) => ({ ...v, [c.key]: next }));
      if (typeof raw !== 'boolean' && c.fromStored) {
        setDrafts((d) => ({ ...d, [c.key]: c.fromStored!(next) }));
      }
      toast.success(t('owner_saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="owner-controls">
      <h2 id="owner-controls" className="text-sm font-semibold text-foreground">
        {t('owner_controls_title')}
      </h2>

      {GROUPS.map((group) => (
        <Card key={group.titleKey}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{t(group.titleKey)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            {group.controls.map((c) => {
              const isSwitch = c.kind === 'switch';
              const on = values[c.key] === true || values[c.key] === 'true';
              return (
                <div key={c.key} className="space-y-1.5">
                  {isSwitch ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Label htmlFor={c.key} className="min-w-0 flex-1 text-sm font-normal leading-snug">
                        {t(c.labelKey)}
                      </Label>
                      <Switch
                        id={c.key}
                        checked={on}
                        disabled={saving === c.key}
                        onCheckedChange={(next) => void save(c, next)}
                      />
                    </div>
                  ) : (
                    <>
                      <Label htmlFor={c.key} className="text-sm font-normal">{t(c.labelKey)}</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={c.key}
                          dir="ltr"
                          inputMode={c.kind === 'list' ? 'text' : 'decimal'}
                          className="h-9 w-full min-w-[8rem] flex-1 sm:max-w-[16rem]"
                          value={drafts[c.key] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                        />
                        {c.suffix && <span className="text-sm text-muted-foreground">{c.suffix}</span>}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saving === c.key}
                          onClick={() => void save(c, drafts[c.key] ?? '')}
                        >
                          {saving === c.key
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            : t('owner_save')}
                        </Button>
                      </div>
                    </>
                  )}
                  {c.hintKey && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{t(c.hintKey)}</p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <PaymentCapabilities report={caps} />
    </section>
  );
}

/** Three states, and "not verified" is one of them. */
function CapabilityRow({ labelKey, value, noteKey }: {
  labelKey: TranslationKey; value: boolean | 'unknown'; noteKey?: TranslationKey;
}) {
  const { t } = useLanguage();
  const Icon = value === true ? Check : value === false ? AlertTriangle : HelpCircle;
  const tone = value === true
    ? 'text-[#12A06B]'
    : value === false ? 'text-destructive' : 'text-muted-foreground';
  const label = value === true
    ? 'owner_cap_supported'
    : value === false ? 'owner_cap_unsupported' : 'owner_cap_unknown';
  return (
    <div className="border-t border-border py-2.5 first:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-sm text-foreground">{t(labelKey)}</span>
        <span className={`flex items-center gap-1.5 text-xs ${tone}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(label as TranslationKey)}
        </span>
      </div>
      {noteKey && <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t(noteKey)}</p>}
    </div>
  );
}

function PaymentCapabilities({ report }: { report: ProviderCapabilityReport | null }) {
  const { t } = useLanguage();
  if (!report) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t('owner_group_payments')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{t('owner_provider_none')}</p>
        </CardContent>
      </Card>
    );
  }

  const c = report.capabilities;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {t('owner_group_payments')}
          <Badge variant={c.simulated ? 'destructive' : 'outline'} className="font-mono text-2xs" dir="ltr">
            {report.provider}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {c.simulated && (
          <p className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
            {t('owner_provider_simulated')}
          </p>
        )}
        <div>
          <CapabilityRow labelKey="owner_cap_zero_setup" value={c.zeroAmountSetup} />
          <CapabilityRow labelKey="owner_cap_reusable" value={c.reusablePaymentMethod} />
          <CapabilityRow labelKey="owner_cap_refunds" value={c.refunds} />
          <CapabilityRow labelKey="owner_cap_invoice" value={c.legalInvoice} noteKey="owner_cap_invoice_note" />
        </div>
        {/* The adapter's own words about what it has and has not proved.
            Untranslated on purpose: it names environment variables and
            provider behaviour, and it is written for whoever operates them. */}
        {c.notes && (
          <p dir="ltr" className="mt-3 border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
            {c.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
