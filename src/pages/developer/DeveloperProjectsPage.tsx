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
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { listProjects, createProject, listUnits } from '@/services/developer/inventory';
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

/** The counts a project card shows, fetched once for all projects. */
interface ProjectCounts {
  total: number;
  available: number;
  sold: number;
}

export default function DeveloperProjectsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { workspace, can } = useDeveloperWorkspace();

  const [projects, setProjects] = useState<DevProject[]>([]);
  const [counts, setCounts] = useState<Map<string, ProjectCounts>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listProjects(workspace.id);
      setProjects(rows);

      // One query for every unit's status rather than one per project. A
      // developer with six projects should not cost six round trips to draw a
      // list, and the status counts are what the card is for.
      if (rows.length > 0) {
        const all = await listUnits(workspace.id, { limit: 5000, orderBy: 'unit_number' });
        const map = new Map<string, ProjectCounts>();
        for (const unit of all.rows) {
          const entry = map.get(unit.project_id) ?? { total: 0, available: 0, sold: 0 };
          entry.total += 1;
          if (unit.status === 'AVAILABLE') entry.available += 1;
          if (unit.status === 'SOLD') entry.sold += 1;
          map.set(unit.project_id, entry);
        }
        setCounts(map);
      } else {
        setCounts(new Map());
      }
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

      {!loading && !error && projects.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title={t('dev_empty_projects_title')}
            description={t('dev_empty_projects_body')}
            action={can('inventory') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t('dev_action_add_project')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const c = counts.get(project.id);
            return (
              <Link
                key={project.id}
                to={`/developers/projects/${project.id}`}
                className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                  {project.cover_image_url ? (
                    <img
                      src={project.cover_image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Building2 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                    </div>
                  )}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2 py-0.5 text-2xs font-medium backdrop-blur">
                    {project.is_published
                      ? <><Eye className="h-3 w-3" aria-hidden="true" />{t('dev_published')}</>
                      : <><EyeOff className="h-3 w-3" aria-hidden="true" />{t('dev_unpublished')}</>}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold tracking-tight">{project.name}</h2>
                    {(project.city || project.district) && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {[project.district, project.city].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>

                  <p className="text-2xs text-muted-foreground">
                    {t(CONSTRUCTION_KEYS[project.construction_status])}
                    {project.handover_date && ` · ${t('dev_handover')} ${formatDate(project.handover_date, language)}`}
                  </p>

                  <div className="mt-auto flex items-center gap-4 border-t border-border pt-3 text-xs">
                    {c ? (
                      <>
                        <span className="tabular">
                          <span className="font-semibold">{c.available}</span>
                          <span className="text-muted-foreground"> {t('dev_stat_available').toLowerCase()}</span>
                        </span>
                        <span className="tabular text-muted-foreground">
                          {c.sold} {t('dev_stat_sold').toLowerCase()}
                        </span>
                        <span className="ml-auto tabular text-muted-foreground">{c.total}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t('dev_no_units_yet')}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
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
