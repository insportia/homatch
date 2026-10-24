// EMAIL STUDIO — the designer's property controls (the Properties panel). Every control writes a
// document value normalizeDoc accepts; nothing here can express markup or an unsafe URL.

import {
  AlignCenter, AlignLeft, AlignRight, ChevronDown, Info, Link2, Lock, Plus, ShieldAlert, Trash2, X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type Align, type Block, type ButtonBlock, COLUMN_RATIOS, FONT_KEYS, ICON_GLYPHS, type LeafBlock, type Pad, SOCIAL_NETWORKS, type SocialNetwork, type Theme,
} from '@/emailMarketing/designer/document';
import { HTML_BLOCK_MAX, sanitizeEmailHtml } from '@/emailMarketing/designer/emailHtml';
import { inlineMarkup, renderBlockHtml } from '@/emailMarketing/designer/render';
import { textToRich } from '@/emailMarketing/designer/richText';
import { checkUrl } from '@/emailMarketing/risk/links';
import { cn } from '@/lib/utils';
import { ImagePicker } from '../ImagePicker';
import { RichTextEditor } from '../RichTextEditor';
import { findingText } from '../shared';

type Icon = React.ComponentType<{ className?: string }>;

export function ToolBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-30">
      {children}
    </button>
  );
}

/* ── property controls ─────────────────────────────────────────────────────────────────────── */

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-foreground/80">{label}</Label>
      {children}
      {hint}
    </div>
  );
}

export function Hint({ text }: { text: string }) {
  return <p className="flex items-start gap-1 text-2xs leading-snug text-muted-foreground"><Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />{text}</p>;
}

export function ColorField({ label, value, onChange, allowEmpty = false }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; allowEmpty?: boolean }) {
  const { t } = useLanguage();
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value ?? '#FFFFFF'} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
        <Input value={text} dir="ltr" className="h-8 font-mono text-xs" placeholder={allowEmpty ? t('ems_d_none') : t('ems_d_hex_placeholder')}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { const v = text.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase()); else if (!v && allowEmpty) onChange(null); else setText(value ?? ''); }} />
        {allowEmpty && value ? <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('ems_d_clear')} onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></Button> : null}
      </div>
    </Field>
  );
}

export function NumberField({ label, value, min, max, onChange, suffix }: { label: string; value: number | undefined; min: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <Input type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} className="h-8 text-xs"
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n)))); }} />
        {suffix ? <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  );
}

export function SliderField({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <Field label={`${label} · ${value}${suffix ?? ''}`}>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([n]) => onChange(n)} aria-label={label} />
    </Field>
  );
}

