/**
 * MatchingJobProgress — real-time progress panel for a match-campaign job.
 * Subscribes to matching_jobs + matching_job_events via Supabase Realtime.
 * Falls back to polling every 8 s when Realtime is unavailable.
 * Restores state from DB on mount/refresh (no in-memory-only state).
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
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
  signals_collected: number;
  signals_classified: number;
  signals_rejected: number;
  candidates_after_filter: number;
  matches_created: number;
  /*
   * NOT SELECTED, and the omission is the point.
   *
   * cost_usd_total, provider_results, query_packs_created, queries_run,
   * tiers_run, failure_reason and error_message all still exist on
   * matching_jobs and the admin view still reads every one. A customer
   * component should not hold Homatch's internal cost or its suppliers'
   * names in memory at all -- not rendering them is one edit away from
   * rendering them again, which is how they got here.
   */
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

// Exported so other views showing matching_jobs state (e.g. the Dashboard's
// live-matching card) render the exact same status vocabulary instead of
// re-deriving their own — the two used to drift out of sync when the
// Dashboard read from a different, now-removed progress table entirely.
export const MATCHING_JOB_TERMINAL_STATUSES = ['completed', 'partially_completed', 'failed', 'cancelled', 'paused'] as const;
const TERMINAL = new Set<string>(MATCHING_JOB_TERMINAL_STATUSES);

// The non-terminal lifecycle order, in the sequence a job actually moves
// through — used to render a step-by-step progress stepper.
export const MATCHING_JOB_STEP_ORDER = [
  'queued', 'analysing_property', 'generating_queries', 'searching_sources',
  'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking',
] as const;

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'partially_completed') return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />;
  return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
}

// Stable machine status codes (queued, analysing_property, …) map to
// translated labels via the caller's own `t` — kept as a plain function
// (not a component) so it stays callable from non-hook contexts, with `t`
// threaded in as a parameter instead of calling useLanguage() here.
export function statusLabel(status: string, t: (key: string) => string) {
  const keyMap: Record<string, string> = {
    queued: 'mjp_status_queued',
    analysing_property: 'mjp_status_analysing',
    generating_queries: 'mjp_status_generating_queries',
    searching_sources: 'mjp_status_searching',
    collecting_results: 'mjp_status_collecting',
    normalizing: 'mjp_status_normalizing',
    deduplicating: 'mjp_status_deduplicating',
    classifying: 'mjp_status_classifying',
    ranking: 'mjp_status_ranking',
    completed: 'mjp_status_completed',
    partially_completed: 'mjp_status_partial',
    failed: 'mjp_status_failed',
    paused: 'mjp_status_paused',
    cancelled: 'mjp_status_cancelled',
  };
  const key = keyMap[status];
  return key ? t(key) : status;
}

/**
 * What this step was, in words the customer already has.
 *
 * The raw event_type used to be printed: DFSEO_TASK_COMPLETE,
 * CLASSIFY_BATCH_START, APIFY_RUN_FAILED. That is our queue's vocabulary --
 * it names suppliers, internal stages and, in two cases, providers that have
 * been retired -- and it was rendering in monospace on a customer's own
 * search.
 *
 * Every phrase below is an EXISTING mjp_status_* string, already translated
 * into all six languages for the status line at the top of this panel. So
 * the feed now says "Classifying" where it said CLASSIFY_BATCH_START, and an
 * event nobody has mapped says "Analysing" rather than leaking its token.
 */
function eventLabel(t: (key: string) => string, type: string): string {
  const upper = String(type || '').toUpperCase();
  if (/ERROR|FAIL|FATAL/.test(upper)) return t('mjp_error_fallback');
  if (/COMPLETE|DONE|FINISH/.test(upper)) return t('mjp_status_completed');
  if (/CLASSIFY|OPENAI|INTENT/.test(upper)) return t('mjp_status_classifying');
  if (/DEDUP|RESOLVE|ENTITY/.test(upper)) return t('mjp_status_deduplicating');
  if (/NORMALI/.test(upper)) return t('mjp_status_normalizing');
  if (/MATCH|CANDIDATE|RANK|SCORE/.test(upper)) return t('mjp_status_ranking');
  if (/QUERY|PACK|PLAN/.test(upper)) return t('mjp_status_generating_queries');
  if (/SEARCH|DISCOVER|SCAN|SUPPLY|FETCH/.test(upper)) return t('mjp_status_searching');
  if (/SIGNAL|COLLECT/.test(upper)) return t('mjp_status_collecting');
  return t('mjp_status_analysing');
}

