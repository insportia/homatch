/*
 * WHAT TO DO WITH A VERIFICATION, ONCE YOU HAVE ONE.
 *
 * A finished report used to end. The two questions a buyer actually has next
 * — is this worth the money, and can I borrow against it — are already whole
 * products here, and the report knew about neither. So the customer either
 * remembered they existed and navigated by hand, or they did not.
 *
 * These are links into the EXISTING Investment and Mortgage tools. Nothing is
 * duplicated and nothing is precomputed: the verification's subject is handed
 * across as a query parameter where the destination accepts one, and the
 * destination does its own work exactly as it does from anywhere else.
 *
 * They are buttons, not text links, because a next step the eye skips is a
 * next step nobody takes.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, Landmark, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export function NextStepsCard({ cadastralCode }: { cadastralCode?: string | null }) {
  const { t } = useLanguage();
  // Handed across only when it exists. A `?code=` with nothing after it is
  // worse than no parameter: the destination would start by clearing it.
  const code = (cadastralCode ?? '').trim();
  const suffix = code ? `?code=${encodeURIComponent(code)}` : '';

  return (
    <Card className="border-[hsl(var(--primary))]/35">
      <CardContent className="space-y-3 pt-5">
        <div className="min-w-0">
          <h3 className="fact text-base">{t('verify_next_title')}</h3>
          <p className="caveat mt-1">{t('verify_next_subtitle')}</p>
        </div>

        {/* basis-full on the narrow end: two full-width buttons stacked beats
            two half-width buttons with their labels broken across lines. */}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-11 min-w-0 basis-full sm:basis-auto sm:flex-1">
            <Link to={`/investment${suffix}`} className="min-w-0">
              <TrendingUp className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="mx-2 min-w-0 break-words">{t('verify_next_investment')}</span>
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11 min-w-0 basis-full border-2 sm:basis-auto sm:flex-1">
            <Link to={`/mortgage${suffix}`} className="min-w-0">
              <Landmark className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="mx-2 min-w-0 break-words">{t('verify_next_mortgage')}</span>
              <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
