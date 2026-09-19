/*
 * „თქვენი შემოწმებები" — the few a customer actually comes back for.
 *
 * Six, because this sits under the search box on the Verification Center and
 * its job is recognition, not archival: a returning customer is nearly always
 * looking for something they ran recently, and a list long enough to scroll
 * pushes the thing they came to do off the screen. Everything older lives one
 * tap away on the history page, and "see all" only appears once there is
 * actually more to see.
 *
 * Opening one renders the stored report in the Center itself rather than
 * navigating to a second screen, so there is exactly one thing in Homatch
 * that draws a verification report.
 */
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifyCheckList } from '@/components/verify/VerifyCheckList';
import type { ResearchJobRecord } from '@/types/types';

/** How many a returning customer is shown before "see all". */
export const RECENT_CHECKS = 6;

export function VerifyRecentChecks({
  items,
  loading,
  onOpen,
}: {
  items: ResearchJobRecord[] | null;
  loading?: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const recent = items ? items.slice(0, RECENT_CHECKS) : null;
  const hasMore = (items?.length ?? 0) > RECENT_CHECKS;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="min-w-0 break-words text-base font-semibold tracking-tight">
          {t('vh_recent_title')}
        </h2>
        {hasMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => navigate('/verify/history')}
          >
            {t('vh_see_all')}
            <ArrowRight className="ms-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <VerifyCheckList
        items={recent}
        loading={loading}
        onOpen={onOpen}
        emptyTitle={t('vh_empty_title')}
        emptyHint={t('vh_empty_hint')}
      />
    </section>
  );
}
