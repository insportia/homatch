// ADMIN — Leads Database → Overview: catalog KPIs, the four independent matching switches,
// the curated lead price, and recent imports. Every change is confirmed, audited server-side
// and shown as done only after the server answers.
import { Coins, Database, ExternalLink, Eye, EyeOff, Globe2, Languages, Layers, RefreshCw, ShieldAlert, Users, Wallet } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Empty, ErrorNote, Field, inputClass, When } from '@/components/admin/control/AdminKit';
import { Kpi, KpiRow } from '@/components/communications/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type AdminOverview, getOverview, type MatchingControl, setCuratedPrice, setMatchingControl,
} from '@/services/curatedLeadsAdmin';
import { getWorkspaceState, type WorkspaceState } from '@/services/matchingWorkspace';
import { errorText, Notice, nf, Pill, ReasonDialog, StatusPill } from './shared';

interface ControlDef {
  control: MatchingControl;
  labelKey: string;
  descKey: string;
  value: (s: WorkspaceState) => boolean;
  /** SHOW/HIDE instead of ON/OFF. */
  visibility?: boolean;
}

const CONTROLS: ControlDef[] = [
  { control: 'INTERNAL', labelKey: 'admin_ldb_ctl_internal', descKey: 'admin_ldb_ctl_internal_desc', value: (s) => s.internal },
  { control: 'CURATED', labelKey: 'admin_ldb_ctl_curated', descKey: 'admin_ldb_ctl_curated_desc', value: (s) => s.curated },
  { control: 'UNLOCKED_LIBRARY', labelKey: 'admin_ldb_ctl_library', descKey: 'admin_ldb_ctl_library_desc', value: (s) => s.unlockedLibrary, visibility: true },
  { control: 'MAINTENANCE', labelKey: 'admin_ldb_ctl_maintenance', descKey: 'admin_ldb_ctl_maintenance_desc', value: (s) => s.maintenance },
];

