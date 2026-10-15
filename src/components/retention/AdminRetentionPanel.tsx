/*
 * Admin → Storage: retention lifecycle at a glance, and the read-only Dry Run.
 *
 * Both are admin-only RPCs that check is_admin() themselves. Measured values
 * (sizes, reclaimed bytes) and estimates (recoverable bytes) are labelled as
 * such. No customer content — ids and counts only. If the retention migration
 * is not applied yet, this panel says so and renders nothing else.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Play } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { formatBytes } from '@/services/retention';

type Json = Record<string, any>;

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 p-2">
      <div className="text-2xs text-muted-foreground">{label}{hint ? ` · ${hint}` : ''}</div>
      <div className="break-words text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Pairs({ data, bytes = false }: { data: Json | null | undefined; bytes?: boolean }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <span className="text-2xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="outline" className="max-w-full break-all text-2xs">
          {k} · {typeof v === 'object' && v !== null
            ? `${v.objects ?? ''}${v.bytes != null ? ` · ${formatBytes(Number(v.bytes))}` : ''}`
            : bytes ? formatBytes(Number(v)) : String(v)}
        </Badge>
      ))}
    </div>
  );
}

export function AdminRetentionPanel() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<Json | null>(null);
  const [missing, setMissing] = useState(false);
  const [dry, setDry] = useState<Json | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    supabase.rpc('retention_admin_summary').then(({ data, error }) => {
      if (error) setMissing(true); else setSummary(data as Json);
    });
  }, []);

  const runDry = useCallback(async () => {
    setRunning(true);
    const { data, error } = await supabase.rpc('retention_admin_dry_run', {});
    setRunning(false);
    setDry(error ? { error: error.message } : (data as Json));
  }, []);

  if (missing) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('rt_admin_title')}</h2>
        <p className="text-2xs text-muted-foreground">{t('rt_admin_not_installed')}</p>
      </section>
    );
  }
  if (!summary) return null;
  const cfg = summary.config ?? {};

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />{t('rt_admin_title')}
      </h2>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={cfg.purge_enabled ? 'destructive' : 'secondary'} className="text-2xs">
              {t('rt_admin_purge')}: {cfg.purge_enabled ? 'ON' : 'OFF'}
            </Badge>
            <Badge variant="outline" className="text-2xs">{t('rt_admin_effective')}: {cfg.effective_at ?? '—'}</Badge>
            <Badge variant="outline" className="text-2xs">{t('rt_admin_reminders')}: {cfg.reminders_enabled ? 'ON' : 'OFF'}</Badge>
            <Badge variant="outline" className="text-2xs">{t('rt_admin_knowledge')}: {cfg.knowledge_enabled ? 'ON' : 'OFF'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('rt_admin_expiring_7d')} value={summary.expiring_7d ?? 0} />
            <Stat label={t('rt_admin_awaiting')} value={summary.expired_awaiting_cleanup ?? 0} />
            <Stat label={t('rt_admin_recoverable')} hint={t('rt_admin_estimate')} value={formatBytes(Number(summary.estimated_recoverable_bytes ?? 0))} />
            <Stat label={t('rt_admin_reclaimed')} hint={t('rt_admin_measured')} value={formatBytes(Number(summary.reclaimed_bytes_measured ?? 0))} />
            <Stat label={t('rt_admin_legacy')} value={summary.legacy_not_expiring ?? 0} />
            <Stat label={t('rt_admin_knowledge_rows')} value={summary.knowledge?.market_observations ?? 0} />
            <Stat label={t('rt_admin_knowledge_size')} hint={t('rt_admin_measured')}
              value={formatBytes(Number(summary.knowledge?.market_observations_bytes ?? 0) + Number(summary.knowledge?.contract_insight_bytes ?? 0))} />
            <Stat label={t('rt_admin_registry_size')} hint={t('rt_admin_measured')} value={formatBytes(Number(summary.postgres?.registry_bytes ?? 0))} />
          </div>
          <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_records')}</div><Pairs data={summary.records} /></div>
          <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_objects')}</div><Pairs data={summary.objects} /></div>
          <div className="space-y-1"><div className="text-2xs font-semibold">{t('rt_admin_blocked')}</div><Pairs data={summary.blocked} /></div>
          <div className="space-y-1"><div className="text-2xs font-semibold">Supabase Storage</div><Pairs data={summary.supabase_storage} /></div>
          <div className="space-y-1"><div className="text-2xs font-semibold">Cloudflare R2</div><Pairs data={summary.r2} /></div>
          <div className="space-y-1"><div className="text-2xs font-semibold">Postgres</div><Pairs data={summary.postgres} bytes /></div>
          <div className="space-y-1">
            <div className="text-2xs font-semibold">{t('rt_admin_trend')}</div>
            {(summary.trend_30d ?? []).length === 0
              ? <span className="text-2xs text-muted-foreground">—</span>
              : <div className="flex flex-wrap gap-1.5">{summary.trend_30d.map((d: Json) => (
                  <Badge key={d.day} variant="outline" className="text-2xs">{d.day} · {d.purged} · {formatBytes(Number(d.bytes))}</Badge>))}</div>}
          </div>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={runDry} disabled={running}>
                <Play className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('rt_admin_dry_run')}
              </Button>
              <span className="text-2xs text-muted-foreground">{t('rt_admin_dry_run_hint')}</span>
            </div>
            {dry ? (
              dry.error ? <p className="text-2xs text-destructive">{String(dry.error)}</p> : (
                <div className="space-y-1">
                  <div className="text-2xs font-semibold">Verify</div>
                  <Pairs data={Object.fromEntries(Object.entries(dry.verify ?? {}).filter(([k]) => k !== 'ids'))} />
                  <div className="text-2xs font-semibold">Contracts</div>
                  <Pairs data={Object.fromEntries(Object.entries(dry.contracts ?? {}).filter(([k]) => k !== 'ids'))} />
                  <div className="text-2xs font-semibold">{t('rt_admin_orphans')}</div>
                  <Pairs data={dry.orphans} />
                  <div className="text-2xs font-semibold">{t('rt_admin_out_of_scope')}</div>
                  <Pairs data={dry.out_of_scope_shared_caches} />
                </div>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
