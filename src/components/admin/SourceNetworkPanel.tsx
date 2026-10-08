// FIND BUYERS / FIND TENANTS — the source network tab of the admin center.
//
// Keeps the distinctions that decide coverage apart: a DISCOVERED community is
// unproven, VERIFIED means a real read proved it public, ACTIVE means it is
// switched on, READ means it was actually read. The posting directory is shown
// on its own line: listed communities are never read. Data comes from
// admin_find_buyers_source_network (admin-gated, read-only).

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getSourceNetwork, type SourceNetwork } from '@/services/findBuyers';
import { citiesMentioned } from '@/research-core/discovery/sourceNetwork';

const n = (v: unknown) => Number(v ?? 0) || 0;
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');

function Grid({ head, rows, testId }: { head: string[]; rows: React.ReactNode[][]; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border" data-testid={testId}>
      <table className="w-full min-w-[720px] text-2xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>{head.map((h) => <th key={h} className="px-2.5 py-2 text-start font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="px-2.5 py-3 text-muted-foreground" colSpan={head.length}>—</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60 align-top">{r.map((c, j) => <td key={j} className="px-2.5 py-2">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceNetworkPanel({ days }: { days: number }) {
  const { t } = useLanguage();
  const [data, setData] = useState<SourceNetwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getSourceNetwork(days > 0 ? days : 30);
      /* Anything but the function's own shape (e.g. before the migration) is "not available", never a crash. */
      if (!next || !Array.isArray(next.platforms) || !Array.isArray(next.campaigns) || !Array.isArray(next.telegram) || !Array.isArray(next.directory)) {
        setData(null);
        setError('UNAVAILABLE');
      } else setData(next);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <div className="mt-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (error || !data) return <p className="mt-4 text-sm text-destructive" data-testid="fbx-net-error">{t('fbx_net_unavailable')}</p>;

  const total = data.platforms.reduce((acc, p) => ({
    discovered: acc.discovered + n(p.discovered), verified: acc.verified + n(p.verified), active: acc.active + n(p.active), read: acc.read + n(p.read),
  }), { discovered: 0, verified: 0, active: 0, read: 0 });

  return (
    <div className="mt-4 space-y-4" data-testid="fbx-source-network">
      <p className="text-2xs text-muted-foreground">{t('fbx_net_explain')}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(['discovered', 'verified', 'active', 'read'] as const).map((k) => (
          <div key={k} className="rounded-xl border border-border bg-background/40 p-3" data-testid={`fbx-net-total-${k}`}>
            <p className="text-2xs text-muted-foreground">{t(`fbx_net_${k}`)}</p>
            <p className="mt-1 font-display text-lg font-semibold tabular-nums" dir="ltr">{total[k].toLocaleString()}</p>
          </div>
        ))}
      </div>
      <p className="rounded-lg border border-border px-3 py-2 text-2xs" data-testid="fbx-net-autoenable">
        {t(data.autoEnable === true ? 'fbx_net_autoenable_on' : 'fbx_net_autoenable_off')}
      </p>

      <Grid testId="fbx-net-platforms"
        head={[t('fbx_net_platform'), t('fbx_net_discovered'), t('fbx_net_verified'), t('fbx_net_active'), t('fbx_net_read'), t('fbx_net_inactive'), t('fbx_net_blocked'), t('fbx_net_new'), t('fbx_net_items'), t('fbx_net_demand'), t('fbx_net_last_read')]}
        rows={data.platforms.map((p) => [
          <span key="p" className="font-semibold">{p.platform}</span>, n(p.discovered), n(p.verified), n(p.active), n(p.read), n(p.inactive), n(p.blocked),
          n(p.newInWindow), n(p.itemsRead) + n(p.commentsRead), n(p.demandSignals), when(p.lastRead),
        ])} />
      {data.directory.length ? (
        <p className="text-2xs text-muted-foreground" data-testid="fbx-net-directory">
          {t('fbx_net_directory', { list: data.directory.map((d) => `${d.platform} ${n(d.listed)}`).join(' · ') })}
        </p>
      ) : null}

      <h3 className="pt-2 text-xs font-semibold">{t('fbx_net_campaigns')}</h3>
      <Grid testId="fbx-net-campaigns"
        head={[t('fbx_net_when'), t('fbx_net_city'), t('fbx_net_languages'), t('fbx_net_found'), t('fbx_net_registered'), t('fbx_net_audited'), t('fbx_net_verified'), t('fbx_net_activated'), t('fbx_net_read_now')]}
        rows={data.campaigns.map((c) => [
          when(c.at), c.city ?? '—', Array.isArray(c.languages) && c.languages.length ? c.languages.join(', ') : '—',
          n(c.communitiesFound), n(c.newlyRegistered), c.audited ?? '—', c.verified ?? '—', c.activated ?? '—', c.readNow ?? '—',
        ])} />

      <h3 className="pt-2 text-xs font-semibold">{t('fbx_net_telegram')}</h3>
      <Grid testId="fbx-net-telegram"
        head={[t('fbx_net_name'), t('fbx_net_city'), t('fbx_net_state'), t('fbx_net_audit'), t('fbx_net_items'), t('fbx_net_demand'), t('fbx_net_last_read')]}
        rows={data.telegram.map((c) => [
          <a key="h" href={`https://t.me/${c.handle}`} target="_blank" rel="noopener noreferrer nofollow" className="underline" dir="auto">{c.name ?? c.handle}</a>,
          citiesMentioned(`${c.name ?? ''} ${c.handle}`).join(', ') || '—',
          `${c.lifecycle}${c.enabled ? ' · ON' : ''}`,
          <span key="a" dir="auto">{c.auditReason ?? '—'}</span>,
          n(c.itemsRead), n(c.demandFound), when(c.lastSuccessAt),
        ])} />
    </div>
  );
}

export default SourceNetworkPanel;
