import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { getAdminSignals } from '@/services/api';
import { supabase } from '@/db/supabase';
import { format } from 'date-fns';
import { RefreshCw, RotateCcw, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

const STATUSES = ['ALL', 'PENDING', 'CLASSIFIED', 'FILTERED_OUT', 'ERROR', 'NOISE'];
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  CLASSIFIED: 'default',
  PENDING: 'secondary',
  REJECTED: 'destructive',
  FILTERED_OUT: 'destructive',
  ERROR: 'destructive',
  NOISE: 'outline',
};

function SignalDetailModal({ signal, onClose }: { signal: any; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{t('admin_signals_detail_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">ID</p>
              <p className="font-mono text-[11px] break-all">{signal.id}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{t('admin_signals_status')}</p>
              <Badge variant={STATUS_VARIANT[signal.classification_status] ?? 'outline'} className="text-[10px]">
                {signal.classification_status ?? '—'}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{t('admin_signals_platform')}</p>
              <p>{signal.platform ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{t('admin_signals_language')}</p>
              <p>{signal.language ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{t('admin_signals_discovered')}</p>
              <p>{signal.discovered_at ? format(new Date(signal.discovered_at), 'MMM d yyyy, HH:mm') : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{t('admin_signals_filter_classified')}</p>
              <p>{signal.classified_at ? format(new Date(signal.classified_at), 'MMM d yyyy, HH:mm') : '—'}</p>
            </div>
          </div>

          <div>
            <p className="text-muted-foreground font-medium uppercase tracking-wide mb-1">{t('admin_signals_raw_text')}</p>
            <div className="rounded-lg bg-secondary/50 border border-border p-3 max-h-40 overflow-y-auto">
              <p className="whitespace-pre-wrap leading-relaxed">{signal.raw_text ?? '—'}</p>
            </div>
          </div>

          {signal.intent_json && (
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-1">{t('admin_signals_intent_json')}</p>
              <pre className="rounded-lg bg-secondary/50 border border-border p-3 max-h-64 overflow-auto text-[11px] font-mono leading-relaxed">
                {JSON.stringify(signal.intent_json, null, 2)}
              </pre>
            </div>
          )}

          {signal.error_message && (
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-1">{t('admin_diagnostics_error')}</p>
              <p className="text-destructive bg-destructive/10 rounded-lg p-2">{signal.error_message}</p>
            </div>
          )}

          {signal.rejection_reason && (
            <div>
              <p className="text-muted-foreground font-medium uppercase tracking-wide mb-1">{t('admin_signals_rejection_reason')}</p>
              <p className="text-amber-400 bg-amber-500/10 rounded-lg p-2">{signal.rejection_reason}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 100;

export default function AdminSignalsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState('ALL');
  const [reprocessing, setReprocessing] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<any | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = () => {
    setLoading(true);
    getAdminSignals(PAGE_SIZE, 0, status === 'ALL' ? undefined : status)
      .then(data => {
        setItems(data);
        setHasMore(data.length === PAGE_SIZE);
      }).finally(() => setLoading(false));
  };

  const loadMore = () => {
    setLoadingMore(true);
    getAdminSignals(PAGE_SIZE, items.length, status === 'ALL' ? undefined : status)
      .then(data => {
        setItems(prev => [...prev, ...data]);
        setHasMore(data.length === PAGE_SIZE);
      }).finally(() => setLoadingMore(false));
  };

  useEffect(load, [status]);

  const failedCount = items.filter(s =>
    s.classification_status === 'ERROR' || s.classification_status === 'FILTERED_OUT'
  ).length;

  const handleReprocess = async () => {
    setReprocessing(true);
    try {
      // First reset ERROR/FILTERED_OUT signals back to PENDING so classifier picks them up
      const { error: resetErr } = await supabase
        .from('raw_signals')
        .update({ classification_status: 'PENDING', error_message: null, classified_at: null })
        .in('classification_status', ['ERROR', 'FILTERED_OUT']);
      if (resetErr) throw resetErr;

      // Trigger classify-signals-v2 EF
      const { error: efErr } = await supabase.functions.invoke('classify-signals-v2', {
        body: { batchSize: 200, market: 'GE' },
      });
      if (efErr) throw efErr;

      toast.success('Reprocessing started — signals reset to PENDING and classifier triggered.');
      setTimeout(() => load(), 3000); // refresh after a moment
    } catch (e: any) {
      toast.error(`Reprocess failed: ${e.message ?? String(e)}`);
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('admin_signals_title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('admin_signals_subtitle', { count: items.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('admin_refresh')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            onClick={handleReprocess}
            disabled={reprocessing || failedCount === 0}
            title={failedCount === 0 ? t('admin_signals_no_failed_tooltip') : t('admin_signals_requeue_tooltip', { count: failedCount })}
          >
            {reprocessing
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <RotateCcw className="h-3.5 w-3.5" />}
            {t('admin_signals_reprocess_btn')}
            {failedCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/40 text-amber-500 ml-0.5">
                {failedCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <Button key={s} variant={status === s ? 'default' : 'outline'} size="sm"
            className="text-xs" onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_excerpt')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_platform')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_lang_short')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_status')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_discovered')}</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{t('admin_signals_action')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : items.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('admin_signals_empty')}</td></tr>
                ) : items.map(s => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedSignal(s)}>
                    <td className="px-4 py-2.5 max-w-[280px]">
                      <p className="text-xs truncate">{s.raw_text?.slice(0, 110) ?? '—'}</p>
                      {s.error_message && (
                        <p className="text-[10px] text-destructive truncate mt-0.5">{s.error_message.slice(0, 60)}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px]">{s.platform ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{s.language ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge variant={STATUS_VARIANT[s.classification_status] ?? 'outline'} className="text-[10px]">
                        {s.classification_status ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {s.discovered_at ? format(new Date(s.discovered_at), 'MMM d, HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        onClick={e => { e.stopPropagation(); setSelectedSignal(s); }}
                        title={t('admin_signals_view_details')}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {hasMore && !loading && items.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={loadMore} disabled={loadingMore}>
            <RefreshCw className={`h-3.5 w-3.5 ${loadingMore ? 'animate-spin' : ''}`} />
            {loadingMore ? t('general_loading') : t('admin_signals_load_more', { count: items.length })}
          </Button>
        </div>
      )}

      {selectedSignal && (
        <SignalDetailModal signal={selectedSignal} onClose={() => setSelectedSignal(null)} />
      )}
    </div>
  );
}
