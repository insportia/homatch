import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, Home, Target, Flame, Users, Loader2, PhoneCall, TrendingUp,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';

interface CampaignRow {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  sent_count: number | null;
  open_count: number | null;
  reply_count: number | null;
  created_at: string;
}

interface HotLeadRow {
  id: string;
  phone_number: string;
  status: string;
  lead_score: number | null;
  qualification_score: number | null;
  follow_up_needed: boolean | null;
  contacts: { full_name: string | null } | null;
  outreach_campaigns: { name: string | null; property_id: string | null; properties: { title: string | null } | null } | null;
}

const MATCH_STATUS_KEYS: Record<string, string> = {
  NEW: 'insights_status_new',
  PREVIEWED: 'insights_status_previewed',
  UNLOCKED: 'insights_status_unlocked',
  ARCHIVED: 'insights_status_archived',
  REJECTED: 'insights_status_rejected',
};

const COMM_BUCKET_KEYS: Record<string, string> = {
  PENDING: 'insights_comm_pending',
  OPEN: 'insights_comm_in_progress',
  POST_GENERATED: 'insights_comm_in_progress',
  COPIED: 'insights_comm_in_progress',
  POSTED: 'insights_comm_posted',
  SKIPPED: 'insights_comm_skipped',
};

export default function OutreachInsightsPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [propertyCount, setPropertyCount] = useState(0);
  const [matchStatusCounts, setMatchStatusCounts] = useState<Record<string, number>>({});
  const [commStatusCounts, setCommStatusCounts] = useState<Record<string, number>>({});
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [hotLeads, setHotLeads] = useState<HotLeadRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [propsRes, matchesRes, commRes, campaignsRes, leadsRes] = await Promise.all([
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('matches').select('status').limit(2000),
        supabase.from('property_community_recommendations').select('status').limit(2000),
        supabase.from('outreach_campaigns')
          .select('id,name,campaign_type,status,sent_count,open_count,reply_count,created_at')
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('ai_call_records')
          .select('id,phone_number,status,lead_score,qualification_score,follow_up_needed,contacts(full_name),outreach_campaigns(name,property_id,properties(title))')
          .order('lead_score', { ascending: false, nullsFirst: false })
          .limit(15),
      ]);
      if (cancelled) return;

      setPropertyCount(propsRes.count ?? 0);

      const mStatus: Record<string, number> = {};
      for (const row of matchesRes.data ?? []) {
        const s = (row as { status: string }).status;
        mStatus[s] = (mStatus[s] ?? 0) + 1;
      }
      setMatchStatusCounts(mStatus);

      const cStatus: Record<string, number> = {};
      for (const row of commRes.data ?? []) {
        const s = (row as { status: string }).status;
        cStatus[s] = (cStatus[s] ?? 0) + 1;
      }
      setCommStatusCounts(cStatus);

      setCampaigns((campaignsRes.data ?? []) as CampaignRow[]);
      setHotLeads((leadsRes.data ?? []) as unknown as HotLeadRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalMatches = Object.values(matchStatusCounts).reduce((a, b) => a + b, 0);
  const postedCount = commStatusCounts['POSTED'] ?? 0;
  const hotLeadCount = hotLeads.filter((l) => (l.lead_score ?? 0) >= 70).length;

  const commBuckets: Record<string, number> = {};
  for (const [status, count] of Object.entries(commStatusCounts)) {
    const key = COMM_BUCKET_KEYS[status] ?? 'insights_comm_pending';
    commBuckets[key] = (commBuckets[key] ?? 0) + count;
  }

  const statTiles = [
    { icon: Home, labelKey: 'insights_stat_properties', value: propertyCount },
    { icon: Target, labelKey: 'insights_stat_matches', value: totalMatches },
    { icon: Flame, labelKey: 'insights_stat_hot_leads', value: hotLeadCount },
    { icon: Users, labelKey: 'insights_stat_communities_posted', value: postedCount },
  ];

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {t('outreach_insights_title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('outreach_insights_subtitle')}</p>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {statTiles.map(({ icon: Icon, labelKey, value }) => (
                  <Card key={labelKey}>
                    <CardContent className="p-4">
                      <Icon className="h-4 w-4 text-primary mb-2" />
                      <p className="text-2xl font-semibold text-foreground">{value}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t(labelKey as Parameters<typeof t>[0])}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />{t('insights_campaigns_title')}
                  </p>
                  {campaigns.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t('insights_campaigns_none')}</p>
                  ) : (
                    <div className="space-y-2">
                      {campaigns.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              <Badge variant="outline" className="text-[9px] px-1 py-0">{c.campaign_type}</Badge>
                              <Badge variant="outline" className="text-[9px] px-1 py-0">{c.status}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {c.sent_count ?? 0} {t('insights_metric_sent')} · {c.open_count ?? 0} {t('insights_metric_opened')} · {c.reply_count ?? 0} {t('insights_metric_replies')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-primary" />{t('insights_hot_leads_title')}
                  </p>
                  {hotLeads.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t('insights_hot_leads_none')}</p>
                  ) : (
                    <div className="space-y-2">
                      {hotLeads.map((l) => (
                        <div key={l.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate">{l.contacts?.full_name ?? l.phone_number}</p>
                              {l.outreach_campaigns?.properties?.title && (
                                <span className="text-[11px] text-muted-foreground truncate">— {l.outreach_campaigns.properties.title}</span>
                              )}
                              {l.follow_up_needed && (
                                <Badge className="text-[9px] px-1 py-0 bg-amber-500/15 text-amber-500 border-amber-500/30">{t('insights_follow_up_badge')}</Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {l.lead_score != null ? `${l.lead_score}/100` : '—'} · {l.status}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-sm font-semibold">{t('insights_matching_title')}</p>
                    {Object.keys(matchStatusCounts).length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      Object.entries(matchStatusCounts).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t((MATCH_STATUS_KEYS[status] ?? 'insights_status_new') as Parameters<typeof t>[0])}</span>
                          <span className="font-medium text-foreground">{count}</span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-sm font-semibold">{t('insights_community_title')}</p>
                    {Object.keys(commBuckets).length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      Object.entries(commBuckets).map(([labelKey, count]) => (
                        <div key={labelKey} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t(labelKey as Parameters<typeof t>[0])}</span>
                          <span className="font-medium text-foreground">{count}</span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
