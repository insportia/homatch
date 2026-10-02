// "Improve with HOMATCH AI" — loaded only when the customer asks for it.
//
//   open → the creative's history (no model call) → if no analysis yet, ONE
//   analysis (the open click is the request) → 2–3 concepts → optional
//   instruction → the price, from the server → explicit confirmation →
//   generation (stages as the job really reports them) → gallery: Original +
//   V1–V3, choose one or several (Primary / Secondary / Test), use, refine.
//
// The original upload never changes; chosen variations become NEW creatives
// with their lineage. Nothing is charged without the confirm click, and the
// confirm's idempotency key is minted once — a double click or a retry can
// never start (or charge) a second job.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, Loader2, RefreshCw, Sparkles, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './MetaButton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { GENERATION_STAGES, INSTRUCTION_MAX, MAX_VARIATIONS } from '@/lib/metaAds/creativeAi';
import {
  aiAnalyze, aiDiscard, aiGenerate, aiJob, aiJobs, aiQuote, aiUse,
  type AiJob, type AiQuote, type MetaCreativeRow,
} from '@/services/metaAds';
import { useMediaUrl } from './CreativeStep';

type Role = 'PRIMARY' | 'SECONDARY' | 'TEST';
const ROLES: Role[] = ['PRIMARY', 'SECONDARY', 'TEST'];
const CHIPS = ['premium', 'view', 'investment', 'less_text', 'keep_building'] as const;
const POLL_MS = 3000;

/** Errors the panel explains in words; anything else reads as a plain failure. */
const KNOWN_ERRORS = ['INSUFFICIENT_CREDITS', 'AI_UNAVAILABLE', 'RATE_LIMITED', 'BUSY', 'INSTRUCTION_NOT_ALLOWED', 'ANALYSIS_FAILED',
  'GENERATION_FAILED', 'TIMED_OUT', 'PRICING_UNAVAILABLE', 'IMAGE_REQUIRED'];
const codeOf = (e: unknown) => String((e as { code?: string })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? 'FAILED');

