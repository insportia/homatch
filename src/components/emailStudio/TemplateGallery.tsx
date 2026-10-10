import { Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  TEMPLATE_COPY, TEMPLATE_IDS, TEMPLATE_NAME_KEY, TEMPLATE_THEME, asEmailLang, type TemplateId,
} from '@/emailStudio/templates';
import { FOCUS, INK, INK_SOFT } from './styles';

/** The four approved templates as selectable cards (a radio group). */
export function TemplateGallery({
  value, onChange, availability,
}: {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
  availability: Partial<Record<TemplateId, { available: boolean }>>;
}) {
  const { t, lang } = useLanguage();
  const copyLang = asEmailLang(lang);
  return (
    <div role="radiogroup" aria-label={t('es_section_template')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {TEMPLATE_IDS.map((id) => {
        const theme = TEMPLATE_THEME[id];
        const selected = value === id;
        const available = availability[id]?.available !== false;
        const copy = TEMPLATE_COPY[id][copyLang];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={!available}
            disabled={!available}
            onClick={() => available && onChange(id)}
            className={cn(
              'group relative flex min-h-[188px] flex-col overflow-hidden rounded-2xl border bg-white text-start',
              selected ? 'border-[hsl(38_92%_50%)] ring-2 ring-[hsl(38_92%_54%)]' : 'border-[hsl(38_28%_86%)] hover:border-[hsl(38_70%_60%)]',
              !available && 'cursor-not-allowed opacity-70',
              'motion-safe:transition-shadow', FOCUS,
            )}
          >
            {/* A miniature of the template's look — colours only, no stock imagery. */}
            <span aria-hidden="true" className="block h-[84px] w-full p-2.5" style={{ background: theme.canvas }}>
              <span className="flex h-full flex-col overflow-hidden rounded-lg" style={{ background: theme.surface }}>
                <span className="h-3 w-full" style={{ background: theme.headerBg, borderBottom: `1px solid ${theme.hairline}` }} />
                <span className="mx-2 mt-2 h-2 w-3/5 rounded-full" style={{ background: theme.ink, opacity: 0.85 }} />
                <span className="mx-2 mt-1.5 h-1.5 w-4/5 rounded-full" style={{ background: theme.muted, opacity: 0.45 }} />
                <span className="mx-2 mt-auto mb-2 h-3 w-1/3 rounded" style={{ background: theme.ctaBg }} />
              </span>
            </span>
            <span className="flex flex-1 flex-col gap-1 p-3.5">
              <span className={cn('flex items-center gap-2 text-[15px] font-bold', INK)}>
                {t(TEMPLATE_NAME_KEY[id])}
                {selected ? <Check className="h-4 w-4 text-[hsl(36_85%_42%)]" aria-hidden="true" /> : null}
                {!available ? <Lock className="h-4 w-4 text-[hsl(218_15%_50%)]" aria-hidden="true" /> : null}
              </span>
              <span className={cn('text-sm leading-snug break-words', INK_SOFT)}>
                {available ? copy.headline : t('es_tpl_premium_unavailable')}
              </span>
              {selected ? <span className="sr-only">{t('es_tpl_selected')}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
