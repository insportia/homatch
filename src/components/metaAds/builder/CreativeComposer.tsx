// THE TEXT LAYER — what the customer approves is exactly what Meta receives.
//
// The image model made the visual; HOMATCH typesets the copy. Every preview
// here is the server's composition (meta-ads-api `creative_ai_compose`) drawn
// as SVG with real, selectable Unicode text in the very font files the export
// rasterises — so the preview IS the final creative, in every language.
// Editing text, layout, format or theme re-composes only: no new image, no
// model call, nothing charged.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, Loader2, XCircle } from 'lucide-react';
import { Button } from './MetaButton';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  ASPECTS, COPY_LIMITS, LAYOUT_ASPECTS, LAYOUT_IDS, THEME_IDS,
  type Aspect, type ComposeSpec, type CopyField, type CreativeCopy, type LayoutId, type ThemeId,
} from '@/lib/metaAds/creativeLayout';
import { aiCompose, type ComposePreview, type ComposeSource } from '@/services/metaAds';
import { ensureCreativeFonts } from './creativeFonts';

const EDIT_FIELDS: CopyField[] = ['headline', 'subheadline', 'offer', 'cta', 'brand', 'badge'];
/** The three fields everyone needs; price, brand and badge wait behind "more". */
const MAIN_FIELDS: CopyField[] = ['headline', 'subheadline', 'cta'];
const MORE_FIELDS: CopyField[] = ['offer', 'brand', 'badge'];
/** Plain names for the main fields; the rest keep their own. */
const fieldKey = (f: CopyField) => (MAIN_FIELDS.includes(f) ? `mm_cx_f_${f}` : `mm_ct_field_${f}`);
const DEBOUNCE_MS = 450;

export interface ComposerItem { key: string; source: ComposeSource; label: string; textArtifacts?: boolean | null; spec?: ComposeSpec | null }

