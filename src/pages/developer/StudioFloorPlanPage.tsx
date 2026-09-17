import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, X, Ruler, ArrowUpFromLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useAuth } from '@/contexts/AuthContext';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { rememberPendingPath } from '@/services/returnTo';
import { Panel, LoadingRows, ErrorState, EmptyState } from '@/components/developer/primitives';
import { SectionHead } from '@/components/developer/visuals';
import { FloorPlanOverlay, DEFAULT_CATEGORIES, type Selection } from '@/components/developer/FloorPlanOverlay';
import { FloorPlanGate } from '@/components/developer/FloorPlanGate';
import {
  evaluateGate, type FloorPlanDocument, type FloorPlanRecord,
} from '@/services/developer/floorplan';
import {
  getFloorPlan, applyCorrection, acceptElement, rejectElement, markGenerated,
  type ElementKind,
} from '@/services/developer/floorplanStore';
import { generateScene, totalAreaM2, type GeneratedScene } from '@/lib/floorplan/geometry';
import { assetUrl } from '@/services/developer/twin';
import { supabase } from '@/db/supabase';

/**
 * HOMATCH PROJECT STUDIO — VERIFYING A FLOOR PLAN.
 *
 * The whole 2D → 3D pipeline meets a person here, and this screen is the
 * reason the pipeline is allowed to exist at all. Everything to the left is a
 * machine's proposal drawn on the drawing it came from; everything to the
 * right is what a person has decided about it; and nothing becomes geometry
 * until the gate at the bottom says every required category has been decided.
 *
 * INTERNAL ONLY, in the UI and in SQL. dt_floorplans_write requires
 * dev_is_studio(), so a developer who reached this route would find every
 * accept button refused by the database. The guard below is the courtesy; the
 * policy is the enforcement.
 *
 * WHAT THIS SCREEN DELIBERATELY IS NOT. It is not a CAD editor. An operator
 * can accept, reject, and type the two numbers the drawing may not print —
 * scale and ceiling height. Dragging a wall by its endpoints is a bigger tool
 * than this pass needs, and the cost of not having it is that a badly read
 * wall is REJECTED rather than nudged, which is the safe direction to fail in.
 */

const FloorPlanShell = lazy(() => import('@/components/developer/FloorPlanShell'));

