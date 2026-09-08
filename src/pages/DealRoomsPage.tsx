// HOMATCH — Deal Rooms list.
//
// The entry point to everything a buyer has checked. Deliberately sparse: a
// room is identified by the thing a buyer actually remembers (the address or
// cadastral code), with its verdict, and nothing else. Counts, coverage
// percentages and internal state have no place on a list screen.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Briefcase, ChevronRight, ShieldCheck } from 'lucide-react';
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

const DealRoomsPage: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<DealRoomRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDealRooms()
      .then((r) => alive && setRooms(r))
      .catch(() => alive && setError(t('dr_error_generic')));
    return () => {
      alive = false;
    };
    // t is stable for a given language; re-running on language change is
    // harmless and keeps the error message localized.
  }, [t]);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{t('dr_list_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('dr_list_subtitle')}</p>
        </header>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {rooms === null && !error ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {rooms && rooms.length === 0 ? (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <Briefcase className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">{t('dr_list_empty')}</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {t('dr_list_empty_hint')}
                </p>
              </div>
              <Button onClick={() => navigate('/verify')} className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                {t('dr_start_verify')}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {rooms && rooms.length > 0 ? (
          <div className="space-y-3">
            {rooms.map((room) => {
              const snap = (room.verify_snapshot ?? {}) as { verdict?: string };
              const verdict = snap.verdict as Verdict | undefined;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => navigate(`/deal-rooms/${room.id}`)}
                  className="w-full text-left rounded-xl border bg-card hover:bg-accent/40 transition-colors p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium break-words">
                        {room.title || room.address || room.cadastral_code}
                      </p>
                      {room.cadastral_code && room.title ? (
                        <p className="text-xs text-muted-foreground break-words">{room.cadastral_code}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {verdict && VERDICT_KEY[verdict] ? (
                          <Badge variant={VERDICT_VARIANT[verdict] ?? 'secondary'}>{t(VERDICT_KEY[verdict])}</Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {t('dr_updated')} {new Date(room.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
};

export default DealRoomsPage;
