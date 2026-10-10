import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bed, Building2, MapPin, Ruler } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { resolveImageSrc } from '@/services/storage/images';
import { cn } from '@/lib/utils';
import type { PropertyCardSnapshot } from '@/services/propertyChat';

/**
 * A listing shared in a conversation. Every figure is the server's snapshot of the
 * sender's own listing at send time; a field the listing did not hold is simply not shown.
 */
export function PropertyCardBubble({ card, mine, compact = false }: { card: PropertyCardSnapshot; mine: boolean; compact?: boolean }) {
  const { t, lang } = useLanguage();
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (card.cover) resolveImageSrc(card.cover).then((u) => { if (alive) setCover(u); }).catch(() => undefined);
    return () => { alive = false; };
  }, [card.cover]);

  const locale = intlLocaleFor(lang);
  const price = card.price != null && card.currency
    ? (() => {
        try { return new Intl.NumberFormat(locale, { style: 'currency', currency: card.currency, maximumFractionDigits: 0 }).format(card.price); }
        catch { return `${new Intl.NumberFormat(locale).format(card.price)} ${card.currency}`; }
      })()
    : null;
  const location = [card.district, card.city].filter(Boolean).join(', ');
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <div className={cn(
      'w-full max-w-[18rem] overflow-hidden rounded-xl border bg-white text-[hsl(218_45%_14%)]',
      mine ? 'border-[hsl(40_80%_60%/0.6)]' : 'border-[hsl(var(--gold-border))]',
    )}>
      {!compact && (
        <div className="relative aspect-[16/9] w-full bg-[hsl(42_60%_96%)]">
          {cover
            ? <img src={cover} alt={card.title ?? t('pc_property_card')} className="h-full w-full object-cover" loading="lazy" />
            : <div className="grid h-full w-full place-items-center text-gold-ink" aria-hidden="true"><Building2 className="h-7 w-7" /></div>}
          {card.homatch_id != null && (
            <span className="absolute start-2 top-2 rounded-md bg-[#0C1119]/85 px-2 py-0.5 text-2xs font-semibold tabular-nums text-[hsl(40_94%_64%)]" dir="ltr">
              {t('pc_property_ref', { id: card.homatch_id })}
            </span>
          )}
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-gold-ink">{t('pc_property_card')}</p>
        {card.title && <p className="line-clamp-2 text-sm font-semibold leading-snug">{card.title}</p>}
        {location && <p className="flex items-center gap-1.5 text-xs text-[hsl(218_28%_38%)]"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{location}</span></p>}
        {(card.bedrooms != null || card.area != null) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(218_28%_38%)]">
            {card.bedrooms != null && <span className="inline-flex items-center gap-1"><Bed className="h-3.5 w-3.5" aria-hidden="true" />{card.bedrooms === 1 ? t('pc_feat_bedrooms_one') : t('pc_feat_bedrooms', { n: num.format(card.bedrooms) })}</span>}
            {card.area != null && <span className="inline-flex items-center gap-1"><Ruler className="h-3.5 w-3.5" aria-hidden="true" />{t('pc_feat_area', { n: num.format(card.area) })}</span>}
          </p>
        )}
        {price && <p className="text-base font-bold tabular-nums">{price}</p>}
        {mine && (
          <Link to={`/property/${card.id}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-gold-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] rounded">
            {t('pc_card_open')}
          </Link>
        )}
      </div>
    </div>
  );
}
