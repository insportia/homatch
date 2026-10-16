/*
 * The customer's own data: saved homes and a readable activity timeline.
 * Everything comes from own-account RPCs under RLS; grouping repeated events is
 * presentation only — the stored history is never changed, and the recording
 * switch and erasure stay one tap away.
 */
import { Bookmark, BookmarkX, Building2, ChevronDown, Eye, ExternalLink, Heart, MapPin, Megaphone, Phone, Search, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Switch } from '@/components/ui/switch';
import { safeExternalUrl } from '@/lib/safeExternalUrl';
import {
  deleteMyInterestHistory, getMyInterestHistory, setMyInterestTracking, type InterestEvent, type MyInterestHistory,
} from '@/services/demandIntelligence';
import { resetSavedListings, useSavedListing } from '@/services/savedListings';
import { usd, type T } from '../format';
import { btn, cx, dayKey, naturalDate, Pill, Surface } from './primitives';

function useMyHistory(limit = 100) {
  const [data, setData] = useState<MyInterestHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => getMyInterestHistory(limit).then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, reload: load };
}

/* ───────────────────────── Saved ───────────────────────── */

type Saved = MyInterestHistory['saved'][number];

export function SavedTab({ t, onCount }: { t: T; onCount?: (n: number) => void }) {
  const { data, failed, reload } = useMyHistory(10);
  useEffect(() => { if (data) onCount?.(data.saved.length); }, [data, onCount]);
  if (failed) return <LoadFailed t={t} onRetry={() => void reload()} />;
  if (!data) return <GridSkeleton />;
  if (!data.saved.length) {
    return (
      <Surface className="flex flex-col items-center gap-4 px-6 py-12 text-center" data-tab-panel="saved">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--gold)/0.12)] text-[hsl(var(--gold-ink))]" aria-hidden="true"><Heart className="h-6 w-6" /></span>
        <div className="max-w-md space-y-1.5">
          <h2 className="font-display text-xl font-semibold">{t('fpx_saved_empty_title')}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('fpx_saved_empty_body')}</p>
        </div>
      </Surface>
    );
  }
  return (
    <div className="space-y-3" data-tab-panel="saved">
      <p className="text-sm text-muted-foreground">{t('fpx_saved_note', { n: data.saved.length })}</p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.saved.map((s) => <SavedCard key={s.listing_key} s={s} t={t} onRemoved={() => void reload()} />)}
      </ul>
    </div>
  );
}

