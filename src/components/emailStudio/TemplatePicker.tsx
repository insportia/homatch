// EMAIL STUDIO — choose how the email starts (UX pass §5): a blank canvas, one of the ten built-in
// templates, or one of the customer's own. Every card is a LIVE miniature rendered by the email
// renderer itself (sandboxed iframe, no script), and any template opens in a full desktop/mobile
// preview before it is chosen. Nothing is applied until the customer picks.

import { Eye, FilePlus2, Sparkles } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { type EmailDoc, emptyDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { builtInTemplate, TEMPLATE_KINDS, type TemplateKind, templateSubject } from '@/emailMarketing/designer/templates';
import { renderCampaignEmail } from '@/emailMarketing/campaignTemplate';
import { cn } from '@/lib/utils';
import type { UserTemplate } from '@/services/emailCampaignStudio';
import { EmailPreviewFrame } from './shared';

export interface PickedStart { doc: EmailDoc; subject: string | null; previewText: string | null; template: string }

function Miniature({ doc, language, title }: { doc: EmailDoc; language: string; title: string }) {
  const html = useMemo(() => {
    const body = renderDesignBody(doc, { rtl: language === 'ar' || language === 'he', draft: true });
    return renderCampaignEmail({ subject: title, bodyHtml: body.html, bodyText: body.text, lang: language, unsubscribeUrl: '#' }).html
      .replace(/\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g, (_m, _f, fb?: string) => String(fb ?? ''));
  }, [doc, language, title]);
  return (
    <div className="flex h-[15rem] justify-center overflow-hidden rounded-t-xl bg-[#EDE8E0]" aria-hidden="true">
      <div className="relative h-[360px] w-[245px] shrink-0" dir="ltr">
        <iframe title={title} sandbox="" srcDoc={html} tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 h-[1000px] w-[680px] origin-top-left scale-[0.36] border-0" />
      </div>
    </div>
  );
}

export function TemplatePicker({ language, mine, onPick, onCancel }: {
  language: string; mine: UserTemplate[]; onPick: (p: PickedStart) => void; onCancel?: () => void;
}) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<{ key: string; name: string; doc: EmailDoc; subject: string | null; previewText: string | null; template: string } | null>(null);
  const builtIns = useMemo(() => TEMPLATE_KINDS.map((k: TemplateKind) => ({ key: k, doc: builtInTemplate(k, language), subject: templateSubject(k, language) })), [language]);
  const own = mine.filter((x) => x.kind !== 'SECTION' && x.design?.blocks?.length);

  const Card = ({ name, sub, doc, onUse, onPreview, badge }: { name: string; sub: string; doc: EmailDoc; onUse: () => void; onPreview: () => void; badge?: string }) => (
    <div className="group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_rgba(12,17,25,0.04)] transition-shadow hover:shadow-md">
      <button type="button" onClick={onPreview} className="block text-start" aria-label={`${t('ems_tpl_preview')}: ${name}`}>
        <Miniature doc={doc} language={language} title={name} />
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold [overflow-wrap:anywhere]">{name}{badge ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{badge}</span> : null}</p>
          <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{sub}</p>
        </div>
        <div className="mt-auto flex gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onPreview}><Eye className="h-3.5 w-3.5" />{t('ems_tpl_preview')}</Button>
          <Button type="button" size="sm" className="h-8 flex-1 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={onUse}>{t('ems_tpl_use')}</Button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('ems_pick_start')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('ems_pick_start_sub')}</p>
        </div>
        {onCancel ? <Button variant="ghost" size="sm" onClick={onCancel}>{t('ems_cancel')}</Button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <button type="button" onClick={() => onPick({ doc: emptyDoc(), subject: null, previewText: null, template: 'blank' })}
          className="flex min-h-[19rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors hover:border-[hsl(38_70%_55%)] hover:bg-[hsl(38_90%_98%)]">
          <FilePlus2 className="h-7 w-7 text-[hsl(32_60%_38%)]" aria-hidden="true" />
          <span className="text-sm font-semibold">{t('ems_tpl_blank')}</span>
          <span className="max-w-[14rem] text-2xs text-muted-foreground">{t('ems_tpl_blank_sub')}</span>
        </button>
        {builtIns.map((b) => (
          <Card key={b.key} name={t(`ems_tpl_${b.key.toLowerCase()}`)} sub={t(`ems_tpl_${b.key.toLowerCase()}_sub`)} doc={b.doc}
            onPreview={() => setPreview({ key: b.key, name: t(`ems_tpl_${b.key.toLowerCase()}`), doc: b.doc, subject: b.subject, previewText: null, template: b.key })}
            onUse={() => onPick({ doc: b.doc, subject: b.subject, previewText: null, template: b.key })} />
        ))}
        {own.map((x) => (
          <Card key={x.id} name={x.name} sub={t('ems_tpl_mine')} badge={t('ems_tpl_mine_badge')} doc={x.design}
            onPreview={() => setPreview({ key: x.id, name: x.name, doc: x.design, subject: x.subject, previewText: x.preview_text, template: 'custom' })}
            onUse={() => onPick({ doc: x.design, subject: x.subject, previewText: x.preview_text, template: 'custom' })} />
        ))}
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-2xs text-muted-foreground"><Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-[hsl(38_80%_45%)]" aria-hidden="true" />{t('ems_tpl_homi_hint')}</p>

      <Dialog open={Boolean(preview)} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className={cn('max-h-[92dvh] overflow-y-auto sm:max-w-3xl')}>
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>{t('ems_tpl_preview_sub')}</DialogDescription>
          </DialogHeader>
          {preview ? (
            <EmailPreviewFrame subject={preview.subject ?? preview.name} html={renderDesignBody(preview.doc, { rtl: language === 'ar' || language === 'he', draft: true }).html}
              text={renderDesignBody(preview.doc).text} language={language} previewText={preview.previewText} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>{t('ems_back')}</Button>
            <Button className="bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={() => { if (preview) onPick({ doc: preview.doc, subject: preview.subject, previewText: preview.previewText, template: preview.template }); setPreview(null); }}>{t('ems_tpl_use')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
