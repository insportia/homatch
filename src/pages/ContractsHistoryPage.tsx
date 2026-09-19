/*
 * EVERY CONTRACT, WITH A WAY TO FIND ONE.
 *
 * The entry page shows the recent few because that is what a returning
 * customer usually wants. This is the other case: somebody who knows they had
 * a contract read months ago and needs it now. Search is over what a person
 * would actually remember — what the file was called, and which property it
 * was about — and it filters the list already loaded rather than asking the
 * server on every keystroke.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { ContractList } from '@/components/contracts/ContractList';
import { listContracts, type ContractSummary } from '@/services/contracts';

export default function ContractsHistoryPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ContractSummary[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    listContracts()
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((c) =>
      [c.label, c.originalFilename, c.address, c.cadastralCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [items, q]);

  return (
    <AppLayout noPadding>
      <div className="hm-invest hm-invest-canvas min-h-[calc(100vh-4rem)]">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 pb-24 sm:px-6 lg:px-8">
          <Button variant="ghost" size="sm" className="-ms-2" onClick={() => navigate('/contracts')}>
            <ChevronLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t('ct_back')}
          </Button>

          <h1 className="min-w-0 break-words text-xl font-semibold sm:text-2xl">
            {t('ct_history_title')}
          </h1>

          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('ct_history_search_ph')}
              aria-label={t('ct_history_search_ph')}
              className="h-11 ps-9 text-base md:h-10 md:text-sm"
            />
          </div>

          <ContractList
            items={filtered}
            emptyTitle={q.trim() ? t('ct_history_no_match') : t('ct_empty_title')}
            emptyHint={q.trim() ? t('ct_history_no_match_hint') : t('ct_empty_hint')}
          />
        </div>
      </div>
    </AppLayout>
  );
}