function eventIcon(type: string) {
  /* Shapes of work, not names of suppliers. The first two branches here
     tested for DFSEO and APIFY, both retired. */
  if (type.startsWith('CLASSIFY') || type.startsWith('OPENAI')) return <Cpu className="h-3 w-3 shrink-0 text-orange-500" />;
  if (/SEARCH|DISCOVER|SCAN|SUPPLY|FETCH|QUERY/.test(type)) return <Search className="h-3 w-3 shrink-0 text-blue-500" />;
  if (/SIGNAL|COLLECT|NORMALI/.test(type)) return <Database className="h-3 w-3 shrink-0 text-purple-500" />;
  if (type.includes('MATCH') || type.includes('CANDIDATE')) return <Users className="h-3 w-3 shrink-0 text-green-500" />;
  if (type.includes('ERROR') || type.includes('FAIL') || type.includes('FATAL')) return <XCircle className="h-3 w-3 shrink-0 text-destructive" />;
  return <div className="h-3 w-3 shrink-0 rounded-full bg-muted-foreground/40 mt-0.5" />;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MatchingJobProgress({ jobId, propertyId, onComplete }: Props) {
  const { t } = useLanguage();
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
      .select('id,status,progress,current_step,current_tier,signals_collected,signals_classified,signals_rejected,candidates_after_filter,matches_created,started_at,completed_at')
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
        <Loader2 className="h-4 w-4 animate-spin" /> {t('mjp_loading_job')}
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
          <span className="font-semibold text-sm truncate">{statusLabel(job.status, t)}</span>
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

      {/*
        NO PROVIDER BADGES. This rendered job.provider_results as
        "DATAFORSEO: LIVE" and "APIFY: FAILED" in monospace, on a page a
        CUSTOMER opens -- MatchesPage and PropertyDetailPage both mount this.
        Which suppliers Homatch buys from is not something a customer should
        have to read, and two of the names were retired providers besides.

        NO COST LINE EITHER. It printed job.cost_usd_total to four decimal
        places, which is HOMATCH'S internal cost of running the search, not
        the customer's charge. The customer's price is in Credits and is
        shown where they unlock; the money it costs us to find a lead is ours
        to know. Admin keeps both.
      */}

      {/* Counters grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {[
          /*
            The crawler's own stages are gone: query packs, queries run and
            tiers run are how the search is BUILT, not what it FOUND, and a
            customer reading "Tiers run 3" has been handed our architecture
            to interpret. What is left answers the only question they asked --
            how many people were looked at, and how many matched.
          */
          { label: t('mjp_counter_signals'), value: job.signals_collected },
          { label: t('mjp_counter_classified'), value: job.signals_classified },
          { label: t('mjp_counter_candidates'), value: job.candidates_after_filter },
          { label: t('mjp_counter_matches'), value: job.matches_created },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted/50 rounded-lg px-2 py-1.5">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      {/*
        Error, WITHOUT the internals. This printed job.failure_reason and
        job.error_message verbatim -- enum names like
        NO_INTERNAL_MATCHES_EXTERNAL_LOCKED and whatever string a worker
        threw, including provider and queue wording. A customer cannot act on
        either, and both are kept for the admin view and the job record.
      */}
      {job.status === 'failed' && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
          {t('mjp_error_fallback')}
        </div>
      )}

      {/* Events log */}
      {timeline.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('mjp_live_process', { count: timeline.length })}
            </span>
            {timeline.length > 20 && (
              <button
                className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setShowAllEvents(v => !v)}
              >
                {showAllEvents ? <><ChevronUp className="h-3 w-3" /> {t('mjp_show_less')}</> : <><ChevronDown className="h-3 w-3" /> {t('mjp_show_all')}</>}
              </button>
            )}
          </div>
          <ScrollArea className="h-48 rounded-md border border-border bg-muted/30">
            <div ref={scrollRef} className="p-2 space-y-1">
              {visibleEvents.map(ev => (
                <div key={ev.id} className="flex items-start gap-1.5 text-[14px] font-mono">
                  {eventIcon(ev.event_type)}
                  <span className={cn(
                    'shrink-0',
                    ev.event_type.includes('ERROR') || ev.event_type.includes('FAIL') || ev.event_type.includes('FATAL')
                      ? 'text-destructive' : 'text-muted-foreground'
                  )}>
                    {ev.stream === 'external' ? `${t('mjp_external_prefix')} ` : ''}{eventLabel(t, ev.event_type)}
                  </span>
                  <span className="text-foreground/70 truncate">
                    {/*
                      MESSAGE ONLY. The fallback used to assemble
                      payload.provider and payload.actualCostUsd into the
                      line, so a customer watching their own search read the
                      supplier's name and what that step cost Homatch, to
                      four decimal places. `message` is copy somebody wrote
                      to be read; the rest is instrumentation.
                    */}
                    {String(ev.payload?.message ?? '').slice(0, 160)}
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
