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
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Landmark } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifyActionButton } from './VerifyActionButton';

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
        {/* Stacked on a phone, side by side from sm. Each button sizes to its
            own translated label rather than to a width chosen for English. */}
        <div className="flex flex-wrap gap-2">
          <VerifyActionButton
            to={`/investment${suffix}`}
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('verify_next_investment')}
          />
          <VerifyActionButton
            to={`/mortgage${suffix}`}
            icon={<Landmark className="h-5 w-5" />}
            label={t('verify_next_mortgage')}
            variant="outline"
          />
        </div>
      </CardContent>
    </Card>
  );
}
