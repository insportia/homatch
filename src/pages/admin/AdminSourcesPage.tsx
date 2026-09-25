// HOMATCH ADMIN — the research source graph.
//
// This page already existed as a flat list of source_registry rows with a
// quality bar and an on/off switch. It keeps all of that, as the Registry
// tab, and gains the three things an operator could not previously answer:
//
//   Health   what has each source actually produced, and is it failing?
//   Access   which authenticated research sessions exist, and do they work?
//   Queue    which sources need a human to obtain access?
//
// Tabs on the existing page rather than a second admin application, and the
// existing shadcn primitives rather than a bespoke operations dashboard.
//
// NOTHING SECRET REACHES THIS FILE. A connection row carries the NAME of a
// platform secret, and the service layer does not even select that column.
// What is rendered is presence and health: whether a credential exists,
// whether it last worked, and when the platform said it expires.

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from 'lucide-react';
import {
  getAdminSources,
  getSourceConcentration,
  toggleSourceActive,
  getResearchSourceHealth,
  getResearchConnections,
  getResearchAccessQueue,
  decideResearchAccessRequest,
} from '@/services/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

type Row = Record<string, any>;
type ConcentrationRow = Awaited<ReturnType<typeof getSourceConcentration>>[number];

const when = (value: unknown) =>
  value ? format(new Date(String(value)), 'MMM d, HH:mm') : '—';

/** The access states, and how loudly each should read. */
const ACCESS_TONE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  PUBLIC: 'secondary',
  AUTHENTICATED_ACCESS: 'default',
  JOIN_REQUIRED: 'outline',
  DEGRADED: 'outline',
  INACCESSIBLE: 'destructive',
};

