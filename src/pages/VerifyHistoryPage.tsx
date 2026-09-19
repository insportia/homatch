/*
 * EVERY VERIFICATION, WITH A WAY TO FIND ONE.
 *
 * The Verification Center shows the recent few, which is what a returning
 * customer usually wants. This is the other case: somebody who checked a
 * property months ago and needs that report now. Opening one from here goes
 * to the Center with ?job=, so there is exactly ONE screen that renders a
 * verification report and this page never becomes a second, diverging copy
 * of it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { VerifyCheckList } from '@/components/verify/VerifyCheckList';
import { listVerifyHistory } from '@/services/researchJobs';
import type { ResearchJobRecord } from '@/types/types';

export default function VerifyHistoryPage() {
  const { t } = useLanguage();
  const { supaUser } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ResearchJobRecord[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const uid = supaUser?.id;
    if (!uid) { setItems([]); return; }
    let alive = true;
    listVerifyHistory(uid)
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [supaUser?.id]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((j) =>
      [j.title, j.query, j.address, j.project_name, j.entity_name, j.company_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [items, q]);

  return (
    <AppLayout noPadding>
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 pb-24 sm:px-6 lg:px-8">
          <Button variant="ghost" size="sm" className="-ms-2" onClick={() => navigate('/verify')}>
            <ChevronLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('vh_back')}
          </Button>

          <h1 className="min-w-0 break-words text-xl font-semibold sm:text-2xl">
            {t('vh_history_title')}
          </h1>

          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('vh_search_ph')}
              aria-label={t('vh_search_ph')}
              className="h-11 ps-9 text-base md:h-10 md:text-sm"
            />
          </div>

          <VerifyCheckList
            items={filtered}
            onOpen={(id) => navigate(`/verify?job=${encodeURIComponent(id)}`)}
            emptyTitle={q.trim() ? t('vh_no_match') : t('vh_empty_title')}
            emptyHint={q.trim() ? t('vh_no_match_hint') : t('vh_empty_hint')}
          />

          {/* Names the invariant the whole screen depends on. */}
          {filtered && filtered.length > 0 ? (
            <p className="min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
              {t('vh_free_note')}
            </p>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
