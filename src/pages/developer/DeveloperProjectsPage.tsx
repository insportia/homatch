import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Plus, MapPin, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, EmptyState, LoadingRows, ErrorState, Money, formatDate,
  formatMoney, formatNumber, formatArea,
} from '@/components/developer/primitives';
import {
  SalesBar, Metric, ProjectCover, SectionHead,
} from '@/components/developer/visuals';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { createProject } from '@/services/developer/inventory';
import { loadPortfolio, type Portfolio, type ProjectRollup } from '@/services/developer/portfolio';
import { devErrorText } from '@/services/developer/client';
import type { DevProject, ConstructionStatus } from '@/services/developer/types';

const CONSTRUCTION_STATUSES: ConstructionStatus[] = [
  'PLANNED', 'UNDER_CONSTRUCTION', 'FINISHING', 'COMPLETED', 'HANDED_OVER',
];

export const CONSTRUCTION_KEYS: Record<ConstructionStatus, string> = {
  PLANNED: 'dev_cs_planned',
  UNDER_CONSTRUCTION: 'dev_cs_under_construction',
  FINISHING: 'dev_cs_finishing',
  COMPLETED: 'dev_cs_completed',
  HANDED_OVER: 'dev_cs_handed_over',
};


export default function DeveloperProjectsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { workspace, can } = useDeveloperWorkspace();

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      // One roll-up for the whole workspace, shared with Home, so the bar on a
      // card here and the bar on the command centre are the same bar.
      setPortfolio(await loadPortfolio(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const closeCreate = () => {
    setCreating(false);
    if (params.has('new')) {
      params.delete('new');
      setParams(params, { replace: true });
    }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_projects')}
      description={t('dev_projects_subtitle')}
      actions={can('inventory') ? (
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('dev_action_add_project')}
        </Button>
      ) : undefined}
    >
      {loading && <LoadingRows rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && portfolio && portfolio.projects.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title={t('dev_empty_projects_title')}
            description={t('dev_empty_projects_body')}
              steps={[t('dev_firstrun_step1'), t('dev_firstrun_step2'),
                t('dev_firstrun_step3'), t('dev_firstrun_step4')]}
            action={can('inventory') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t('dev_action_add_project')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && portfolio && portfolio.projects.length > 0 && (
        <div className="space-y-8">
          {/* THE PORTFOLIO IN ONE LINE.
              A developer with four towers wants the estate before the
              buildings. Same roll-up as the command centre, so the two agree. */}
          {portfolio.totals.total > 0 && (
            <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
                <Metric
                  weight="hero"
                  label={t('dev_stat_available')}
                  value={(
                    <>
                      {formatNumber(portfolio.totals.available, language)}
                      <span className="ml-2 align-baseline text-base font-normal text-muted-foreground">
                        {`/ ${formatNumber(portfolio.totals.total, language)}`}
                      </span>
                    </>
                  )}
                  hint={`${formatMoney(portfolio.totals.value_available, portfolio.totals.currency ?? workspace?.default_currency, language)} · ${formatArea(portfolio.totals.area_available, language)}`}
                />
                <Metric
                  label={t('dev_projects_count')}
                  value={formatNumber(portfolio.projects.length, language)}
                />
                <Metric
                  label={t('dev_stat_sold')}
                  value={`${portfolio.totals.soldPct}%`}
                  hint={`${formatNumber(portfolio.totals.sold, language)} ${t('dev_stat_sold').toLowerCase()}`}
                />
              </div>
              <SalesBar size="lg" showLegend className="mt-5" counts={portfolio.totals} />
            </section>
          )}

          <section>
            <SectionHead title={t('dev_nav_projects')} />
            {/* Auto-fill rather than a fixed three: one development should be a
    card you can read, not a card marooned in an empty third of a
    page. Cards grow to fill whatever the screen gives them. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-5">
              {portfolio.projects.map((project) => {
                const c: ProjectRollup | undefined = portfolio.byProject.get(project.id);
                return (
                  <Link
                    key={project.id}
                    to={`/developers/projects/${project.id}`}
                    className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-300 hover:border-gold-border/70 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ProjectCover
                      src={project.cover_image_url}
                      name={project.name}
                      ratio="aspect-[16/10]"
                      overlay={(
                        <>
                          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent" />
                          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2 py-0.5 text-2xs font-medium backdrop-blur">
                            {project.is_published
                              ? <><Eye className="h-3 w-3" aria-hidden="true" />{t('dev_published')}</>
                              : <><EyeOff className="h-3 w-3" aria-hidden="true" />{t('dev_unpublished')}</>}
                          </span>
                          <span className="absolute inset-x-4 bottom-3 min-w-0">
                            <span className="block truncate text-base font-semibold tracking-tight text-white drop-shadow-sm">
                              {project.name}
                            </span>
                            {(project.city || project.district) && (
                              <span className="mt-0.5 flex items-center gap-1 truncate text-2xs text-white/80">
                                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                {[project.district, project.city].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    />

                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <p className="text-2xs text-muted-foreground">
                        {t(CONSTRUCTION_KEYS[project.construction_status])}
                        {project.handover_date && ` · ${t('dev_handover')} ${formatDate(project.handover_date, language)}`}
                      </p>

                      {c && c.total > 0 ? (
                        <div className="mt-auto space-y-2.5">
                          <SalesBar counts={c} />
                          <div className="flex items-baseline gap-3 text-xs">
                            <span className="tabular">
                              <span className="font-semibold">{c.available}</span>
                              <span className="text-muted-foreground">{` ${t('dev_stat_available').toLowerCase()}`}</span>
                            </span>
                            <span className="tabular text-muted-foreground">
                              {`${c.sold} ${t('dev_stat_sold').toLowerCase()}`}
                            </span>
                            <span className="ml-auto tabular font-medium">{`${c.soldPct}%`}</span>
                          </div>
                          <p className="tabular text-2xs text-muted-foreground">
                            <Money amount={c.value_available} currency={c.currency ?? workspace?.default_currency} />
                            {` ${t('dev_value_available_note')}`}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-auto text-2xs text-muted-foreground">{t('dev_no_units_yet')}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}


      <CreateProjectDialog
        open={creating}
        onClose={closeCreate}
        onCreated={(project) => {
          closeCreate();
          navigate(`/developers/projects/${project.id}`);
        }}
      />
    </DeveloperShell>
  );
}

function CreateProjectDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (project: DevProject) => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [status, setStatus] = useState<ConstructionStatus>('UNDER_CONSTRUCTION');
  const [handover, setHandover] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(''); setCity(workspace?.city ?? ''); setDistrict('');
      setStatus('UNDER_CONSTRUCTION'); setHandover(''); setDescription('');
    }
  }, [open, workspace]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace || !name.trim() || saving) return;
    setSaving(true);
    try {
      const project = await createProject(workspace.id, {
        name: name.trim(),
        city: city.trim() || null,
        district: district.trim() || null,
        country: workspace.country,
        construction_status: status,
        handover_date: handover || null,
        description: description.trim() || null,
        currency: workspace.default_currency,
      });
      toast.success(t('dev_project_created'));
      onCreated(project);
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dev_action_add_project')}</DialogTitle>
          <DialogDescription>{t('dev_project_create_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-p-name">{t('dev_project_name')}</Label>
            <Input id="dev-p-name" value={name} onChange={(e) => setName(e.target.value)}
              required autoFocus maxLength={160} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-p-city">{t('dev_project_city')}</Label>
              <Input id="dev-p-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-p-district">{t('dev_project_district')}</Label>
              <Input id="dev-p-district" value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={80} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-p-status">{t('dev_project_status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ConstructionStatus)}>
                <SelectTrigger id="dev-p-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSTRUCTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(CONSTRUCTION_KEYS[s])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-p-handover">{t('dev_project_handover')}</Label>
              <Input id="dev-p-handover" type="date" value={handover}
                onChange={(e) => setHandover(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-p-desc">{t('dev_project_description')}</Label>
            <Textarea id="dev-p-desc" value={description} rows={3}
              onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t('dev_saving') : t('dev_create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
