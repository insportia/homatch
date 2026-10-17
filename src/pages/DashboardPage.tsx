// HOMATCH — the authenticated Dashboard.
//
// Same brand as the Main Page: cream ground, navy ink, gold accent, and the
// same restraint about surfaces. The first pass laid this out as a dozen
// separate cards; this one groups them, because a dozen equal rectangles is
// exactly what makes a dashboard look like a template. There are now five
// surfaces — the welcome banner, the actions group, the workspace, the
// assistant, and the three-up footer group — and the divisions inside each
// are hairlines, not more borders.
//
// EVERY NUMBER ON THIS SCREEN IS REAL
//
// The reference is populated with invented figures (12 active clients, 28
// matched properties, named buyers at 92%). None of that is reproduced. Each
// group reads from loadDashboardSummary(), which queries only tables this
// user owns, and renders a designed empty state when the answer is nothing.
// The "+n this week" lines are computed from created_at, not decoration.
//
// It answers, in reading order: who you are and where you stand (banner),
// what you can do now (four primary actions), what Homatch has found
// (matches, properties), and what is in flight (verifications, financing,
// activity).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, CheckCircle2, CircleDollarSign, FileUp, Loader2, MapPin, Radar,
  Search, ShieldCheck, Sparkles, Trash2, TrendingUp, UserSearch, Users, Zap,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
// The dashboard used to reach for HomatchShell directly, which is why it
// was the only screen with a sidebar. It now comes through AppLayout like
// every other authenticated page -- same shell, plus the assistant, the
// floating button and the mobile bottom nav it was quietly missing.
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { HomatchAsk, type AskAction } from '@/components/home/HomatchAsk';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { softDeleteProperty } from '@/services/api';
import { isMatchingJobLive, type LiveMatchingJob } from '@/services/matchingProgress';
import { statusLabel as jobStatusLabel } from '@/components/matching/MatchingJobProgress';
import {
  EMPTY_DASHBOARD_SUMMARY, loadDashboardSummary,
  type DashboardMatch, type DashboardSummary,
} from '@/services/dashboardSummary';
import type { ResearchJobRecord } from '@/types/types';
import { checkLabel } from '@/components/verify/VerifyCheckList';
import type { ActivityEvent, Property } from '@/types/types';
import { activityLabelKey } from '@/lib/activityPresentation';
import { PrivateImage } from '@/components/common/PrivateImage';
import { toast } from 'sonner';
import { useServiceControls, type ServiceKey } from '@/lib/serviceControls';

