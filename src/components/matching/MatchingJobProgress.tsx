/**
 * MatchingJobProgress — real-time progress panel for a match-campaign job.
 * Subscribes to matching_jobs + matching_job_events via Supabase Realtime.
 * Falls back to polling every 8 s when Realtime is unavailable.
 * Restores state from DB on mount/refresh (no in-memory-only state).
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle,
  Search, Database, Cpu, Users, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  status: string;
  progress: number;
  current_step: string | null;
  current_tier: number;
  query_packs_created: number;
  queries_run: number;
  signals_collected: number;
  signals_classified: number;
  signals_rejected: number;
  candidates_after_filter: number;
  matches_created: number;
  tiers_run: number;
  cost_usd_total: number;
  provider_results: Record<string, string> | null;
  failure_reason: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  stream?: 'matching' | 'external';
}

interface Props {
  jobId: string;
  propertyId?: string;
  onComplete?: (job: JobRow) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL = new Set(['completed', 'partially_completed', 'failed', 'cancelled', 'paused']);

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'partially_completed') return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    queued: 'Queued',
    analysing_property: 'Analysing property',
    generating_queries: 'Generating queries',
    searching_sources: 'Searching sources',
    collecting_results: 'Collecting results',
    normalizing: 'Normalising',
    deduplicating: 'Deduplicating',
    classifying: 'Classifying',
    ranking: 'Ranking',
    completed: 'Completed',
    partially_completed: 'Partially completed',
    failed: 'Failed',
    paused: 'Paused',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}

function providerBadge(key: string, value: string) {
  const color =
    value === 'LIVE' ? 'bg-green-500/15 text-green-700 border-green-300' :
    value === 'FAILED' ? 'bg-destructive/15 text-destructive border-destructive/30' :
    value === 'NOT_CONFIGURED' ? 'bg-muted text-muted-foreground border-border' :
    'bg-yellow-500/15 text-yellow-700 border-yellow-300';
  return (
    <span key={key} className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border', color)}>
      {key.toUpperCase()}: {value}
    </span>
  );
}

function eventIcon(type: string) {
  if (type.startsWith('DFSEO') || type.startsWith('DATAFORSEO')) return <Search className="h-3 w-3 shrink-0 text-blue-500" />;
  if (type.startsWith('APIFY')) return <Database className="h-3 w-3 shrink-0 text-purple-500" />;
  if (type.startsWith('CLASSIFY') || type.startsWith('OPENAI')) return <Cpu className="h-3 w-3 shrink-0 text-orange-500" />;
  if (type.includes('MATCH') || type.includes('CANDIDATE')) return <Users className="h-3 w-3 shrink-0 text-green-500" />;
  if (type.includes('ERROR') || type.includes('FAIL') || type.includes('FATAL')) return <XCircle className="h-3 w-3 shrink-0 text-destructive" />;
  return <div className="h-3 w-3 shrink-0 rounded-full bg-muted-foreground/40 mt-0.5" />;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MatchingJobProgress({ jobId, propertyId, onComplete }: Props) {
  const [job, setJob] = useState<JobRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [externalEvents, setExternalEvents] = useState<EventRow[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load snapshot from DB
  const loadJob = async () => {
    const { data } = await supabase
      .from('matching_jobs')
      .select('id,status,progress,current_step,current_tier,query_packs_created,queries_run,signals_collected,signals_classified,signals_rejected,candidates_after_filter,matches_created,tiers_run,cost_usd_total,provider_results,failure_reason,error_message,started_at,completed_at')
      .eq('id', jobId)
      .maybeSingle();
    if (data) setJob(data as JobRow);
    return data as JobRow | null;
  };

  const loadEvents = async () => {
    const { data } = await supabase
      .from('matching_job_events')
      .select('id,event_type,payload,created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    if (data) setEvents((data as EventRow[]).map(event => ({ ...event, stream: 'matching' })));
  };

  const loadExternalEvents = async () => {
    if (!propertyId) return;
    const { data } = await supabase
      .from('external_discovery_events')
      .select('id,event_type,payload,created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (data) setExternalEvents((data as EventRow[]).map(event => ({ ...event, stream: 'external' })));
  };

  // Scroll event list to bottom on new events
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events.length, externalEvents.length]);

  useEffect(() => {
    // Initial load
    loadJob();
    loadEvents();
    loadExternalEvents();

    // Realtime: matching_jobs row changes
    const jobChannel = supabase
      .channel(`mj-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'matching_jobs',
        filter: `id=eq.${jobId}`,
      }, (payload) => {
        const updated = payload.new as JobRow;
        setJob(updated);
        if (TERMINAL.has(updated.status) && !completedRef.current) {
          completedRef.current = true;
          onComplete?.(updated);
        }
      })
      .subscribe();

    // Realtime: new events
    const evChannel = supabase
      .channel(`mje-${jobId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matching_job_events',
        filter: `job_id=eq.${jobId}`,
      }, (payload) => {
        setEvents(prev => {
          const e = payload.new as EventRow;
          if (prev.find(x => x.id === e.id)) return prev;
          return [...prev, e];
        });
      })
      .subscribe();

    const externalChannel = propertyId
      ? supabase
          .channel(`ede-${propertyId}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'external_discovery_events',
            filter: `property_id=eq.${propertyId}`,
          }, (payload) => {
            setExternalEvents(prev => {
              const externalEvent = { ...(payload.new as EventRow), stream: 'external' as const };
              if (prev.some(item => item.id === externalEvent.id)) return prev;
              return [...prev, externalEvent];
            });
          })
          .subscribe()
      : null;

    // Polling fallback (every 8 s) — also updates when Realtime misses events
    pollingRef.current = setInterval(async () => {
      const j = await loadJob();
      await loadEvents();
      await loadExternalEvents();
      if (j && TERMINAL.has(j.status) && !completedRef.current) {
        completedRef.current = true;
        onComplete?.(j);
        if (pollingRef.current) clearInterval(pollingRef.current);
      }
    }, 8_000);

    return () => {
      supabase.removeChannel(jobChannel);
      supabase.removeChannel(evChannel);
      if (externalChannel) supabase.removeChannel(externalChannel);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, propertyId]);

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading job…
      </div>
    );
  }

  const isTerminal = TERMINAL.has(job.status);
  const timeline = [...events, ...externalEvents]
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const visibleEvents = showAllEvents ? timeline : timeline.slice(-20);

  return (
    <div className="rounded-xl border border-border bg-card space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(job.status)}
          <span className="font-semibold text-sm truncate">{statusLabel(job.status)}</span>
          {job.current_step && !isTerminal && (
            <span className="text-xs text-muted-foreground truncate hidden md:inline">
              — {job.current_step}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 font-mono">
          {job.id.slice(0, 8)}…
        </span>
      </div>

      {/* Progress bar */}
      {!isTerminal && (
        <Progress value={job.progress} className="h-1.5" />
      )}

      {/* Provider status */}
      {job.provider_results && Object.keys(job.provider_results).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(job.provider_results).map(([k, v]) => providerBadge(k, v))}
        </div>
      )}

      {/* Counters grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {[
          { label: 'Query packs', value: job.query_packs_created },
          { label: 'Queries run', value: job.queries_run },
          { label: 'Signals', value: job.signals_collected },
          { label: 'Classified', value: job.signals_classified },
          { label: 'Rejected', value: job.signals_rejected },
          { label: 'Candidates', value: job.candidates_after_filter },
          { label: 'Matches', value: job.matches_created },
          { label: 'Tiers run', value: job.tiers_run },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted/50 rounded-lg px-2 py-1.5">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      {/* Cost */}
      {job.cost_usd_total > 0 && (
        <div className="text-xs text-muted-foreground">
          Cost so far: <span className="font-mono text-foreground">${job.cost_usd_total.toFixed(4)}</span>
        </div>
      )}

      {/* Error */}
      {job.status === 'failed' && job.error_message && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
          <strong>{job.failure_reason ?? 'Error'}</strong>: {job.error_message}
        </div>
      )}

      {/* Events log */}
      {timeline.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Live process ({timeline.length})
            </span>
            {timeline.length > 20 && (
              <button
                className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setShowAllEvents(v => !v)}
              >
                {showAllEvents ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show all</>}
              </button>
            )}
          </div>
          <ScrollArea className="h-48 rounded-md border border-border bg-muted/30">
            <div ref={scrollRef} className="p-2 space-y-1">
              {visibleEvents.map(ev => (
                <div key={ev.id} className="flex items-start gap-1.5 text-[11px] font-mono">
                  {eventIcon(ev.event_type)}
                  <span className={cn(
                    'shrink-0',
                    ev.event_type.includes('ERROR') || ev.event_type.includes('FAIL') || ev.event_type.includes('FATAL')
                      ? 'text-destructive' : 'text-muted-foreground'
                  )}>
                    {ev.stream === 'external' ? 'EXTERNAL · ' : ''}{ev.event_type}
                  </span>
                  <span className="text-foreground/70 truncate">
                    {String(
                      ev.payload?.message ??
                      [
                        ev.payload?.provider,
                        ev.payload?.platform,
                        ev.payload?.itemCount != null ? `${String(ev.payload.itemCount)} results` : null,
                        ev.payload?.actualCostUsd != null ? `${Number(ev.payload.actualCostUsd).toFixed(4)}` : null,
                      ].filter(Boolean).join(' · ') ??
                      ''
                    ).slice(0, 160)}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