export default function CreativeComposer({ items, ideas = [], submitLabel, busy, onSubmit, onBack }: {
  items: ComposerItem[];
  /** Ready-made copy from Creative Intelligence ("text ideas"); one tap fills the fields. */
  ideas?: Array<{ headline: string; subheadline?: string; cta?: string }>;
  submitLabel: string;
  busy?: boolean;
  /** One approved spec per item, in order. */
  onSubmit: (specs: ComposeSpec[]) => void;
  onBack?: () => void;
}) {
  const { t } = useLanguage();
  const [fonts, setFonts] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [copy, setCopy] = useState<CreativeCopy | null>(null);
  const [shortHeadline, setShortHeadline] = useState('');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [theme, setTheme] = useState<ThemeId>('INK');
  const [layouts, setLayouts] = useState<Record<string, LayoutId>>({});
  const [active, setActive] = useState(items[0]?.key ?? '');
  const [previews, setPreviews] = useState<Record<string, ComposePreview | null>>({});
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { void ensureCreativeFonts().then((ok) => setFonts(ok ? 'ready' : 'failed')); }, []);

  /* First load: the server's default text layer for each item (concept copy + the layout the visual was made for). */
  useEffect(() => {
    let live = true;
    setPending((n) => n + 1);
    Promise.all(items.map((it) => aiCompose(it.source, it.spec ?? undefined))).then((res) => {
      if (!live) return;
      const first = res[0]?.spec;
      if (first) {
        setCopy(first.copy); setShortHeadline(first.shortHeadline ?? ''); setAspect(first.aspect); setTheme(first.theme);
      }
      setLayouts(Object.fromEntries(items.map((it, i) => [it.key, res[i].spec.layout])));
      setPreviews(Object.fromEntries(items.map((it, i) => [it.key, res[i]])));
    }).catch((e) => { if (live) setFailed(String((e as { code?: string })?.code ?? 'FAILED')); })
      .finally(() => { if (live) setPending((n) => n - 1); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const specFor = (key: string): ComposeSpec | null => (copy ? {
    layout: layouts[key] ?? 'EDITORIAL_BOTTOM', aspect: LAYOUT_ASPECTS[layouts[key] ?? 'EDITORIAL_BOTTOM'].includes(aspect) ? aspect : '4:5',
    theme, copy, ...(shortHeadline ? { shortHeadline } : {}),
  } : null);

  /* Every edit re-composes (debounced). Text-only: the visual is never regenerated. */
  const editKey = JSON.stringify([copy, aspect, theme, layouts]);
  const firstRun = useRef(true);
  /* The edit the shown previews belong to: nothing is created from a preview of an older edit. */
  const [composedKey, setComposedKey] = useState('');
  useEffect(() => {
    if (!copy) return;
    if (firstRun.current) { firstRun.current = false; setComposedKey(editKey); return; }
    const mine = ++seq.current;
    const key = editKey;
    const timer = setTimeout(() => {
      setPending((n) => n + 1);
      Promise.all(items.map((it) => aiCompose(it.source, specFor(it.key)!))).then((res) => {
        if (mine !== seq.current) return;
        setFailed(null);
        setPreviews(Object.fromEntries(items.map((it, i) => [it.key, res[i]])));
        setComposedKey(key);
      }).catch((e) => { if (mine === seq.current) setFailed(String((e as { code?: string })?.code ?? 'FAILED')); })
        .finally(() => setPending((n) => n - 1));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [editKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = previews[active] ?? null;
  const stale = pending > 0 || composedKey !== editKey;
  const allOk = items.every((it) => previews[it.key]?.composition.ok);
  const canSubmit = !!copy && fonts === 'ready' && !stale && !failed && allOk && !busy;
  const activeLayout = layouts[active];
  const blocking = (current?.composition.checks ?? []).filter((c) => c.blocking);
  const notes = (current?.composition.checks ?? []).filter((c) => !c.blocking);
  const readable = useMemo(() => (copy ? EDIT_FIELDS.map((f) => copy[f]).filter(Boolean).join(' · ') : ''), [copy]);
  const activeItem = items.find((i) => i.key === active);

  const set = (f: CopyField, v: string) => setCopy((c) => (c ? { ...c, [f]: v.slice(0, COPY_LIMITS[f]) } : c));
  const renderField = (f: CopyField) => (
    <label key={f} className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2 text-[13px] font-medium">
        <span>{t(fieldKey(f) as never)}{f !== 'headline' && <span className="ms-1 text-2xs font-normal text-muted-foreground">{t('madsb_optional')}</span>}</span>
        <span className="text-2xs tabular-nums text-muted-foreground" dir="ltr">{(copy?.[f] ?? '').length}/{COPY_LIMITS[f]}</span>
      </span>
      <Input dir="auto" value={copy?.[f] ?? ''} maxLength={COPY_LIMITS[f]} onChange={(e) => set(f, e.target.value)}
        aria-invalid={blocking.some((c) => c.field === f) || undefined} data-mm-composer-field={f} />
    </label>
  );

  return (
    <section className="space-y-3" data-mm-composer={items.length} data-mm-composer-state={stale ? 'composing' : allOk ? 'ok' : 'blocked'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-[hsl(var(--secondary))]" aria-label={t('mm_ct_back')} data-mm-composer-back="">
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{t('mm_cx_text_title')}</h3>
            <p className="text-[13px] text-muted-foreground">{t('mm_cx_text_desc')}</p>
          </div>
        </div>
        <p className="text-2xs text-muted-foreground" data-mm-composer-free="">{t('mm_ct_free_note')}</p>
      </div>

      {items.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('mm_ct_variations')}>
          {items.map((it) => (
            <button key={it.key} type="button" role="tab" aria-selected={active === it.key} onClick={() => setActive(it.key)} data-mm-composer-tab={it.key}
              className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold',
                active === it.key ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>
              {previews[it.key]?.composition.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}{it.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The final creative — the same composition the export rasterises. */}
        <figure className="min-w-0 space-y-1.5">
          <div className={cn('relative overflow-hidden rounded-xl border border-border bg-[hsl(var(--secondary))]/50 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full', stale && 'opacity-80')}
            data-mm-composer-preview={active} data-mm-composer-layout={current?.composition.layout ?? ''} data-mm-composer-dir={current?.composition.dir ?? ''}
            role="img" aria-label={readable}>
            {fonts === 'ready' && current?.svg
              ? <div dangerouslySetInnerHTML={{ __html: current.svg }} />
              : <div className="grid aspect-[4/5] place-items-center text-[13px] text-muted-foreground">
                  {fonts === 'failed' ? t('mm_ct_fonts_failed') : <Loader2 className="h-5 w-5 animate-spin" aria-label={t('mm_ct_composing')} />}
                </div>}
            {stale && current?.svg && <span className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white"><Loader2 className="h-4 w-4 animate-spin" aria-label={t('mm_ct_composing')} /></span>}
          </div>
          <figcaption className="text-2xs text-muted-foreground">{t('mm_ct_preview_note')}</figcaption>
          {activeItem?.textArtifacts && (
            <p className="flex items-start gap-1.5 rounded-lg border border-[hsl(32_78%_36%)]/40 bg-[hsl(32_78%_36%)]/10 px-2.5 py-1.5 text-2xs text-[hsl(32_78%_28%)]" data-mm-composer-artifacts="">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t('mm_ct_artifacts')}
            </p>
          )}
        </figure>

        <div className="min-w-0 space-y-3">
          {copy && ideas.length > 0 && (
            <div className="space-y-1.5" data-mm-composer-ideas={ideas.length}>
              <p className="text-[13px] font-semibold">{t('mm_cx_ideas_title')}</p>
              <p className="text-2xs text-muted-foreground">{t('mm_cx_ideas_desc')}</p>
              <div className="flex flex-col gap-1.5">
                {ideas.slice(0, 3).map((idea, i) => (
                  <button key={i} type="button" dir="auto" data-mm-composer-idea={i}
                    onClick={() => setCopy((c) => (c ? { ...c, headline: idea.headline, ...(idea.subheadline ? { subheadline: idea.subheadline } : {}), ...(idea.cta ? { cta: idea.cta } : {}) } : c))}
                    className="min-h-11 rounded-xl border border-border px-3 py-2 text-start text-[13px] leading-snug [overflow-wrap:anywhere] hover:border-[hsl(var(--gold-border))] hover:bg-[hsl(var(--gold-soft))]/50">
                    <span className="font-semibold">{idea.headline}</span>{idea.subheadline ? <span className="block text-2xs text-muted-foreground">{idea.subheadline}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
          {copy && MAIN_FIELDS.map((f) => renderField(f))}
          {copy && (
            <details className="group rounded-xl border border-border px-3 py-1.5" data-mm-composer-more="" open={MORE_FIELDS.some((f) => !!copy[f]) || undefined}>
              <summary className="flex min-h-10 cursor-pointer list-none items-center text-[13px] font-medium">{t('mm_cx_more_fields')}</summary>
              <div className="space-y-3 pb-2 pt-1">{MORE_FIELDS.map((f) => renderField(f))}</div>
            </details>
          )}

          <fieldset>
            <legend className="mb-1 text-[13px] font-medium">{t('mm_ct_layout')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUT_IDS.filter((l) => LAYOUT_ASPECTS[l].includes(aspect)).map((l) => (
                <button key={l} type="button" aria-pressed={activeLayout === l} onClick={() => setLayouts((x) => ({ ...x, [active]: l }))} data-mm-composer-layout-pick={l}
                  className={cn('min-h-11 rounded-lg border px-3 text-2xs font-semibold', activeLayout === l ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>
                  {t(`mm_ct_layout_${l.toLowerCase()}` as never)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-4">
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium">{t('mm_ct_format')}</legend>
              <div className="flex gap-1.5">
                {ASPECTS.map((a) => (
                  <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)} data-mm-composer-aspect={a} dir="ltr"
                    className={cn('min-h-11 min-w-11 rounded-lg border px-2.5 text-2xs font-semibold', aspect === a ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>{a}</button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium">{t('mm_ct_theme')}</legend>
              <div className="flex gap-1.5">
                {THEME_IDS.map((th) => (
                  <button key={th} type="button" aria-pressed={theme === th} onClick={() => setTheme(th)} data-mm-composer-theme={th}
                    className={cn('min-h-11 rounded-lg border px-3 text-2xs font-semibold', theme === th ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border')}>
                    {t(`mm_ct_theme_${th.toLowerCase()}` as never)}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Legibility, said before anything is created. */}
          <div className="space-y-1" role="status" aria-live="polite" data-mm-composer-checks={blocking.length}>
            {failed && <p className="flex items-start gap-1.5 text-2xs text-destructive"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t(failed === 'COMPOSER_UNAVAILABLE' ? 'mm_ct_unavailable' : 'mm_ct_failed')}</p>}
            {blocking.map((c, i) => (
              <p key={`${c.code}${i}`} className="flex items-start gap-1.5 text-2xs text-destructive" data-mm-composer-check={c.code}>
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t(`mm_ct_check_${c.code.toLowerCase()}` as never, { field: c.field ? t(fieldKey(c.field as CopyField) as never) : '' })}
              </p>
            ))}
            {notes.map((c, i) => (
              <p key={`${c.code}${i}`} className="flex items-start gap-1.5 text-2xs text-muted-foreground" data-mm-composer-note={c.code}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(`mm_ct_check_${c.code.toLowerCase()}` as never, { field: c.field ? t(fieldKey(c.field as CopyField) as never) : '' })}{c.detail && c.code === 'MIXED_SCRIPT_WORD' ? `: ${c.detail}` : ''}
              </p>
            ))}
            {!failed && !stale && allOk && current && (
              <p className="flex items-center gap-1.5 text-2xs text-[hsl(152_54%_26%)]" data-mm-composer-ready=""><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t('mm_ct_ready')}</p>
            )}
          </div>

          <Button type="button" className="min-h-11 w-full gap-1.5 sm:w-auto" disabled={!canSubmit}
            onClick={() => onSubmit(items.map((it) => specFor(it.key)!))} data-mm-composer-submit="">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{submitLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
