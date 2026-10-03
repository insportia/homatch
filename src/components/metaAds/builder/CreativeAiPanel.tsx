// "Improve with HOMATCH AI" — loaded only when the customer asks for it.
//
//   open → the creative's history (no model call) → if no analysis yet, ONE
//   analysis (the open click is the request) → 2–3 concepts → optional
//   instruction → the price, from the server → explicit confirmation →
//   generation (stages as the job really reports them) → gallery: Original +
//   V1–V3, choose one or several (Primary / Secondary / Test), use, refine.
//
// The original upload never changes; chosen variations become NEW creatives
// with their lineage — each one COMPOSED first: the AI made the visual only,
// and the customer approves the final creative (HOMATCH typography over the
// visual, CreativeComposer) exactly as Meta will receive it. Nothing is charged without the confirm click, and the
// confirm's idempotency key is minted once — a double click or a retry can
// never start (or charge) a second job.
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Eye, Loader2, RefreshCw, Sparkles, Trash2, Type, Undo2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './MetaButton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { ANALYSIS_VERSION, GENERATION_STAGES, INSTRUCTION_MAX, MAX_VARIATIONS, parseOverlayIntent } from '@/lib/metaAds/creativeAi';
import {
  aiAnalyze, aiComposeSave, aiDiscard, aiGenerate, aiJob, aiJobs, aiQuote, aiUse,
  type AiJob, type AiQuote, type MetaCreativeRow,
} from '@/services/metaAds';
import { useMediaUrl } from './CreativeStep';
import type { ComposeSpec } from '@/lib/metaAds/creativeLayout';

const CreativeComposer = lazy(() => import('./CreativeComposer'));

type Role = 'PRIMARY' | 'SECONDARY' | 'TEST';
const ROLES: Role[] = ['PRIMARY', 'SECONDARY', 'TEST'];
const CHIPS = ['premium', 'view', 'investment', 'less_text', 'keep_building'] as const;
const POLL_MS = 3000;
/** The selection key of the customer's own upload (variants are 1…3). */
const ORIGINAL = 0;
/** Where the customer is: original → AI variants → choose → text & layout → final creative. */
const STEPS = ['original', 'variants', 'choose', 'text', 'final'] as const;