export default function StudioFloorPlanPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  useSurfaceTheme('light');
  const { homatchUser, loading: authLoading } = useAuth();
  const { isStudio, loading: workspaceLoading } = useDeveloperWorkspace();

  const [record, setRecord] = useState<FloorPlanRecord | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [scaleInput, setScaleInput] = useState('');
  const [ceilingInput, setCeilingInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [scene, setScene] = useState<GeneratedScene | null>(null);

  useEffect(() => {
    if (!authLoading && !homatchUser) {
      rememberPendingPath(`/studio/plan/${id ?? ''}`);
      navigate('/auth/login', { replace: true });
    }
  }, [authLoading, homatchUser, id, navigate]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const row = await getFloorPlan(id);
      setRecord(row);
      if (row) {
        /* The drawing itself. dt_assets is the one place a heavy file's URL is
           decided, so moving the bucket later changes one function. */
        const { data: asset } = await supabase
          .from('dt_assets')
          .select('storage_provider, storage_key, version, content_hash')
          .eq('id', row.asset_id)
          .maybeSingle();
        setImageUrl(asset ? assetUrl(asset as never) : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /** The document under review: corrections applied, or the raw reading. */
  const doc: FloorPlanDocument | null = record?.verified ?? record?.extraction ?? null;
  const gate = useMemo(() => (doc ? evaluateGate(doc) : null), [doc]);

  useEffect(() => {
    if (!doc) return;
    setScaleInput(doc.detectedScale == null ? '' : String(doc.detectedScale));
    setCeilingInput(doc.ceilingHeight == null ? '' : String(doc.ceilingHeight));
  }, [doc]);

  const selected = useMemo(() => {
    if (!doc || !selection) return null;
    const pool: Record<ElementKind, Array<{ id: string }>> = {
      wall: doc.walls, door: doc.doors, window: doc.windows,
      room: doc.rooms, balcony: doc.balconies,
    };
    return pool[selection.kind]?.find((el) => el.id === selection.id) ?? null;
  }, [doc, selection]);

  const correct = async (correction: Parameters<typeof applyCorrection>[1]) => {
    if (!record) return;
    setBusy(true);
    try {
      const next = await applyCorrection(
        record, correction, (d) => !evaluateGate(d).canGenerate,
      );
      setRecord(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('dev_err_generic'));
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    if (!doc) return;
    const result = generateScene(doc);
    if (!result.scene) {
      toast.error(result.validation.problems.map((p) => p.code).join(', '));
      return;
    }
    setScene(result.scene);
    if (record) void markGenerated(record).catch(() => {});
  };

  if (authLoading || workspaceLoading || loading) {
    return <div className="min-h-screen bg-background"><LoadingRows rows={8} className="mx-auto max-w-5xl pt-24" /></div>;
  }

  if (!isStudio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">{t('studio_internal_only')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('studio_internal_only_body')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/studio"><ArrowLeft className="mr-1.5 h-4 w-4" />{t('studio_back_to_workspace')}</Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">{t('dev_fp_title')}</h1>
            {record && (
              <p className="truncate text-2xs text-muted-foreground">
                {t(`dev_fp_status_${record.status.toLowerCase()}`)}
                {record.model ? ` · ${record.model}` : ''}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {error && <ErrorState message={error} onRetry={load} />}

        {!error && !doc && (
          <Panel>
            <EmptyState
              title={t('dev_fp_nothing_title')}
              description={t('dev_fp_nothing_body')}
            />
          </Panel>
        )}

        {!error && doc && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* ── What it saw, on what it looked at ─────────────────────── */}
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {categories.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setCategories((prev) => prev.map((c) => (
                      c.key === category.key ? { ...c, visible: !c.visible } : c)))}
                    aria-pressed={category.visible}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                      category.visible
                        ? 'border-border bg-card' : 'border-dashed border-border text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-sm"
                      style={{ background: category.colour, opacity: category.visible ? 1 : 0.3 }}
                    />
                    {t(category.labelKey)}
                  </button>
                ))}
              </div>

              {imageUrl ? (
                <FloorPlanOverlay
                  doc={doc}
                  imageUrl={imageUrl}
                  categories={categories}
                  selection={selection}
                  onSelect={setSelection}
                  className="max-h-[70vh]"
                />
              ) : (
                <Panel><EmptyState title={t('dev_fp_image_missing')} /></Panel>
              )}

              {/* ── The shell, once the gate has opened ─────────────────── */}
              {scene && (
                <section>
                  <SectionHead
                    title={t('dev_fp_shell_title')}
                    sub={t('dev_fp_shell_sub')
                      .replace('{area}', String(totalAreaM2(scene)))
                      .replace('{width}', scene.extent.width.toFixed(2))
                      .replace('{depth}', scene.extent.depth.toFixed(2))}
                  />
                  <Suspense fallback={(
                    <div className="flex h-[26rem] items-center justify-center rounded-lg bg-sand/40">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                    </div>
                  )}>
                    <FloorPlanShell scene={scene} className="h-[26rem] lg:h-[32rem]" />
                  </Suspense>
                </section>
              )}
            </div>

            {/* ── What a person decides about it ────────────────────────── */}
            <div className="min-w-0 space-y-5">
              {gate && (
                <FloorPlanGate
                  gate={gate}
                  onGenerate={generate}
                  generating={busy}
                />
              )}

              {/* THE TWO NUMBERS A DRAWING OFTEN DOES NOT PRINT. Typed by a
                  person, recorded as OPERATOR, never inferred by the model. */}
              <Panel className="space-y-3 p-4">
                <SectionHead title={t('dev_fp_measures')} />
                <div className="space-y-1.5">
                  <Label htmlFor="fp-scale">{t('dev_fp_scale')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="fp-scale"
                      inputMode="decimal"
                      value={scaleInput}
                      onChange={(e) => setScaleInput(e.target.value)}
                      placeholder="0.0100"
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const value = Number(scaleInput);
                        void correct({
                          kind: 'scale',
                          elementId: null,
                          before: { detectedScale: doc.detectedScale },
                          after: { detectedScale: Number.isFinite(value) && value > 0 ? value : null },
                        });
                      }}
                    >
                      <Ruler className="mr-1.5 h-3.5 w-3.5" />{t('dev_fp_confirm')}
                    </Button>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {doc.scaleEvidence ?? t('dev_fp_scale_hint')}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fp-ceiling">{t('dev_fp_ceiling')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="fp-ceiling"
                      inputMode="decimal"
                      value={ceilingInput}
                      onChange={(e) => setCeilingInput(e.target.value)}
                      placeholder="2.70"
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const value = Number(ceilingInput);
                        void correct({
                          kind: 'ceiling',
                          elementId: null,
                          before: { ceilingHeight: doc.ceilingHeight },
                          after: { ceilingHeight: Number.isFinite(value) && value > 0 ? value : null },
                        });
                      }}
                    >
                      <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" />{t('dev_fp_confirm')}
                    </Button>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {doc.ceilingHeightSource === 'DRAWING'
                      ? t('dev_fp_ceiling_from_drawing')
                      : t('dev_fp_ceiling_hint')}
                  </p>
                </div>
              </Panel>

              {/* ── The selected element ───────────────────────────────── */}
              <Panel className="p-4">
                <SectionHead title={t('dev_fp_selected')} />
                {!selected || !selection ? (
                  <p className="text-xs text-muted-foreground">{t('dev_fp_select_hint')}</p>
                ) : (
                  <div className="space-y-3">
                    <dl className="space-y-1.5 text-xs">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t('dev_fp_element')}</dt>
                        <dd className="tabular">{selection.id}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t('dev_fp_confidence')}</dt>
                        <dd className="tabular">
                          {Math.round(((selected as unknown as { confidence?: number }).confidence ?? 0) * 100)}%
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t('dev_fp_state')}</dt>
                        <dd>{t(`dev_fp_elstate_${((selected as unknown as { state?: string }).state ?? 'UNVERIFIED').toLowerCase()}`)}</dd>
                      </div>
                      {(selected as unknown as { evidence?: string | null }).evidence && (
                        <div>
                          <dt className="text-muted-foreground">{t('dev_fp_evidence')}</dt>
                          <dd className="mt-0.5">{(selected as unknown as { evidence?: string }).evidence}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void correct(
                          acceptElement(selection.kind, selection.id, selected))}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />{t('dev_fp_accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void correct(
                          rejectElement(selection.kind, selection.id, selected))}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />{t('dev_fp_reject')}
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>

              {/* ── What the reading could not settle ───────────────────── */}
              {doc.warnings.length > 0 && (
                <Panel className="p-4">
                  <SectionHead title={t('dev_fp_warnings')} />
                  <ul className="space-y-1.5">
                    {doc.warnings.map((warning, i) => (
                      <li key={`${warning.code}-${i}`} className="text-2xs text-amber-700 dark:text-amber-400">
                        {t(`dev_fp_warn_${warning.code.toLowerCase()}`)}
                        {warning.detail ? ` — ${warning.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {doc.unknownElements.length > 0 && (
                <Panel className="p-4">
                  <SectionHead title={t('dev_fp_unknown')} sub={t('dev_fp_unknown_sub')} />
                  <ul className="space-y-1.5">
                    {doc.unknownElements.map((element) => (
                      <li key={element.id} className="text-2xs text-muted-foreground">
                        {element.note}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
