// HOMATCH INVESTMENT INTELLIGENCE — the surface, and the one piece of it
// that is Investment's alone.
//
// Everything generic moved to src/components/workspace/primitives.tsx when
// Mortgage needed the same cards, the same figures and the same gaps. This
// file re-exports it unchanged so no Investment call site had to move, and
// keeps OriginChip, which renders Investment's OWN provenance vocabulary
// (USER / PROPERTY / RESEARCH / DERIVED) and means nothing to any other
// product.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { InvestmentValueOrigin } from '@/investment/types';

export * from '@/components/workspace/primitives';

export function OriginChip({ origin, className }: { origin: InvestmentValueOrigin; className?: string }) {
  const { t } = useLanguage();
  const key = {
    USER: 'inv_origin_user',
    PROPERTY: 'inv_origin_property',
    RESEARCH: 'inv_origin_research',
    DERIVED: 'inv_origin_derived',
  }[origin];
  const tone = {
    USER: 'border-border text-muted-foreground',
    PROPERTY: 'border-[hsl(var(--info)/0.45)] text-[hsl(var(--info))]',
    RESEARCH: 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]',
    DERIVED: 'border-border text-muted-foreground',
  }[origin];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-[1px] text-2xs font-medium leading-none',
        tone,
        className,
      )}
    >
      {t(key)}
    </span>
  );
}