/* ------------------------------------------------------------------ *
 * Presentational primitives                                           *
 * ------------------------------------------------------------------ */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[0.9rem] border border-foreground/15 bg-card shadow-card ${className}`}>{children}</section>;
}

function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    /* A fixed header height, not a truncated title: a two-line group name
       (Georgian and Russian both run long) wraps inside the same 3.5rem band,
       so the header rules of adjacent columns still line up. */
    <div className="flex min-h-[3.5rem] items-center justify-between gap-3 border-b border-border px-5 py-3">
      <h2 className="flex min-w-0 items-center gap-2.5 text-balance text-[16px] font-semibold uppercase leading-tight tracking-[0.08em] text-foreground">
        <span className="h-4 w-1 shrink-0 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        <span className="min-w-0 break-words">{title}</span>
      </h2>
      {action}
    </div>
  );
}

function LinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  const { isRTL } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium text-gold-ink transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label} <ArrowRight className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );
}

function EmptyState({ icon: Icon, title, hint, action }: {
  icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-10 text-center">
      {/* Same grammar as the action tiles: a warm ring, not a grey box. */}
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[hsl(var(--gold))]/10 ring-1 ring-inset ring-[hsl(var(--gold))]/25 text-[hsl(var(--gold-ink))]" aria-hidden="true">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cards                                                               *
 * ------------------------------------------------------------------ */

/**
 * One count inside the banner's inline strip. These used to be four separate
 * bordered cards; four numbers are a summary, not four objects, so they share
 * one surface and are separated by hairlines.
 */
function Count({ icon: Icon, label, value, note, loading, onClick, testId }: {
  icon: React.ElementType; label: string; value: number | null; note?: string | null; loading: boolean;
  /** A count that names a place to go opens it (owner, 2026-10-17: every figure leads somewhere). */
  onClick?: () => void; testId?: string;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-start gap-2.5">
        {/* Premium, not grey: the navy disc and gold glyph of the HOMATCH mark. */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] shadow-[0_8px_18px_-12px_hsl(218_60%_15%/0.7)]" aria-hidden="true">
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 break-words pt-0.5 text-2xs font-semibold uppercase leading-snug tracking-[0.08em] text-[hsl(218_28%_38%)]">
          {label}
        </span>
      </span>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-14" />
      ) : (
        <span className="mt-3 block font-display text-[2.25rem] font-bold leading-none tracking-[-0.03em] text-[hsl(218_45%_14%)] tabular-nums" dir="ltr">
          {value ?? '—'}
        </span>
      )}
      {!loading && note && (
        <span className="mt-2.5 inline-flex max-w-full items-center gap-1 rounded-md bg-[hsl(40_94%_60%/0.14)] px-1.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_32%)] ring-1 ring-inset ring-[hsl(40_90%_55%/0.35)]">
          <span className="min-w-0 break-words">{note}</span>
        </span>
      )}
    </>
  );
  const cls = 'relative block h-full w-full min-w-0 px-5 py-5 text-start sm:px-6 sm:py-6';
  return onClick ? (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`${cls} transition-colors hover:bg-[hsl(40_60%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_50%)]`}>
      {body}
    </button>
  ) : <div className={cls} data-testid={testId}>{body}</div>;
}

/**
 * One of the four primary actions. They live inside a single bordered group
 * divided by hairlines, so they read as one control surface rather than four
 * competing cards.
 */
function ActionTile({ icon: Icon, title, desc, onClick }: {
  icon: React.ElementType; title: string; desc: string; onClick: () => void;
}) {
  const { t, isRTL } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col items-start p-5 text-start transition-colors hover:bg-[hsl(var(--gold-soft))]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6"
    >
      {/*
        NOT A GREY BOX. A ring and a warm wash at a tenth opacity, so the icon is the
        object rather than its container — four destinations stopped looking identical the
        moment the box came off. It deepens on hover instead of changing shape.
      */}
      <span
        className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)] shadow-[0_8px_18px_-12px_hsl(218_60%_15%/0.7)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.3)] transition-shadow duration-300 group-hover:ring-[hsl(40_90%_60%/0.6)] motion-reduce:transition-none"
        aria-hidden="true"
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
      </span>
      <span className="mt-4 block font-display text-base font-semibold leading-snug tracking-[-0.012em] text-foreground">
        {title}
      </span>
      <span className="mt-1.5 block flex-1 text-2xs leading-relaxed text-muted-foreground">{desc}</span>
      {/*
        A CONTAINED ACTION, not an arrow alone in a corner. The tile is the button and
        always was; nothing said so. This states the destination and the arrow travels
        with the words rather than away from them.
      */}
      <span className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[hsl(40_60%_76%)] bg-[hsl(40_60%_98%)] px-3 py-1.5 text-2xs font-semibold text-[hsl(218_45%_14%)] transition-colors group-hover:border-[hsl(38_92%_56%)] group-hover:text-[hsl(34_90%_32%)]">
        {t('db_tile_open')}
        <ArrowRight
          className={`h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-0.5' : ''}`}
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

/** A live search. Real progress from matching_jobs, or nothing at all — presented as the
    premium, navy/gold module it is, its name in full (never truncated) on any phone. */
