// The live preview: the exact HTML outreach-send will deliver, rendered in a
// sandboxed iframe (no scripts, no same-origin), at desktop or phone width.
import React, { useMemo } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { type EmailDesign, applyMergeFields, renderEmailHtml } from '@/communication/emailDesign';

export type Device = 'desktop' | 'mobile';

export function EmailPreview({ design, subject, preheader, dir, lang, device, onDevice, sampleName }: {
  design: EmailDesign;
  subject: string;
  preheader: string;
  dir: 'ltr' | 'rtl';
  lang: string;
  device: Device;
  onDevice: (d: Device) => void;
  /** A real recipient's name to show merge fields with, or null for the fallbacks. */
  sampleName: string | null;
}) {
  const { t } = useLanguage();
  const html = useMemo(
    () => applyMergeFields(renderEmailHtml(design, { subject, preheader, dir, lang }), sampleName, true),
    [design, subject, preheader, dir, lang, sampleName],
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" dir="auto">{applyMergeFields(subject, sampleName, false) || t('es_no_subject')}</p>
          {preheader ? <p className="truncate text-2xs text-muted-foreground" dir="auto">{preheader}</p> : null}
        </div>
        <div className="inline-flex rounded-lg p-0.5 ring-1 ring-inset ring-border" role="group" aria-label={t('es_device')}>
          {(['desktop', 'mobile'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => onDevice(d)}
              className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-2xs font-semibold', device === d ? 'bg-foreground text-background' : 'hover:bg-muted')}>
              {d === 'desktop' ? <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> : <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />}
              {t(d === 'desktop' ? 'es_desktop' : 'es_mobile')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center overflow-hidden rounded-xl bg-muted/50 p-2 sm:p-3">
        <iframe
          title={t('es_preview_frame')}
          sandbox=""
          srcDoc={html}
          className={cn('h-[70dvh] max-h-[760px] rounded-lg bg-white shadow-md transition-[width] duration-300', device === 'mobile' ? 'w-[375px] max-w-full' : 'w-full')}
        />
      </div>
    </div>
  );
}

export default EmailPreview;
