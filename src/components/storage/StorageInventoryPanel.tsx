// HOMATCH — Admin → Storage → "Storage by service".
//
// Cloudflare's dashboard can browse R2 by prefix; it cannot say which service
// a file belongs to or how much each service holds. This panel answers that
// from the database indexes, and holds the one per-bucket switch that moves
// NEW uploads to R2 (existing files are never moved or deleted from here).
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Database } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollTable } from '@/components/communications/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatBytes } from '@/services/adminStorage';
import {
  r2ByService, serviceOf, setWriteTarget, storageInventory, type StorageInventory, type Store,
} from '@/services/storageInventory';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
const svcKey = (s: string) => `sinv_svc_${s}` as TKey;

export function StorageInventoryPanel() {
  const { t } = useLanguage();
  const [inv, setInv] = useState<StorageInventory | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setInv(await storageInventory()), []);
  useEffect(() => { void load(); }, [load]);

  if (inv === undefined) return null;
  if (inv === null) {
    return <p className="text-xs text-muted-foreground">{t('sinv_unavailable')}</p>;
  }

  const toggle = async (bucket: string, next: Store) => {
    const msg = t(next === 'R2' ? 'sinv_confirm_r2' : 'sinv_confirm_supabase').replace('{{bucket}}', bucket);
    if (!window.confirm(msg)) return;
    setBusy(bucket);
    try {
      await setWriteTarget(bucket, next, 'Admin → Storage');
      toast.success(t('sinv_switched').replace('{{target}}', t(next === 'R2' ? 'sinv_store_r2' : 'sinv_store_supabase')));
      await load();
    } catch {
      toast.error(t('sinv_switch_failed'));
    } finally {
      setBusy(null);
    }
  };

  const services = r2ByService(inv.r2);
  const files = (n: number) => t('sinv_files').replace('{{count}}', n.toLocaleString());

  return (
    <section className="space-y-3" aria-labelledby="sinv-title">
      <div>
        <h2 id="sinv-title" className="text-sm font-semibold">{t('sinv_title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('sinv_subtitle')}</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Card><CardContent className="flex items-center gap-3 p-3">
          <Cloud className="h-5 w-5 shrink-0 text-gold-ink" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground">{t('sinv_r2_total')}</div>
            <div className="truncate text-lg font-semibold tabular-nums">{formatBytes(Number(inv.totals.r2_bytes))}</div>
            <div className="text-2xs text-muted-foreground">{files(Number(inv.totals.r2_objects))}</div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-3">
          <Database className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-2xs text-muted-foreground">{t('sinv_supabase_total')}</div>
            <div className="truncate text-lg font-semibold tabular-nums">{formatBytes(Number(inv.totals.supabase_bytes))}</div>
            <div className="text-2xs text-muted-foreground">{files(Number(inv.totals.supabase_objects))}</div>
          </div>
        </CardContent></Card>
      </div>

      <h3 className="text-xs font-semibold">{t('sinv_r2_by_service')}</h3>
      <ScrollTable minWidth={560}>
        <table className="w-full text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t('sinv_col_service')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('sinv_col_prefix')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('sinv_col_files')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('sinv_col_size')}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.service} className="border-t border-border/50">
                <td className="px-3 py-2 font-medium">{t(svcKey(s.service))}</td>
                <td className="px-3 py-2"><span dir="ltr" className="font-mono text-2xs text-muted-foreground">{s.prefixes.join('  ')}</span></td>
                <td className="px-3 py-2 text-end tabular-nums">{s.objects.toLocaleString()}</td>
                <td className="px-3 py-2 text-end tabular-nums">{formatBytes(s.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      <h3 className="text-xs font-semibold">{t('sinv_supabase_buckets')}</h3>
      <ScrollTable minWidth={680}>
        <table className="w-full text-xs">
          <thead className="bg-secondary/60 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t('sinv_col_bucket')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('sinv_col_service')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('sinv_col_files')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('sinv_col_size')}</th>
              <th className="px-3 py-2 text-end font-medium">{t('sinv_col_copied')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('sinv_col_new_uploads')}</th>
            </tr>
          </thead>
          <tbody>
            {inv.supabase.map((b) => {
              const routable = b.bucket in inv.routing;
              const target = inv.routing[b.bucket];
              return (
                <tr key={b.bucket} className="border-t border-border/50">
                  <td className="px-3 py-2"><span dir="ltr" className="font-mono text-2xs">{b.bucket}</span></td>
                  <td className="px-3 py-2">{t(svcKey(serviceOf(b.bucket)))}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{Number(b.objects).toLocaleString()}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatBytes(Number(b.bytes))}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{Number(b.copied_to_r2).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {routable ? (
                      <label className="flex items-center gap-2">
                        <Switch checked={target === 'R2'} disabled={busy === b.bucket}
                          onCheckedChange={(on) => void toggle(b.bucket, on ? 'R2' : 'SUPABASE')}
                          aria-label={`${t('sinv_col_new_uploads')} ${b.bucket}`} />
                        <Badge variant={target === 'R2' ? 'default' : 'outline'} className="text-2xs">
                          {t(target === 'R2' ? 'sinv_store_r2' : 'sinv_store_supabase')}
                        </Badge>
                      </label>
                    ) : (
                      <span className="text-2xs text-muted-foreground">{t('sinv_not_routable')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-2xs text-muted-foreground">{t('sinv_cost_note')}</p>
    </section>
  );
}