function LiveRunStrip({ run, propertyTitle, onOpen }: {
  run: LiveMatchingJob; propertyTitle: string; onOpen: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const pct = Math.max(0, Math.min(100, Math.round(Number(run.progress) || 0)));
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="dash-live-run"
      className="group relative w-full overflow-hidden rounded-2xl bg-[linear-gradient(135deg,hsl(218_52%_11%),hsl(218_48%_17%))] p-4 text-start text-white shadow-[0_18px_40px_-24px_hsl(218_60%_15%/0.8)] ring-1 ring-inset ring-[hsl(40_80%_55%/0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 sm:p-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] text-[hsl(218_52%_11%)]" aria-hidden="true">
          <Radar className="h-5 w-5 motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-display text-[15px] font-semibold leading-snug">{t('dash_live_title')}</p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-[hsl(218_40%_84%)]">
            {jobStatusLabel(run.status, t)}{propertyTitle ? <> · <span dir="auto">{propertyTitle}</span></> : null}
          </p>
        </div>
        <span className="shrink-0 font-display text-xl font-bold tabular-nums text-[hsl(40_94%_66%)]" dir="ltr">{pct}%</span>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('dash_live_title')}>
        <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(40_94%_62%),hsl(34_90%_50%))] transition-all duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <span className="mt-3.5 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-[hsl(40_94%_74%)] ring-1 ring-inset ring-[hsl(40_94%_60%/0.35)] transition-colors group-hover:bg-white/15">
        <span className="break-words">{t('dash_live_open')}</span>
        <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
      </span>
    </button>
  );
}

function MatchRow({ entry, onOpen }: { entry: DashboardMatch; onOpen: () => void }) {
  const { t } = useLanguage();
  const { match, property } = entry;
  const budget = match.preview_budget_min || match.preview_budget_max
    ? [match.preview_budget_min, match.preview_budget_max]
        .filter(Boolean)
        .map(n => Number(n).toLocaleString())
        .join(' – ')
    : null;

  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sand text-foreground" aria-hidden="true">
        <Users className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {match.preview_city || property.title || t('as_default_property_name')}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            budget ? `${t('db_match_budget')} ${budget}${match.preview_currency ? ` ${match.preview_currency}` : ''}` : null,
            match.preview_bedrooms ? `${match.preview_bedrooms} ${t('prop_bedrooms')}` : null,
            match.preview_platform,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="shrink-0 text-end">
        <p className="text-sm font-semibold tabular-nums text-success">{match.match_score}%</p>
        <p className="text-[13px] uppercase tracking-wider text-muted-foreground">{t('db_match_fit')}</p>
      </div>

      <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-full border-border bg-card px-3 text-xs" onClick={onOpen}>
        {t('db_match_open')}
      </Button>
    </div>
  );
}