export default function AdminSourcesPage() {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Row[]>([]);
  const [health, setHealth] = useState<Row[]>([]);
  const [connections, setConnections] = useState<Row[]>([]);
  const [queue, setQueue] = useState<Row[]>([]);
  const [concentration, setConcentration] = useState<ConcentrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    // Every tab's data in one pass: an operator switching tabs should not wait
    // again, and none of these is expensive.
    Promise.all([
      getAdminSources(500).catch(() => []),
      getResearchSourceHealth(500).catch(() => []),
      getResearchConnections().catch(() => []),
      getResearchAccessQueue(undefined, 200).catch(() => []),
      /* Through an RPC: supply_observations has no grant for authenticated,
         so the concentration cannot be assembled in the browser. */
      getSourceConcentration().catch(() => []),
    ])
      .then(([s, h, c, qu, conc]) => {
        setSources(s);
        setHealth(h);
        setConnections(c);
        setQueue(qu);
        setConcentration(conc);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id: string, active: boolean) => {
    setSources(s => s.map(x => (x.id === id ? { ...x, active } : x)));
    try {
      await toggleSourceActive(id, active);
      toast.success(active ? t('admin_sources_enabled') : t('admin_sources_disabled'));
    } catch {
      setSources(s => s.map(x => (x.id === id ? { ...x, active: !active } : x)));
      toast.error(t('admin_sources_toggle_failed'));
    }
  };

  const decide = async (id: string, state: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED') => {
    const previous = queue;
    setQueue(rows => rows.map(r => (r.id === id ? { ...r, state } : r)));
    try {
      await decideResearchAccessRequest(id, state);
      toast.success(t('admin_sources_access_updated'));
    } catch {
      setQueue(previous);
      toast.error(t('admin_sources_access_failed'));
    }
  };

  const matches = (row: Row) =>
    !q ||
    String(row.url ?? row.source_url ?? '').toLowerCase().includes(q.toLowerCase()) ||
    String(row.platform ?? '').toLowerCase().includes(q.toLowerCase()) ||
    String(row.name ?? row.source_name ?? '').toLowerCase().includes(q.toLowerCase());

  const filteredSources = sources.filter(matches);
  const filteredHealth = health.filter(matches);
  const pending = queue.filter(r => r.state === 'REQUESTED' || r.state === 'IN_PROGRESS');

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold">{t('admin_sources_title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('admin_sources_subtitle', { count: sources.length })}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder={t('admin_sources_search_placeholder')}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <Tabs defaultValue="registry">
        <TabsList>
          <TabsTrigger value="registry">{t('admin_sources_tab_registry')}</TabsTrigger>
          <TabsTrigger value="health">{t('admin_sources_tab_health')}</TabsTrigger>
          <TabsTrigger value="concentration">{t('admin_sources_tab_concentration')}</TabsTrigger>
          <TabsTrigger value="access">{t('admin_sources_tab_access')}</TabsTrigger>
          <TabsTrigger value="queue">
            {t('admin_sources_tab_queue')}
            {pending.length > 0 && (
              <Badge variant="outline" className="ml-1.5 text-[11px]">{pending.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Registry: what exists, and whether it is switched on ───────── */}
        <TabsContent value="registry">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <Th>{t('admin_sources_url')}</Th>
                      <Th>{t('admin_sources_platform')}</Th>
                      <Th>{t('admin_sources_access')}</Th>
                      <Th>{t('admin_sources_last_collected')}</Th>
                      <Th>{t('admin_sources_active')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <LoadingRows cols={5} />
                    ) : filteredSources.length === 0 ? (
                      <EmptyRow cols={5} label={t('admin_sources_empty')} />
                    ) : (
                      filteredSources.map(s => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2.5 max-w-[260px]">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline truncate block text-xs"
                            >
                              {s.url ?? '—'}
                            </a>
                            {s.name && (
                              <div className="text-xs text-muted-foreground truncate">{s.name}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Badge variant="outline" className="text-[13px]">{s.platform ?? '—'}</Badge>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Badge variant={ACCESS_TONE[s.access_state] ?? 'outline'} className="text-[13px]">
                              {s.access_state ?? 'PUBLIC'}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                            {when(s.last_collected_at)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Switch checked={!!s.active} onCheckedChange={v => toggle(s.id, v)} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Health: what each source actually produced ─────────────────── */}
        <TabsContent value="concentration">
          <Card>
            <CardContent className="p-0">
              {/*
                * IS THIS A DISCOVERY NETWORK, OR ONE SOURCE?
                *
                * Share is of the observations Homatch HOLDS, never of a
                * market: nobody knows how many properties are for sale in
                * Tbilisi, and a coverage percentage would need that number.
                *
                * The column that decides whether a source earns its rate
                * limit is "only here" — entities no other source reached.
                * A source can hold a healthy share and take nothing with it
                * when dropped, which is what two sources reading the same
                * listings looks like.
                */}
              <div className="p-4 text-xs text-muted-foreground">
                {t('admin_sources_concentration_note')}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <Th>{t('admin_sources_url')}</Th>
                      {/* Importance before measurement: the rows are ordered
                          by tier, so an operator sees what the business
                          depends on before what merely parses tidily. */}
                      <Th>{t('admin_sources_tier')}</Th>
                      <Th>{t('admin_sources_family')}</Th>
                      <Th>{t('admin_sources_lifecycle')}</Th>
                      <Th>{t('admin_sources_observations')}</Th>
                      <Th>{t('admin_sources_share_held')}</Th>
                      <Th>{t('admin_sources_priced')}</Th>
                      <Th>{t('admin_sources_only_here')}</Th>
                      <Th>{t('admin_sources_provenance')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <LoadingRows cols={9} />
                    ) : concentration.length === 0 ? (
                      <EmptyRow cols={9} label={t('admin_sources_concentration_empty')} />
                    ) : (
                      concentration.map((c) => (
                        <tr key={c.adapter_id} className="border-b border-border/50">
                          <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">{c.adapter_id}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {/*
                              P0 has to LOOK different from P3, not just read
                              differently — the point of tiering was that an
                              operator can tell at a glance which sources the
                              product depends on. An untiered source says so
                              rather than borrowing P0's styling.
                            */}
                            {c.priority_tier === null || c.priority_tier === undefined ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <Badge
                                variant={c.priority_tier === 0 ? 'default' : 'outline'}
                                className={cn(
                                  'text-[13px] font-mono',
                                  c.priority_tier === 0 && 'bg-primary text-primary-foreground',
                                  c.priority_tier === 1 && 'border-primary/50 text-primary',
                                  c.priority_tier >= 2 && 'text-muted-foreground',
                                )}
                              >
                                P{c.priority_tier}
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{c.source_family ?? '—'}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Badge variant={c.active ? 'default' : 'outline'} className="text-[13px]">
                              {c.lifecycle ?? '—'}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">{c.observations}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">
                            {(Number(c.share_of_held) * 100).toFixed(1)}%
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">
                            {c.with_price}/{c.observations}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">
                            {c.incremental_unique_entities}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs font-mono">
                            {Number(c.avg_quality).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <Th>{t('admin_sources_url')}</Th>
                      <Th>{t('admin_sources_scanned')}</Th>
                      <Th>{t('admin_sources_useful')}</Th>
                      <Th>{t('admin_sources_useful_rate')}</Th>
                      <Th>{t('admin_sources_last_useful')}</Th>
                      <Th>{t('admin_sources_failures')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <LoadingRows cols={6} />
                    ) : filteredHealth.length === 0 ? (
                      <EmptyRow cols={6} label={t('admin_sources_health_empty')} />
                    ) : (
                      filteredHealth.map(s => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2.5 max-w-[260px]">
                            <span className="truncate block text-xs">{s.url}</span>
                            {s.compatible_profiles?.length > 0 && (
                              <div className="text-xs text-muted-foreground truncate">
                                {s.compatible_profiles.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs">{s.scanned_signal_count ?? 0}</td>
                          <td className="px-4 py-2.5 text-xs">{s.useful_signal_count ?? 0}</td>
                          <td className="px-4 py-2.5 text-xs">
                            {/*
                              NULL means nothing has been scanned. Rendering it
                              as 0% would state that the source produces
                              nothing, which is a claim about the source rather
                              than about us.
                            */}
                            {s.useful_rate === null || s.useful_rate === undefined
                              ? <span className="text-muted-foreground">{t('admin_sources_not_scanned')}</span>
                              : `${(Number(s.useful_rate) * 100).toFixed(1)}%`}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                            {when(s.last_useful_at)}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {Number(s.failure_count ?? 0) > 0 ? (
                              <span className="text-destructive" title={s.last_failure_reason ?? ''}>
                                {s.failure_count}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Access: connected research sessions ────────────────────────── */}
        <TabsContent value="access">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t('admin_sources_access_note')}
              </p>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : connections.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin_sources_access_empty')}</p>
              ) : (
                <div className="space-y-2">
                  {connections.map(c => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[13px]">{c.platform}</Badge>
                          <span className="text-sm font-medium truncate">{c.label}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t('admin_sources_last_validated')}: {when(c.last_validated_at)}
                          {c.expires_at && ` · ${t('admin_sources_expires')}: ${when(c.expires_at)}`}
                          {Number(c.consecutive_failures ?? 0) > 0 &&
                            ` · ${t('admin_sources_failures')}: ${c.consecutive_failures}`}
                        </div>
                      </div>
                      <Badge
                        variant={c.status === 'CONNECTED' ? 'default' : c.status === 'ACTION_REQUIRED' ? 'destructive' : 'outline'}
                        className="text-[13px]"
                      >
                        {c.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Queue: sources that need a person ──────────────────────────── */}
        <TabsContent value="queue">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">{t('admin_sources_queue_note')}</p>
              {loading ? (
                <Skeleton className="h-16 w-full" />
              ) : queue.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin_sources_queue_empty')}</p>
              ) : (
                <div className="space-y-2">
                  {queue.map(r => (
                    <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <a
                            href={r.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-sm truncate block"
                          >
                            {r.source_name || r.source_url}
                          </a>
                          <div className="text-xs text-muted-foreground mt-0.5">{r.rationale}</div>
                          <div className="text-xs text-muted-foreground">
                            {[r.city, r.country_code, (r.languages ?? []).join('/'), (r.profiles ?? []).join(', ')]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[13px]">{r.state}</Badge>
                      </div>
                      {(r.state === 'REQUESTED' || r.state === 'IN_PROGRESS') && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => decide(r.id, 'IN_PROGRESS')}>
                            {t('admin_sources_queue_in_progress')}
                          </Button>
                          <Button size="sm" onClick={() => decide(r.id, 'APPROVED')}>
                            {t('admin_sources_queue_approve')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => decide(r.id, 'REJECTED')}>
                            {t('admin_sources_queue_reject')}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
      {children}
    </th>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td colSpan={cols} className="px-4 py-2">
            <Skeleton className="h-5 w-full" />
          </td>
        </tr>
      ))}
    </>
  );
}

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}
