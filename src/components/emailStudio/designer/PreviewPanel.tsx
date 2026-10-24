// EMAIL STUDIO — previews and checks for a design: desktop / mobile (the wrapped email exactly as
// sent, merge fields at their fallbacks), a dark-mode SIMULATION, the generated HTML, and the
// checks report (compatibility warnings with email-safe fixes, missing alt text and links,
// Gmail's clipping size). Everything here is computed from the renderer's own output; nothing
// claims how a particular mail app will render it — only a test send to that app shows that.

import { AlertTriangle, Check, CheckCircle2, ClipboardCopy, Code2, Info, ListChecks, Monitor, Moon, Wand2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { renderCampaignEmail } from '@/emailMarketing/campaignTemplate';
import { buttonsMissingLink, imagesMissingAlt } from '@/emailMarketing/designer/checks';
import { analyzeCompat, applyAllFixes, type CompatWarning, GMAIL_CLIP_BYTES } from '@/emailMarketing/designer/compat';
import type { Block, EmailDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { findBlock } from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';
import { EmailPreviewFrame } from '../shared';

type Mode = 'device' | 'dark' | 'html' | 'checks';

/* Full colour inversion: what apps that force dark mode (Gmail app, some Outlook builds) roughly do. */
const DARK_INVERT = '<style>html{background:#fff!important;filter:invert(1) hue-rotate(180deg)}img,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}</style>';

export function PreviewPanel({ doc, rtl, subject, previewText, senderName, language, label, onApply, onSelect }: {
  doc: EmailDoc; rtl: boolean; subject: string; previewText?: string | null; senderName?: string | null; language?: string | null;
  label: (b: Block) => string; onApply: (doc: EmailDoc) => void; onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('device');
  const body = useMemo(() => renderDesignBody(doc, { rtl }), [doc, rtl]);
  const full = useMemo(() => {
    const merge = (s: string) => s.replace(/\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g, (_m, _f, fb?: string) => String(fb ?? '').trim());
    return renderCampaignEmail({ subject: merge(subject), bodyHtml: merge(body.html), bodyText: merge(body.text), senderName: senderName ?? null,
      lang: language ?? 'en', preheader: previewText ? merge(previewText) : null, unsubscribeUrl: '#' }).html;
  }, [body, subject, senderName, language, previewText]);
  const bytes = useMemo(() => new TextEncoder().encode(full).length, [full]);
  const warnings = useMemo(() => analyzeCompat(doc), [doc]);
  const alt = useMemo(() => imagesMissingAlt(doc), [doc]);
  const links = useMemo(() => buttonsMissingLink(doc), [doc]);
  const issues = warnings.filter((w) => w.severity === 'warn').length + alt.length + links.length;

  const tabs: Array<[Mode, React.ComponentType<{ className?: string }>, string]> = [
    ['device', Monitor, t('ems_b_prev_device')], ['dark', Moon, t('ems_b_prev_dark')], ['html', Code2, t('ems_b_prev_html')], ['checks', ListChecks, t('ems_b_prev_checks')],
  ];
  return (
    <div className="space-y-3">
      <div className="inline-flex flex-wrap rounded-lg border bg-card p-0.5" role="tablist" aria-label={t('ems_b_preview')}>
        {tabs.map(([m, I, l]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs', mode === m ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
            <I className="h-3.5 w-3.5" />{l}
            {m === 'checks' && issues ? <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{issues}</span> : null}
          </button>
        ))}
      </div>

      {mode === 'device' ? <EmailPreviewFrame subject={subject} html={doc.blocks.length ? body.html : null} text={body.text} senderName={senderName} language={language} previewText={previewText} /> : null}

      {mode === 'dark' ? (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('ems_b_dark_hint')}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {([['ems_b_dark_invert', DARK_INVERT], ['ems_b_dark_keep', '']] as const).map(([k, css]) => (
              <figure key={k} className="space-y-1">
                <figcaption className="text-2xs font-medium text-muted-foreground">{t(k)}</figcaption>
                <div className="overflow-hidden rounded-xl border bg-[#111] p-2">
                  <iframe title={t(k)} sandbox="" srcDoc={css ? full.replace(/<\/head>/i, `${css}</head>`) : full} className="h-[30rem] w-full rounded-lg border-0 bg-white" />
                </div>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      {mode === 'html' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('ems_b_html_size', { kb: (bytes / 1024).toFixed(1), limit: Math.round(GMAIL_CLIP_BYTES / 1024) })}</span>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5"
              onClick={() => { void navigator.clipboard?.writeText(full).then(() => toast.success(t('ems_b_copied')), () => toast.error(t('ems_b_copy_failed'))); }}>
              <ClipboardCopy className="h-3.5 w-3.5" />{t('ems_b_copy_html')}
            </Button>
          </div>
          <pre className="max-h-[32rem] overflow-auto rounded-xl border bg-[#0C1119] p-3 text-[11px] leading-relaxed text-[#E6E1D6]" dir="ltr"><code>{full}</code></pre>
          <p className="text-2xs text-muted-foreground">{t('ems_b_html_note')}</p>
        </div>
      ) : null}

      {mode === 'checks' ? (
        <ChecksReport doc={doc} warnings={warnings} alt={alt} links={links} bytes={bytes} label={label} onApply={onApply} onSelect={onSelect} />
      ) : null}
    </div>
  );
}

export function ChecksReport({ doc, warnings, alt, links, bytes, label, onApply, onSelect }: {
  doc: EmailDoc; warnings: CompatWarning[]; alt: string[]; links: string[]; bytes?: number;
  label: (b: Block) => string; onApply: (doc: EmailDoc) => void; onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const fixable = warnings.some((w) => w.fix);
  const name = (id?: string) => { const b = id ? findBlock(doc.blocks, id) : null; return b ? label(b) : null; };
  const Row = ({ tone, children, id, action }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode; id?: string; action?: React.ReactNode }) => (
    <li className="flex items-start gap-2 rounded-lg border bg-card p-2.5 text-xs">
      {tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
        : tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div>{children}</div>
        {id ? <button type="button" className="text-2xs text-[hsl(32_60%_38%)] underline-offset-2 hover:underline" onClick={() => onSelect(id)}>{t('ems_b_show_block', { name: name(id) ?? '' })}</button> : null}
      </div>
      {action}
    </li>
  );
  return (
    <div className="space-y-3">
      {warnings.length ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">{t('ems_b_compat_title')}</p>
          {fixable ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs">{t('ems_b_compat_suggest')}</span>
              <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => onApply(applyAllFixes(doc))}><Wand2 className="h-3.5 w-3.5" />{t('ems_b_apply_all')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-1.5">
        {warnings.map((w, i) => (
          <Row key={`${w.code}-${w.blockId ?? i}`} tone={w.severity === 'warn' ? 'warn' : 'info'} id={w.blockId}
            action={w.fix ? <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-2xs" onClick={() => onApply(w.fix!(doc))}><Check className="h-3 w-3" />{t('ems_b_apply')}</Button> : null}>
            {t(`ems_b_compat_${w.code.toLowerCase()}`, Object.fromEntries(Object.entries(w.vars ?? {}).map(([k, v]) => [k, String(v)])))}
          </Row>
        ))}
        {alt.map((id) => <Row key={`alt-${id}`} tone="warn" id={id}>{t('ems_b_check_alt')}</Row>)}
        {links.map((id) => <Row key={`link-${id}`} tone="warn" id={id}>{t('ems_b_check_link')}</Row>)}
        {!warnings.length && !alt.length && !links.length ? <Row tone="ok">{t('ems_b_checks_clear')}</Row> : null}
        {bytes != null ? <Row tone={bytes > GMAIL_CLIP_BYTES ? 'warn' : 'ok'}>{t('ems_b_html_size', { kb: (bytes / 1024).toFixed(1), limit: Math.round(GMAIL_CLIP_BYTES / 1024) })}</Row> : null}
        <Row tone="info">{t('ems_b_checks_disclaimer')}</Row>
      </ul>
    </div>
  );
}