function SavedCard({ s, t, onRemoved }: { s: Saved; t: T; onRemoved: () => void }) {
  const snap = s.snapshot as Record<string, unknown>;
  const str = (k: string) => (typeof snap[k] === 'string' && snap[k] ? String(snap[k]) : null);
  const n = (k: string) => (typeof snap[k] === 'number' && Number.isFinite(snap[k]) ? Number(snap[k]) : null);
  const url = safeExternalUrl(str('url'));
  const image = safeExternalUrl(str('imageUrl'));
  const place = [str('district'), str('city')].filter(Boolean).join(', ');
  const save = useSavedListing(s.listing_key);
  const remove = async () => { await save.toggle(snap as never); onRemoved(); };
  return (
    <Surface as="li" className="flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-[16/10] bg-[linear-gradient(135deg,hsl(40_30%_94%),hsl(40_20%_88%))]">
        {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          : <span className="absolute inset-0 grid place-items-center text-foreground/25" aria-hidden="true"><Building2 className="h-10 w-10" /></span>}
        {str('sourceHost') ? <span className="absolute start-3 top-3 rounded-full bg-[#0C1119]/80 px-2.5 py-1 text-2xs font-semibold text-white backdrop-blur-sm" dir="ltr">{str('sourceHost')}</span> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-display text-2xl font-semibold leading-none tracking-[-0.01em] tabular-nums" dir="ltr">{n('price') != null ? usd(n('price')) : t('fpx_price_unknown')}</p>
        {str('title') ? <h3 dir="auto" className="line-clamp-2 text-sm font-medium text-foreground">{str('title')}</h3> : null}
        {place ? <p dir="auto" className="flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{place}</span></p> : null}
        <p className="text-xs text-muted-foreground">
          {[n('areaSqm') != null ? t('mps_value_area', { v: String(n('areaSqm')) }) : null, n('rooms') != null ? t('mps_rooms_n', { n: n('rooms') as number }) : null].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-auto pt-1 text-xs text-muted-foreground">{t('fpx_saved_on', { date: naturalDate(s.saved_at) })}</p>
        <div className="flex gap-2 pt-1">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" className={cx(btn.primary, 'flex-1')}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('mps_open_original')}</a> : null}
          <button type="button" onClick={() => void remove()} disabled={save.busy} aria-label={t('fpi_unsave')} title={t('fpi_unsave')} className={btn.icon}><BookmarkX className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {save.failed ? <p role="alert" className="text-xs text-destructive">{t('fpi_save_failed')}</p> : null}
      </div>
    </Surface>
  );
}

/* ───────────────────────── Activity ───────────────────────── */

const EVENT_ICON: Record<string, typeof Search> = {
  SEARCH: Search, DEMAND_DECLARED: Bookmark, PREFERENCE_CHANGED: Settings2, DEMAND_WITHDRAWN: BookmarkX, VIEWED: Eye,
  RESULT_OPENED: ExternalLink, SAVED: Heart, UNSAVED: BookmarkX, CONTACT_REVEALED: Phone, VIEWING_REQUESTED: Eye,
  PAID_CAMPAIGN_STARTED: Megaphone, PROPERTY_LISTED: Building2,
};

/** Consecutive events of the same kind about the same thing collapse into one line with a count. */
interface Group { key: string; first: InterestEvent; count: number; latest: string }
function groupEvents(events: InterestEvent[]): Array<{ day: string; label: string; groups: Group[] }> {
  const days: Array<{ day: string; label: string; groups: Group[] }> = [];
  for (const e of events) {
    const day = dayKey(e.occurred_at);
    let bucket = days.at(-1);
    if (!bucket || bucket.day !== day) { bucket = { day, label: naturalDate(e.occurred_at).split(',')[0], groups: [] }; days.push(bucket); }
    const sig = [e.event_type, e.side, e.city, e.property_type, e.budget_min, e.budget_max, e.listing_key, e.search_id].join('|');
    const last = bucket.groups.at(-1);
    if (last && last.key === sig) last.count += 1;
    else bucket.groups.push({ key: sig, first: e, count: 1, latest: e.occurred_at });
  }
  return days;
}

function eventSummary(e: InterestEvent, t: T): string {
  const what = [e.property_type ? t(`mps_pt_${e.property_type}`) : null, e.side ? t(`fpx_side_${e.side}`) : null].filter(Boolean).join(' · ');
  const where = [...(e.districts ?? []).slice(0, 2), e.city].filter(Boolean).join(', ');
  const budget = e.budget_min != null || e.budget_max != null
    ? [e.budget_min != null ? usd(e.budget_min) : null, e.budget_max != null ? usd(e.budget_max) : null].filter(Boolean).join(' – ') : null;
  return [what, where, budget, e.source_host].filter(Boolean).join(' · ');
}

export function ActivityTab({ t }: { t: T }) {
  const { data, failed, reload } = useMyHistory(100);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const days = useMemo(() => groupEvents(data?.events ?? []), [data]);
  const shownDays = expanded ? days : days.slice(0, 4);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try { await setMyInterestTracking(on); await reload(); } catch { setNotice(t('mps_error_generic')); } finally { setBusy(false); }
  };
  const erase = async () => {
    setBusy(true);
    try { await deleteMyInterestHistory(); resetSavedListings(); setConfirming(false); setNotice(t('fpi_activity_deleted')); await reload(); }
    catch { setNotice(t('mps_error_generic')); } finally { setBusy(false); }
  };

  if (failed) return <LoadFailed t={t} onRetry={() => void reload()} />;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" data-tab-panel="activity">
      <Surface className="p-5 sm:p-6" aria-labelledby="fpi-activity-title">
        <h2 id="fpi-activity-title" className="font-display text-lg font-semibold">{t('fpi_activity_title')}</h2>
        {!data ? <div className="mt-4 h-40 animate-pulse rounded-xl bg-muted/60" aria-busy="true" /> : !days.length ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('fpi_activity_empty')}</p>
        ) : (
          <div className="mt-4 space-y-6">
            {shownDays.map((d) => (
              <section key={d.day} aria-label={d.label}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{d.label}</h3>
                <ol className="relative space-y-1 border-s border-border ps-5">
                  {d.groups.map((g) => {
                    const Icon = EVENT_ICON[g.first.event_type] ?? Search;
                    const summary = eventSummary(g.first, t);
                    const href = g.first.event_type === 'SEARCH' && g.first.search_id ? `/find-property/search/${encodeURIComponent(g.first.search_id)}` : null;
                    const body = (
                      <>
                        <span className="absolute -start-[29px] top-2.5 grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-[hsl(var(--gold-ink))]" aria-hidden="true"><Icon className="h-3 w-3" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                            {t(`admin_di_event_${g.first.event_type.toLowerCase()}`)}
                            {g.count > 1 ? <Pill>{t('fpx_times', { n: g.count })}</Pill> : null}
                          </span>
                          {summary ? <span dir="auto" className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span> : null}
                        </span>
                        <time dateTime={g.latest} className="shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(g.latest).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' })}</time>
                      </>
                    );
                    return (
                      <li key={`${g.key}-${g.latest}`} className="relative">
                        {href ? <Link to={href} className="flex min-h-[44px] items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{body}</Link>
                          : <div className="flex min-h-[44px] items-start gap-3 px-2 py-2">{body}</div>}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {days.length > 4 ? (
              <button type="button" onClick={() => setExpanded((v) => !v)} className={btn.ghost} aria-expanded={expanded}>
                <ChevronDown className={cx('h-4 w-4 transition', expanded && 'rotate-180')} aria-hidden="true" />{expanded ? t('fpx_show_less') : t('fpx_show_more')}
              </button>
            ) : null}
          </div>
        )}
      </Surface>

      <Surface as="aside" className="space-y-4 p-5" aria-label={t('fpx_privacy_title')}>
        <h2 className="font-display text-base font-semibold">{t('fpx_privacy_title')}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('fpi_activity_note', { days: data?.retentionDays ?? 730 })}</p>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={data?.observedTracking ?? true} disabled={busy || !data} onCheckedChange={(on) => void toggle(on)} aria-describedby="fpi-tracking-desc" />
          <span className="min-w-0"><span className="block font-medium">{t('fpi_activity_tracking')}</span>
            <span id="fpi-tracking-desc" className="block text-xs leading-relaxed text-muted-foreground">{t('fpi_activity_tracking_desc')}</span></span>
        </label>
        {confirming ? (
          <div role="alertdialog" aria-label={t('fpi_activity_delete')} className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm">{t('fpi_activity_delete_confirm')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void erase()} className="min-h-11 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground">{t('fpi_activity_delete_yes')}</button>
              <button type="button" onClick={() => setConfirming(false)} className={btn.quiet}>{t('fpi_activity_delete_no')}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={cx(btn.quiet, 'w-full')}><Trash2 className="h-4 w-4" aria-hidden="true" />{t('fpi_activity_delete')}</button>
        )}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </Surface>
    </div>
  );
}

function LoadFailed({ t, onRetry }: { t: T; onRetry: () => void }) {
  return (
    <Surface className="flex flex-wrap items-center justify-between gap-3 p-5" role="alert">
      <p className="text-sm">{t('mps_error_generic')}</p>
      <button type="button" onClick={onRetry} className={btn.quiet}>{t('fpw_retry')}</button>
    </Surface>
  );
}
function GridSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-border bg-card/70" />)}</div>;
}
