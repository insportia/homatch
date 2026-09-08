// HOMATCH — admin: renovation price book and market survey review.
//
// This is the workflow that turns collected market evidence into prices a
// customer may actually be shown. Nothing reaches the calculator until an
// admin has verified an item AND published the version it belongs to, and
// both of those are refused by the database if the evidence is missing.
//
// The page deliberately shows the honest current state: version 1 is a DRAFT
// of provisional items, so the publish button explains why it cannot be used
// rather than being hidden.
import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import {
  listPriceVersions, listPriceItems, listObservations, reviewObservation,
  publishPriceVersion, setPriceItemStatus,
  type PriceVersionRecord, type PriceItemRecord, type PriceObservationRecord,
} from '@/services/renovationPricing';

const STATUS_KEY: Record<string, string> = {
  PROVISIONAL: 'admin_pb_status_provisional',
  VERIFIED: 'admin_pb_status_verified',
  STALE: 'admin_pb_status_stale',
  REJECTED: 'admin_pb_status_rejected',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PROVISIONAL: 'secondary',
  VERIFIED: 'default',
  STALE: 'outline',
  REJECTED: 'destructive',
};

const AdminPriceBookPage: React.FC = () => {
  const { t } = useLanguage();
  const [versions, setVersions] = useState<PriceVersionRecord[]>([]);
  const [items, setItems] = useState<PriceItemRecord[]>([]);
  const [observations, setObservations] = useState<PriceObservationRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const v = await listPriceVersions();
    setVersions(v);
    const target = selected ?? v[0]?.id ?? null;
    setSelected(target);
    if (target) setItems(await listPriceItems(target));
    setObservations(await listObservations());
  }, [selected]);

  useEffect(() => {
    reload().catch(() => toast.error(t('dr_error_generic')));
    // Intentionally runs once: reload closes over `selected`, and re-running on
    // every change would refetch the whole page on each row action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshItems = async (versionId: string) => {
    setSelected(versionId);
    setItems(await listPriceItems(versionId));
  };

  const onReview = async (o: PriceObservationRecord, state: PriceObservationRecord['review_state']) => {
    setBusy(true);
    try {
      await reviewObservation(o.id, state);
      setObservations((prev) => prev.map((x) => (x.id === o.id ? { ...x, review_state: state } : x)));
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async (versionId: string) => {
    setBusy(true);
    try {
      await publishPriceVersion(versionId);
      toast.success(t('admin_pb_publish'));
      await reload();
    } catch (e) {
      // The refusal is the feature: surfacing WHY is more useful than a
      // generic failure, because the admin's next action depends on it.
      const msg = e instanceof Error && e.message.startsWith('cannot_publish')
        ? t('admin_pb_cannot_publish')
        : t('dr_error_generic');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onSetStatus = async (item: PriceItemRecord, status: PriceItemRecord['status']) => {
    setBusy(true);
    try {
      await setPriceItemStatus(item.id, status);
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status } : x)));
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-6 space-y-5 max-w-5xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('admin_pb_title')}</h1>
      </header>

      <Tabs defaultValue="versions">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="versions">{t('admin_pb_versions')}</TabsTrigger>
          <TabsTrigger value="observations">{t('admin_pb_observations')}</TabsTrigger>
        </TabsList>

        <TabsContent value="versions" className="mt-5 space-y-4">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin_pb_no_data')}</p>
          ) : null}

          {versions.map((v) => (
            <Card key={v.id} className={selected === v.id ? 'border-primary' : undefined}>
              <CardContent className="pt-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {v.market} v{v.version}
                  </span>
                  <Badge variant={v.status === 'PUBLISHED' ? 'default' : 'secondary'}>{v.status}</Badge>
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={() => refreshItems(v.id)}>
                    {t('dr_list_open')}
                  </Button>
                  {v.status === 'DRAFT' ? (
                    <Button size="sm" disabled={busy} onClick={() => onPublish(v.id)}>
                      {t('admin_pb_publish')}
                    </Button>
                  ) : null}
                </div>
                {v.notes ? <p className="text-xs text-muted-foreground break-words">{v.notes}</p> : null}
              </CardContent>
            </Card>
          ))}

          {selected && items.length > 0 ? (
            <Card>
              <CardContent className="pt-5 space-y-3 overflow-x-auto">
                {items.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 border-b pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{i.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.item_key} · {i.price_base} {i.currency}/{i.unit} · {i.cost_kind}
                      </p>
                      {i.source ? (
                        <p className="text-xs text-muted-foreground break-words">
                          {t('admin_pb_source')}: {i.source}
                          {i.source_date ? ` · ${i.source_date}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={STATUS_VARIANT[i.status] ?? 'secondary'} className="shrink-0">
                      {t(STATUS_KEY[i.status] ?? 'admin_pb_status_provisional')}
                    </Badge>
                    {i.status !== 'REJECTED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={t('admin_pb_reject')}
                        onClick={() => onSetStatus(i, 'REJECTED')}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="observations" className="mt-5 space-y-3">
          {observations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin_pb_no_data')}</p>
          ) : null}

          {observations.map((o) => (
            <Card key={o.id}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium break-words">
                      {o.item_key} — {o.observed_value} {o.currency}/{o.observed_unit}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {t('admin_pb_source')}: {o.source_name}
                      {o.source_date ? ` · ${t('admin_pb_source_date')}: ${o.source_date}` : ''}
                    </p>
                    {o.normalization_note ? (
                      <p className="text-xs text-muted-foreground break-words">{o.normalization_note}</p>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {o.review_state}
                  </Badge>
                </div>
                {o.review_state === 'PENDING' ? (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => onReview(o, 'APPROVED')}>
                      <CheckCircle2 className="h-4 w-4" />
                      {t('admin_pb_approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      className="gap-1.5"
                      onClick={() => onReview(o, 'OUTLIER')}
                    >
                      <TrendingUp className="h-4 w-4" />
                      {t('admin_pb_outlier')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview(o, 'REJECTED')}>
                      {t('admin_pb_reject')}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPriceBookPage;
