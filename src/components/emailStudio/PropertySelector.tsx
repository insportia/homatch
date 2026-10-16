import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import type { StudioProperty } from '@/services/emailStudio';
import { FOCUS, INK, INK_SOFT, QUIET_BUTTON } from './styles';

/** The caller's own listings — nothing else can be offered. */
export function PropertySelector({
  properties, value, onChange, loading,
}: {
  properties: StudioProperty[];
  value: string | null;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const { t, lang } = useLanguage();
  if (loading) return <p className={cn('text-sm', INK_SOFT)} role="status">{t('es_loading')}</p>;
  if (!properties.length) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[hsl(38_28%_80%)] p-4">
        <p className={cn('text-sm', INK_SOFT)}>{t('es_no_properties')}</p>
        <Link to="/property/add" className={QUIET_BUTTON}>{t('es_add_property')}</Link>
      </div>
    );
  }
  const price = (p: StudioProperty) => {
    if (!p.price) return null;
    try {
      return new Intl.NumberFormat(intlLocaleFor(lang), { style: 'currency', currency: (p.currency || 'USD').toUpperCase(), maximumFractionDigits: 0 }).format(p.price);
    } catch { return String(p.price); }
  };
  return (
    <div role="radiogroup" aria-label={t('es_choose_property')} className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
      {properties.map((p) => {
        const selected = p.propertyId === value;
        const place = [p.district, p.city].filter(Boolean).join(', ');
        return (
          <button
            key={p.propertyId}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(p.propertyId)}
            className={cn(
              'flex min-h-[64px] items-center gap-3 rounded-xl border bg-white p-3 text-start',
              selected ? 'border-[hsl(38_92%_50%)] ring-2 ring-[hsl(38_92%_54%)]' : 'border-[hsl(38_28%_86%)] hover:border-[hsl(38_70%_60%)]',
              FOCUS,
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(42_90%_95%)]">
              <Building2 className="h-5 w-5 text-[hsl(36_80%_40%)]" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[15px] font-semibold', INK)}>{p.title || t('es_untitled')}</span>
              <span className={cn('block truncate text-sm', INK_SOFT)}>
                {[p.homatchId ? t('es_property_id', { id: p.homatchId }) : null, place || null, price(p)].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
