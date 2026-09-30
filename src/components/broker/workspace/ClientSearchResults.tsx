// One client search's current matches — the canonical find-property read,
// narrowed to this search (the function ANDs the id with the caller's own
// user id, so another account's search returns nothing). These are listings
// already paid for by the sweep: nothing here charges.
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { readResults, type FindPropertyResult } from '@/services/findProperty';

export function ClientSearchResults({ subscriptionId }: { subscriptionId: string }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<FindPropertyResult[] | null>(null);
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readResults(10, subscriptionId).then((r) => {
      if (!live) return;
      setRows(r.success ? r.results : []);
      setState(r.success ? r.state : 'ERROR');
    });
    return () => { live = false; };
  }, [subscriptionId]);
  if (rows === null) return <Skeleton className="h-20 rounded-lg" />;
  if (state === 'ERROR') return <p role="alert" className="text-2xs text-destructive">{t('broker_desk_load_error')}</p>;
  if (rows.length === 0) {
    return <p className="text-2xs text-muted-foreground">{state === 'NO_ACTIVE_SEARCH' ? t('broker_ws_search_paused_no_results') : t('broker_ws_search_no_results')}</p>;
  }
  return (
    <ul className="space-y-1.5" data-client-search-results>
      {rows.map((r) => {
        const l = r.listing;
        const price = l?.price?.amount != null ? `${l.price.amount.toLocaleString()} ${l.price.currency ?? ''}` : null;
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <div className="min-w-0">
              <p className="break-words text-2xs font-semibold text-foreground">{l?.title || t('broker_desk_untitled_property')}</p>
              <p className="text-2xs text-muted-foreground">
                {[l?.district, l?.city, price, l?.bedrooms != null ? t('broker_ws_bedrooms', { n: String(l.bedrooms) }) : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            {l?.url && (
              <a href={l.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline">
                {t('broker_ws_view_listing')}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