export default function CreativeAiPanel({ open, onOpenChange, creative, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; creative: MetaCreativeRow;
  /** Variations were turned into creatives: the step reloads its list. */
  onCreated: () => void;
}) {
  const { t, lang } = useLanguage();
  const originalUrl = useMediaUrl(creative.media[0]?.path);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AiJob | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concept, setConcept] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [variations, setVariations] = useState(MAX_VARIATIONS);
  const [quote, setQuote] = useState<AiQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refineFrom, setRefineFrom] = useState<{ jobId: string; index: number } | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<Record<number, Role>>({});
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [using, setUsing] = useState(false);
  const keyRef = useRef<string | null>(null);

  /* ── open: history first (free), analysis only if none is cached ── */
  const runAnalysis = useCallback(async (force: boolean) => {
    setAnalyzing(true); setError(null);
    try {
      const r = await aiAnalyze(creative.id, lang, force);
      setAnalysis(r.job);
      setConcept(r.job.analysis?.concepts[0]?.id ?? null);
    } catch (e) { setError(codeOf(e) === 'FAILED' ? 'ANALYSIS_FAILED' : codeOf(e)); }
    finally { setAnalyzing(false); }
  }, [creative.id, lang]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true); setError(null);
    aiJobs(creative.id).then(({ jobs }) => {
      if (!live) return;
      const an = jobs.find((j) => j.kind === 'ANALYSIS' && j.status === 'DONE') ?? null;
      const gen = jobs.find((j) => j.kind !== 'ANALYSIS' && j.status !== 'FAILED') ?? null;
      setAnalysis(an); setConcept(an?.analysis?.concepts[0]?.id ?? null); setJob(gen);
      if (!an) void runAnalysis(false);
    }).catch((e) => { if (live) setError(codeOf(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, creative.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the price, from the server, whenever the request changes ── */
  const count = refineFrom ? 1 : variations;
  useEffect(() => {
    if (!open || !analysis) return;
    let live = true;
    setQuoting(true);
    aiQuote(count, !!refineFrom).then((r) => { if (live) setQuote(r.quote); })
      .catch((e) => { if (live) { setQuote(null); setError(codeOf(e)); } })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
  }, [open, analysis, count, refineFrom]);

  /* ── a running job: poll its real stage ── */
  useEffect(() => {
    if (!job || job.status !== 'RUNNING') return;
    const id = setInterval(() => {
      aiJob(job.id).then((r) => {
        setJob(r.job);
        if (r.job.status === 'DONE') toast.success(t('mm_c_ai_done_toast', { n: String(r.job.images.length) }));
        if (r.job.status === 'FAILED') setError(r.job.error === 'TIMED_OUT' ? 'TIMED_OUT' : 'GENERATION_FAILED');
      }).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const inflight = useRef(false);
  const confirmGenerate = async () => {
    // A ref, not state: a fast double click must not send twice (the server key dedupes too).
    if (!analysis || !concept || inflight.current) return;
    inflight.current = true;
    setStarting(true); setError(null);
    keyRef.current ??= crypto.randomUUID(); // once per confirmed request; a retry reuses it
    try {
      const r = await aiGenerate({
        creativeId: creative.id, analysisJobId: analysis.id, conceptId: concept, instruction: instruction.trim() || undefined,
        variations: count, idempotencyKey: keyRef.current, locale: lang,
        ...(refineFrom ? { fromJobId: refineFrom.jobId, fromIndex: refineFrom.index } : {}),
      });
      setJob(r.job); setPicked({}); setConfirming(false); setRefineFrom(null);
      keyRef.current = null;
    } catch (e) {
      const c = codeOf(e);
      setError(c);
      if (c !== 'FAILED') keyRef.current = null; // refused (no job started): a new request may get a new key
    } finally { setStarting(false); inflight.current = false; }
  };

  const discard = async (index: number, restore = false) => {
    if (!job) return;
    try {
      await aiDiscard(job.id, index, restore);
      const r = await aiJob(job.id); setJob(r.job);
      setPicked((p) => { const n = { ...p }; delete n[index]; return n; });
    } catch { toast.error(t('mads_load_failed')); }
  };

  const use = async (indexes: number[]) => {
    if (!job || !indexes.length || using) return;
    setUsing(true);
    try {
      // Unpicked (Use all) = Secondary: a normal creative; Primary only where the customer said so.
      const picks = indexes.map((i) => ({ index: i, role: picked[i] ?? ('SECONDARY' as Role) }));
      const r = await aiUse(job.id, picks);
      toast.success(t('mm_c_ai_used', { n: String(r.created.length) }));
      onCreated();
      onOpenChange(false);
    } catch { toast.error(t('mads_load_failed')); }
    finally { setUsing(false); }
  };

  const concepts = analysis?.analysis?.concepts ?? [];
  const live = (job?.images ?? []).filter((i) => !i.discarded && i.url);
  const running = job?.status === 'RUNNING';
  const stageIndex = running ? Math.max(0, GENERATION_STAGES.indexOf(job!.stage as never)) : -1;
  const chosen = useMemo(() => Object.keys(picked).map(Number), [picked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[calc(100%-1rem)] overflow-y-auto p-4 sm:p-6 md:max-w-3xl" data-mm-ai-panel="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('mm_c_ai_title')}</DialogTitle>
          <DialogDescription>{t('mm_c_ai_lead')}</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" data-mm-ai-error={error} className="rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {t(`mm_c_ai_err_${(KNOWN_ERRORS.includes(error) ? error : 'FAILED').toLowerCase()}` as never)}
            {error === 'INSUFFICIENT_CREDITS' && <> · <Link to="/credits" className="font-semibold underline">{t('mm_c_ai_top_up')}</Link></>}
          </p>
        )}

        {(loading || analyzing) && (
          <div className="flex items-center gap-2 rounded-xl border border-border p-3 text-[13px] text-muted-foreground" role="status" aria-live="polite" data-mm-ai-analyzing="">
            <Loader2 className="h-4 w-4 animate-spin" />{t(analyzing ? 'mm_c_ai_stage_analyzing' : 'mm_c_ai_loading')}
          </div>
        )}

        {analysis?.analysis && !running && (
          <section className="space-y-3" data-mm-ai-concepts={concepts.length}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground"><span className="font-semibold text-foreground">{t('mm_c_ai_sees')}</span> {analysis.analysis.subject}</p>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1.5" onClick={() => runAnalysis(true)} disabled={analyzing} data-mm-ai-reanalyze="">
                <RefreshCw className="h-3.5 w-3.5" />{t('mm_c_ai_reanalyze')}
              </Button>
            </div>
            <div role="radiogroup" aria-label={t('mm_c_ai_concepts')} className="grid gap-2 md:grid-cols-3">
              {concepts.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={concept === c.id} onClick={() => setConcept(c.id)} data-mm-ai-concept={c.id}
                  className={cn('rounded-xl border p-3 text-start text-2xs leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
                    concept === c.id ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border hover:bg-[hsl(var(--secondary))]/60')}>
                  <span className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">{concept === c.id && <Check className="h-3.5 w-3.5" />}{c.title}</span>
                  <span className="block text-foreground/90">{c.angle}</span>
                  <span className="mt-1 block text-muted-foreground"><b>{t('mm_c_ai_visual')}:</b> {c.visual}</span>
                  <span className="block text-muted-foreground"><b>{t('mm_c_ai_composition')}:</b> {c.composition}</span>
                  <span className="block text-muted-foreground"><b>{t('mm_c_ai_cta')}:</b> {c.cta}</span>
                  {c.safeArea !== 'NONE' && <span className="block text-muted-foreground"><b>{t('mm_c_ai_safe')}:</b> {t(`mm_c_ai_safe_${c.safeArea.toLowerCase()}` as never)}</span>}
                </button>
              ))}
            </div>
            <p className="text-2xs text-muted-foreground">{t('mm_c_ai_hypothesis')}</p>

            {refineFrom && (
              <p className="flex items-center justify-between gap-2 rounded-lg bg-[hsl(var(--secondary))]/70 px-3 py-2 text-[13px]" data-mm-ai-refining={refineFrom.index}>
                <span>{t('mm_c_ai_refining', { n: String(refineFrom.index) })}</span>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-background" onClick={() => setRefineFrom(null)} aria-label={t('mm_c_ai_refine_cancel')}><X className="h-4 w-4" /></button>
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">{t(refineFrom ? 'mm_c_ai_refine_label' : 'mm_c_ai_instruction')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
              <Input value={instruction} maxLength={INSTRUCTION_MAX} onChange={(e) => setInstruction(e.target.value)} placeholder={t('mm_c_ai_instruction_ph')} data-mm-ai-instruction="" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} type="button" className="min-h-9 rounded-full border border-border px-3 text-2xs hover:bg-[hsl(var(--secondary))]"
                  onClick={() => setInstruction(t(`mm_c_ai_chip_${c}` as never))} data-mm-ai-chip={c}>{t(`mm_c_ai_chip_${c}` as never)}</button>
              ))}
            </div>

            {!refineFrom && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{t('mm_c_ai_count')}</span>
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" aria-pressed={variations === n} onClick={() => setVariations(n)} data-mm-ai-count={n}
                    className={cn('grid h-11 w-11 place-items-center rounded-lg border text-[13px] font-semibold', variations === n ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>{n}</button>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-[hsl(var(--gold-border))]/50 bg-[hsl(var(--gold-soft))]/40 p-3" data-mm-ai-quote={quote ? quote.expectedCredits : ''}>
              {quoting || !quote ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('mm_c_ai_pricing')}</p>
              ) : (
                <>
                  <p className="text-[13px] text-foreground">{t('mm_c_ai_price_line', { n: String(count), credits: quote.expectedCredits.toFixed(2), max: quote.maxCredits.toFixed(2) })}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">{t('mm_c_ai_price_fair', { balance: quote.balanceCredits.toFixed(2) })}</p>
                  {!confirming ? (
                    <Button type="button" className="mt-2 min-h-11 w-full gap-1.5 sm:w-auto" disabled={!concept || !quote.enough || !quote.available} onClick={() => setConfirming(true)} data-mm-ai-generate="">
                      <Wand2 className="h-4 w-4" />{t(refineFrom ? 'mm_c_ai_refine_cta' : 'mm_c_ai_generate_cta', { n: String(count), credits: quote.expectedCredits.toFixed(2) })}
                    </Button>
                  ) : (
                    <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-2.5" data-mm-ai-confirm="">
                      <p className="text-[13px]">{t('mm_c_ai_confirm_body', { n: String(count), max: quote.maxCredits.toFixed(2) })}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" className="min-h-11 gap-1.5" onClick={confirmGenerate} disabled={starting} data-mm-ai-confirm-go="">
                          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('mm_c_ai_confirm_cta')}
                        </Button>
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(false)} disabled={starting}>{t('mm_c_ai_cancel')}</Button>
                      </div>
                    </div>
                  )}
                  {!quote.enough && <p className="mt-1.5 text-2xs text-destructive">{t('mm_c_ai_err_insufficient_credits')} · <Link to="/credits" className="font-semibold underline">{t('mm_c_ai_top_up')}</Link></p>}
                </>
              )}
            </div>
          </section>
        )}

        {running && (
          <section className="space-y-3 rounded-xl border border-border p-4" role="status" aria-live="polite" data-mm-ai-running={job!.stage}>
            <div className="h-1 overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
              <div className="h-full w-full animate-pulse rounded-full bg-[hsl(var(--gold))]/70 motion-reduce:animate-none" />
            </div>
            <ol className="space-y-1.5">
              {GENERATION_STAGES.map((s, i) => (
                <li key={s} data-mm-ai-stage={s} data-state={i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'todo'}
                  className={cn('flex items-center gap-2 text-[13px]', i === stageIndex ? 'font-semibold text-foreground' : i < stageIndex ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                  {i < stageIndex ? <Check className="h-3.5 w-3.5" /> : i === stageIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
                  {t(`mm_c_ai_stage_${s.toLowerCase()}` as never)}
                </li>
              ))}
            </ol>
            <p className="text-2xs text-muted-foreground">{t('mm_c_ai_running_note')}</p>
          </section>
        )}

        {job?.status === 'DONE' && (
          <section className="space-y-3" data-mm-ai-gallery={live.length}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('mm_c_ai_gallery')}</h3>
              {job.chargedCredits != null && <span className="text-2xs text-muted-foreground" data-mm-ai-charged={job.chargedCredits}>{t('mm_c_ai_charged', { credits: job.chargedCredits.toFixed(2), n: String(live.length) })}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <figure className="space-y-1" data-mm-ai-original="">
                <button type="button" className="block w-full overflow-hidden rounded-xl border-2 border-border" onClick={() => originalUrl && setPreview({ url: originalUrl, label: t('mm_c_ai_original') })}>
                  {originalUrl ? <img src={originalUrl} alt={t('mm_c_ai_original')} className="aspect-square w-full object-cover" /> : <span className="block aspect-square w-full bg-[hsl(var(--secondary))]" />}
                </button>
                <figcaption className="text-2xs font-semibold">{t('mm_c_ai_original')} · <span className="font-normal text-muted-foreground">{t('mm_c_ai_original_kept')}</span></figcaption>
              </figure>
              {job.images.map((im) => {
                const sel = picked[im.index];
                if (im.discarded) {
                  return (
                    <div key={im.index} className="grid aspect-square place-items-center rounded-xl border border-dashed border-border text-2xs text-muted-foreground" data-mm-ai-removed={im.index}>
                      <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2" onClick={() => discard(im.index, true)}><Undo2 className="h-3.5 w-3.5" />{t('mm_c_ai_restore', { n: String(im.index) })}</button>
                    </div>
                  );
                }
                return (
                  <figure key={im.index} className="space-y-1" data-mm-ai-variant={im.index} data-selected={sel ? 'true' : 'false'}>
                    <div className={cn('relative overflow-hidden rounded-xl border-2', sel ? 'border-[hsl(var(--gold-border))]' : 'border-transparent')}>
                      <button type="button" aria-pressed={!!sel} aria-label={t('mm_c_ai_select', { n: String(im.index) })} className="block w-full"
                        onClick={() => setPicked((p) => { const n = { ...p }; if (n[im.index]) delete n[im.index]; else n[im.index] = Object.values(n).includes('PRIMARY') ? 'SECONDARY' : 'PRIMARY'; return n; })}>
                        {im.url && <img src={im.url} alt={t('mm_c_ai_variant', { n: String(im.index) })} className="aspect-square w-full object-cover" />}
                        {sel && <span className="absolute start-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[hsl(var(--gold))] text-[#161309]"><Check className="h-3.5 w-3.5" /></span>}
                      </button>
                      <div className="absolute end-1 top-1 flex gap-1">
                        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg bg-black/55 text-white" onClick={() => im.url && setPreview({ url: im.url, label: t('mm_c_ai_variant', { n: String(im.index) }) })} aria-label={t('mm_c_ai_preview', { n: String(im.index) })} data-mm-ai-preview={im.index}><Eye className="h-4 w-4" /></button>
                        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg bg-black/55 text-white" onClick={() => discard(im.index)} aria-label={t('mm_c_ai_remove', { n: String(im.index) })} data-mm-ai-remove={im.index}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <figcaption className="flex flex-wrap items-center gap-1 text-2xs">
                      <span className="font-semibold">{t('mm_c_ai_variant', { n: String(im.index) })}</span>
                      {sel && (
                        <select value={sel} onChange={(e) => setPicked((p) => ({ ...p, [im.index]: e.target.value as Role }))} aria-label={t('mm_c_ai_role')}
                          className="h-8 rounded-md border border-border bg-background px-1 text-2xs" data-mm-ai-role={im.index}>
                          {ROLES.map((r) => <option key={r} value={r}>{t(`mm_c_ai_role_${r.toLowerCase()}` as never)}</option>)}
                        </select>
                      )}
                      <button type="button" className="ms-auto inline-flex min-h-9 items-center gap-1 text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline" data-mm-ai-refine={im.index}
                        onClick={() => { setRefineFrom({ jobId: job.id, index: im.index }); setConfirming(false); setInstruction(''); }}>
                        <Wand2 className="h-3 w-3" />{t('mm_c_ai_refine')}
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <p className="text-2xs text-muted-foreground">{t('mm_c_ai_roles_note')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-11 gap-1.5" disabled={!chosen.length || using} onClick={() => use(chosen)} data-mm-ai-use="">
                {using ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t('mm_c_ai_use_selected', { n: String(chosen.length) })}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={!live.length || using} onClick={() => use(live.map((i) => i.index))} data-mm-ai-use-all="">{t('mm_c_ai_use_all')}</Button>
              <Button type="button" variant="ghost" className="min-h-11 gap-1.5" onClick={() => { setPicked({}); onOpenChange(false); }} data-mm-ai-keep-original="">
                <Undo2 className="h-4 w-4" />{t('mm_c_ai_keep_original')}
              </Button>
            </div>
          </section>
        )}

        {preview && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-3" role="dialog" aria-modal="true" aria-label={preview.label} onClick={() => setPreview(null)} data-mm-ai-large="">
            <img src={preview.url} alt={preview.label} className="max-h-[85dvh] max-w-full rounded-xl object-contain" />
            <button type="button" className="absolute end-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white" onClick={() => setPreview(null)} aria-label={t('mm_c_ai_close_preview')} autoFocus><X className="h-5 w-5" /></button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
