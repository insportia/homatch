import React from 'react';
import { useSectionField, useFieldProps } from '@/site/content';

/**
 * THE PRICING PAGE'S HEADING, AS CONTENT.
 *
 * WHY IT MOVED OUT OF THE PAGE
 *
 * Everything else on /pricing is DATA: the plan cards, the Credit grants, the
 * comparison matrix and the badges are rows in billing_plans and
 * product_plan_entitlements, and an admin changes them in Admin > Pricing.
 * The three lines at the top were the exception — the only words on a
 * commercial page that could be changed only by shipping, in the one place
 * where the wording is argued over most.
 *
 * WHY IT IS NOT THE WHOLE PAGE
 *
 * Rewriting the plan grid as stored content would mean a bad save could
 * misstate what a customer is charged. The prices stay server-side, and the
 * sentence introducing them becomes editable. The two halves cannot
 * contradict each other because only one of them is ever the source of a
 * number.
 *
 * The page's own margins stay in the page: this renders the words, not the
 * band around them, so it sits inside the existing header block rather than
 * bringing a second one.
 */
export function PricingIntroSection() {
  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <header className="max-w-3xl">
      <p className="text-[14px] font-medium uppercase tracking-[0.18em] text-gold-ink" {...fp('eyebrow')}>
        {sf('eyebrow', 'nav_pricing')}
      </p>
      <h1
        className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl"
        {...fp('title')}
      >
        {sf('title', 'payg_headline')}
      </h1>
      <p className="mt-4 text-pretty text-base text-muted-foreground sm:text-lg" {...fp('body')}>
        {sf('body', 'payg_no_subscription')}
      </p>
    </header>
  );
}
