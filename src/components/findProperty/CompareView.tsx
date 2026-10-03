import { CircleDot } from 'lucide-react';
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ComparisonRow } from '@/research-core/marketplace/comparison';
import type { PropertyView } from '@/services/marketplaceSearch';
import { SELLER_KEY } from './PropertyCard';
import { type T, checkedAgo, num, usd } from './format';

function cell(row: ComparisonRow, side: 'a' | 'b', t: T): string {
  const v = row[side];
  if (v === null || v === undefined) return t('mps_not_stated');
  switch (row.field) {
    case 'price': case 'pricePerSqm': return usd(v as number);
    case 'area': return t('mps_value_area', { v: num(v as number) });
    case 'buildingStatus': return t(`mps_bs_${v}`);
    case 'renovation': return t(`mps_rn_${v}`);
    case 'parking': case 'furnished': return v ? t('mps_yes') : t('mps_no');
    case 'freshness': return checkedAgo(typeof v === 'string' && v.includes('T') ? v : null, t) ?? t(`mps_fresh_${v}`);
    case 'seller': return t(SELLER_KEY[v as string] ?? 'mps_seller_unknown');
    default: return String(v);
  }
}

/** Two properties, field by field. Per-field direction only where objective; never a winner. */
export function CompareView({ t, open, onOpenChange, a, b, rows }: {
  t: T; open: boolean; onOpenChange: (o: boolean) => void; a: PropertyView | null; b: PropertyView | null; rows: ComparisonRow[];
}) {
  if (!a || !b) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="hm-discovery max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto bg-background p-0">
        <DialogHeader className="p-5 pb-0 text-start">
          <DialogTitle className="font-display text-xl">{t('mps_compare_title')}</DialogTitle>
          <DialogDescription>{t('mps_compare_note')}</DialogDescription>
        </DialogHeader>
        <div className="p-5">
          <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-[34%] text-start font-medium text-muted-foreground"><span className="sr-only">{t('mps_compare_field')}</span></th>
                <th scope="col" className="text-start font-display text-base font-semibold">{usd(a.facts.priceUsd)}</th>
                <th scope="col" className="text-start font-display text-base font-semibold">{usd(b.facts.priceUsd)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field}>
                  <th scope="row" className="rounded-s-lg bg-card py-2.5 ps-3 text-start font-medium text-muted-foreground">{t(`mps_cmp_${r.field}`)}</th>
                  {(['a', 'b'] as const).map((side) => {
                    const ahead = r.ahead === side.toUpperCase();
                    return (
                      <td key={side} className={`bg-card py-2.5 pe-3 align-top break-words ${side === 'b' ? 'rounded-e-lg' : ''} ${ahead ? 'font-semibold text-foreground' : 'text-foreground/85'}`}>
                        <span className="inline-flex items-start gap-1.5">
                          {ahead ? <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
                          <span dir="auto">{cell(r, side, t)}</span>
                          {ahead ? <span className="sr-only">{t('mps_compare_ahead')}</span> : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
