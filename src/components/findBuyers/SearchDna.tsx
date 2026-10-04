// What HOMATCH is looking for, from the property's own facts through the
// same Property DNA the search uses (research-core/findBuyers/propertyDna):
// the deal, the place, the real bedroom count, the area, and the budget band
// a fitting buyer/tenant would state. Nothing here is a stored guess.
import React from 'react';
import { BedDouble, MapPin, Ruler, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildPropertyDna } from '@/findBuyers/searchDna';
import { formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import { placeName } from '@/lib/placeNames';

export interface DnaFacts {
  transaction_type?: string | null;
  property_type?: string | null;
  city?: string | null;
  district?: string | null;
  bedrooms?: number | null;
  rooms?: number | null;
  area?: number | null;
  total_price?: number | null;
  currency?: string | null;
}

export function useSearchDna(f: DnaFacts | null) {
  if (!f) return null;
  return buildPropertyDna({
    transactionType: f.transaction_type, propertyType: f.property_type, city: f.city, district: f.district,
    bedrooms: f.bedrooms, rooms: f.rooms, area: f.area, totalPrice: f.total_price, currency: f.currency,
  });
}

export function SearchDna({ facts, onDark = false, className }: { facts: DnaFacts | null; onDark?: boolean; className?: string }) {
  const { t, lang } = useLanguage();
  const dna = useSearchDna(facts);
  if (!dna) return null;
  const locale = intlLocaleFor(lang);
  const cur = dna.currency ?? 'USD';
  const band = dna.tolerances.price;
  const place = [placeName(dna.city, lang), placeName(dna.district, lang)].filter(Boolean).join(' · ');
  const chips = [
    place ? { icon: MapPin, text: place } : null,
    dna.bedrooms != null ? { icon: BedDouble, text: t('fbl_dna_bedrooms', { n: String(dna.bedrooms) }) } : null,
    dna.areaSqm ? { icon: Ruler, text: `${dna.areaSqm} m²` } : null,
    band ? {
      icon: Wallet,
      text: t(dna.transaction === 'RENT' ? 'fbl_dna_budget_rent' : 'fbl_dna_budget_sale', {
        range: `${formatMoney(band.min, cur, locale, { decimals: 0, narrowSymbol: true })} – ${formatMoney(band.max, cur, locale, { decimals: 0, narrowSymbol: true })}`,
      }),
    } : null,
  ].filter(Boolean) as Array<{ icon: React.ComponentType<{ className?: string }>; text: string }>;

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2.5 py-0.5 text-2xs font-bold uppercase tracking-[0.12em]',
          onDark ? 'bg-[hsl(40_94%_64%/0.14)] text-[hsl(40_94%_70%)] ring-1 ring-inset ring-[hsl(40_80%_60%/0.4)]'
            : 'bg-[hsl(42_100%_94%)] text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]')}>
          {t(dna.transaction === 'RENT' ? 'fbl_dna_for_rent' : 'fbl_dna_for_sale')}
        </span>
        {chips.map(({ icon: Icon, text }) => (
          <span key={text} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-semibold',
            onDark ? 'bg-white/5 text-white ring-1 ring-inset ring-white/10' : 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(218_40%_88%)]')}>
            <Icon className={cn('h-3.5 w-3.5 shrink-0', onDark ? 'text-[hsl(40_94%_64%)]' : 'text-[hsl(34_90%_40%)]')} aria-hidden="true" />
            <span dir="auto">{text}</span>
          </span>
        ))}
      </div>
      <p className={cn('text-2xs leading-relaxed', onDark ? 'text-[hsl(218_40%_85%)]' : 'text-[hsl(218_28%_38%)]')}>
        {t(dna.transaction === 'RENT' ? 'fbl_dna_sentence_rent' : 'fbl_dna_sentence_sale')}
      </p>
    </div>
  );
}

export default SearchDna;
