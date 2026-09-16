import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Megaphone, PhoneCall, MessageCircle, Mail, Users, ArrowRight, Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, StatTile, EmptyState, LoadingRows, ErrorState,
  Eyebrow, GoldRule, formatDateTime, formatMoney, formatNumber,
  TableScroll, Th, Td,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { supabase } from '@/services/developer/client';
import { listLeads, type LeadWithContact } from '@/services/developer/crm';
import { Headline, SectionHead } from '@/components/developer/visuals';
import { listLedger } from '@/services/developer/sales';
import type { SalesLedgerRow } from '@/services/developer/types';
import { AdConnectionsPanel } from '@/components/developer/AdConnectionsPanel';
import { BrokerPanel } from '@/components/developer/BrokerPanel';

/**
 * MARKETING (§54, §55, §97).
 *
 * THIS PAGE DELIBERATELY BUILDS NOTHING.
 *
 * Homatch already has an AI Call Center, a WhatsApp product, an email product
 * and a campaign builder, each with its own consent handling, provider
 * routing, spend caps and kill switches. A "Developer Campaigns" screen that
 * sent its own messages would be a second copy of all of that — and the copy
 * would not honour an opt-out recorded in the original, which is the one
 * failure that actually matters.
 *
 * So this is a doorway, not a product. It shows what the workspace's own
 * outreach has produced, and it hands off to the real thing with the
 * developer context attached.
 */