export function OverviewTab({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const { t, lang } = useLanguage();
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [state, setState] = React.useState<WorkspaceState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ def: ControlDef; next: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [cents, setCents] = React.useState('');
  const [priceOpen, setPriceOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([getOverview(), getWorkspaceState()]);
      setOverview(o); setState(s); setError(null);
      setCents(o.price ? String(o.price.cents) : '10');
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => { void load(); }, [load]);

  const stateWord = (def: ControlDef, on: boolean) =>
    t(def.visibility ? (on ? 'admin_ldb_show' : 'admin_ldb_hide') : (on ? 'admin_ldb_on' : 'admin_ldb_off'));

  const applyControl = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    try {
      const next = await setMatchingControl(pending.def.control, pending.next, reason || undefined);
      setState(next);
      toast.success(t('admin_ldb_ctl_saved', { control: t(pending.def.labelKey), state: stateWord(pending.def, pending.next) }));
      setPending(null);
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const centsNum = Number(cents);
  const centsValid = Number.isInteger(centsNum) && centsNum >= 1 && centsNum <= 10000;
  const usd = (c: number) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(c / 100);

  const applyPrice = async (reason: string) => {
    setBusy(true);
    try {
      const p = await setCuratedPrice(centsNum, reason || undefined);
      toast.success(t('admin_ldb_price_saved', { usd: usd(p.cents), credits: nf(p.credits, lang) }));
      setPriceOpen(false);
      void load();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const legacy = overview?.controls.find_buyers_external;
  const legacyOn = Boolean(legacy?.backend && legacy?.frontend);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('admin_ldb_refresh')}
        </Button>
      </div>
      {error && <ErrorNote message={error} />}

      <KpiRow cols={5}>
        <Kpi labelKey="admin_ldb_kpi_total" icon={Database} loading={loading} value={overview ? nf(overview.total, lang) : null} accent />
        <Kpi labelKey="admin_ldb_kpi_published" icon={Eye} loading={loading} value={overview ? nf(overview.published, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_hidden" icon={EyeOff} loading={loading} value={overview ? nf(overview.hidden, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_unverified" icon={ShieldAlert} loading={loading} value={overview ? nf(overview.unverifiedRights, lang) : null}
             sub={t('admin_ldb_kpi_unverified_sub')} />
        <Kpi labelKey="admin_ldb_kpi_countries" icon={Globe2} loading={loading} value={overview ? nf(overview.countries, lang) : null} />
      </KpiRow>
      <KpiRow cols={4}>
        <Kpi labelKey="admin_ldb_kpi_languages" icon={Languages} loading={loading} value={overview ? nf(overview.languages, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_unlocks" icon={Layers} loading={loading} value={overview ? nf(overview.unlocks, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_buyers" icon={Users} loading={loading} value={overview ? nf(overview.buyers, lang) : null} />
        <Kpi labelKey="admin_ldb_kpi_revenue" icon={Wallet} loading={loading}
             value={overview ? t('admin_ldb_credits_n', { n: nf(overview.revenueCredits, lang) }) : null}
             sub={overview ? usd(Math.round(overview.revenueUsd * 100)) : null} />
      </KpiRow>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('admin_ldb_controls_title')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('admin_ldb_controls_hint')}</p>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {CONTROLS.map((def) => {
            const on = state ? def.value(state) : null;
            const id = `ldb-ctl-${def.control}`;
            return (
              <div key={def.control} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="block text-sm font-semibold">{t(def.labelKey)}</label>
                  <p className="text-xs text-muted-foreground">{t(def.descKey)}</p>
                </div>
                {on === null ? <Skeleton className="h-6 w-24" /> : (
                  <div className="flex items-center gap-3">
                    <Pill tone={def.control === 'MAINTENANCE' ? (on ? 'warn' : 'muted') : (on ? 'good' : 'muted')} className="min-w-[3.5rem] justify-center">
                      {stateWord(def, on)}
                    </Pill>
                    <Switch id={id} checked={on} disabled={busy || loading} onCheckedChange={(v) => setPending({ def, next: v })} />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 bg-muted/30 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('admin_ldb_legacy_title')}</p>
              <p className="text-xs text-muted-foreground">{t('admin_ldb_legacy_note')}</p>
            </div>
            {overview && <Pill tone={legacyOn ? 'warn' : 'muted'}>{t(legacyOn ? 'admin_ldb_on' : 'admin_ldb_off')}</Pill>}
            <Button asChild size="sm" variant="outline">
              <a href="/admin/service-control">{t('admin_ldb_legacy_open')}<ExternalLink className="ms-1.5 h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" /></a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t('admin_ldb_price_title')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('admin_ldb_price_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !overview ? <Skeleton className="h-10 w-full" /> : overview?.price ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('admin_ldb_price_current', { usd: usd(overview.price.cents), credits: nf(overview.price.credits, lang) })}</span>
              <Pill tone={overview.price.active ? 'good' : 'warn'}>{t(overview.price.active ? 'admin_ldb_price_active' : 'admin_ldb_price_inactive')}</Pill>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('admin_ldb_price_unknown')}</p>}
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (centsValid) setPriceOpen(true); }}>
            <div className="w-44">
              <Field label={t('admin_ldb_price_cents_label')} htmlFor="ldb-price-cents">
                <input id="ldb-price-cents" className={inputClass} inputMode="numeric" value={cents} dir="ltr"
                       onChange={(e) => setCents(e.target.value.replace(/[^0-9]/g, ''))} />
              </Field>
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              {centsValid ? t('admin_ldb_price_preview', { usd: usd(centsNum), credits: nf(centsNum / 10, lang) }) : t('admin_ldb_price_range')}
            </p>
            <Button type="submit" size="sm" disabled={!centsValid || busy || loading || centsNum === overview?.price?.cents}>
              {t('admin_ldb_price_save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin_ldb_recent_title')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading && !overview ? <div className="space-y-2 p-3">{[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            : !overview || overview.recentBatches.length === 0 ? <Empty>{t('admin_ldb_no_batches')}</Empty> : (
              <ul className="divide-y divide-border">
                {overview.recentBatches.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => onOpenBatch(b.id)}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                      <span className="min-w-[10rem] flex-1">
                        <span className="block truncate text-sm font-medium">{b.name}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {t('admin_ldb_counts', { total: nf(b.total_rows, lang), valid: nf(b.valid_rows, lang), invalid: nf(b.invalid_rows, lang), duplicate: nf(b.duplicate_rows, lang), imported: nf(b.imported_rows, lang) })}
                        </span>
                      </span>
                      <StatusPill status={b.status} />
                      {!b.rights_verified && <Pill tone="warn">{t('admin_ldb_rights_unverified')}</Pill>}
                      <span className="text-2xs text-muted-foreground"><When at={b.created_at} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </CardContent>
      </Card>

      <ReasonDialog
        open={pending !== null}
        onOpenChange={(v) => { if (!v) setPending(null); }}
        title={pending ? t('admin_ldb_ctl_confirm_title', { control: t(pending.def.labelKey), state: stateWord(pending.def, pending.next) }) : ''}
        description={pending ? t(pending.def.control === 'MAINTENANCE'
          ? (pending.next ? 'admin_ldb_ctl_maint_on_warn' : 'admin_ldb_ctl_maint_off_desc')
          : pending.next ? 'admin_ldb_ctl_confirm_on' : 'admin_ldb_ctl_confirm_off', { control: t(pending.def.labelKey) }) : undefined}
        confirmLabel={pending ? t('admin_ldb_ctl_confirm_btn', { state: stateWord(pending.def, pending.next) }) : ''}
        destructive={pending?.def.control === 'MAINTENANCE' ? pending.next : pending?.next === false}
        busy={busy}
        onConfirm={(r) => void applyControl(r)}
      >
        {pending?.def.control === 'MAINTENANCE' && pending.next && <Notice tone="warn">{t('admin_ldb_ctl_maint_on_note')}</Notice>}
      </ReasonDialog>

      <ReasonDialog
        open={priceOpen}
        onOpenChange={setPriceOpen}
        title={t('admin_ldb_price_confirm_title')}
        description={t('admin_ldb_price_confirm_desc', { old: overview?.price ? usd(overview.price.cents) : '—', new: centsValid ? usd(centsNum) : '—' })}
        confirmLabel={t('admin_ldb_price_save')}
        busy={busy}
        onConfirm={(r) => void applyPrice(r)}
      />
    </div>
  );
}