export function AlignField({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const { t } = useLanguage();
  const opts: Array<[Align, Icon]> = [['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]];
  return (
    <Field label={t('ems_d_align')}>
      <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('ems_d_align')}>
        {opts.map(([a, I]) => (
          <button key={a} type="button" aria-pressed={value === a} aria-label={t(`ems_d_align_${a}`)} onClick={() => onChange(a)}
            className={cn('inline-flex h-7 w-8 items-center justify-center rounded-md', value === a ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
            <I className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </Field>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ v: T; l: string }>; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <div className="inline-flex flex-wrap rounded-lg border p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={cn('inline-flex h-7 items-center rounded-md px-2.5 text-xs', value === o.v ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
            {o.l}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function UrlField({ label, value, onChange, kind = 'a', text, hint }: { label: string; value: string | null | undefined; onChange: (v: string) => void; kind?: 'a' | 'img'; text?: string; hint?: string }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const findings = draft.trim() ? checkUrl(draft.trim(), { kind, text }) : [];
  const accepted = kind === 'img' ? /^https:\/\//i.test(draft.trim()) : /^(https:\/\/|mailto:|tel:)/i.test(draft.trim());
  return (
    <Field label={label} hint={
      <div className="space-y-0.5">
        {hint ? <Hint text={hint} /> : null}
        {draft.trim() && !accepted ? <p className="text-2xs text-red-700">{t(kind === 'img' ? 'ems_d_url_https_image' : 'ems_d_url_https')}</p> : null}
        {findings.map((f) => (
          <p key={f.code} className={cn('flex items-start gap-1 text-2xs', f.severity === 'BLOCK' ? 'text-red-700' : 'text-amber-800')}>
            <Link2 className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />{findingText(t, f)}
          </p>
        ))}
      </div>
    }>
      <Input value={draft} dir="ltr" inputMode="url" placeholder="https://" className="h-8 text-xs"
        onChange={(e) => setDraft(e.target.value)} onBlur={() => onChange(draft.trim())} />
    </Field>
  );
}

export const MERGE_FIELDS = ['{{first_name|}}', '{{name|}}'];

export function TextField({ label, value, onChange, rows = 4, max }: { label: string; value: string; onChange: (v: string) => void; rows?: number; max: number }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  const insert = (s: string) => {
    const el = ref.current;
    const pos = el ? el.selectionStart : draft.length;
    const next = (draft.slice(0, pos) + s + draft.slice(pos)).slice(0, max);
    setDraft(next); onChange(next);
  };
  return (
    <Field label={label} hint={
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {MERGE_FIELDS.map((m) => (
          <button key={m} type="button" onClick={() => insert(m)} className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:text-foreground" dir="ltr">{m}</button>
        ))}
        <span className="ms-auto text-2xs text-muted-foreground">{t('ems_d_markup_hint')}</span>
      </div>
    }>
      <Textarea ref={ref} value={draft} rows={rows} maxLength={max} className="text-sm"
        onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onChange(draft); }} />
    </Field>
  );
}

export function ShortText({ label, value, max, onChange, placeholder }: { label: string; value: string; max: number; onChange: (v: string) => void; placeholder?: string }) {
  return <Field label={label}><Input value={value} maxLength={max} placeholder={placeholder} className="h-8 text-sm" onChange={(e) => onChange(e.target.value)} /></Field>;
}

export function PaddingField({ value, onChange }: { value: Pad | undefined; onChange: (p: Pad) => void }) {
  const { t } = useLanguage();
  const p = value ?? { t: 8, r: 32, b: 8, l: 32 };
  return (
    <Field label={t('ems_d_padding')}>
      <div className="grid grid-cols-4 gap-1">
        {(['t', 'r', 'b', 'l'] as const).map((k) => (
          <Input key={k} type="number" min={0} max={80} aria-label={t(`ems_d_pad_${k}`)} value={p[k]} className="h-8 px-1.5 text-center text-xs"
            onChange={(e) => onChange({ ...p, [k]: Math.min(80, Math.max(0, Number(e.target.value) || 0)) })} />
        ))}
      </div>
    </Field>
  );
}

export function FontField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { t } = useLanguage();
  return (
    <Field label={t('ems_d_font')}>
      <Select value={value ?? 'inherit'} onValueChange={(v) => onChange(v === 'inherit' ? undefined : v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{t('ems_d_font_inherit')}</SelectItem>
          {FONT_KEYS.map((f) => <SelectItem key={f} value={f}>{t(`ems_d_font_${f}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function WeightField({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  const { t } = useLanguage();
  return (
    <Field label={t('ems_d_weight')}>
      <Select value={String(value ?? '')} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('ems_d_font_inherit')} /></SelectTrigger>
        <SelectContent>
          {[400, 500, 600, 700, 800].map((w) => <SelectItem key={w} value={String(w)}>{t(`ems_d_weight_${w}`)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

/* CTA presets: one click to a recognisable style; every value stays editable below. */
const BUTTON_PRESETS: Array<{ key: string; patch: (accent: string) => Partial<ButtonBlock> }> = [
  { key: 'solid', patch: (a) => ({ buttonColor: a, textColor: '#0C1119', radius: 10, strokeWidth: 0, strokeColor: null, fullWidth: false }) },
  { key: 'dark', patch: () => ({ buttonColor: '#0C1119', textColor: '#FFFFFF', radius: 8, strokeWidth: 0, strokeColor: null, fullWidth: false }) },
  { key: 'outline', patch: (a) => ({ buttonColor: '#FFFFFF', textColor: '#0C1119', radius: 8, strokeWidth: 2, strokeColor: a, fullWidth: false }) },
  { key: 'pill', patch: (a) => ({ buttonColor: a, textColor: '#FFFFFF', radius: 40, strokeWidth: 0, strokeColor: null, size: 'lg', fullWidth: false }) },
  { key: 'square', patch: () => ({ buttonColor: '#1B1B1B', textColor: '#FFFFFF', radius: 0, strokeWidth: 0, strokeColor: null, size: 'lg', fullWidth: false }) },
  { key: 'wide', patch: (a) => ({ buttonColor: a, textColor: '#0C1119', radius: 10, strokeWidth: 0, strokeColor: null, fullWidth: true }) },
];

export function ButtonBuilder({ b, theme, rtl, onPatch }: { b: ButtonBlock; theme: Theme; rtl: boolean; onPatch: (p: Record<string, unknown>, key?: string) => void }) {
  const { t } = useLanguage();
  const [advanced, setAdvanced] = useState(false);
  const preview = useMemo(() => renderBlockHtml({ ...b, label: b.label || t('ems_d_button_sample'), padding: { t: 10, r: 10, b: 10, l: 10 } }, theme, rtl), [b, theme, rtl, t]);
  return (
    <>
      <ShortText label={t('ems_d_label')} value={b.label} max={80} onChange={(v) => onPatch({ label: v }, `label:${b.id}`)} placeholder={t('ems_d_button_sample')} />
      <UrlField label={t('ems_d_link')} value={b.href} text={b.label} onChange={(v) => onPatch({ href: v })} hint={t('ems_d_button_link_hint')} />
      <Field label={t('ems_d_button_style')}>
        <div className="grid grid-cols-3 gap-1.5">
          {BUTTON_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => onPatch(p.patch(theme.accent))}
              className="rounded-md border px-1.5 py-1.5 text-2xs hover:border-[hsl(38_70%_55%)] hover:bg-[hsl(38_90%_97%)]">{t(`ems_d_btn_${p.key}`)}</button>
          ))}
        </div>
      </Field>
      <div className="rounded-lg border bg-[repeating-conic-gradient(#f4f4f4_0_25%,#fff_0_50%)] bg-[length:14px_14px]" aria-hidden="true"
        // Safe: renderer output (escaped, no script).
        dangerouslySetInnerHTML={{ __html: preview }} />
      <Segmented label={t('ems_d_size')} value={b.size ?? 'md'} options={(['sm', 'md', 'lg'] as const).map((s) => ({ v: s, l: t(`ems_d_size_${s}`) }))}
        onChange={(v) => onPatch({ size: v, paddingX: undefined, paddingY: undefined, fontSize: undefined })} />
      <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
      <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_full_width')}</span><Switch checked={Boolean(b.fullWidth)} onCheckedChange={(v) => onPatch({ fullWidth: v })} /></label>
      <div className="grid grid-cols-2 gap-2">
        <ColorField label={t('ems_d_button_color')} value={b.buttonColor} onChange={(v) => v && onPatch({ buttonColor: v })} />
        <ColorField label={t('ems_d_text_color')} value={b.textColor} onChange={(v) => v && onPatch({ textColor: v })} />
      </div>
      <SliderField label={t('ems_d_radius')} value={b.radius} min={0} max={40} suffix="px" onChange={(n) => onPatch({ radius: n }, `radius:${b.id}`)} />
      <button type="button" className="flex w-full items-center justify-between text-xs font-medium text-foreground/80" onClick={() => setAdvanced((o) => !o)} aria-expanded={advanced}>
        {t('ems_d_more_options')}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
      </button>
      {advanced ? (
        <div className="space-y-3">
          <ColorField label={t('ems_d_hover_color')} value={b.hoverColor} allowEmpty onChange={(v) => onPatch({ hoverColor: v })} />
          <Hint text={t('ems_d_hover_hint')} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('ems_d_outline')} value={b.strokeWidth ?? 0} min={0} max={4} suffix="px" onChange={(n) => onPatch({ strokeWidth: n })} />
            <ColorField label={t('ems_d_outline_color')} value={b.strokeColor} allowEmpty onChange={(v) => onPatch({ strokeColor: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('ems_d_pad_x')} value={b.paddingX} min={8} max={64} suffix="px" onChange={(n) => onPatch({ paddingX: n })} />
            <NumberField label={t('ems_d_pad_y')} value={b.paddingY} min={6} max={28} suffix="px" onChange={(n) => onPatch({ paddingY: n })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('ems_d_size')} value={b.fontSize} min={12} max={22} suffix="px" onChange={(n) => onPatch({ fontSize: n })} />
            <WeightField value={b.fontWeight} onChange={(n) => onPatch({ fontWeight: n })} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function BlockProperties({ block, theme, rtl, onPatch, onClose, onRemove, editsOnCanvas = false, locked = false, canHtml = true }: {
  block: Block | LeafBlock; theme: Theme; rtl: boolean; onPatch: (p: Record<string, unknown>, key?: string) => void; onClose: () => void; onRemove: () => void;
  /** Wide screens edit text in place on the canvas; the panel then only explains how. */
  editsOnCanvas?: boolean;
  /** A locked layer (or one inside a locked section) shows its lock, not its controls. */
  locked?: boolean;
  /** The advanced HTML block is for accounts the server allows; others see why it is read-only. */
  canHtml?: boolean;
}) {
  const { t } = useLanguage();
  const b = block as Block;
  const [advanced, setAdvanced] = useState(false);
  if (locked) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{b.name || t(`ems_block_${b.type}`)}</p>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t('ems_d_close')} onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
        </div>
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('ems_b_locked_hint')}</p>
        {b.locked ? <Button type="button" variant="outline" size="sm" className="h-8 w-full" onClick={() => onPatch({ locked: false })}>{t('ems_b_unlock')}</Button> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t(`ems_block_${b.type}`)}</p>
          <p className="text-2xs leading-snug text-muted-foreground">{t(`ems_block_${b.type}_hint`)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t('ems_d_delete')} onClick={onRemove}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={t('ems_d_close')} onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {b.type === 'heading' || b.type === 'text' ? (<>
        {editsOnCanvas ? <Hint text={t('ems_d_rich_hint')} /> : (
          <Field label={t('ems_d_text')} hint={<Hint text={t('ems_d_rich_hint')} />}>
            <RichTextEditor value={b.rich ?? ''} fallbackHtml={b.rich ? undefined : inlineMarkup(b.text, theme.link)} inline={b.type === 'heading'}
              ariaLabel={t('ems_d_text')} dir={rtl ? 'rtl' : 'ltr'} onChange={(rich) => onPatch({ rich }, `rich:${b.id}`)} className="text-sm" />
          </Field>
        )}
        <div className="flex flex-wrap gap-1">
          {MERGE_FIELDS.map((m) => (
            <button key={m} type="button" className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:text-foreground" dir="ltr"
              onClick={() => onPatch({ rich: `${b.rich ?? textToRich(b.text)} ${m}`.trim() })}>{m}</button>
          ))}
        </div>
        {b.type === 'heading' ? (
          <Segmented label={t('ems_d_level')} value={String(b.level) as '1' | '2' | '3'} options={(['1', '2', '3'] as const).map((l) => ({ v: l, l: t(`ems_d_level_${l}`) }))}
            onChange={(v) => onPatch({ level: Number(v), fontSize: undefined })} />
        ) : null}
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_b_font_size')} value={b.fontSize} min={b.type === 'heading' ? 14 : 11} max={b.type === 'heading' ? 48 : 28} suffix="px" onChange={(n) => onPatch({ fontSize: n })} />
          <WeightField value={b.fontWeight} onChange={(n) => onPatch({ fontWeight: n })} />
        </div>
        {b.type === 'text' ? <SliderField label={t('ems_d_line_height')} value={b.lineHeight ?? 1.65} min={1} max={2.2} step={0.05} onChange={(n) => onPatch({ lineHeight: Math.round(n * 100) / 100 }, `lh:${b.id}`)} /> : null}
        {b.type === 'heading' ? <SliderField label={t('ems_d_letter_spacing')} value={b.letterSpacing ?? 0} min={0} max={8} onChange={(n) => onPatch({ letterSpacing: n }, `ls:${b.id}`)} /> : null}
        <FontField value={b.fontFamily} onChange={(v) => onPatch({ fontFamily: v })} />
        <ColorField label={t('ems_d_text_color')} value={b.color} allowEmpty onChange={(v) => onPatch({ color: v })} />
      </>) : null}

      {b.type === 'image' || b.type === 'logo' ? (<>
        <ImagePicker label={t(b.type === 'logo' ? 'ems_d_logo_file' : 'ems_d_image_file')} kind={b.type === 'logo' ? 'LOGO' : 'IMAGE'} value={b.src}
          onChange={(src, meta) => onPatch({ src, ...(meta?.name && !b.alt ? { alt: meta.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 120) } : {}) })} />
        <Field label={t('ems_d_alt')} hint={<Hint text={t('ems_d_alt_hint')} />}><Input value={b.alt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ alt: e.target.value }, `alt:${b.id}`)} /></Field>
        <UrlField label={t('ems_d_link_optional')} value={b.href ?? ''} onChange={(v) => onPatch({ href: v || null })} />
        <SliderField label={t('ems_d_width')} value={b.width} min={40} max={b.type === 'logo' ? 300 : 600} suffix="px" onChange={(n) => onPatch({ width: n }, `w:${b.id}`)} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        {b.type === 'image' ? <SliderField label={t('ems_d_radius')} value={b.radius ?? 0} min={0} max={40} suffix="px" onChange={(n) => onPatch({ radius: n }, `r:${b.id}`)} /> : null}
      </>) : null}

      {b.type === 'button' ? <ButtonBuilder b={b} theme={theme} rtl={rtl} onPatch={onPatch} /> : null}

      {b.type === 'banner' ? (<>
        <ShortText label={t('ems_d_eyebrow')} value={b.eyebrow} max={80} onChange={(v) => onPatch({ eyebrow: v }, `e:${b.id}`)} />
        <ShortText label={t('ems_d_title')} value={b.title} max={300} onChange={(v) => onPatch({ title: v }, `t:${b.id}`)} />
        <TextField label={t('ems_d_subtitle')} value={b.subtitle} max={600} rows={3} onChange={(v) => onPatch({ subtitle: v })} />
        <ImagePicker label={t('ems_d_image_optional')} value={b.imageSrc} onChange={(src) => onPatch({ imageSrc: src })} />
        {b.imageSrc ? <Field label={t('ems_d_alt')}><Input value={b.imageAlt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ imageAlt: e.target.value }, `alt:${b.id}`)} /></Field> : null}
        <ShortText label={t('ems_d_button_label')} value={b.buttonLabel} max={80} onChange={(v) => onPatch({ buttonLabel: v }, `bl:${b.id}`)} />
        <UrlField label={t('ems_d_link')} value={b.buttonHref} text={b.buttonLabel} onChange={(v) => onPatch({ buttonHref: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_background')} value={b.background} onChange={(v) => onPatch({ background: v })} />
          <ColorField label={t('ems_d_text_color')} value={b.textColor} onChange={(v) => v && onPatch({ textColor: v })} />
          <ColorField label={t('ems_d_button_color')} value={b.buttonColor} onChange={(v) => v && onPatch({ buttonColor: v })} />
          <ColorField label={t('ems_d_button_text')} value={b.buttonTextColor} onChange={(v) => v && onPatch({ buttonTextColor: v })} />
        </div>
      </>) : null}

      {b.type === 'card' ? (<>
        <ImagePicker label={t('ems_d_image_optional')} value={b.imageSrc} onChange={(src) => onPatch({ imageSrc: src })} />
        {b.imageSrc ? <Field label={t('ems_d_alt')}><Input value={b.imageAlt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ imageAlt: e.target.value }, `alt:${b.id}`)} /></Field> : null}
        <ShortText label={t('ems_d_title')} value={b.title} max={300} onChange={(v) => onPatch({ title: v }, `t:${b.id}`)} />
        <TextField label={t('ems_d_text')} value={b.text} max={1500} rows={3} onChange={(v) => onPatch({ text: v })} />
        <ShortText label={t('ems_d_button_label')} value={b.buttonLabel} max={80} onChange={(v) => onPatch({ buttonLabel: v }, `bl:${b.id}`)} />
        <UrlField label={t('ems_d_link')} value={b.buttonHref} text={b.buttonLabel} onChange={(v) => onPatch({ buttonHref: v })} />
        <Segmented label={t('ems_d_layout')} value={b.layout} options={[{ v: 'stack', l: t('ems_d_layout_stack') }, { v: 'side', l: t('ems_d_layout_side') }]} onChange={(v) => onPatch({ layout: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_card_color')} value={b.cardColor} onChange={(v) => v && onPatch({ cardColor: v })} />
          <ColorField label={t('ems_d_border_color')} value={b.borderColor} allowEmpty onChange={(v) => onPatch({ borderColor: v, borderWidth: v ? b.borderWidth || 1 : 0 })} />
          <ColorField label={t('ems_d_button_color')} value={b.buttonColor} onChange={(v) => v && onPatch({ buttonColor: v })} />
          <ColorField label={t('ems_d_button_text')} value={b.buttonTextColor} onChange={(v) => v && onPatch({ buttonTextColor: v })} />
        </div>
        <SliderField label={t('ems_d_radius')} value={b.radius} min={0} max={32} suffix="px" onChange={(n) => onPatch({ radius: n }, `r:${b.id}`)} />
      </>) : null}

      {b.type === 'header' ? (<>
        <ImagePicker label={t('ems_d_logo_file')} kind="LOGO" value={b.logoSrc} onChange={(src) => onPatch({ logoSrc: src })} />
        {b.logoSrc ? <SliderField label={t('ems_d_width')} value={b.logoWidth} min={40} max={260} suffix="px" onChange={(n) => onPatch({ logoWidth: n }, `w:${b.id}`)} /> : null}
        <ShortText label={t('ems_d_brand')} value={b.brand} max={80} onChange={(v) => onPatch({ brand: v }, `br:${b.id}`)} />
        <ShortText label={t('ems_d_tagline')} value={b.tagline} max={160} onChange={(v) => onPatch({ tagline: v }, `tg:${b.id}`)} />
        <UrlField label={t('ems_d_link_optional')} value={b.href ?? ''} onChange={(v) => onPatch({ href: v || null })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_text_color')} value={b.textColor} onChange={(v) => v && onPatch({ textColor: v })} />
          <ColorField label={t('ems_d_background')} value={b.background} allowEmpty onChange={(v) => onPatch({ background: v })} />
        </div>
      </>) : null}

      {b.type === 'facts' ? (<>
        <div className="space-y-1.5">
          {b.items.map((it, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <Field label={t('ems_d_fact_value')}><Input value={it.value} maxLength={80} className="h-8 text-xs" onChange={(e) => onPatch({ items: b.items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }, `fv:${b.id}:${i}`)} /></Field>
              <Field label={t('ems_d_fact_label')}><Input value={it.label} maxLength={60} className="h-8 text-xs" onChange={(e) => onPatch({ items: b.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }, `fl:${b.id}:${i}`)} /></Field>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('ems_d_delete')} onClick={() => onPatch({ items: b.items.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {b.items.length < 8 ? <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5" onClick={() => onPatch({ items: [...b.items, { label: t('ems_d_fact_label'), value: '—' }] })}><Plus className="h-3.5 w-3.5" />{t('ems_d_add_fact')}</Button> : null}
        </div>
        <Segmented label={t('ems_d_columns')} value={String(b.columns) as '2' | '3' | '4'} options={(['2', '3', '4'] as const).map((n) => ({ v: n, l: n }))} onChange={(v) => onPatch({ columns: Number(v) })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_value_color')} value={b.valueColor} allowEmpty onChange={(v) => onPatch({ valueColor: v })} />
          <ColorField label={t('ems_d_tile_color')} value={b.tileColor} allowEmpty onChange={(v) => onPatch({ tileColor: v })} />
        </div>
      </>) : null}

      {b.type === 'divider' ? (<>
        <ColorField label={t('ems_d_color')} value={b.color} onChange={(v) => v && onPatch({ color: v })} />
        <SliderField label={t('ems_d_thickness')} value={b.thickness} min={1} max={6} suffix="px" onChange={(n) => onPatch({ thickness: n }, `th:${b.id}`)} />
        <SliderField label={t('ems_d_rule_width')} value={b.widthPct ?? 100} min={5} max={100} suffix="%" onChange={(n) => onPatch({ widthPct: n }, `wp:${b.id}`)} />
      </>) : null}

      {b.type === 'spacer' ? <SliderField label={t('ems_d_height')} value={b.height} min={4} max={120} suffix="px" onChange={(n) => onPatch({ height: n }, `h:${b.id}`)} /> : null}

      {b.type === 'social' ? <SocialEditor links={b.links} onChange={(links) => onPatch({ links })} /> : null}

      {b.type === 'footer' ? (<>
        <TextField label={t('ems_d_text')} value={b.text} max={1000} rows={4} onChange={(v) => onPatch({ text: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <ColorField label={t('ems_d_text_color')} value={b.color} allowEmpty onChange={(v) => onPatch({ color: v })} />
      </>) : null}

      {b.type === 'contact' ? (<>
        {(['name', 'email', 'phone', 'address'] as const).map((k) => (
          <Field key={k} label={t(`ems_d_contact_${k}`)}>
            <Input value={b[k]} dir={k === 'email' || k === 'phone' ? 'ltr' : undefined} className="h-8 text-xs" maxLength={k === 'address' ? 300 : 254}
              onChange={(e) => onPatch({ [k]: e.target.value }, `${k}:${b.id}`)} />
          </Field>
        ))}
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
      </>) : null}

      {b.type === 'unsubscribe' ? (<>
        <Field label={t('ems_d_label')} hint={<Hint text={t('ems_d_unsubscribe_hint')} />}>
          <Input value={b.text} maxLength={200} placeholder={t('ems_d_unsubscribe_default')} className="h-8 text-xs" onChange={(e) => onPatch({ text: e.target.value }, `u:${b.id}`)} />
        </Field>
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
      </>) : null}

      {b.type === 'section' ? (<>
        <Hint text={t('ems_b_section_hint')} />
        <ColorField label={t('ems_d_background')} value={b.background ?? theme.card} onChange={(v) => onPatch({ background: v })} />
        <ImagePicker label={t('ems_b_bg_image')} value={b.bgImage} onChange={(src) => onPatch({ bgImage: src })} />
        {b.bgImage ? <Hint text={t('ems_b_bg_image_hint')} /> : null}
        <SliderField label={t('ems_d_radius')} value={b.radius} min={0} max={32} suffix="px" onChange={(n) => onPatch({ radius: n }, `r:${b.id}`)} />
        <p className="text-2xs text-muted-foreground">{t('ems_b_section_children', { n: b.children.length })}</p>
      </>) : null}

      {b.type === 'badge' ? (<>
        <ShortText label={t('ems_d_label')} value={b.text} max={40} onChange={(v) => onPatch({ text: v }, `bt:${b.id}`)} placeholder={t('ems_b_badge_sample')} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <div className="grid grid-cols-2 gap-2">
          <ColorField label={t('ems_d_color')} value={b.color} onChange={(v) => v && onPatch({ color: v })} />
          <ColorField label={t('ems_d_text_color')} value={b.textColor} onChange={(v) => v && onPatch({ textColor: v })} />
        </div>
        <SliderField label={t('ems_d_radius')} value={b.radius} min={0} max={40} suffix="px" onChange={(n) => onPatch({ radius: n }, `r:${b.id}`)} />
      </>) : null}

      {b.type === 'icon' ? (<>
        <Field label={t('ems_b_glyph')}>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={t('ems_b_glyph')}>
            {ICON_GLYPHS.map((g) => (
              <button key={g} type="button" aria-pressed={b.glyph === g} aria-label={t(`ems_b_glyph_${g}`)} title={t(`ems_b_glyph_${g}`)} onClick={() => onPatch({ glyph: g })}
                className={cn('h-8 rounded-md border text-base', b.glyph === g ? 'border-transparent bg-[#0C1119] text-white' : 'hover:bg-muted')}>
                {({ check: '✓', star: '★', phone: '☎', mail: '✉', home: '⌂', pin: '●', key: '◆', arrow: '→' } as const)[g]}
              </button>
            ))}
          </div>
        </Field>
        <TextField label={t('ems_d_text')} value={b.label} max={200} rows={2} onChange={(v) => onPatch({ label: v })} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <ColorField label={t('ems_d_color')} value={b.color} onChange={(v) => v && onPatch({ color: v })} />
        <SliderField label={t('ems_d_size')} value={b.size} min={12} max={40} suffix="px" onChange={(n) => onPatch({ size: n }, `s:${b.id}`)} />
      </>) : null}

      {b.type === 'gallery' ? (<>
        {b.images.map((img, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-2">
            <ImagePicker label={t('ems_b_gallery_image_n', { n: i + 1 })} value={img.src}
              onChange={(src, meta) => onPatch({ images: b.images.map((x, j) => (j === i ? { ...x, src, alt: x.alt || (meta?.name ?? '').replace(/\.[a-z0-9]+$/i, '').slice(0, 120) } : x)) })} />
            <Field label={t('ems_d_alt')}><Input value={img.alt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ images: b.images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)) }, `ga:${b.id}:${i}`)} /></Field>
            <UrlField label={t('ems_d_link_optional')} value={img.href ?? ''} onChange={(v) => onPatch({ images: b.images.map((x, j) => (j === i ? { ...x, href: v || null } : x)) })} />
            {b.images.length > 2 ? <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-red-700" onClick={() => onPatch({ images: b.images.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" />{t('ems_d_delete')}</Button> : null}
          </div>
        ))}
        {b.images.length < 3 ? <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5" onClick={() => onPatch({ images: [...b.images, { src: '', alt: '', href: null }] })}><Plus className="h-3.5 w-3.5" />{t('ems_b_add_image')}</Button> : null}
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t('ems_d_gap')} value={b.gap} min={0} max={24} suffix="px" onChange={(n) => onPatch({ gap: n })} />
          <NumberField label={t('ems_d_radius')} value={b.radius} min={0} max={24} suffix="px" onChange={(n) => onPatch({ radius: n })} />
        </div>
      </>) : null}

      {b.type === 'video' ? (<>
        <Hint text={t('ems_b_video_hint')} />
        <ImagePicker label={t('ems_b_video_thumb')} value={b.thumbSrc} playMark
          onChange={(src, meta) => onPatch({ thumbSrc: src, ...(meta?.name && !b.alt ? { alt: meta.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) } : {}) })} />
        <Field label={t('ems_d_alt')} hint={<Hint text={t('ems_d_alt_hint')} />}><Input value={b.alt} maxLength={200} className="h-8 text-xs" onChange={(e) => onPatch({ alt: e.target.value }, `alt:${b.id}`)} /></Field>
        <UrlField label={t('ems_b_video_link')} value={b.href} onChange={(v) => onPatch({ href: v })} hint={t('ems_b_video_link_hint')} />
        <ShortText label={t('ems_b_video_caption')} value={b.caption} max={200} onChange={(v) => onPatch({ caption: v }, `vc:${b.id}`)} />
        <SliderField label={t('ems_d_width')} value={b.width} min={120} max={600} suffix="px" onChange={(n) => onPatch({ width: n }, `w:${b.id}`)} />
        <AlignField value={b.align} onChange={(a) => onPatch({ align: a })} />
        <SliderField label={t('ems_d_radius')} value={b.radius} min={0} max={32} suffix="px" onChange={(n) => onPatch({ radius: n }, `r:${b.id}`)} />
      </>) : null}

      {b.type === 'html' ? <HtmlEditor html={b.html} canEdit={canHtml} onChange={(html) => onPatch({ html })} /> : null}

      {b.type === 'columns' ? (<>
        <Segmented label={t('ems_d_ratio')} value={b.ratio} options={COLUMN_RATIOS.map((r) => ({ v: r, l: r.replace('-', ' / ') }))} onChange={(v) => onPatch({ ratio: v })} />
        <SliderField label={t('ems_d_gap')} value={b.gap} min={0} max={40} suffix="px" onChange={(n) => onPatch({ gap: n }, `g:${b.id}`)} />
        <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_stack_mobile')}</span><Switch checked={b.stackOnMobile} onCheckedChange={(v) => onPatch({ stackOnMobile: v })} /></label>
      </>) : null}

      <div className="border-t pt-3">
        <button type="button" className="flex w-full items-center justify-between text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground" onClick={() => setAdvanced((o) => !o)} aria-expanded={advanced}>
          {t('ems_d_section_style')}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
        </button>
        {advanced ? (
          <div className="mt-3 space-y-3">
            <ShortText label={t('ems_b_layer_name')} value={b.name ?? ''} max={60} placeholder={t(`ems_block_${b.type}`)} onChange={(v) => onPatch({ name: v || null }, `n:${b.id}`)} />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('ems_b_margin_top')} value={b.margin?.t ?? 0} min={0} max={80} suffix="px" onChange={(n) => onPatch({ margin: { t: n, b: b.margin?.b ?? 0 } })} />
              <NumberField label={t('ems_b_margin_bottom')} value={b.margin?.b ?? 0} min={0} max={80} suffix="px" onChange={(n) => onPatch({ margin: { t: b.margin?.t ?? 0, b: n } })} />
            </div>
            {b.type !== 'banner' && b.type !== 'section' ? <ColorField label={t('ems_d_background')} value={b.background} allowEmpty onChange={(v) => onPatch({ background: v })} /> : null}
            <PaddingField value={b.padding} onChange={(p) => onPatch({ padding: p }, `pad:${b.id}`)} />
            {b.type !== 'card' ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t('ems_d_border')} value={b.borderWidth ?? 0} min={0} max={8} suffix="px" onChange={(n) => onPatch({ borderWidth: n })} />
                <ColorField label={t('ems_d_border_color')} value={b.borderColor} allowEmpty onChange={(v) => onPatch({ borderColor: v })} />
              </div>
            ) : null}
            <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_hide_mobile')}</span><Switch checked={Boolean(b.hideOnMobile)} onCheckedChange={(v) => onPatch({ hideOnMobile: v, hideOnDesktop: v ? false : b.hideOnDesktop })} /></label>
            <label className="flex items-center justify-between gap-2 text-xs"><span>{t('ems_d_hide_desktop')}</span><Switch checked={Boolean(b.hideOnDesktop)} onCheckedChange={(v) => onPatch({ hideOnDesktop: v, hideOnMobile: v ? false : b.hideOnMobile })} /></label>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SocialEditor({ links, onChange }: { links: Array<{ network: SocialNetwork; url: string }>; onChange: (l: Array<{ network: SocialNetwork; url: string }>) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="space-y-1 rounded-lg border p-2">
          <div className="flex items-center gap-1.5">
            <Select value={l.network} onValueChange={(v) => onChange(links.map((x, j) => (j === i ? { ...x, network: v as SocialNetwork } : x)))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SOCIAL_NETWORKS.map((n) => <SelectItem key={n} value={n}>{t(`ems_social_${n}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('ems_d_delete')} onClick={() => onChange(links.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          <UrlField label={t('ems_d_link')} value={l.url} onChange={(v) => onChange(links.map((x, j) => (j === i ? { ...x, url: v } : x)))} />
        </div>
      ))}
      {links.length < 9 ? (
        <Button type="button" variant="outline" size="sm" className="h-8 w-full" onClick={() => onChange([...links, { network: 'website', url: '' }])}>{t('ems_d_add_social')}</Button>
      ) : null}
    </div>
  );
}

export function ThemeProperties({ theme, onPatch }: { theme: Theme; onPatch: (p: Partial<Theme>) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3.5">
      <div>
        <p className="text-sm font-semibold">{t('ems_d_theme')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('ems_d_theme_hint')}</p>
      </div>
      <ColorField label={t('ems_d_canvas')} value={theme.canvas} onChange={(v) => v && onPatch({ canvas: v })} />
      <ColorField label={t('ems_d_card')} value={theme.card} onChange={(v) => v && onPatch({ card: v })} />
      <ColorField label={t('ems_d_text_color')} value={theme.text} onChange={(v) => v && onPatch({ text: v })} />
      <ColorField label={t('ems_d_muted')} value={theme.muted} onChange={(v) => v && onPatch({ muted: v })} />
      <ColorField label={t('ems_d_accent')} value={theme.accent} onChange={(v) => v && onPatch({ accent: v })} />
      <ColorField label={t('ems_d_link_color')} value={theme.link} onChange={(v) => v && onPatch({ link: v })} />
      <Field label={t('ems_d_font')}>
        <Select value={theme.fontFamily} onValueChange={(v) => onPatch({ fontFamily: v as Theme['fontFamily'] })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{FONT_KEYS.map((f) => <SelectItem key={f} value={f}>{t(`ems_d_font_${f}`)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t('ems_b_email_width')} value={theme.width} min={480} max={680} suffix="px" onChange={(n) => onPatch({ width: n })} />
        <NumberField label={t('ems_d_radius')} value={theme.radius} min={0} max={28} suffix="px" onChange={(n) => onPatch({ radius: n })} />
      </div>
    </div>
  );
}

/* The advanced HTML block: written in a text area, reduced to the email-safe allowlist by the
   server on every save (emailHtml.ts); what was removed is shown, never silently kept. */
function HtmlEditor({ html, canEdit, onChange }: { html: string; canEdit: boolean; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(html);
  const [removed, setRemoved] = useState(false);
  useEffect(() => setDraft(html), [html]);
  const save = () => {
    if (!canEdit || draft === html) return;
    setRemoved(sanitizeEmailHtml(draft) !== draft.trim());
    onChange(draft);
  };
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-2xs leading-snug text-amber-900">
        <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('ems_b_html_warning')}
      </p>
      <Textarea value={draft} rows={10} maxLength={HTML_BLOCK_MAX} dir="ltr" readOnly={!canEdit} className="font-mono text-xs" aria-label={t('ems_block_html')}
        onChange={(e) => setDraft(e.target.value)} onBlur={save} />
      <div className="flex items-center justify-between text-2xs text-muted-foreground">
        <span>{t('ems_b_html_allowed')}</span>
        <span dir="ltr">{draft.length}/{HTML_BLOCK_MAX}</span>
      </div>
      {removed ? <p className="text-2xs text-amber-800">{t('ems_b_html_sanitized')}</p> : null}
      {!canEdit ? <p className="text-2xs text-muted-foreground">{t('ems_b_html_readonly')}</p> : null}
    </div>
  );
}