function PropertyRow({ property, run, onOpen, onDelete }: {
  property: Property; run?: LiveMatchingJob; onOpen: () => void; onDelete: () => void;
}) {
  const { t } = useLanguage();
  const facts = property.facts;
  const location = [facts?.district, facts?.city].filter(Boolean).join(', ');
  const running = !!run && isMatchingJobLive(run.status);
  /* matchability_score is null in production (see MyPropertiesPage): showing
     "0%" labelled "best match score" invents a metric. No score, no figure. */
  const score = running ? run.progress : property.matchability_score ?? null;

  return (
    <div className="group flex items-center gap-3 px-5 py-3.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="h-11 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
          {/* The cover is either an imported listing's own URL or a path in
              the private bucket. PrivateImage tells them apart and signs the
              second kind, showing the placeholder until it has a URL. */}
          <PrivateImage
            src={property.cover_photo_url}
            alt=""
            className="h-full w-full object-cover"
            fallback={(
              <span className="grid h-full w-full place-items-center text-muted-foreground" aria-hidden="true">
                <Building2 className="h-4 w-4" />
              </span>
            )}
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {property.title || t('dash_imported_property')}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {location && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{location}</span>
              </span>
            )}
            {facts?.total_price && (
              <span className="shrink-0 font-medium text-foreground">
                {Number(facts.total_price).toLocaleString()} {facts.currency ?? ''}
              </span>
            )}
          </span>
        </span>

        {score != null && (
          <span className="hidden shrink-0 text-end sm:block">
            <span className="block text-sm font-semibold tabular-nums text-foreground">{score}%</span>
            <span className="block text-[13px] uppercase tracking-wider text-muted-foreground">
              {running ? t('dash_label_ai_progress') : t('dash_label_best_match')}
            </span>
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onDelete}
        aria-label={t('dash_delete_property_aria')}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}



function VerificationRow({ record, onOpen }: { record: ResearchJobRecord; onOpen: () => void }) {
  const { t, lang } = useLanguage();

  /*
   * A VERIFICATION IS A RESEARCH RUN.
   *
   * This row used to take a DealRoomRecord and show its stored verdict — so
   * the dashboard listed storage containers, counted 8 of them as the
   * customer's verifications while the account held 67 completed runs, and
   * opened the retired workspace on click. Named and stated the same way the
   * Verification Center's own list does, so one thing is not described two
   * ways in two places.
   */
  const status = String(record.status ?? '').toUpperCase();
  const running = status === 'QUEUED' || status === 'RUNNING' || status === 'PENDING' || status === 'IN_PROGRESS';
  const failed = status === 'FAILED' || status === 'ERROR';
  const label = running ? t('vh_state_running') : failed ? t('vh_state_failed') : t('db_verify_done');
  const pill = running ? 'status-low' : failed ? 'status-paused' : 'status-active';
  const when = record.created_at ? new Date(record.created_at).toLocaleDateString(lang) : '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-5 py-3 text-start transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {checkLabel(record, t('verify_untitled_case_title'))}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{when}</span>
      </span>
      <span className={`${pill} shrink-0`}>{label}</span>
    </button>
  );
}

/* The label map lives in src/lib/activityPresentation.ts, shared with the
   Activity page, so the two surfaces never disagree about an event's words —
   or about which rows are feed entries at all (telemetry and unmapped types
   return null there and are filtered out, never rendered as a raw enum). */
