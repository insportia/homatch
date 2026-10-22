// The inspector for the selected section. Every supported property of every
// block is editable by hand; AI help appears where it fits (rewrite a paragraph,
// suggest a button label) and always arrives as a suggestion to accept or discard.
// Images are real objects: pick one of the property's public photos or paste an
// https address, then resize (width %), position (alignment), caption, link,
// replace or remove it.
import React, { useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Check, ImageOff, Languages, Loader2, Plus, Sparkles, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Align, type Block, safeHref, safeImageSrc, sanitizeInline } from '@/communication/emailDesign';
import { type RewriteMode, type StudioPhoto, studioAi } from '@/services/communicationStudio';
import { aiErrorKey } from '@/components/communication/MessageAssistDialog';
import { RichTextField } from './RichTextField';

const field = 'h-10 w-full min-w-0 rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring';
const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-2xs font-semibold ring-1 ring-inset ring-border hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{children}</span>;
}

function AlignPicker({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const { t } = useLanguage();
  const items: Array<[Align, React.ComponentType<{ className?: string }>]> = [['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]];
  return (
    <div className="inline-flex rounded-lg p-0.5 ring-1 ring-inset ring-border" role="radiogroup" aria-label={t('es_alignment')}>
      {items.map(([a, Icon]) => (
        <button key={a} type="button" role="radio" aria-checked={value === a} onClick={() => onChange(a)} aria-label={t(`es_align_${a}`)}
          className={cn('grid h-8 w-9 place-items-center rounded-md', value === a ? 'bg-foreground text-background' : 'hover:bg-muted')}>
          <Icon className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function PhotoGrid({ photos, selected, onPick }: { photos: StudioPhoto[]; selected: string[]; onPick: (url: string) => void }) {
  const { t } = useLanguage();
  if (!photos.length) return <p className="text-2xs text-muted-foreground">{t('es_no_public_photos')}</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {photos.map((p) => {
        const on = selected.includes(p.url);
        return (
          <button key={p.url} type="button" onClick={() => onPick(p.url)} aria-pressed={on}
            className={cn('relative aspect-[4/3] overflow-hidden rounded-lg ring-2 focus-visible:outline-none focus-visible:ring-ring', on ? 'ring-[hsl(38_92%_50%)]' : 'ring-transparent hover:ring-border')}>
            <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            {p.cover ? <span className="absolute start-1 top-1 rounded bg-black/60 px-1 text-2xs font-semibold text-white">{t('es_cover')}</span> : null}
            {on ? <span className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[hsl(38_92%_50%)]"><Check className="h-3 w-3 text-black" aria-hidden="true" /></span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function BlockInspector({ block, onChange, photos, language, propertyId, propertyFacts }: {
  block: Block;
  onChange: (next: Block) => void;
  photos: StudioPhoto[];
  language: string;
  propertyId: string | null;
  /** Label/value pairs read from the property, for "fill from property". */
  propertyFacts: Array<{ label: string; value: string }>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const dir = language === 'ar' || language === 'he' ? 'rtl' : 'auto';

  const rewrite = async (mode: RewriteMode, html: string, target?: string) => {
    setBusy(mode);
    try { setSuggestion(await studioAi.rewrite({ text: html, mode, language, targetLanguage: target, propertyId })); }
    catch (e) { toast.error(t(aiErrorKey(e))); } finally { setBusy(null); }
  };

  switch (block.type) {
    case 'header':
      return (
        <div className="space-y-3">
          <label className="block"><Label>{t('es_brand')}</Label><input className={field} value={block.brand} maxLength={60} onChange={(e) => onChange({ ...block, brand: e.target.value })} /></label>
          <label className="block"><Label>{t('es_tagline')}</Label><input className={field} dir={dir} value={block.tagline} maxLength={120} onChange={(e) => onChange({ ...block, tagline: e.target.value })} /></label>
        </div>
      );
    case 'heading':
      return (
        <div className="space-y-3">
          <label className="block"><Label>{t('es_heading_text')}</Label><input className={field} dir={dir} value={block.text} maxLength={200} onChange={(e) => onChange({ ...block, text: e.target.value })} /></label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg p-0.5 ring-1 ring-inset ring-border" role="radiogroup" aria-label={t('es_heading_size')}>
              {([1, 2] as const).map((lv) => (
                <button key={lv} type="button" role="radio" aria-checked={block.level === lv} onClick={() => onChange({ ...block, level: lv })}
                  className={cn('h-8 rounded-md px-3 text-2xs font-semibold', block.level === lv ? 'bg-foreground text-background' : 'hover:bg-muted')}>{t(lv === 1 ? 'es_large' : 'es_medium')}</button>
              ))}
            </div>
            <AlignPicker value={block.align} onChange={(align) => onChange({ ...block, align })} />
          </div>
        </div>
      );
    case 'text':
      return (
        <div className="space-y-3">
          <RichTextField value={block.html} onChange={(html) => onChange({ ...block, html })} label={t('es_block_text')} dir={dir} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AlignPicker value={block.align} onChange={(align) => onChange({ ...block, align })} />
            <button type="button" className={chip} onClick={() => onChange({ ...block, html: `${block.html}{{first_name|}}` })}>{t('es_insert_name')}</button>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label={t('es_ai_actions')}>
            {(['improve', 'shorten', 'expand', 'professional', 'persuasive'] as RewriteMode[]).map((m) => (
              <button key={m} type="button" className={chip} disabled={!block.html.trim() || busy !== null} onClick={() => void rewrite(m, block.html)}>
                {busy === m ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}{t(`es_ai_${m}`)}
              </button>
            ))}
            <button type="button" className={chip} disabled={!block.html.trim() || busy !== null} onClick={() => void rewrite('translate', block.html, language)}>
              {busy === 'translate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}{t('es_ai_translate_to', { lang: t(`fbx_lang_${language}`) })}
            </button>
          </div>
          {suggestion !== null && (
            <div className="space-y-2 rounded-xl bg-[hsl(42_100%_96%)] p-3 ring-1 ring-inset ring-[hsl(40_80%_75%)]" role="region" aria-label={t('es_ai_suggestion')}>
              <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_32%)]">{t('es_ai_suggestion')}</p>
              {/* The suggestion is already sanitised to the inline allowlist by the server and again here. */}
              <div dir={dir} className="text-sm leading-relaxed [&_a]:underline" dangerouslySetInnerHTML={{ __html: sanitizeInline(suggestion) }} />
              <div className="flex gap-2">
                <button type="button" onClick={() => { onChange({ ...block, html: suggestion }); setSuggestion(null); }}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[hsl(218_52%_11%)] px-3 text-2xs font-semibold text-[hsl(40_94%_64%)]"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t('es_accept')}</button>
                <button type="button" onClick={() => setSuggestion(null)} className={chip}><X className="h-3.5 w-3.5" aria-hidden="true" />{t('es_discard')}</button>
              </div>
            </div>
          )}
        </div>
      );
    case 'image':
      return (
        <div className="space-y-3">
          {block.src ? (
            <div className="overflow-hidden rounded-xl bg-muted/50 p-2">
              <div style={{ textAlign: block.align }}>
                <img src={block.src} alt={block.alt} className="inline-block max-h-48 rounded-lg object-cover" style={{ width: `${block.width}%` }} />
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-2xs text-muted-foreground"><ImageOff className="h-4 w-4" aria-hidden="true" />{t('es_image_missing')}</p>
          )}
          <div><Label>{t('es_choose_photo')}</Label><PhotoGrid photos={photos} selected={block.src ? [block.src] : []} onPick={(src) => onChange({ ...block, src })} /></div>
          <div className="flex gap-2">
            <input className={field} dir="ltr" placeholder="https://" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} aria-label={t('es_image_url')} />
            <button type="button" className={chip} onClick={() => { const src = safeImageSrc(urlDraft); if (!src) { toast.error(t('es_image_url_invalid')); return; } onChange({ ...block, src }); setUrlDraft(''); }}>{t('es_apply')}</button>
          </div>
          <label className="block">
            <Label>{t('es_image_width', { n: String(block.width) })}</Label>
            <input type="range" min={20} max={100} step={5} value={block.width} onChange={(e) => onChange({ ...block, width: Number(e.target.value) })} className="w-full accent-[hsl(38_92%_50%)]" />
          </label>
          <AlignPicker value={block.align} onChange={(align) => onChange({ ...block, align })} />
          <label className="block"><Label>{t('es_alt_text')}</Label><input className={field} dir={dir} value={block.alt} maxLength={200} onChange={(e) => onChange({ ...block, alt: e.target.value })} /></label>
          <label className="block"><Label>{t('es_caption')}</Label><input className={field} dir={dir} value={block.caption} maxLength={200} onChange={(e) => onChange({ ...block, caption: e.target.value })} /></label>
          <label className="block"><Label>{t('es_image_link')}</Label><input className={field} dir="ltr" placeholder="https://" value={block.href} onChange={(e) => onChange({ ...block, href: e.target.value })} onBlur={() => onChange({ ...block, href: safeHref(block.href) })} /></label>
          {block.src ? <button type="button" className={chip} onClick={() => onChange({ ...block, src: '' })}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('es_remove_image')}</button> : null}
        </div>
      );
    case 'gallery': {
      const urls = block.images.map((i) => i.src);
      return (
        <div className="space-y-3">
          <p className="text-2xs text-muted-foreground">{t('es_gallery_hint')}</p>
          <PhotoGrid photos={photos} selected={urls} onPick={(src) => {
            const has = urls.includes(src);
            const images = has ? block.images.filter((i) => i.src !== src) : [...block.images, { src, alt: '' }].slice(-3);
            onChange({ ...block, images });
          }} />
        </div>
      );
    }
    case 'button':
      return (
        <div className="space-y-3">
          <label className="block"><Label>{t('es_button_label')}</Label><input className={field} dir={dir} value={block.label} maxLength={60} onChange={(e) => onChange({ ...block, label: e.target.value })} /></label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chip} disabled={busy !== null} onClick={async () => {
              setBusy('cta');
              try { setLabels(await studioAi.cta({ language, propertyId })); } catch (e) { toast.error(t(aiErrorKey(e))); } finally { setBusy(null); }
            }}>
              {busy === 'cta' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}{t('es_ai_cta')}
            </button>
            {labels.map((l) => <button key={l} type="button" className={chip} dir="auto" onClick={() => onChange({ ...block, label: l })}>{l}</button>)}
          </div>
          <label className="block"><Label>{t('es_button_link')}</Label>
            <input className={field} dir="ltr" placeholder="https:// · mailto: · tel:" value={block.href} onChange={(e) => onChange({ ...block, href: e.target.value })} onBlur={() => onChange({ ...block, href: safeHref(block.href) })} />
          </label>
          <AlignPicker value={block.align} onChange={(align) => onChange({ ...block, align })} />
        </div>
      );
    case 'facts':
      return (
        <div className="space-y-2">
          {propertyFacts.length > 0 && (
            <button type="button" className={chip} onClick={() => onChange({ ...block, items: propertyFacts.slice(0, 8) })}>{t('es_fill_facts')}</button>
          )}
          {block.items.map((it, i) => (
            <div key={i} className="flex gap-1.5">
              <input className={field} dir={dir} value={it.label} maxLength={40} aria-label={t('es_fact_label')} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className={field} dir={dir} value={it.value} maxLength={80} aria-label={t('es_fact_value')} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-muted" aria-label={t('es_remove')} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          ))}
          {block.items.length < 8 && <button type="button" className={chip} onClick={() => onChange({ ...block, items: [...block.items, { label: '', value: '' }] })}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('es_add_fact')}</button>}
        </div>
      );
    case 'spacer':
      return (
        <label className="block"><Label>{t('es_spacer_size', { n: String(block.size) })}</Label>
          <input type="range" min={8} max={96} step={4} value={block.size} onChange={(e) => onChange({ ...block, size: Number(e.target.value) })} className="w-full accent-[hsl(38_92%_50%)]" />
        </label>
      );
    case 'footer':
      return (
        <label className="block"><Label>{t('es_footer_text')}</Label>
          <textarea className="w-full rounded-xl bg-background p-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" rows={4} dir={dir} maxLength={500} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <span className="mt-1 block text-2xs text-muted-foreground">{t('es_footer_unsub_note')}</span>
        </label>
      );
    case 'divider':
      return <p className="text-2xs text-muted-foreground">{t('es_divider_note')}</p>;
  }
}

export default BlockInspector;
