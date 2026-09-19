/*
 * WHAT REMAINS UNCONFIRMED — WHERE A GAP BELONGS.
 *
 * The stored Villion report opened with „ფასის შეფასება ჯერ ვერ კეთდება..."
 * because Verify runs from a cadastral code and nobody supplied an asking
 * price. That is true, and it is not a headline: it describes the input, not
 * the property, and leading with it makes every verification of an unlisted
 * flat begin by apologising.
 *
 * So it comes here, near the end, with the other open questions — which is
 * where a reader who has just formed an opinion goes looking for what might
 * change it.
 *
 * MATERIAL AND ROUTINE ARE NOT THE SAME THING, AND THE READER MUST BE ABLE TO
 * TELL. "We were not given an asking price" is ordinary. "The registry could
 * not confirm the current encumbrance status" could change a decision. A flat
 * list makes those look equally worrying; ranking them says which ones to
 * actually go and ask about.
 */
import { HelpCircle, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';
import type { UnconfirmedItem } from '@/verify/intelligence/buyerSummary';

export function UnconfirmedCard({ items }: { items: UnconfirmedItem[] }) {
  const { t } = useLanguage();
  if (!items.length) return null;

  // Material first: the ones worth a phone call before the ones worth a shrug.
  const ordered = [...items].sort((a, b) =>
    a.weight === b.weight ? 0 : a.weight === 'MATERIAL' ? -1 : 1
  );
  const material = ordered.filter((i) => i.weight === 'MATERIAL').length;

  return (
    <VerifySection
      eyebrow={t('verify_unconf_eyebrow')}
      title={t('verify_unconf_title')}
      subtitle={material ? t('verify_unconf_subtitle_material') : t('verify_unconf_subtitle_routine')}
      /* The gold hairline only when something here could change a decision. */
      accent={material > 0}
    >
      <ul className="space-y-2">
        {ordered.map((item) => {
          const isMaterial = item.weight === 'MATERIAL';
          const Icon = isMaterial ? AlertTriangle : HelpCircle;
          return (
            <li
              key={item.key}
              className="flex min-w-0 gap-2.5 rounded-xl border border-border bg-background/40 p-3"
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  isMaterial ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block min-w-0 break-words text-sm leading-relaxed text-foreground">
                  {t(item.key)}
                </span>
                {item.detail ? (
                  <span className="mt-0.5 block min-w-0 break-words text-2xs text-muted-foreground">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Says how much weight the list as a whole deserves — the question
          section 2 asks the report to answer for the reader. */}
      <p className="mt-3 min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
        {material ? t('verify_unconf_weight_material') : t('verify_unconf_weight_limited')}
      </p>
    </VerifySection>
  );
}
