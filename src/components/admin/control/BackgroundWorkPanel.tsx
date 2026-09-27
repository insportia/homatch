/*
 * What the database itself can attest about background work.
 *
 * Added to System health because the live check above answers "can the
 * database, storage and the API be reached right now" and nothing answered
 * "is the work behind the product actually getting done". admin_system_facts
 * reports when jobs last finished and last failed, and whether anything
 * claims to be running without a recent heartbeat — each with its timestamp.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * The database cannot see whether an edge function or the Railway worker
 * answers. The canonical worker is `homatch-official-worker`; it is named
 * here with an explicit "not checked from here" rather than a green tick,
 * because turning "I could not look" into "Working" is the one mistake an
 * operations screen must not make. `homatch-official-worker-v2` is not
 * production and is not shown.
 */
import { AlertTriangle, CheckCircle2, HelpCircle, Workflow } from 'lucide-react';
import React from 'react';
import { humanize } from '@/admin/labels';
import { ErrorNote, KV, When } from '@/components/admin/control/AdminKit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { getSystemFacts, type SystemFacts } from '@/services/adminControl';

export const CANONICAL_WORKER = 'homatch-official-worker';

export function BackgroundWorkPanel() {
  const { t } = useLanguage();
  const [facts, setFacts] = React.useState<SystemFacts | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    getSystemFacts()
      .then((f) => { if (live) setFacts(f); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Workflow className="h-4 w-4" aria-hidden="true" /> {t('admin_cc_bg_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorNote message={error} />}
        {!facts && !error && <Skeleton className="h-32 w-full" />}
        {facts && (
          <>
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium"><code dir="ltr">{CANONICAL_WORKER}</code></p>
                <p className="text-2xs text-muted-foreground">{t('admin_cc_bg_worker_unchecked')}</p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_bg_jobs')}</h3>
              <KV rows={[
                [t('admin_cc_bg_in_flight'), String(facts.background_jobs.in_flight)],
                [t('admin_cc_bg_stale'), facts.background_jobs.stale_heartbeat > 0
                  ? <span className="flex items-center gap-1 text-[hsl(var(--warning))]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{facts.background_jobs.stale_heartbeat}</span>
                  : <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-[#12A06B]" aria-hidden="true" />0</span>],
                [t('admin_cc_bg_last_completed'), <When at={facts.background_jobs.last_completed_at} />],
                [t('admin_cc_bg_last_failed'), facts.background_jobs.last_failed_at
                  ? <span><When at={facts.background_jobs.last_failed_at} />{facts.background_jobs.last_failed_code ? ` · ${facts.background_jobs.last_failed_code}` : ''}</span>
                  : '—'],
                [t('admin_cc_bg_last_24h'), Object.entries(facts.background_jobs.by_state_24h).map(([k, v]) => `${humanize(k)}: ${v}`).join(' · ') || '—'],
              ]} />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_bg_matching')}</h3>
              <KV rows={[
                [t('admin_cc_bg_runs_24h'), String(facts.matching_jobs.runs_24h)],
                [t('admin_cc_bg_last_completed'), <When at={facts.matching_jobs.last_completed_at} />],
                [t('admin_cc_bg_last_failed'), facts.matching_jobs.last_failed_at
                  ? <span><When at={facts.matching_jobs.last_failed_at} />{facts.matching_jobs.last_failure_reason ? ` · ${facts.matching_jobs.last_failure_reason}` : ''}</span>
                  : '—'],
              ]} />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_bg_providers')}</h3>
              {facts.providers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin_cc_bg_no_providers')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {facts.providers.map((p) => (
                    <li key={p.provider} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 py-1 text-sm last:border-0">
                      <span className="font-medium">{p.provider}</span>
                      <span className="text-2xs text-muted-foreground">
                        {humanize(p.status)} · {t('admin_cc_bg_last_success')} {p.last_success_at ? new Date(p.last_success_at).toLocaleString() : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-2xs text-muted-foreground">
              {t('admin_cc_bg_log_checks', { n: facts.health_log.checks_24h })}{' '}
              {facts.health_log.last ? <When at={facts.health_log.last.checked_at} /> : '—'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