export default function DeveloperMarketingPage() {
  const { t, lang: language } = useLanguage();
  const { workspace } = useDeveloperWorkspace();

  const [leads, setLeads] = useState<LeadWithContact[]>([]);
  const [ledger, setLedger] = useState<SalesLedgerRow[]>([]);
  const [shareStats, setShareStats] = useState<{ links: number; opens: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, sales] = await Promise.all([
        listLeads(workspace.id, { limit: 1000 }),
        listLedger(workspace.id).catch(() => [] as SalesLedgerRow[]),
      ]);
      setLeads(rows);
      setLedger(sales);

      const { data: links } = await supabase
        .from('dev_share_links')
        .select('id, view_count')
        .eq('workspace_id', workspace.id);
      setShareStats({
        links: links?.length ?? 0,
        opens: (links ?? []).reduce((s, l) => s + Number(l.view_count ?? 0), 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  /**
   * WHICH SOURCE IS PRODUCING SALES.
   *
   * Leads by source come from the CRM; sales and revenue by source come from
   * the sales ledger, which records lead_source on the sale itself rather than
   * inferring it back through the buyer. Sources with neither are not rows.
   *
   * There is no cost column and no return on spend. Platform spend is not
   * connected to this workspace (see the note under Paid channels), and a
   * return computed against a number we do not have would be the one invented
   * figure on an otherwise honest page.
   */
  const bySource = useMemo(() => {
    const rows = new Map<string, {
      source: string; leads: number; viewed: number; reserved: number;
      sold: number; revenue: number; currency: string | null;
    }>();
    const row = (key: string) => {
      const found = rows.get(key) ?? {
        source: key, leads: 0, viewed: 0, reserved: 0, sold: 0, revenue: 0, currency: null,
      };
      rows.set(key, found);
      return found;
    };

    for (const lead of leads) {
      const entry = row(lead.source || t('dev_source_unknown'));
      entry.leads += 1;
      if (['VIEWING_SCHEDULED', 'VIEWING_COMPLETED', 'NEGOTIATION', 'RESERVATION',
        'CONTRACT', 'PAYMENT_PENDING', 'SOLD'].includes(lead.stage)) entry.viewed += 1;
      if (['RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD'].includes(lead.stage)) {
        entry.reserved += 1;
      }
    }
    for (const sale of ledger) {
      const entry = row(sale.lead_source || t('dev_source_unknown'));
      entry.sold += 1;
      entry.revenue += Number(sale.sale_price ?? 0);
      entry.currency = entry.currency ?? sale.currency;
    }
    return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
  }, [leads, ledger, t]);

  const channels = [
    {
      key: 'calls', icon: PhoneCall, titleKey: 'dev_mk_calls', bodyKey: 'dev_mk_calls_body',
      to: '/outreach/calls',
    },
    {
      key: 'whatsapp', icon: MessageCircle, titleKey: 'dev_mk_whatsapp', bodyKey: 'dev_mk_whatsapp_body',
      to: '/outreach/whatsapp',
    },
    {
      key: 'email', icon: Mail, titleKey: 'dev_mk_email', bodyKey: 'dev_mk_email_body',
      to: '/outreach/email',
    },
    {
      key: 'audiences', icon: Users, titleKey: 'dev_mk_audiences', bodyKey: 'dev_mk_audiences_body',
      to: '/outreach/contacts',
    },
  ];

  // Leads that arrived from somewhere other than a person typing them in.
  const attributed = leads.filter((l) => l.source && l.source !== 'MANUAL');
  const sold = attributed.filter((l) => l.stage === 'SOLD');

  return (
    <DeveloperShell
      title={t('dev_nav_marketing')}
      description={t('dev_marketing_subtitle')}
      requires="marketing"
    >
      {loading && <LoadingRows rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && (
        <div className="space-y-6">
          <section>
            <div className="mb-3">
              <Eyebrow>{t('dev_mk_channels')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.map((channel) => {
                const Icon = channel.icon;
                return (
                  <Link
                    key={channel.key}
                    to={channel.to}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold-ink" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t(channel.titleKey)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t(channel.bodyKey)}</p>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">{t('dev_mk_one_product_note')}</p>
          </section>

          <section>
            <div className="mb-3">
              <Eyebrow>{t('dev_mk_what_it_produced')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={t('dev_mk_attributed_leads')} value={attributed.length}
                hint={t('dev_mk_attributed_hint')} />
              <StatTile label={t('dev_mk_attributed_sold')} value={sold.length} />
              <StatTile label={t('dev_mk_share_links')} value={shareStats?.links ?? 0} />
              <StatTile label={t('dev_mk_share_opens')} value={shareStats?.opens ?? 0} />
            </div>
            {/* §56: platform metrics, CRM outcomes and confirmed attribution
                are three different things, and this page only claims the
                second. Saying so is the difference between a number and a
                manufactured ROAS. */}
            <p className="mt-2 text-2xs text-muted-foreground">{t('dev_mk_attribution_caveat')}</p>
          </section>

          {attributed.length === 0 && (
            <Panel>
              <EmptyState
                icon={<Megaphone className="h-7 w-7" />}
                title={t('dev_mk_empty_title')}
                description={t('dev_mk_empty_body')}
                action={(
                  <Button asChild>
                    <Link to="/outreach/campaigns">{t('dev_mk_create_campaign')}</Link>
                  </Button>
                )}
              />
            </Panel>
          )}

          {/* ── Which source produced what ─────────────────────────────
              The chain a developer actually asks about, and only the columns
              these rows can answer: no spend and no return on spend, because
              the platforms are not connected to this workspace. */}
          {bySource.length > 0 && (
            <section>
              <SectionHead title={t('dev_mk_by_source')} sub={t('dev_mk_by_source_sub')} />
              <Panel>
                <TableScroll>
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr>
                        <Th>{t('dev_mk_source')}</Th>
                        <Th className="text-right">{t('dev_funnel_leads')}</Th>
                        <Th className="text-right">{t('dev_funnel_viewings')}</Th>
                        <Th className="text-right">{t('dev_funnel_reserved')}</Th>
                        <Th className="text-right">{t('dev_funnel_sold')}</Th>
                        <Th className="text-right">{t('dev_mk_revenue')}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {bySource.map((row) => (
                        <tr key={row.source}>
                          <Td className="font-medium">{row.source}</Td>
                          <Td className="text-right tabular">{formatNumber(row.leads, language)}</Td>
                          <Td className="text-right tabular text-muted-foreground">
                            {formatNumber(row.viewed, language)}
                          </Td>
                          <Td className="text-right tabular text-muted-foreground">
                            {formatNumber(row.reserved, language)}
                          </Td>
                          <Td className="text-right tabular font-semibold">
                            {formatNumber(row.sold, language)}
                          </Td>
                          <Td className="text-right tabular">
                            {row.revenue > 0
                              ? formatMoney(row.revenue, row.currency ?? workspace?.default_currency, language)
                              : '—'}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
              <p className="mt-2 text-2xs text-muted-foreground">{t('dev_mk_no_spend_note')}</p>
            </section>
          )}

          {/* Paid traffic. The attribution mapping works today; pulling
              spend from the platforms is blocked on a credential this
              deployment does not have, and the panel says which is which
              rather than showing a dead "Connect" button. */}
          {workspace && (
            <section>
              <div className="mb-3">
                <Eyebrow>{t('dev_mk_paid')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <AdConnectionsPanel workspaceId={workspace.id} />
            </section>
          )}

          {/* Inventory out to people who do not work here. Deliberately
              not a workspace membership — a broker gets a link, a named
              list of apartments, a commission and an expiry. */}
          {workspace && (
            <section>
              <div className="mb-3">
                <Eyebrow>{t('dev_mk_distribution')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <BrokerPanel workspaceId={workspace.id} ledger={ledger} />
            </section>
          )}
        </div>
      )}
    </DeveloperShell>
  );
}
