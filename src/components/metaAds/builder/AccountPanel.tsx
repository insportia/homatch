// The Meta connection and asset picker, shared by the builder and the
// workspace's Connections tab. Friendly names first; technical IDs only as
// secondary detail. Never a token — the status call does not return one.
import React, { useState } from 'react';
import { CheckCircle2, Link2, RefreshCw, Loader2, ShieldAlert, Unplug, Facebook } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  startMetaOAuth, mockConnect, refreshMetaAssets, selectMetaAsset, disconnectMeta,
  type MetaAsset, type MetaStatus,
} from '@/services/metaAds';

export const RETURN_KEY = 'homatch_meta_return_to';

const ACCOUNT_STATUS: Record<number, string> = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED' };

export function assetProblem(asset: MetaAsset): string | null {
  if (asset.status === 'UNAVAILABLE') return 'madsb_asset_unavailable';
  if (asset.kind === 'AD_ACCOUNT') {
    const s = Number((asset.capabilities as { account_status?: number } | undefined)?.account_status ?? 1);
    if (s !== 1) return `madsb_account_status_${(ACCOUNT_STATUS[s] ?? 'OTHER').toLowerCase()}`;
  }
  return null;
}

export function AccountPanel({ status, onChanged, returnTo, compact }: {
  status: MetaStatus | null; onChanged: () => void | Promise<void>; returnTo?: string; compact?: boolean;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const health = status?.connection?.health ?? (status?.connection?.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED');
  const connectedish = health === 'CONNECTED' || health === 'PERMISSION_MISSING';

  const connect = async () => {
    setBusy('connect');
    try {
      const r = await startMetaOAuth();
      if (r.url) {
        try { if (returnTo) localStorage.setItem(RETURN_KEY, returnTo); } catch { /* fine */ }
        window.location.href = r.url;
        return;
      }
      if (r.mockConnect) { await mockConnect(); toast.success(t('mads_connected_ok')); await onChanged(); }
    } catch { toast.error(t('mads_load_failed')); } finally { setBusy(null); }
  };
  const refresh = async () => {
    setBusy('refresh');
    try { await refreshMetaAssets(); await onChanged(); toast.success(t('madsb_assets_refreshed')); }
    catch (e: any) { toast.error(t(String(e?.message ?? '').startsWith('meta_err') ? e.message : 'mads_load_failed')); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    setBusy('disconnect');
    try { await disconnectMeta(); await onChanged(); } catch { toast.error(t('mads_load_failed')); } finally { setBusy(null); }
  };
  const pick = async (kind: string, id: string) => {
    setBusy(`pick:${id}`);
    try {
      const r = await selectMetaAsset(kind, id);
      if (kind === 'PAGE' && r.leadgenSubscribed === false) toast.warning(t('madsb_leadgen_subscribe_failed'));
      await onChanged();
    } catch { toast.error(t('mads_load_failed')); } finally { setBusy(null); }
  };

  const assets = status?.assets ?? [];
  const page = assets.find((a) => a.kind === 'PAGE' && a.selected);
  const rows: Array<{ kind: MetaAsset['kind']; label: string; hint: string; optional?: boolean; filter?: (a: MetaAsset) => boolean }> = [
    { kind: 'BUSINESS', label: 'mads_conn_business', hint: 'madsb_hint_business', optional: true },
    { kind: 'PAGE', label: 'mads_conn_page', hint: 'madsb_hint_page' },
    { kind: 'INSTAGRAM', label: 'mads_conn_instagram', hint: 'madsb_hint_instagram', optional: true,
      filter: (a) => !page || !a.parent_external_id || a.parent_external_id === page.external_id },
    { kind: 'AD_ACCOUNT', label: 'mads_conn_ad_account', hint: 'madsb_hint_ad_account' },
  ];

  return (
    <div className="space-y-3">
      <div className={cn('rounded-2xl border p-4 sm:p-5',
        health === 'CONNECTED' ? 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/[0.06]' : 'border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))]')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {health === 'CONNECTED'
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(152_54%_30%)]" />
              : health === 'NOT_CONNECTED' ? <Facebook className="mt-0.5 h-5 w-5 shrink-0 text-[#1877F2]" />
                : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(32_78%_36%)]" />}
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{t(`madsb_health_${health.toLowerCase()}` as never)}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t(`madsb_health_${health.toLowerCase()}_d` as never)}</p>
              {health === 'PERMISSION_MISSING' && (status?.connection?.missing_scopes ?? []).length > 0 && (
                <p className="mt-1 text-2xs text-muted-foreground" dir="ltr">{status?.connection?.missing_scopes?.join(' · ')}</p>
              )}
              {status?.mode === 'MOCK' && <p className="mt-1 text-2xs font-medium text-[hsl(var(--gold-ink))]">{t('madsb_mock_connection')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {connectedish && (
              <Button variant="outline" size="sm" onClick={refresh} disabled={busy !== null} className="gap-1.5">
                <RefreshCw className={cn('h-3.5 w-3.5', busy === 'refresh' && 'animate-spin')} />{t('mads_conn_refresh')}
              </Button>
            )}
            <Button size="sm" onClick={connect} disabled={busy !== null}
              className={cn('gap-1.5', health === 'NOT_CONNECTED' && 'bg-[#1877F2] text-white hover:bg-[#166FE0]')}>
              {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : health === 'NOT_CONNECTED' ? <Facebook className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {t(health === 'NOT_CONNECTED' ? 'madsb_login_facebook' : 'mads_conn_reconnect')}
            </Button>
            {connectedish && !compact && (
              <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy !== null} className="gap-1.5 text-muted-foreground">
                <Unplug className="h-3.5 w-3.5" />{t('madsb_disconnect')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {connectedish && rows.map(({ kind, label, hint, optional, filter }) => {
        const options = assets.filter((a) => a.kind === kind && (!filter || filter(a)));
        const selected = options.find((a) => a.selected);
        return (
          <div key={kind} className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-foreground">
                {t(label as never)}{optional && <span className="ms-1.5 text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span>}
              </p>
              <p className="text-2xs text-muted-foreground">{t(hint as never)}</p>
            </div>
            {options.length === 0 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {t(kind === 'AD_ACCOUNT' ? 'mads_conn_no_ad_account' : kind === 'PAGE' ? 'madsb_no_pages' : 'mads_conn_none_found')}
              </p>
            ) : (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {options.map((o) => {
                  const problem = assetProblem(o);
                  const currency = (o.capabilities as { currency?: string } | undefined)?.currency;
                  return (
                    <button key={o.id} type="button" aria-pressed={o.selected} disabled={busy !== null || o.status === 'UNAVAILABLE'}
                      onClick={() => pick(kind, o.id)}
                      className={cn('flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start text-sm transition-colors',
                        o.selected ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border hover:border-[hsl(var(--gold-border))]',
                        o.status === 'UNAVAILABLE' && 'opacity-50')}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{o.name ?? o.external_id}</span>
                        <span className="block truncate text-2xs text-muted-foreground" dir="ltr">
                          {o.external_id}{currency ? ` · ${currency}` : ''}
                        </span>
                        {problem && <span className="mt-0.5 block text-2xs font-medium text-destructive">{t(problem as never)}</span>}
                      </span>
                      {busy === `pick:${o.id}` ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                        : o.selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
            {kind === 'AD_ACCOUNT' && selected && assetProblem(selected) && (
              <p className="mt-2 text-[13px] text-destructive">{t('madsb_account_fix_in_meta')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
