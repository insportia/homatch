// HOMATCH — the verifications a customer already has.
//
// This is the second half of the Verification Center: above it the customer
// starts a new verification, here they return to one. It is deliberately
// sparse — a case is identified by the thing a buyer actually remembers (the
// address or the cadastral code) plus its verdict, and nothing else. Counts,
// coverage percentages and internal state have no place on a list screen.
//
// It lives inside /verify rather than on a route of its own: there is one
// destination in this product, not a Verify page and a separate workspace
// app beside it.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { listDealRooms, type DealRoomRecord } from '@/services/dealRooms';
import type { Verdict } from '@/components/dealroom/VerdictBanner';

const VERDICT_KEY: Record<string, string> = {
  POSITIVE: 'dr_verdict_positive',
  MODERATELY_POSITIVE: 'dr_verdict_moderate',
  NEGATIVE: 'dr_verdict_negative',
};

const VERDICT_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  POSITIVE: 'default',
  MODERATELY_POSITIVE: 'secondary',
  NEGATIVE: 'destructive',
};

export const VerificationCaseList: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [cases, setCases] = useState<DealRoomRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    listDealRooms()
      .then((r) => alive && setCases(r))
      .catch(() => alive && setError(t('dr_error_generic')));
    return () => {
      alive = false;
    };
    // t is stable for a given language; re-running on language change is
    // harmless and keeps the error message localized. The list is unmounted
    // while a verification is running, so returning to the landing state
    // remounts it and it reloads on its own.
  }, [t]);

  if (error) return <p className="text-sm text-destructive break-words">{error}</p>;

  if (cases === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">{t('dr_list_title')}</h2>

      {cases.length === 0 ? (
        <Card>
          <CardContent className="pt-6 pb-6 text-center space-y-2">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t('dr_list_empty')}</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed break-words">
              {t('dr_list_empty_hint')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const snap = (c.verify_snapshot ?? {}) as { verdict?: string };
            const verdict = snap.verdict as Verdict | undefined;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/verify/${c.id}`)}
                className="w-full text-left rounded-xl border bg-card hover:bg-accent/40 transition-colors p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium break-words">
                      {c.title || c.address || c.cadastral_code || t('vc_untitled_case')}
                    </p>
                    {c.cadastral_code && c.title ? (
                      <p className="text-xs text-muted-foreground break-words">{c.cadastral_code}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {verdict && VERDICT_KEY[verdict] ? (
                        <Badge variant={VERDICT_VARIANT[verdict] ?? 'secondary'}>{t(VERDICT_KEY[verdict])}</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {t('dr_updated')} {new Date(c.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default VerificationCaseList;