function ActivityRow({ event }: { event: ActivityEvent }) {
  const { t } = useLanguage();
  const key = activityLabelKey(event.event_type);
  if (!key) return null;
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-ink" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{t(key)}</span>
        <span className="block text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Page                                                                *
 * ------------------------------------------------------------------ */

function DashboardContent() {
  useSurfaceTheme('light');
  const { homatchUser } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  /* A paused product (Admin → Service Control Center) offers no shortcut here. */
  const { services } = useServiceControls();
  const shown = (service: ServiceKey) => services[service].frontend;

  const [data, setData] = useState<DashboardSummary>(EMPTY_DASHBOARD_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Guards against an in-flight load resolving after a newer one — the same
  // race the previous dashboard hit, where a poll started just before a
  // delete could resurrect the deleted property on screen.
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!homatchUser) return;
    const seq = ++requestSeq.current;
    try {
      const next = await loadDashboardSummary(homatchUser.id);
      if (seq !== requestSeq.current) return;
      setData(next);
      setError(false);
    } catch {
      if (seq !== requestSeq.current) return;
      setError(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { void refresh(); }, [refresh]);

  const liveRuns = useMemo(
    () => Object.values(data.progress).filter(r => isMatchingJobLive(r.status)),
    [data.progress],
  );

  // Poll only while something is actually running. The previous dashboard
  // polled every 3s forever, including for an idle account with nothing to
  // update — that is a request every three seconds per open tab, all day.
  useEffect(() => {
    if (!homatchUser || liveRuns.length === 0) return;
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, [homatchUser, liveRuns.length, refresh]);

  const handleDelete = async () => {
    if (!deleteId) return;
    await softDeleteProperty(deleteId);
    setDeleteId(null);
    toast.success(t('dash_toast_property_deleted'));
    await refresh();
  };

  const firstName = homatchUser?.full_name?.split(' ')[0];
  const propertiesById = useMemo(
    () => new Map(data.properties.map(p => [p.id, p])),
    [data.properties],
  );

  /** The four primary actions, in the order the product argues for: the
      assistant first, because it is how the rest is reached, then the two
      matching directions, then verification. Mortgage and outreach are
      secondary and live further down; putting six here would flatten the
      hierarchy the last pass just built. */
  const primaryActions = [
    { key: 'ai', icon: Sparkles, title: t('db_qa_ai_title'), desc: t('db_qa_ai_desc'), path: '/ai' },
    /* "Find interested people" is the owner workspace's job — sending it to the
       add-property FORM was the exact mislink HomatchShell's nav notes record
       removing. And "find a property" is the discovery product, not the
       assistant. Each tile now opens the product it names. */
    { key: 'client', icon: UserSearch, title: t('db_qa_client_title'), desc: t('db_qa_client_desc'), path: '/property' },
    { key: 'property', icon: Search, title: t('db_qa_property_title'), desc: t('db_qa_property_desc'), path: '/find-property' },
    { key: 'verify', icon: ShieldCheck, title: t('db_qa_verify_title'), desc: t('db_qa_verify_desc'), path: '/verify' },
  ].filter((action) => shown(({ ai: 'ai_assistant', client: 'find_buyers', property: 'find_property', verify: 'verify' } as const)[action.key as 'ai' | 'client' | 'property' | 'verify']));
  /* Columns follow what is left, so a paused product leaves no hole. */
  const actionCols = ['', 'xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4'][primaryActions.length] ?? 'xl:grid-cols-4';

  const askActions: AskAction[] = [
    { key: '1', icon: Sparkles, label: t('db_ai_sugg_1') },
    { key: '2', icon: UserSearch, label: t('db_ai_sugg_2') },
    { key: '3', icon: ShieldCheck, label: t('db_ai_sugg_3') },
    { key: '4', icon: CircleDollarSign, label: t('db_ai_sugg_4') },
  ];

  const weekNote = (count: number) => (count > 0 ? t('db_stat_delta_week', { count }) : null);

  /* A brand-new account has no properties, no matches and no verifications.
     That is a beginning, not a fault, so it gets one intentional onboarding
     surface instead of three separate "nothing here" boxes. */
  const isNewAccount =
    !loading && !error && data.properties.length === 0 && data.matchTotals.total === 0 && data.verifications.length === 0;

  return (
    /*
     * THE PANEL HOME, ON THE SHELL'S OWN SURFACE.
     *
     * `.hm-customer` is the application shell's premium light block — refined hairlines,
     * a restrained lift, gold accent relationships, tabular figures. The Dashboard is
     * part of that shell rather than a product viewport, which is why it wears it and
     * Matches does not.
     */
    <AppLayout>
      <div className="hm-customer -mx-4 -my-6 min-h-[calc(100dvh-4rem)] px-4 py-6 md:-mx-6 md:-my-8 md:px-6 md:py-8">
      <div className="space-y-5 md:space-y-6">
        {/* ── 1. Welcome, with the four counts on the same surface ── */}
        <section className="overflow-hidden rounded-[0.9rem] border border-foreground/15 bg-card shadow-card">
          <div className="grid md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            {/* The navy structural greeting — the same frame the approved
                Mortgage hero wears. The four counts below stay on white. */}
            <div className="flex flex-col justify-center bg-[#0C1119] p-7 text-white md:p-9 lg:p-11">
              <h1 className="text-balance font-display text-2xl font-bold tracking-[-0.022em] text-white sm:text-3xl lg:text-4xl">
                {firstName ? t('dash_welcome_back_name', { name: firstName }) : t('dash_welcome_back')}
              </h1>
              <p className="mt-4 max-w-xl text-pretty text-lg leading-relaxed text-white/80">
                {t('db_welcome_sub')}
              </p>
              <span className="mt-6 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
            </div>

            {/* The reference's banner image. Same approved photograph as the
                Main Page hero, cropped tight so it reads as a texture here
                rather than competing with the greeting. */}
            <div className="relative hidden min-h-[15rem] md:block lg:min-h-[17rem]">
              <SceneMedia scene="hero" alt="" sizes="(min-width:1024px) 40vw, 45vw" position="58% 44%" />
              <div className="absolute inset-0 bg-[hsl(30_8%_8%/0.18)]" aria-hidden="true" />
              <div className="absolute inset-y-0 start-0 w-16 bg-gradient-to-r from-[#0C1119] to-transparent rtl:bg-gradient-to-l" aria-hidden="true" />
              <figure className="absolute inset-0 flex items-end p-7 lg:p-8">
                <div className="flex gap-3.5">
                  <span className="w-px shrink-0 self-stretch bg-gold" aria-hidden="true" />
                  <blockquote className="max-w-[22rem] text-pretty text-base font-semibold leading-relaxed text-white drop-shadow-[0_2px_14px_rgba(16,24,36,0.85)]">
                    {t('db_banner_quote')}
                  </blockquote>
                </div>
              </figure>
            </div>
          </div>

          {/* A hairline between modules rather than a drawn grid: four cells boxed by
              rules read as a table of figures, which is what this stopped being. */}
          <div className="grid grid-cols-2 divide-x divide-border border-t border-border rtl:divide-x-reverse xl:grid-cols-4">
            <div className="border-b border-border xl:border-b-0">
              <Count icon={Building2} label={t('dash_total_properties')} value={data.properties.length} note={weekNote(data.propertiesThisWeek)} loading={loading}
                onClick={() => navigate('/property')} testId="dash-stat-properties" />
            </div>
            <div className="border-b border-border xl:border-b-0">
              {/* The people the Find Buyers searches found now — never the legacy matches table,
                  whose old, already-opened contacts read as fresh "matches" (owner, 2026-10-17). */}
              <Count
                icon={Users}
                label={t('dash_stat_people')}
                value={data.people ? data.people.total : null}
                note={data.people && data.people.newCount > 0 ? t('dash_stat_people_new', { count: data.people.newCount }) : null}
                loading={loading}
                onClick={() => navigate(data.properties.length === 1 ? `/property/${data.properties[0].id}/matches` : '/property')}
                testId="dash-stat-people"
              />
            </div>
            <Count icon={ShieldCheck} label={t('db_stat_verifications')} value={data.verifications.length} note={weekNote(data.verificationsThisWeek)} loading={loading}
              onClick={() => navigate('/verify')} testId="dash-stat-verifications" />
            {/* Searches genuinely running now (matching_jobs), not a property's standing flag. */}
            <Count
              icon={Radar}
              label={t('dash_stat_searching')}
              value={liveRuns.length}
              note={liveRuns.length > 0 ? t('dash_live_open') : null}
              loading={loading}
              onClick={liveRuns.length > 0 ? () => navigate(`/property/${liveRuns[0].property_id}/buyers/external`) : undefined}
              testId="dash-stat-searching"
            />
          </div>
        </section>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4">
            <p className="text-sm text-destructive">{t('db_error_load')}</p>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-border bg-card" onClick={() => { setLoading(true); void refresh(); }}>
              {t('db_retry')}
            </Button>
          </div>
        )}

        {/* ── Live matching, only while something is genuinely running ── */}
        {liveRuns.map(run => (
          <LiveRunStrip
            key={run.id}
            run={run}
            propertyTitle={propertiesById.get(run.property_id)?.title ?? ''}
            onOpen={() => navigate(`/property/${run.property_id}/buyers/external`)}
          />
        ))}

        {/* ── 2. The four primary actions, as one group ── */}
        <section className="overflow-hidden rounded-[0.9rem] border border-foreground/15 bg-card shadow-card">
          <div className={`grid divide-y divide-foreground/[0.12] sm:grid-cols-2 sm:divide-x sm:divide-foreground/[0.12] rtl:sm:divide-x-reverse ${actionCols} xl:divide-y-0`}>
            {primaryActions.map(action => (
              <ActionTile
                key={action.key}
                icon={action.icon}
                title={action.title}
                desc={action.desc}
                onClick={() => navigate(action.path)}
              />
            ))}
          </div>
        </section>

        {/* ── 3. Workspace + assistant ── */}
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            {isNewAccount ? (
              <Card className="flex h-full flex-col items-start justify-center p-8 sm:p-10">
                <span className="grid h-12 w-12 place-items-center rounded-[0.6rem] border border-gold/50 bg-gold-soft text-gold-ink" aria-hidden="true">
                  <Sparkles className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h2 className="mt-5 max-w-md text-balance text-lg font-semibold leading-snug text-foreground sm:text-xl">
                  {t('db_onboard_title')}
                </h2>
                <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
                  {t('db_onboard_body')}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  {/* The button names the action it performs. The old pair said
                      "find interested people" and opened the add-property FORM. */}
                  <Button className="h-11 gap-2 rounded-full px-6 text-sm" onClick={() => navigate('/property/add')}>
                    {t('nav_add_property')}
                    <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </Button>
                  {shown('find_property') && (
                    <Button
                      variant="outline"
                      className="h-11 gap-2 rounded-full border-border bg-transparent px-6 text-sm"
                      onClick={() => navigate('/find-property')}
                    >
                      {t('db_qa_property_title')}
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
              /* Matches and properties are one workspace divided by a rule —
                 two views of the same portfolio, not two products. */
              <Card className="h-full">
                <CardHead
                  title={t('db_matches_title')}
                  action={
                    data.matchTotals.topPropertyId && shown('find_buyers')
                      ? <LinkAction label={t('db_matches_view_all')} onClick={() => navigate(`/property/${data.matchTotals.topPropertyId}/matches`)} />
                      : undefined
                  }
                />
                {loading ? (
                  <div className="space-y-3 p-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : data.topMatches.length === 0 ? (
                  <EmptyState icon={Users} title={t('db_matches_empty')} hint={t('db_matches_empty_hint')} />
                ) : (
                  <div className="divide-y divide-foreground/[0.12]">
                    {data.topMatches.map(entry => (
                      <MatchRow
                        key={entry.match.id}
                        entry={entry}
                        onOpen={() => navigate(shown('find_buyers') ? `/property/${entry.match.property_id}/matches` : `/property/${entry.match.property_id}`)}
                      />
                    ))}
                  </div>
                )}

                <div className="border-t border-foreground/[0.12]">
                  <CardHead
                    title={t('db_properties_title')}
                    action={(
                      /* Wraps: two actions side by side overflowed 390px in
                         Russian and Turkish (the matrix caught it). */
                      <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
                        <LinkAction label={t('nav_add_property')} onClick={() => navigate('/property/add')} />
                        {/* The canonical owner workspace is one step away, always. */}
                        <LinkAction label={t('db_properties_all')} onClick={() => navigate('/property')} />
                      </span>
                    )}
                  />
                  {loading ? (
                    <div className="space-y-3 p-5">{[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
                  ) : data.properties.length === 0 ? (
                    <EmptyState
                      icon={Building2}
                      title={t('db_properties_empty')}
                      hint={t('db_properties_empty_hint')}
                      action={(
                        <Button size="sm" className="h-9 rounded-full px-4 text-xs" onClick={() => navigate('/property/add')}>
                          {t('nav_add_property')}
                        </Button>
                      )}
                    />
                  ) : (
                    <div className="divide-y divide-foreground/[0.12]">
                      {data.properties.slice(0, 5).map(property => (
                        <PropertyRow
                          key={property.id}
                          property={property}
                          run={data.progress[property.id]}
                          onOpen={() => navigate(`/property/${property.id}`)}
                          onDelete={() => setDeleteId(property.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* The assistant — the same real entry point as the Main Page. */}
          <Card className="min-w-0 self-start p-5 sm:p-6">
            <div className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[0.6rem] border border-gold/50 bg-gold-soft text-gold-ink" aria-hidden="true">
                <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{t('ai_title')}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('db_ai_sub')}</p>
              </div>
            </div>

            <p className="mt-5 rounded-2xl rounded-bl-md bg-secondary px-4 py-3 text-sm text-foreground">
              {t('db_ai_greeting')}
            </p>

            <HomatchAsk className="mt-4" variant="card" placeholder={t('db_ai_placeholder')} actions={askActions} />
          </Card>
        </div>

        {/* ── 4. Verification, financing and activity, as one group ── */}
        <section className="overflow-hidden rounded-[0.9rem] border border-foreground/15 bg-card shadow-card">
          <div className={`grid divide-y divide-foreground/[0.12] rtl:lg:divide-x-reverse ${['lg:grid-cols-1', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3'][1 + Number(shown('verify')) + Number(shown('mortgage'))]} lg:divide-x lg:divide-y-0`}>
            {shown('verify') && <div className="min-w-0">
              <CardHead title={t('db_verify_title')} action={<LinkAction label={t('db_verify_start')} onClick={() => navigate('/verify')} />} />
              {loading ? (
                <div className="space-y-3 p-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : data.verifications.length === 0 ? (
                <EmptyState icon={ShieldCheck} title={t('vh_empty_title')} />
              ) : (
                <div className="divide-y divide-foreground/[0.12]">
                  {data.verifications.slice(0, 4).map(record => (
                    <VerificationRow key={record.id} record={record} onOpen={() => navigate(`/verify?job=${encodeURIComponent(record.id)}`)} />
                  ))}
                </div>
              )}
            </div>}

            {shown('mortgage') && <div className="flex min-w-0 flex-col items-center justify-center p-6 text-center sm:p-8">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[hsl(var(--gold))]/10 ring-1 ring-inset ring-[hsl(var(--gold))]/25 text-[hsl(var(--gold-ink))]" aria-hidden="true">
                <CircleDollarSign className="h-5 w-5" strokeWidth={1.6} />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-foreground">{t('db_mortgage_title')}</h2>
              <p className="mt-2 max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground">{t('db_mortgage_body')}</p>
              <Button className="mt-5 h-10 gap-2 rounded-full px-5 text-sm" onClick={() => navigate('/mortgage')}>
                {t('db_mortgage_cta')}
                <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
              </Button>
            </div>}

            <div className="min-w-0">
              <CardHead title={t('db_activity_title')} action={<LinkAction label={t('nav_activity')} onClick={() => navigate('/activity')} />} />
              {loading ? (
                <div className="space-y-3 p-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : data.activity.every(e => activityLabelKey(e.event_type) === null) ? (
                <EmptyState icon={Zap} title={t('empty_no_activity_title')} hint={t('empty_no_activity_desc')} />
              ) : (
                <ul className="divide-y divide-foreground/[0.12]">
                  {data.activity.filter(e => activityLabelKey(e.event_type) !== null).slice(0, 5).map(event => <ActivityRow key={event.id} event={event} />)}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* ── 5. Closing band ── */}
        <div className="flex flex-col items-start gap-5 rounded-[1rem] bg-primary px-6 py-7 text-primary-foreground md:flex-row md:items-center md:justify-between md:px-9">
          <div className="min-w-0">
            <h2 className="text-balance text-lg font-semibold tracking-tight sm:text-xl">{t('db_footer_title')}</h2>
            <p className="mt-1.5 max-w-xl text-pretty text-sm leading-relaxed text-primary-foreground/75">{t('db_footer_body')}</p>
          </div>
          {shown('verify') && (
            <Button
              className="h-11 shrink-0 gap-2 rounded-full bg-gold px-6 text-sm text-primary hover:bg-gold/90"
              onClick={() => navigate('/verify')}
            >
              {t('mp_verify_capability_cta')}
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('prop_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('prop_delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('prop_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('prop_confirm_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard>
      <DashboardContent />
    </RouteGuard>
  );
}
