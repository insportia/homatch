/*
 * A BUTTON THAT FITS THE LANGUAGE IT IS RENDERED IN.
 *
 * "Investment Consultant" is 23 characters. "საინვესტიციო კონსულტანტი" is 24,
 * and Georgian sets considerably wider; "مستشار الاستثمار" reads right to
 * left; "Konut Kredisi Danışmanı" is three words where English has two. The
 * previous CTAs were `<Button size="lg">`, and that variant is `h-11` — a
 * fixed 44px box — while the Button base carries `whitespace-nowrap`. Neither
 * is reset for the <a> that `asChild` renders, so the label could not wrap
 * AND the box could not grow: on a 320px phone the icon, the label and the
 * arrow were squeezed into a row that could not hold them.
 *
 * THE RULES, AND WHY EACH ONE IS HERE
 *
 *   h-auto + min-h-12      a comfortable 48px target, and a box that GROWS
 *                          when a translated label needs two lines. A fixed
 *                          height is the bug; a minimum is the requirement.
 *   whitespace-normal      the label is allowed to wrap. Without this the
 *                          other rules cannot help it.
 *   px-4 py-3              real padding, so a two-line label is not pressed
 *                          against the edges.
 *   gap-3                  the icon, the text and the arrow cannot collide.
 *   shrink-0 on both icons an icon that shrinks turns into a smudge; the
 *                          text is what should give way, and it does.
 *   min-w-0 on the text    the only child allowed to become narrower than
 *                          its content — which is what stops a long word
 *                          pushing the arrow off the end.
 *   leading-snug           wrapped lines stay readable rather than tight.
 *   text-start             a wrapped label reads from its own start edge in
 *                          both directions, rather than centring into a
 *                          ragged block.
 *
 * Nothing here is sized for English, and nothing is special-cased per
 * language: the same rules produce a one-line button where the label is short
 * and a two-line one where it is not.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface VerifyActionButtonProps {
  to: string;
  icon: ReactNode;
  label: string;
}

/*
 * SIBLINGS, NOT A PRIMARY AND A SECONDARY.
 *
 * These were a filled button and an outline one, which said the Investment
 * consultation was the thing to do and the Mortgage one was the alternative.
 * Neither is true: they answer two different questions a buyer has at the
 * same moment, and whichever they need is the primary one. Identical
 * treatment, identical size, identical weight.
 *
 * The treatment is Investment's own — a rounded-full hairline control that
 * warms to gold on hover — so the end of a verification looks like the rest
 * of the product rather than like a landing page.
 */
export function VerifyActionButton({ to, icon, label }: VerifyActionButtonProps) {
  return (
    <Button
      asChild
      variant="outline"
      className={[
        // Grows with the label; never shorter than a comfortable target.
        'h-auto min-h-12 w-full min-w-0 whitespace-normal px-5 py-3',
        // Full width on a phone: two half-width buttons with two-line labels
        // read worse than two full-width ones. Side by side from sm upward.
        'sm:w-auto sm:flex-1',
        // Investment's control language, and the gold is a hover edge rather
        // than a fill — on this ground a gold fill has nowhere near the
        // contrast to carry text.
        'rounded-full border-border bg-transparent',
        'transition-colors hover:border-[hsl(var(--gold-border))] hover:bg-transparent hover:text-foreground',
      ].join(' ')}
    >
      <Link to={to} className="flex min-w-0 items-center gap-3 text-start">
        <span className="shrink-0" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug">
          {label}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
      </Link>
    </Button>
  );
}
