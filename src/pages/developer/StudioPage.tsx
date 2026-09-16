import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Search, Building2, ShieldAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td, formatNumber,
} from '@/components/developer/primitives';
import { listStudioProjects, type StudioProjectSummary } from '@/services/developer/studio';

/**
 * HOMATCH PROJECT STUDIO — the work queue.
 *
 * INTERNAL. This is not a developer-facing screen and it is not a developer
 * workspace screen either: it spans every customer, because the people who
 * use it are Homatch's own 3D team and their work crosses accounts.
 *
 * ENFORCED TWICE. `isStudio` decides whether this route renders at all, and
 * dt_studio_projects() returns null to anybody who is not on dt_studio_staff.
 * Neither is decorative — remove the first and the page is empty; remove the
 * second and the page is empty.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. No prices, no buyers, no pipeline, no
 * revenue. The studio's job is geometry, and the read behind this page has no
 * column that could leak a customer's commercial position.
 */
export default function StudioPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { homatchUser, loading: authLoading } = useAuth();
  const { isStudio, loading: workspaceLoading } = useDeveloperWorkspace();
  useSurfaceTheme('light');

  const [rows, setRows] = useState<StudioProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !homatchUser) {
      navigate('/auth/login?returnTo=/studio', { replace: true });
    }
  }, [authLoading, homatchUser, navigate]);

  useEffect(() => {
    if (!isStudio) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listStudioProjects()
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isStudio]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q)
      || r.workspace_name.toLowerCase().includes(q)
      || (r.city ?? '').toLowerCase().includes(q));
  }, [rows, query]);

  if (workspaceLoading || authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <LoadingRows rows={6} className="mx-auto max-w-4xl pt-24" />
      </div>
    );
  }

  /* A person who is not studio staff gets an explanation, not a blank page —
     and not a hint about what is behind it either. */
  if (!isStudio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">{t('studio_internal_only')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('studio_internal_only_body')}</p>
          <Link
            to="/developers/home"
            className="mt-4 inline-block text-sm text-gold-ink underline underline-offset-4"
          >
            {t('studio_back_to_workspace')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 whitespace-nowrap text-sm font-bold tracking-tight">HOMATCH</span>
            <span className="shrink-0 whitespace-nowrap rounded border border-gold-border/70 px-1.5 py-px text-2xs font-semibold uppercase tracking-wider text-gold-ink">
              {t('studio_badge')}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">{t('studio_title')}</h1>
            <p className="truncate text-2xs text-muted-foreground">{t('studio_subtitle')}</p>
          </div>
          <Link
            to="/developers/home"
            className="shrink-0 text-2xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {t('dev_back_to_homatch')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {rows.length > 0 && (
          <div className="relative mb-4 max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('studio_search')}
              aria-label={t('studio_search')}
              className="pl-8"
            />
          </div>
        )}

        {loading && <LoadingRows rows={6} />}
        {!loading && error && <ErrorState message={error} />}

        {!loading && !error && visible.length === 0 && (
          <Panel>
            <EmptyState
              icon={<Box className="h-7 w-7" />}
              title={t(rows.length === 0 ? 'studio_empty_title' : 'studio_no_match')}
              description={t(rows.length === 0 ? 'studio_empty_body' : 'studio_no_match_body')}
            />
          </Panel>
        )}

        {!loading && !error && visible.length > 0 && (
          <Panel>
            <TableScroll>
              <table className="w-full text-sm" data-tabular>
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <Th>{t('studio_project')}</Th>
                    <Th>{t('studio_developer')}</Th>
                    <Th className="text-right">{t('studio_buildings')}</Th>
                    <Th className="text-right">{t('studio_units')}</Th>
                    {/* The number that decides how much work a scheme is. */}
                    <Th className="text-right">{t('studio_unit_types')}</Th>
                    <Th className="text-right">{t('studio_scenes')}</Th>
                    <Th>{t('studio_experience')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <Td>
                        <Link
                          to={`/studio/${row.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                        {row.city && (
                          <span className="ml-1.5 text-2xs text-muted-foreground">{row.city}</span>
                        )}
                      </Td>
                      <Td className="text-muted-foreground">{row.workspace_name}</Td>
                      <Td className="text-right">{formatNumber(row.buildings, language)}</Td>
                      <Td className="text-right">{formatNumber(row.units, language)}</Td>
                      <Td className="text-right">
                        <span className={cn(row.unit_types === 0 && 'text-muted-foreground')}>
                          {formatNumber(row.unit_types, language)}
                        </span>
                      </Td>
                      <Td className="text-right">
                        {row.scenes === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span>
                            {formatNumber(row.published_scenes, language)}
                            <span className="text-muted-foreground">
                              {' / '}{formatNumber(row.scenes, language)}
                            </span>
                          </span>
                        )}
                      </Td>
                      <Td>
                        <StatusPill status={row.experience_status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )}

        {!loading && !error && rows.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-2xs text-muted-foreground">
            <Building2 className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            {t('studio_reuse_note')}
          </p>
        )}
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const { t } = useLanguage();
  if (!status) {
    return <span className="text-2xs text-muted-foreground">{t('studio_no_experience')}</span>;
  }
  const tone = status === 'PUBLISHED'
    ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]'
    : status === 'REVIEW'
      ? 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]'
      : status === 'ARCHIVED'
        ? 'border-dashed border-border text-muted-foreground bg-transparent'
        : 'border-border text-muted-foreground bg-muted/60';
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
      tone,
    )}>
      {t(`studio_status_${status.toLowerCase()}`)}
    </span>
  );
}
