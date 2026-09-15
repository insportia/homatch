import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Link2, Copy, Check, KeyRound, Eye, EyeOff, History, Box,
  ExternalLink, Trash2, Share2, QrCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  Panel, Fact, UnitStatusPill, Money, formatArea, formatDateTime, EmptyState,
  LoadingRows, Eyebrow, GoldRule,
} from './primitives';
import {
  getUnit, updateUnit, listUnitEvents, listWalkthroughs, saveWalkthrough,
  deleteWalkthrough, isAllowedEmbedUrl, WALKTHROUGH_EMBED_HOSTS,
  createShareLink, shareUrl, listShareLinks, revokeShareLink, listShareEvents,
  type UnitEvent,
} from '@/services/developer/inventory';
import { reserveUnit, getUnitReservation, cancelReservation } from '@/services/developer/sales';
import { listLeads, type LeadWithContact } from '@/services/developer/crm';
import { devErrorText } from '@/services/developer/client';
import type {
  DevUnit, UnitStatus, DevWalkthrough, DevShareLink, DevShareEventRow, DevReservation,
} from '@/services/developer/types';

/**
 * ONE APARTMENT, EVERYTHING ABOUT IT.
 *
 * A drawer rather than a page because a salesperson looking at a floor plate
 * is comparing units, and sending them to a new URL for each one loses the
 * plate they were reading. §152: drawers for the high-frequency operational
 * act, pages for the thing you arrived to do.
 *
 * The STATUS control here offers only the editorial states. RESERVED,
 * CONTRACT_PENDING and SOLD are not in the list — not because they are
 * unimportant but because they are the three that mean money, and each has
 * its own action with its own record behind it. A dropdown that sets SOLD is
 * a dropdown that sells an apartment with no buyer, no price and no contract.
 */

const EDITORIAL_STATUSES: UnitStatus[] = ['AVAILABLE', 'ON_HOLD', 'NEGOTIATION', 'HIDDEN'];

