import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PlanCode } from '@/types/billing';

/**
 * THE PLAN BADGE.
 *
 * Status, not volume. A paid member's presence in Live Chat is marked, and
 * their message is not made louder, larger or harder to scroll past than a
 * Free member's. Identity is the thing being sold here; attention is not.
 *
 * PREMIUM RANKS ABOVE VIP VISUALLY
 *
 * Premium is solid gold on the brand's own dark ink; VIP is a gold hairline on
 * a quiet ground. That reads as a clear hierarchy at a glance without either
 * one becoming a sticker. No crowns, no gradients, no glow: the brand is
 * black, white and gold, and a casino badge would cheapen every surface it
 * appears on.
 *
 * FREE HAS NO BADGE
 *
 * Deliberately. Marking the absence of a subscription is a way of making Free
 * feel like a lesser class of person rather than a full customer, and Free
 * users are customers who have simply not bought anything yet.
 */
export function PlanBadge({
  planCode,
  size = 'md',
  className = '',
}: {
  planCode: PlanCode | string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useLanguage();
  if (planCode !== 'VIP' && planCode !== 'PREMIUM') return null;

  const isPremium = planCode === 'PREMIUM';
  const dims = size === 'sm'
    ? 'px-1.5 py-[1px] text-[12px] tracking-[0.1em]'
    : 'px-2 py-0.5 text-[13px] tracking-[0.12em]';

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-[3px] font-semibold uppercase leading-none',
        dims,
        isPremium
          ? 'bg-gold text-background'
          : 'border border-gold/60 text-gold-ink bg-transparent',
        className,
      ].join(' ')}
      // The badge is decorative repetition of a status the surrounding UI
      // already states, so it is labelled rather than read as body text.
      aria-label={t(isPremium ? 'badge_premium' : 'badge_vip')}
      dir="ltr"
    >
      {t(isPremium ? 'badge_premium' : 'badge_vip')}
    </span>
  );
}