/** Errors the panel explains in words; anything else reads as a plain failure. */
const KNOWN_ERRORS = ['INSUFFICIENT_CREDITS', 'AI_UNAVAILABLE', 'RATE_LIMITED', 'BUSY', 'INSTRUCTION_NOT_ALLOWED', 'ANALYSIS_FAILED',
  'GENERATION_FAILED', 'TIMED_OUT', 'PRICING_UNAVAILABLE', 'IMAGE_REQUIRED', 'START_FAILED'];
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
  /* "What should the creative say?" — the TEXT layer's wording, never sent to the image model as text to draw. */
  const [overlayText, setOverlayText] = useState('');
  const [variations, setVariations] = useState(MAX_VARIATIONS);
  const [quote, setQuote] = useState<AiQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  /* The AI generation cost could not be read: said as that (never a property's
     price), with a retry — not a spinner that never ends. */
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [quoteTry, setQuoteTry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [refineFrom, setRefineFrom] = useState<{ jobId: string; index: number } | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<Record<number, Role>>({});
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [using, setUsing] = useState(false);
  /* The variations being composed (Use → the final creative, approved before anything is created). */
  const [composeFor, setComposeFor] = useState<number[] | null>(null);
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
      // An analysis from an older version (it mixed ad copy into the picture direction) is not reused.
      const current = an && Number((an.analysis as { version?: number } | null)?.version ?? 0) >= ANALYSIS_VERSION ? an : null;
      setAnalysis(current); setConcept(current?.analysis?.concepts[0]?.id ?? null); setJob(gen);
      if (!current) void runAnalysis(false);
    }).catch((e) => { if (live) setError(codeOf(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, creative.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the price, from the server, whenever the request changes ── */
  const count = refineFrom ? 1 : variations;
  useEffect(() => {
    if (!open || !analysis) return;
    let live = true;
    setQuoting(true); setQuoteFailed(false);
    aiQuote(count, !!refineFrom).then((r) => { if (live) setQuote(r.quote); })
      .catch((e) => {
        if (!live) return;
        setQuote(null); setQuoteFailed(true);
        // The cost box says it (with a retry); only a different reason needs the banner.
        const c = codeOf(e);
        if (c !== 'FAILED' && c !== 'PRICING_UNAVAILABLE') setError(c);
      })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
  }, [open, analysis, count, refineFrom, quoteTry]);

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
        overlayText: overlayText.trim() || undefined,
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

  /* Use = compose first: nothing is created before the customer sees the final creative. */
  const use = (indexes: number[]) => { if (indexes.length && !using) setComposeFor(indexes); };
  const create = async (specs: ComposeSpec[]) => {
    if (!composeFor || using) return;
    setUsing(true);
    try {
      // Primary only where the customer said so. One composed export per request (the server's CPU budget):
      // the chosen visuals go one by one. The original upload is composed into a NEW creative; it never changes.
      let created = 0, refused = 0;
      for (const [k, i] of composeFor.entries()) {
        if (i === ORIGINAL) {
          try { await aiComposeSave(creative.id, specs[k]); created += 1; } catch { refused += 1; }
          continue;
        }
        if (!job) { refused += 1; continue; }
        const r = await aiUse(job.id, [{ index: i, role: picked[i] ?? ('SECONDARY' as Role), spec: specs[k] }]);
        created += r.created.length; refused += r.refused?.length ?? 0;
      }
      if (refused) toast.error(t('mm_ct_refused', { n: String(refused) }));
      if (created) toast.success(t('mm_c_ai_used', { n: String(created) }));
      onCreated();
      if (!refused) onOpenChange(false);
    } catch { toast.error(t('mads_load_failed')); }
    finally { setUsing(false); }
  };

  const concepts = analysis?.analysis?.concepts ?? [];
  const live = (job?.images ?? []).filter((i) => !i.discarded && i.url);
  const running = job?.status === 'RUNNING';
  const stageIndex = running ? Math.max(0, GENERATION_STAGES.indexOf(job!.stage as never)) : -1;
  const chosen = useMemo(() => Object.keys(picked).map(Number).sort((a, b) => a - b), [picked]);
  const intent = useMemo(() => parseOverlayIntent(instruction, overlayText), [instruction, overlayText]);
  const step = composeFor ? 3 : job?.status === 'DONE' ? 2 : 1;
  const ideas = useMemo(() => concepts.map((c) => c.copy).filter((x): x is NonNullable<typeof x> => !!x?.headline), [concepts]);
  const toggle = (index: number) => setPicked((p) => {
    const n = { ...p };
    if (n[index] != null) delete n[index];
    else n[index] = index === ORIGINAL || Object.values(n).includes('PRIMARY') ? 'SECONDARY' : 'PRIMARY';
    return n;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-[calc(100%-1rem)] overflow-y-auto p-4 sm:p-6 md:max-w-3xl" data-mm-ai-panel="">
        <DialogHeader className="pr-10 text-start">
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('mm_cx_title')}</DialogTitle>
          <DialogDescription className="space-y-1 text-[13px] leading-relaxed">
            <span className="block font-medium text-foreground">{t('mm_cx_lead1')}</span>
            <span className="block">{t('mm_cx_lead2')}</span>
            <span className="block">{t('mm_cx_lead3')}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Where the customer is — five plain steps. */}
        <ol className="flex flex-wrap gap-x-3 gap-y-1.5 text-2xs" aria-label={t('mm_cx_steps')} data-mm-ai-steps={STEPS[step]}>
          {STEPS.map((s, i) => (
            <li key={s} data-mm-ai-step={s} data-state={i < step ? 'done' : i === step ? 'active' : 'todo'} aria-current={i === step ? 'step' : undefined}
              className={cn('inline-flex items-center gap-1.5', i === step ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px]',
                i < step ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#161309]' : i === step ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {t(`mm_cx_step_${s}` as never)}
            </li>
          ))}
        </ol>

        {step < 2 && (
          <div className="rounded-2xl border border-[hsl(var(--gold-border))]/50 bg-[hsl(var(--gold-soft))]/40 p-3" data-mm-ai-info="">
            <p className="mb-1 text-[13px] font-semibold text-foreground">{t('mm_cx_info_title')}</p>
            <ul className="grid gap-x-4 gap-y-1 text-[13px] text-foreground/90 sm:grid-cols-2">
              {(['1', '2', '3', '4'] as const).map((k) => (
                <li key={k} className="flex items-start gap-1.5"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />{t(`mm_cx_info_${k}` as never)}</li>
              ))}
            </ul>
          </div>
        )}

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

        {analysis?.analysis && !running && !composeFor && (
          <section className="space-y-3" data-mm-ai-concepts={concepts.length}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground"><span className="font-semibold text-foreground">{t('mm_c_ai_sees')}</span> {analysis.analysis.subject}</p>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1.5 self-start" onClick={() => runAnalysis(true)} disabled={analyzing} data-mm-ai-reanalyze="">
                <RefreshCw className="h-3.5 w-3.5" />{t('mm_c_ai_reanalyze')}
              </Button>
            </div>
            {/* Two readable columns at most: a Georgian paragraph never squeezed into a third of a dialog. */}
            <p className="text-sm font-semibold">{t('mm_cx_directions')}</p>
            <div role="radiogroup" aria-label={t('mm_cx_directions')} className="grid gap-2.5 sm:grid-cols-2">
              {concepts.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={concept === c.id} onClick={() => setConcept(c.id)} data-mm-ai-concept={c.id}
                  className={cn('min-w-0 rounded-2xl border bg-card p-3.5 text-start text-2xs leading-relaxed transition-colors [overflow-wrap:break-word] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
                    concept === c.id ? 'border-[hsl(var(--gold-border))] ring-1 ring-[hsl(var(--gold-border))]' : 'border-border hover:border-[hsl(var(--gold-border))]/60')}>
                  <span className="mb-1 flex items-start gap-1.5 text-[13px] font-semibold leading-snug text-foreground">
                    <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', concept === c.id ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#161309]' : 'border-border')} aria-hidden>
                      {concept === c.id && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">{c.title}</span>
                  </span>
                  <span className="block text-foreground/90">{c.angle}</span>
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

            {/* The words on the creative: typeset by HOMATCH later, never drawn by the image model. */}
            {!refineFrom && (
              <label className="block" data-mm-ai-overlay-field="">
                <span className="mb-1 block text-[13px] font-medium">{t('mm_cx_overlay_label')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
                <Input dir="auto" value={overlayText} maxLength={90} onChange={(e) => setOverlayText(e.target.value)} placeholder={t('mm_cx_overlay_ph')} data-mm-ai-overlay="" />
                <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{t('mm_cx_overlay_help')}</span>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">{t(refineFrom ? 'mm_c_ai_refine_label' : 'mm_cx_instruction')} <span className="text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span></span>
              <Input dir="auto" value={instruction} maxLength={INSTRUCTION_MAX} onChange={(e) => setInstruction(e.target.value)} placeholder={t('mm_cx_instruction_ph')} data-mm-ai-instruction="" />
            </label>
            {intent.overlay && (
              <p className="flex items-start gap-1.5 rounded-lg bg-[hsl(var(--secondary))]/60 px-2.5 py-1.5 text-2xs text-foreground" data-mm-ai-overlay-parsed={intent.overlay.placement ?? ''}>
                <Type className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(intent.overlay.placement ? `mm_cx_overlay_parsed_${intent.overlay.placement}` as never : 'mm_cx_overlay_parsed', { text: intent.overlay.text })}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button key={c} type="button" className="min-h-9 rounded-full border border-border px-3 text-2xs hover:bg-[hsl(var(--secondary))]"
                  onClick={() => setInstruction(t(`mm_c_ai_chip_${c}` as never))} data-mm-ai-chip={c}>{t(`mm_c_ai_chip_${c}` as never)}</button>
              ))}
            </div>

            {!refineFrom && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{t('mm_cx_count')}</span>
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" aria-pressed={variations === n} onClick={() => setVariations(n)} data-mm-ai-count={n}
                    className={cn('grid h-11 w-11 place-items-center rounded-lg border text-[13px] font-semibold', variations === n ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>{n}</button>
                ))}
              </div>
            )}

            {/* The AI generation cost — a cost of this tool, never the price of what is advertised. */}
            <div className="rounded-2xl border border-border bg-[hsl(var(--secondary))]/35 p-3.5" data-mm-ai-quote={quote ? quote.expectedCredits : ''}>
              <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground" data-mm-ai-cost-title="">{t('mm_u_ai_cost_title')}</p>
              {quoting ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('mm_c_ai_pricing')}</p>
              ) : !quote ? (
                quoteFailed ? (
                  <div className="flex flex-wrap items-center gap-2" data-mm-ai-quote-failed="">
                    <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{t('mm_c_ai_err_pricing_unavailable')}</p>
                    <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5" onClick={() => { setError(null); setQuoteTry((n) => n + 1); }} data-mm-ai-quote-retry="">
                      <RefreshCw className="h-3.5 w-3.5" />{t('mm_u_retry')}
                    </Button>
                  </div>
                ) : null
              ) : (
                <>
                  <p className="text-[13px] text-foreground">{t('mm_c_ai_price_line', { n: String(count), credits: quote.expectedCredits.toFixed(2), max: quote.maxCredits.toFixed(2) })}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">{t('mm_c_ai_price_fair', { balance: quote.balanceCredits.toFixed(2) })}</p>
                  {!confirming ? (
                    <Button type="button" className="mt-2 min-h-11 w-full gap-1.5 sm:w-auto" disabled={!concept || !quote.enough || !quote.available} onClick={() => setConfirming(true)} data-mm-ai-generate="">
                      <Wand2 className="h-4 w-4" />{t(refineFrom ? 'mm_c_ai_refine_cta' : 'mm_cx_generate_cta', { n: String(count), credits: quote.expectedCredits.toFixed(2) })}
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

        {composeFor && (
          <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin" />}>
            <CreativeComposer
              items={composeFor.map((i) => i === ORIGINAL
                ? { key: 'original', source: { creativeId: creative.id }, label: t('mm_cx_original') }
                : { key: String(i), source: { jobId: job!.id, index: i }, label: t('mm_cx_variant', { n: String(i) }), textArtifacts: job!.images.find((im) => im.index === i)?.textArtifacts ?? null })}
              ideas={ideas}
              submitLabel={t('mm_ct_create', { n: String(composeFor.length) })} busy={using}
              onSubmit={create} onBack={() => setComposeFor(null)} />
          </Suspense>
        )}

        {job?.status === 'DONE' && !composeFor && (
          <section className="space-y-3" data-mm-ai-gallery={live.length}>
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold">{t('mm_cx_choose_title')}</h3>
                {job.chargedCredits != null && <span className="text-2xs text-muted-foreground" data-mm-ai-charged={job.chargedCredits}>{t('mm_c_ai_charged', { credits: job.chargedCredits.toFixed(2), n: String(live.length) })}</span>}
              </div>
              <p className="text-[13px] text-muted-foreground">{t('mm_cx_choose_desc')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {/* The exact upload — framed differently from the AI variants, never mistaken for one. */}
              <figure className="flex min-w-0 flex-col gap-1.5 rounded-2xl border-2 border-dashed border-border p-1.5" data-mm-ai-original="" data-selected={picked[ORIGINAL] != null ? 'true' : 'false'}>
                <div className={cn('relative overflow-hidden rounded-xl', picked[ORIGINAL] != null && 'ring-2 ring-[hsl(var(--gold-border))]')}>
                  {originalUrl ? <img src={originalUrl} alt={t('mm_cx_original')} className="aspect-square w-full object-cover" /> : <span className="block aspect-square w-full bg-[hsl(var(--secondary))]" />}
                </div>
                <figcaption className="px-0.5">
                  <span className="block text-[13px] font-semibold leading-tight">{t('mm_cx_original')}</span>
                  <span className="block text-2xs text-muted-foreground">{t('mm_cx_original_sub')}</span>
                </figcaption>
                <CardActions t={t} selected={picked[ORIGINAL] != null} label={t('mm_cx_original')}
                  onView={() => originalUrl && setPreview({ url: originalUrl, label: t('mm_cx_original') })} onPick={() => toggle(ORIGINAL)} pickAttr="original" />
              </figure>
              {job.images.map((im) => {
                const sel = picked[im.index];
                const name = t('mm_cx_variant', { n: String(im.index) });
                if (im.discarded) {
                  return (
                    <div key={im.index} className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-border text-2xs text-muted-foreground" data-mm-ai-removed={im.index}>
                      <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2" onClick={() => discard(im.index, true)}><Undo2 className="h-3.5 w-3.5" />{t('mm_c_ai_restore', { n: String(im.index) })}</button>
                    </div>
                  );
                }
                return (
                  <figure key={im.index} className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border p-1.5" data-mm-ai-variant={im.index} data-selected={sel ? 'true' : 'false'}>
                    <div className={cn('relative overflow-hidden rounded-xl', sel && 'ring-2 ring-[hsl(var(--gold-border))]')}>
                      {im.url && <img src={im.url} alt={name} className="aspect-square w-full object-cover" />}
                      {sel && <span className="absolute start-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[hsl(var(--gold))] text-[#161309]"><Check className="h-3.5 w-3.5" /></span>}
                      <button type="button" className="absolute end-1 top-1 grid h-9 w-9 place-items-center rounded-lg bg-black/55 text-white" onClick={() => discard(im.index)} aria-label={t('mm_c_ai_remove', { n: String(im.index) })} data-mm-ai-remove={im.index}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <figcaption className="flex flex-wrap items-center justify-between gap-1 px-0.5">
                      <span className="text-[13px] font-semibold leading-tight">{name}</span>
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 text-2xs text-[hsl(var(--gold-ink))] underline-offset-2 hover:underline" data-mm-ai-refine={im.index}
                        onClick={() => { setRefineFrom({ jobId: job.id, index: im.index }); setConfirming(false); setInstruction(''); }}>
                        <Wand2 className="h-3 w-3" />{t('mm_c_ai_refine')}
                      </button>
                    </figcaption>
                    {im.textArtifacts && (
                      <p className="flex items-start gap-1 px-0.5 text-2xs text-[hsl(32_78%_30%)]" data-mm-ai-artifacts={im.index}>
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />{t('mm_ct_artifacts_short')}
                      </p>
                    )}
                    <CardActions t={t} selected={!!sel} label={name}
                      onView={() => im.url && setPreview({ url: im.url, label: name })} onPick={() => toggle(im.index)} pickAttr={String(im.index)} />
                    {sel && (
                      <select value={sel} onChange={(e) => setPicked((p) => ({ ...p, [im.index]: e.target.value as Role }))} aria-label={t('mm_c_ai_role')}
                        className="h-9 w-full rounded-md border border-border bg-background px-1.5 text-2xs" data-mm-ai-role={im.index}>
                        {ROLES.map((r) => <option key={r} value={r}>{t(`mm_c_ai_role_${r.toLowerCase()}` as never)}</option>)}
                      </select>
                    )}
                  </figure>
                );
              })}
            </div>
            <p className="text-2xs text-muted-foreground" data-mm-ai-visual-only="">{t('mm_ct_visual_only')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-11 w-full gap-1.5 sm:w-auto" disabled={!chosen.length || using} onClick={() => use(chosen)} data-mm-ai-use="">
                <Type className="h-4 w-4" />{t('mm_cx_continue', { n: String(chosen.length) })}
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

/** "View" and "Choose" — two plain, equally sized actions on every card. */
function CardActions({ t, selected, label, onView, onPick, pickAttr }: {
  t: (k: never, v?: Record<string, string>) => string; selected: boolean; label: string; onView: () => void; onPick: () => void; pickAttr: string;
}) {
  return (
    <div className="mt-auto grid grid-cols-1 gap-1.5">
      <button type="button" onClick={onView} aria-label={`${t('mm_cx_view' as never)} · ${label}`} data-mm-ai-preview={pickAttr}
        className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-border px-1.5 text-2xs font-semibold leading-tight hover:bg-[hsl(var(--secondary))]">
        <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('mm_cx_view' as never)}
      </button>
      <button type="button" onClick={onPick} aria-pressed={selected} aria-label={`${t((selected ? 'mm_cx_picked' : 'mm_cx_pick') as never)} · ${label}`} data-mm-ai-pick={pickAttr}
        className={cn('inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border px-1.5 text-2xs font-semibold leading-tight',
          selected ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))] text-[#161309]' : 'border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold-soft))]')}>
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />{t((selected ? 'mm_cx_picked' : 'mm_cx_pick') as never)}
      </button>
    </div>
  );
}