export interface UnitDrawerProps {
  unitId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function UnitDrawer({ unitId, onClose, onChanged }: UnitDrawerProps) {
  const { t, lang: language } = useLanguage();
  const { workspace, can, isStudio } = useDeveloperWorkspace();

  const [unit, setUnit] = useState<DevUnit | null>(null);
  const [reservation, setReservation] = useState<DevReservation | null>(null);
  const [loading, setLoading] = useState(false);
  const [reserving, setReserving] = useState(false);

  const load = useCallback(async () => {
    if (!unitId) { setUnit(null); return; }
    setLoading(true);
    try {
      const [u, r] = await Promise.all([getUnit(unitId), getUnitReservation(unitId)]);
      setUnit(u);
      setReservation(r);
    } catch (error) {
      toast.error(devErrorText(error, t));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [unitId, onClose, t]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes, and focus is trapped by the dialog role on the panel.
  useEffect(() => {
    if (!unitId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unitId, onClose]);

  if (!unitId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t('dev_close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={unit ? `${t('dev_unit')} ${unit.unit_number}` : t('dev_unit')}
        className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <Eyebrow>{t('dev_unit')}</Eyebrow>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">
              {unit?.unit_number ?? '—'}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unit && <UnitStatusPill status={unit.status} />}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('dev_close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {loading && <LoadingRows rows={6} />}

        {!loading && unit && (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 w-[calc(100%-2rem)] justify-start overflow-x-auto sm:mx-5 sm:w-[calc(100%-2.5rem)]">
              <TabsTrigger value="overview">{t('dev_tab_overview')}</TabsTrigger>
              <TabsTrigger value="tour">{t('dev_tab_tour')}</TabsTrigger>
              <TabsTrigger value="share">{t('dev_tab_share')}</TabsTrigger>
              <TabsTrigger value="history">{t('dev_tab_history')}</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <TabsContent value="overview" className="mt-0 space-y-5">
                <OverviewTab
                  unit={unit}
                  reservation={reservation}
                  canEdit={can('inventory')}
                  canSell={can('sale')}
                  onReserve={() => setReserving(true)}
                  onCancelReservation={async (reason) => {
                    if (!reservation) return;
                    try {
                      await cancelReservation(reservation.id, reason);
                      toast.success(t('dev_reservation_released'));
                      await load();
                      onChanged();
                    } catch (error) {
                      toast.error(devErrorText(error, t));
                    }
                  }}
                  onSaved={async () => { await load(); onChanged(); }}
                />
              </TabsContent>

              <TabsContent value="tour" className="mt-0">
                {/* §2: the developer SEES what Homatch built and cannot
                    change it. dev_walkthroughs' policy refuses them anyway;
                    this is what stops us offering a button that would fail. */}
                <WalkthroughTab unit={unit} canEdit={isStudio} />
              </TabsContent>

              <TabsContent value="share" className="mt-0">
                <ShareTab unit={unit} />
              </TabsContent>

              <TabsContent value="history" className="mt-0">
                <HistoryTab unitId={unit.id} language={language} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </aside>

      {unit && workspace && (
        <ReserveDialog
          open={reserving}
          unit={unit}
          onClose={() => setReserving(false)}
          onReserved={async () => {
            setReserving(false);
            await load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────

function OverviewTab({
  unit, reservation, canEdit, canSell, onReserve, onCancelReservation, onSaved,
}: {
  unit: DevUnit;
  reservation: DevReservation | null;
  canEdit: boolean;
  canSell: boolean;
  onReserve: () => void;
  onCancelReservation: (reason: string) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const { t, lang: language } = useLanguage();
  const [price, setPrice] = useState(unit.price != null ? String(unit.price) : '');
  const [notes, setNotes] = useState(unit.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');

  useEffect(() => {
    setPrice(unit.price != null ? String(unit.price) : '');
    setNotes(unit.notes ?? '');
  }, [unit.id, unit.price, unit.notes]);

  const dirty = (price !== (unit.price != null ? String(unit.price) : ''))
    || (notes !== (unit.notes ?? ''));

  const save = async () => {
    setSaving(true);
    try {
      const parsed = price.trim() === '' ? null : Number(price);
      if (parsed !== null && !Number.isFinite(parsed)) {
        toast.error(t('dev_err_invalid'));
        return;
      }
      await updateUnit(unit.id, { price: parsed, notes: notes.trim() || null });
      toast.success(t('dev_saved'));
      await onSaved();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: UnitStatus) => {
    try {
      await updateUnit(unit.id, { status });
      await onSaved();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  const togglePublished = async () => {
    try {
      await updateUnit(unit.id, {
        is_published: !unit.is_published,
        published_at: !unit.is_published ? new Date().toISOString() : null,
      });
      await onSaved();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label={t('dev_unit_floor')} value={unit.floor_level ?? '—'} />
        <Fact label={t('dev_unit_type')} value={unit.unit_type ?? '—'} />
        <Fact label={t('dev_unit_bedrooms')} value={unit.bedrooms ?? '—'} />
        <Fact label={t('dev_unit_area')} value={formatArea(unit.area_total, language)} />
        <Fact label={t('dev_unit_balcony')} value={formatArea(unit.area_balcony, language)} />
        <Fact
          label={t('dev_unit_price_sqm')}
          value={<Money amount={unit.price_per_sqm} currency={unit.currency} />}
        />
        <Fact label={t('dev_unit_orientation')} value={unit.orientation ?? '—'} />
        <Fact label={t('dev_unit_view')} value={unit.view_text ?? '—'} />
        <Fact label={t('dev_unit_parking')} value={unit.parking || '—'} />
      </dl>

      {reservation && (
        <Panel className="border-gold-border/60 p-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('dev_reservation_active')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {reservation.expires_at
                  ? t('dev_reservation_expires').replace('{date}', formatDateTime(reservation.expires_at, language))
                  : t('dev_reservation_no_expiry')}
              </p>
              {reservation.amount != null && (
                <p className="mt-1 text-sm">
                  <Money amount={reservation.amount} currency={reservation.currency} />
                </p>
              )}
            </div>
          </div>
          {canSell && (
            releasing ? (
              <div className="mt-3 space-y-2">
                <Label htmlFor="dev-release-reason" className="text-xs">
                  {t('dev_release_reason')}
                </Label>
                <Input
                  id="dev-release-reason"
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder={t('dev_release_reason_placeholder')}
                  maxLength={200}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="destructive"
                    disabled={!releaseReason.trim()}
                    onClick={async () => {
                      await onCancelReservation(releaseReason.trim());
                      setReleasing(false);
                      setReleaseReason('');
                    }}
                  >
                    {t('dev_release_confirm')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReleasing(false)}>
                    {t('dev_cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setReleasing(true)}>
                {t('dev_release_reservation')}
              </Button>
            )
          )}
        </Panel>
      )}

      {canEdit && (
        <section className="space-y-3">
          <div>
            <Eyebrow>{t('dev_unit_edit')}</Eyebrow>
            <GoldRule className="mt-2" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-u-price">{t('dev_unit_price')}</Label>
              <Input
                id="dev-u-price" inputMode="decimal" value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-u-status">{t('dev_unit_status')}</Label>
              <Select
                value={EDITORIAL_STATUSES.includes(unit.status) ? unit.status : ''}
                onValueChange={(v) => setStatus(v as UnitStatus)}
                disabled={!EDITORIAL_STATUSES.includes(unit.status)}
              >
                <SelectTrigger id="dev-u-status">
                  <SelectValue placeholder={t('dev_unit_status_locked')} />
                </SelectTrigger>
                <SelectContent>
                  {EDITORIAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`dev_unit_status_${s.toLowerCase()}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!EDITORIAL_STATUSES.includes(unit.status) && (
                <p className="text-2xs text-muted-foreground">{t('dev_unit_status_workflow_note')}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-u-notes">{t('dev_unit_notes')}</Label>
            <Textarea
              id="dev-u-notes" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={2000}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={save}>
              {saving ? t('dev_saving') : t('dev_save')}
            </Button>
            <Button size="sm" variant="outline" onClick={togglePublished}>
              {unit.is_published
                ? <><EyeOff className="mr-2 h-4 w-4" />{t('dev_unpublish')}</>
                : <><Eye className="mr-2 h-4 w-4" />{t('dev_publish')}</>}
            </Button>
          </div>
        </section>
      )}

      {canSell && !reservation && ['AVAILABLE', 'ON_HOLD', 'NEGOTIATION'].includes(unit.status) && (
        <Button className="w-full" onClick={onReserve}>
          <KeyRound className="mr-2 h-4 w-4" />
          {t('dev_reserve_unit')}
        </Button>
      )}
    </div>
  );
}

// ── Walkthrough ────────────────────────────────────────────────────────────

function WalkthroughTab({ unit, canEdit }: { unit: DevUnit; canEdit: boolean }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [tours, setTours] = useState<DevWalkthrough[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTours(await listWalkthroughs(unit.id));
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setLoading(false);
    }
  }, [unit.id, t]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!workspace) return;
    if (!isAllowedEmbedUrl(url)) {
      toast.error(t('dev_err_embed_not_allowed'));
      return;
    }
    setSaving(true);
    try {
      await saveWalkthrough(workspace.id, {
        unit_id: unit.id, provider: 'EMBED', embed_url: url.trim(),
        title: title.trim() || null, status: 'READY', visibility: 'UNLISTED',
      });
      setUrl(''); setTitle('');
      toast.success(t('dev_tour_added'));
      await load();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  const publish = async (tour: DevWalkthrough) => {
    if (!workspace) return;
    try {
      await saveWalkthrough(workspace.id, {
        id: tour.id, provider: tour.provider, embed_url: tour.embed_url,
        status: tour.status === 'PUBLISHED' ? 'READY' : 'PUBLISHED',
        visibility: tour.status === 'PUBLISHED' ? 'PRIVATE' : 'UNLISTED',
      });
      await load();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  if (loading) return <LoadingRows rows={3} />;

  return (
    <div className="space-y-5">
      {tours.length === 0 ? (
        <EmptyState
          icon={<Box className="h-7 w-7" />}
          title={t('dev_tour_empty_title')}
          description={t('dev_tour_empty_body')}
        />
      ) : (
        <ul className="space-y-2">
          {tours.map((tour) => (
            <li key={tour.id}>
              <Panel className="p-3">
                <div className="flex items-start gap-3">
                  <Box className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {tour.title || t('dev_tour_untitled')}
                    </p>
                    <p className="truncate text-2xs text-muted-foreground">{tour.embed_url}</p>
                    <p className="mt-1 text-2xs">
                      <span className={cn(
                        'rounded-full border px-1.5 py-px',
                        tour.status === 'PUBLISHED'
                          ? 'border-emerald-600/40 text-emerald-700'
                          : 'border-border text-muted-foreground',
                      )}>
                        {t(`dev_tour_status_${tour.status.toLowerCase()}`)}
                      </span>
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => publish(tour)}>
                        {tour.status === 'PUBLISHED' ? t('dev_unpublish') : t('dev_publish')}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={async () => {
                          await deleteWalkthrough(tour.id);
                          await load();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <section className="space-y-3">
          <div>
            <Eyebrow>{t('dev_tour_add')}</Eyebrow>
            <GoldRule className="mt-2" />
          </div>
          {/* §181: Homatch does not generate 3D. It holds a reference to a
              tour that exists, and says so plainly rather than implying a
              renderer that is not here. */}
          <p className="text-xs text-muted-foreground">{t('dev_tour_add_body')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="dev-tour-title">{t('dev_tour_title_label')}</Label>
            <Input id="dev-tour-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-tour-url">{t('dev_tour_url_label')}</Label>
            <Input
              id="dev-tour-url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://my.matterport.com/show/?m=..." inputMode="url"
            />
            <p className="text-2xs text-muted-foreground">
              {t('dev_tour_allowed_hosts')}: {WALKTHROUGH_EMBED_HOSTS.slice(0, 5).join(', ')}…
            </p>
          </div>
          <Button size="sm" disabled={saving || !url.trim()} onClick={add}>
            {saving ? t('dev_saving') : t('dev_tour_add')}
          </Button>
        </section>
      )}
    </div>
  );
}

// ── Share ──────────────────────────────────────────────────────────────────

function ShareTab({ unit }: { unit: DevUnit }) {
  const { t, lang: language } = useLanguage();
  const [links, setLinks] = useState<DevShareLink[]>([]);
  const [events, setEvents] = useState<Map<string, DevShareEventRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listShareLinks('UNIT', unit.id);
      setLinks(rows);
      const map = new Map<string, DevShareEventRow[]>();
      for (const link of rows.slice(0, 5)) {
        map.set(link.id, await listShareEvents(link.id));
      }
      setEvents(map);
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setLoading(false);
    }
  }, [unit.id, t]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const { token } = await createShareLink({ targetType: 'UNIT', targetId: unit.id });
      await navigator.clipboard.writeText(shareUrl(token)).catch(() => {
        // Clipboard permission is not guaranteed; the link is on screen
        // below either way, so this is a convenience and not the feature.
      });
      toast.success(t('dev_share_created'));
      await load();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingRows rows={3} />;

  return (
    <div className="space-y-4">
      {!unit.is_published && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {t('dev_share_unpublished_note')}
        </p>
      )}

      <Button onClick={create} disabled={creating}>
        <Share2 className="mr-2 h-4 w-4" />
        {creating ? t('dev_saving') : t('dev_share_create')}
      </Button>

      {links.length === 0 ? (
        <EmptyState icon={<Link2 className="h-7 w-7" />} title={t('dev_share_empty')} />
      ) : (
        <ul className="space-y-2">
          {links.map((link) => {
            const url = shareUrl(link.token);
            const linkEvents = events.get(link.id) ?? [];
            const revoked = Boolean(link.revoked_at);
            return (
              <li key={link.id}>
                <Panel className={cn('p-3', revoked && 'opacity-60')}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-2xs text-muted-foreground">{url}</p>
                      <p className="mt-1 text-2xs text-muted-foreground">
                        {t('dev_share_views').replace('{n}', String(link.view_count))}
                        {link.last_viewed_at && ` · ${formatDateTime(link.last_viewed_at, language)}`}
                        {revoked && ` · ${t('dev_share_revoked')}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon" variant="ghost" aria-label={t('dev_copy')}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(url);
                            setCopied(link.id);
                            setTimeout(() => setCopied(null), 1600);
                          } catch {
                            toast.error(t('dev_copy_failed'));
                          }
                        }}
                      >
                        {copied === link.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button size="icon" variant="ghost" asChild aria-label={t('dev_open')}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      {!revoked && (
                        <Button
                          size="icon" variant="ghost" aria-label={t('dev_share_revoke')}
                          onClick={async () => { await revokeShareLink(link.id); await load(); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {linkEvents.length > 0 && (
                    <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
                      {linkEvents.slice(0, 5).map((event) => (
                        <li key={event.id} className="flex items-center justify-between gap-2 text-2xs">
                          <span>{t(`dev_share_event_${event.event.toLowerCase()}`)}</span>
                          <time dateTime={event.created_at} className="text-muted-foreground">
                            {formatDateTime(event.created_at, language)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────

function HistoryTab({ unitId, language }: { unitId: string; language: string }) {
  const { t } = useLanguage();
  const [events, setEvents] = useState<UnitEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listUnitEvents(unitId)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch((error) => {
        if (!cancelled) toast.error(devErrorText(error, t));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [unitId, t]);

  if (loading) return <LoadingRows rows={4} />;
  if (events.length === 0) {
    return <EmptyState icon={<History className="h-7 w-7" />} title={t('dev_history_empty')} />;
  }

  return (
    <ol className="space-y-0">
      {events.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-4 pl-1">
          {index < events.length - 1 && (
            <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-border" />
          )}
          <span aria-hidden="true" className="relative z-10 mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-gold" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {t(`dev_unit_event_${event.kind.toLowerCase()}`)}
              {event.from_value && event.to_value && (
                <span className="text-muted-foreground"> · {event.from_value} → {event.to_value}</span>
              )}
              {!event.from_value && event.to_value && (
                <span className="text-muted-foreground"> · {event.to_value}</span>
              )}
            </p>
            {event.note && <p className="text-xs text-muted-foreground">{event.note}</p>}
            <time dateTime={event.created_at} className="text-2xs text-muted-foreground">
              {formatDateTime(event.created_at, language)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Reserve ────────────────────────────────────────────────────────────────

function ReserveDialog({
  open, unit, onClose, onReserved,
}: { open: boolean; unit: DevUnit; onClose: () => void; onReserved: () => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [leads, setLeads] = useState<LeadWithContact[]>([]);
  const [leadId, setLeadId] = useState('');
  const [amount, setAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workspace) return;
    setLoading(true);
    // Default expiry of a fortnight, which is the usual hold and is a
    // suggestion the person can change rather than a rule.
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setExpires(d.toISOString().slice(0, 10));
    listLeads(workspace.id, { limit: 300 })
      .then(setLeads)
      .catch((error) => toast.error(devErrorText(error, t)))
      .finally(() => setLoading(false));
  }, [open, workspace, t]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!leadId || saving) return;
    setSaving(true);
    try {
      await reserveUnit({
        unitId: unit.id,
        leadId,
        amount: amount.trim() ? Number(amount) : null,
        currency: unit.currency,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        notes: notes.trim() || null,
      });
      toast.success(t('dev_reserved'));
      onReserved();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_reserve_unit')} · {unit.unit_number}</DialogTitle>
          <DialogDescription>{t('dev_reserve_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-res-lead">{t('dev_reserve_buyer')}</Label>
            {loading ? (
              <LoadingRows rows={1} className="p-0" />
            ) : leads.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('dev_reserve_no_leads')}</p>
            ) : (
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger id="dev-res-lead">
                  <SelectValue placeholder={t('dev_reserve_pick_buyer')} />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.contact?.full_name || lead.contact?.phone || t('dev_unnamed_buyer')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-res-amount">{t('dev_reserve_amount')}</Label>
              <Input
                id="dev-res-amount" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-res-expires">{t('dev_reserve_expires')}</Label>
              <Input
                id="dev-res-expires" type="date" value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-res-notes">{t('dev_unit_notes')}</Label>
            <Textarea
              id="dev-res-notes" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={saving || !leadId}>
              {saving ? t('dev_saving') : t('dev_reserve_confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
