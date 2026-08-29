// CanonicalGroupBanner — shown on PropertyDetailPage when group.source_count > 1
import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExternalLink, ChevronDown, TrendingDown, Star } from 'lucide-react';
import { getCanonicalGroup } from '@/services/api3';
import type { CanonicalPropertyGroup, CanonicalPropertySource } from '@/types/phase3';

interface Props { propertyId: string }

export function CanonicalGroupBanner({ propertyId }: Props) {
  const { t } = useLanguage();
  const [group, setGroup] = useState<CanonicalPropertyGroup | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getCanonicalGroup(propertyId).then(setGroup).catch(() => {});
  }, [propertyId]);

  if (!group || group.source_count <= 1) return null;

  const priceDiff = group.max_price && group.min_price ? group.max_price - group.min_price : 0;
  const currency = group.price_currency ?? 'USD';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between gap-3 p-3 bg-primary/8 border border-primary/20 rounded-xl text-left hover:bg-primary/12 transition-colors group">
          <div className="flex items-center gap-2 flex-wrap">
            <TrendingDown className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">
              {t('canon_found_on').replace('{count}', String(group.source_count))}
            </span>
            {group.min_price && (
              <Badge variant="outline" className="text-xs text-primary border-primary/30">
                {t('canon_lowest_price')}: {currency} {group.min_price.toLocaleString()}
              </Badge>
            )}
            {priceDiff > 0 && (
              <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
                {t('canon_price_diff')}: {currency} {priceDiff.toLocaleString()}
              </Badge>
            )}
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 p-3 bg-secondary rounded-xl border border-border space-y-2">
          {(group.sources ?? []).map((src: CanonicalPropertySource) => (
            <div key={src.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                {src.is_canonical && (
                  <Star className="h-3 w-3 text-primary shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{src.source_name ?? 'Unknown source'}</p>
                  {src.source_url && (
                    <a
                      href={src.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary flex items-center gap-0.5 hover:underline truncate"
                    >
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      {src.source_url.replace(/^https?:\/\//, '').slice(0, 40)}
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                {src.price && (
                  <p className={`text-sm font-semibold ${src.price === group.min_price ? 'text-primary' : 'text-foreground'}`}>
                    {src.price_currency ?? currency} {src.price.toLocaleString()}
                  </p>
                )}
                {src.is_canonical && (
                  <span className="text-[10px] text-primary">{t('canon_is_canonical')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
