import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Send, Check, X, Clock, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, formatDate, formatMoney,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listWorkspaceOffers, setOfferStatus, expireOffers, type OfferRow,
} from '@/services/developer/sales';
import { createShareLink, shareUrl } from '@/services/developer/inventory';
import { devErrorText } from '@/services/developer/client';
import type { DevOffer } from '@/services/developer/types';

/**
 * OFFERS, AND WHICH ONE IS ABOUT TO GO STALE.
 *
 * An offer is a price with a deadline. The list is ordered by that deadline
 * because the only question a sales manager asks it is "what am I about to
 * lose" — not "what did we send in date order".
 *
 * ACCEPTING AN OFFER DOES NOT RESERVE THE APARTMENT. That is a second,
 * deliberate act with its own deposit and its own expiry, done from the buyer
 * or from Reservations. Collapsing the two would mean a buyer saying "yes,
 * that sounds good" silently takes a unit off the market.
 */
const STATUS_TONE: Record<DevOffer['status'], string> = {
  DRAFT: 'border-border text-muted-foreground bg-muted/60',
  SENT: 'border-gold-border/60 text-gold-ink bg-gold/[0.06]',
  VIEWED: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/[0.07]',
  ACCEPTED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  DECLINED: 'border-border text-muted-foreground bg-muted/60',
  EXPIRED: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  SUPERSEDED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

const STATUS_KEY: Record<DevOffer['status'], string> = {
  DRAFT: 'dev_offer_status_draft',
  SENT: 'dev_offer_status_sent',
  VIEWED: 'dev_offer_status_viewed',
  ACCEPTED: 'dev_offer_status_accepted',
  DECLINED: 'dev_offer_status_declined',
  EXPIRED: 'dev_offer_status_expired',
  SUPERSEDED: 'dev_offer_status_superseded',
};

type Filter = 'LIVE' | 'ALL' | DevOffer['status'];

export default function DeveloperOffersPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('LIVE');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      // Sweep first, so nothing in this list claims to be live when its own
      // date says otherwise. Idempotent and cheap.
      await expireOffers(workspace.id);
      setRows(await listWorkspaceOffers(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const live: DevOffer['status'][] = ['DRAFT', 'SENT', 'VIEWED'];
    const filtered = filter === 'ALL'
      ? rows
      : filter === 'LIVE'
        ? rows.filter((r) => live.includes(r.status))
        : rows.filter((r) => r.status === filter);

    // Soonest deadline first among the live ones; everything settled falls to
    // the bottom in recency order.
    return [...filtered].sort((a, b) => {
      const aLive = live.includes(a.status) ? 0 : 1;
      const bLive = live.includes(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      if (aLive === 0) {
        const av = a.valid_until ? new Date(a.valid_until).getTime() : Number.MAX_SAFE_INTEGER;
        const bv = b.valid_until ? new Date(b.valid_until).getTime() : Number.MAX_SAFE_INTEGER;
        return av - bv;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [rows, filter]);

  async function move(offer: OfferRow, status: DevOffer['status']) {
    setBusy(offer.id);
    try {
      await setOfferStatus(offer.id, status);
      toast.success(t('dev_offer_updated'));
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function share(offer: OfferRow) {
    setBusy(offer.id);
    try {
      const link = await createShareLink({
        targetType: 'OFFER', targetId: offer.id, leadId: offer.lead_id,
      });
      await navigator.clipboard.writeText(shareUrl(link.token));
      toast.success(t('dev_share_copied'));
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_offers_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      requires="crm"
      actions={
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LIVE">{t('dev_offers_filter_live')}</SelectItem>
            <SelectItem value="ALL">{t('dev_offers_filter_all')}</SelectItem>
            {(Object.keys(STATUS_KEY) as DevOffer['status'][]).map((s) => (
              <SelectItem key={s} value={s}>{t(STATUS_KEY[s])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && visible.length === 0 && (
        <Panel>
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={t('dev_offers_empty_title')}
            description={t('dev_offers_empty_body')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/developers/contacts">{t('dev_offers_empty_action')}</Link>
              </Button>
            }
          />
        </Panel>
      )}

      {!loading && !error && visible.length > 0 && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_unit')}</Th>
                  <Th>{t('dev_buyer')}</Th>
                  <Th className="text-right">{t('dev_offer_list_price')}</Th>
                  <Th className="text-right">{t('dev_offer_discount')}</Th>
                  <Th className="text-right">{t('dev_offer_final')}</Th>
                  <Th>{t('dev_offer_valid_until')}</Th>
                  <Th>{t('dev_status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((offer) => {
                  const expiring = offer.valid_until !== null
                    && offer.valid_until >= today
                    && offer.valid_until <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
                    && ['DRAFT', 'SENT', 'VIEWED'].includes(offer.status);
                  const live = ['DRAFT', 'SENT', 'VIEWED'].includes(offer.status);
                  return (
                    <tr key={offer.id} className="hover:bg-muted/30">
                      <Td className="font-medium">{offer.unit_number ?? '—'}</Td>
                      <Td>{offer.buyer_name ?? '—'}</Td>
                      <Td className="text-right text-muted-foreground">
                        <Money amount={offer.base_price} currency={offer.currency} />
                      </Td>
                      <Td className="text-right">
                        {offer.discount_amount > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            −{formatMoney(offer.discount_amount, offer.currency, language)}
                          </span>
                        ) : '—'}
                      </Td>
                      <Td className="text-right font-medium">
                        <Money amount={offer.final_price} currency={offer.currency} />
                      </Td>
                      <Td>
                        <span className={cn(expiring && 'font-medium text-amber-700 dark:text-amber-400')}>
                          {offer.valid_until ? formatDate(offer.valid_until, language) : '—'}
                        </span>
                        {expiring && (
                          <Clock className="ml-1 inline h-3 w-3 text-amber-600" aria-hidden="true" />
                        )}
                      </Td>
                      <Td>
                        <span className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                          STATUS_TONE[offer.status],
                        )}>
                          {t(STATUS_KEY[offer.status])}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {live && (
                            <Button
                              type="button" variant="ghost" size="sm"
                              disabled={busy === offer.id}
                              onClick={() => void share(offer)}
                              aria-label={t('dev_offer_share')}
                              title={t('dev_offer_share')}
                            >
                              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          {offer.status === 'DRAFT' && (
                            <Button
                              type="button" variant="outline" size="sm"
                              disabled={busy === offer.id}
                              onClick={() => void move(offer, 'SENT')}
                            >
                              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              {t('dev_offer_mark_sent')}
                            </Button>
                          )}
                          {(offer.status === 'SENT' || offer.status === 'VIEWED') && (
                            <>
                              <Button
                                type="button" variant="outline" size="sm"
                                disabled={busy === offer.id}
                                onClick={() => void move(offer, 'ACCEPTED')}
                              >
                                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                {t('dev_offer_accepted')}
                              </Button>
                              <Button
                                type="button" variant="ghost" size="sm"
                                disabled={busy === offer.id}
                                onClick={() => void move(offer, 'DECLINED')}
                                aria-label={t('dev_offer_declined')}
                                title={t('dev_offer_declined')}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          {offer.status === 'ACCEPTED' && (
                            <Button asChild variant="outline" size="sm">
                              <Link to="/developers/sales/reservations">
                                {t('dev_offer_to_reservation')}
                              </Link>
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </DeveloperShell>
  );
}
