import { Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { FOCUS, INK, INK_SOFT } from './styles';

export type PreviewMode = 'desktop' | 'mobile';

/**
 * The email as a mail client would show it. A sandboxed iframe with no
 * permissions: the HTML is our own render, but a preview never runs anything.
 */
export function EmailPreview({
  html, mode, onModeChange, loading,
}: {
  html: string | null;
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const toggle = (m: PreviewMode, label: string, Icon: typeof Monitor) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onModeChange(m)}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold',
        mode === m ? 'bg-[hsl(218_52%_14%)] text-[hsl(40_94%_70%)]' : cn('bg-transparent hover:bg-[hsl(42_100%_96%)]', INK),
        FOCUS,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-3 inline-flex flex-wrap gap-1 rounded-xl border border-[hsl(38_28%_86%)] bg-white p-1">
        {toggle('desktop', t('es_preview_desktop'), Monitor)}
        {toggle('mobile', t('es_preview_mobile'), Smartphone)}
      </div>
      <div className="flex justify-center overflow-hidden rounded-2xl bg-[hsl(40_20%_93%)] p-2 sm:p-4">
        <div className={cn('w-full motion-safe:transition-[max-width] motion-safe:duration-300', mode === 'mobile' ? 'max-w-[375px]' : 'max-w-[680px]')}>
          {html ? (
            <iframe
              title={t('es_preview_frame_title')}
              srcDoc={html}
              sandbox=""
              className={cn('block h-[640px] w-full rounded-xl border-0 bg-white sm:h-[720px]', mode === 'mobile' && 'rounded-[1.6rem] ring-8 ring-[hsl(218_30%_18%)]')}
            />
          ) : (
            <div className={cn('flex h-[320px] items-center justify-center rounded-xl bg-white text-sm', INK_SOFT)} role="status">
              {loading ? t('es_loading') : t('es_choose_property')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
