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

// NOTE: this used to query a table called `ai_call_records` with columns
// lead_score/qualification_score/follow_up_needed and a `contacts` relation
// — none of which exist anywhere in this schema (verified against live
// information_schema). No lead-scoring pipeline exists in retell-webhook
// either (it only ever writes status/transcript/summary/duration/cost to
// outreach_sends). Since the query error was never checked, this always
// silently rendered "no hot leads" for every user. Replaced with the real
// AI_CALL rows from outreach_sends, ordered by recency instead of a score
// that was never computed anywhere.
interface RecentCallRow {
  id: string;
  recipient_phone: string | null;
  status: string;
  summary: string | null;
  duration_sec: number | null;
  created_at: string;
  outreach_contacts: { full_name: string | null } | null;
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
  const [recentCalls, setRecentCalls] = useState<RecentCallRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [propsRes, matchesRes, commRes, campaignsRes, callsRes] = await Promise.all([
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('matches').select('status').limit(2000),
        supabase.from('property_community_recommendations').select('status').limit(2000),
        supabase.from('outreach_campaigns')
          .select('id,name,campaign_type,status,sent_count,open_count,reply_count,created_at')
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('outreach_sends')
          .select('id,recipient_phone,status,summary,duration_sec,created_at,outreach_contacts(full_name),outreach_campaigns(name,property_id,properties(title))')
          .eq('channel', 'AI_CALL')
          .order('created_at', { ascending: false })
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
      setRecentCalls((callsRes.data ?? []) as unknown as RecentCallRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const totalMatches = Object.values(matchStatusCounts).reduce((a, b) => a + b, 0);
  const postedCount = commStatusCounts['POSTED'] ?? 0;
  const answeredCallCount = recentCalls.filter((c) => c.status === 'ANSWERED' || c.status === 'COMPLETED').length;

  const commBuckets: Record<string, number> = {};
  for (const [status, count] of Object.entries(commStatusCounts)) {
    const key = COMM_BUCKET_KEYS[status] ?? 'insights_comm_pending';
    commBuckets[key] = (commBuckets[key] ?? 0) + count;
  }

  const statTiles = [
    { icon: Home, labelKey: 'insights_stat_properties', value: propertyCount },
    { icon: Target, labelKey: 'insights_stat_matches', value: totalMatches },
    { icon: Flame, labelKey: 'insights_stat_hot_leads', value: answeredCallCount },
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
                  {recentCalls.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t('insights_hot_leads_none')}</p>
                  ) : (
                    <div className="space-y-2">
                      {recentCalls.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate">{c.outreach_contacts?.full_name ?? c.recipient_phone ?? '—'}</p>
                              {c.outreach_campaigns?.properties?.title && (
                                <span className="text-[11px] text-muted-foreground truncate">— {c.outreach_campaigns.properties.title}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {c.status}{c.duration_sec ? ` · ${Math.round(c.duration_sec / 60)}m` : ''}{c.summary ? ` · ${c.summary}` : ''}
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
