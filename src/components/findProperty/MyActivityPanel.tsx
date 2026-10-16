/*
 * The customer's own interest history: saved listings, recent activity, whether
 * views are recorded, and erasing it. Everything here is the customer's own data
 * (RLS + own-account RPCs); nothing is inferred about them that they cannot see.
 */
import { Bookmark, ExternalLink, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import {
  deleteMyInterestHistory, getMyInterestHistory, setMyInterestTracking, type MyInterestHistory,
} from '@/services/demandIntelligence';
import { resetSavedListings } from '@/services/savedListings';
import type { T } from './format';

export function MyActivityPanel({ t }: { t: T }) {
  const [data, setData] = useState<MyInterestHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => getMyInterestHistory(30).then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { void load(); }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try { await setMyInterestTracking(on); await load(); } catch { setNotice(t('mps_error_generic')); } finally { setBusy(false); }
  };
  const erase = async () => {
    setBusy(true);
    try {
      await deleteMyInterestHistory();
      resetSavedListings();
      setConfirming(false); setNotice(t('fpi_activity_deleted')); await load();
    } catch { setNotice(t('mps_error_generic')); } finally { setBusy(false); }
  };

  if (failed) return null;
  return (
    <section aria-labelledby="fpi-activity-title" className="space-y-4 rounded-2xl border border-foreground/15 bg-card p-5 shadow-sm sm:p-6">
      <div className="space-y-1">
        <h2 id="fpi-activity-title" className="font-display text-lg font-semibold">{t('fpi_activity_title')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('fpi_activity_note', { days: data?.retentionDays ?? 730 })}</p>
      </div>
      {!data ? <div className="h-24 animate-pulse rounded-xl bg-muted/60" aria-busy="true" /> : (
        <>
          <div>
            <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold"><Bookmark className="h-4 w-4" aria-hidden="true" />{t('fpi_activity_saved', { n: data.saved.length })}</h3>
            {data.saved.length === 0 ? <p className="text-sm text-muted-foreground">{t('fpi_activity_saved_empty')}</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.saved.slice(0, 12).map((s) => {
                  const snap = s.snapshot as Record<string, unknown>;
                  const url = safeExternalUrl(typeof snap.url === 'string' ? snap.url : null);
                  return (
                    <li key={s.listing_key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
                      <span className="min-w-0">
                        <span dir="auto" className="block truncate font-medium">{String(snap.title ?? snap.city ?? t('fpi_activity_listing'))}</span>
                        <span dir="auto" className="block truncate text-xs text-muted-foreground">
                          {[snap.district, snap.city].filter(Boolean).join(', ')}{snap.price ? ` · $${Math.round(Number(snap.price)).toLocaleString('en-US')}` : ''}
                        </span>
                      </span>
                      {url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t('mps_open_original')} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-muted"><ExternalLink className="h-4 w-4" aria-hidden="true" /></a> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('fpi_activity_recent')}</h3>
            {data.events.length === 0 ? <p className="text-sm text-muted-foreground">{t('fpi_activity_empty')}</p> : (
              <ol className="space-y-1.5 text-sm">
                {data.events.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{t(`admin_di_event_${e.event_type.toLowerCase()}`)}</span>
                    <span dir="auto" className="text-muted-foreground">{[e.city, e.source_host].filter(Boolean).join(' · ')}</span>
                    <time dateTime={e.occurred_at} className="ms-auto text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <label className="flex min-w-0 items-start gap-3 text-sm">
              <Switch checked={data.observedTracking} disabled={busy} onCheckedChange={(on) => void toggle(on)} aria-describedby="fpi-tracking-desc" />
              <span className="min-w-0"><span className="block font-medium">{t('fpi_activity_tracking')}</span>
                <span id="fpi-tracking-desc" className="block text-xs text-muted-foreground">{t('fpi_activity_tracking_desc')}</span></span>
            </label>
            {confirming ? (
              <div role="alertdialog" aria-label={t('fpi_activity_delete')} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{t('fpi_activity_delete_confirm')}</span>
                <button type="button" disabled={busy} onClick={() => void erase()} className="min-h-11 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground">{t('fpi_activity_delete_yes')}</button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-xl border border-border px-4 text-sm">{t('fpi_activity_delete_no')}</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted">
                <Trash2 className="h-4 w-4" aria-hidden="true" />{t('fpi_activity_delete')}
              </button>
            )}
          </div>
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        </>
      )}
    </section>
  );
}
