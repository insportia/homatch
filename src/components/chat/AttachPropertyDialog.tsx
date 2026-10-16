import { useEffect, useState } from 'react';
import { Building2, Loader2, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { cn } from '@/lib/utils';
import { listAttachableProperties, type AttachableProperty } from '@/services/propertyChat';

/**
 * Pick one of YOUR OWN live listings. Only its id leaves the browser: send-message builds
 * the card from the listing's own rows, so nothing typed or edited here can reach it.
 */
export function AttachPropertyDialog({ open, onOpenChange, myId, onPick, sending }: {
  open: boolean; onOpenChange: (v: boolean) => void; myId: string; onPick: (p: AttachableProperty) => void; sending: boolean;
}) {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<AttachableProperty[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFailed(false);
    listAttachableProperties(myId).then((r) => { if (alive) setItems(r); }).catch(() => { if (alive) { setItems([]); setFailed(true); } });
    return () => { alive = false; };
  }, [open, myId]);
  const locale = intlLocaleFor(lang);
  const fmtPrice = (p: AttachableProperty) => {
    if (p.price == null || !p.currency) return null;
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.price); }
    catch { return `${new Intl.NumberFormat(locale).format(p.price)} ${p.currency}`; }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] bg-white md:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle className="text-[hsl(218_45%_14%)]">{t('pc_attach_title')}</DialogTitle>
          <DialogDescription>{t('pc_attach_desc')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {items === null
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
            : items.length === 0
              ? <p className="py-6 text-center text-sm text-muted-foreground">{failed ? t('pc_err_generic') : t('pc_attach_none')}</p>
              : items.map((p) => (
                <button key={p.id} type="button" disabled={sending} onClick={() => onPick(p)}
                  className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white p-3 text-start transition-colors hover:border-[hsl(40_80%_60%)] hover:bg-[hsl(42_100%_98%)] disabled:opacity-60',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]')}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[hsl(42_60%_95%)] text-gold-ink" aria-hidden="true">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Building2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[hsl(218_45%_14%)]">{p.title ?? t('pc_property_card')}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[hsl(218_28%_38%)]">
                      {p.homatch_id != null && <span className="tabular-nums" dir="ltr">{t('pc_property_ref', { id: p.homatch_id })}</span>}
                      {(p.district || p.city) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{[p.district, p.city].filter(Boolean).join(', ')}</span>}
                    </span>
                  </span>
                  {fmtPrice(p) && <span className="shrink-0 text-sm font-bold tabular-nums text-[hsl(218_45%_14%)]">{fmtPrice(p)}</span>}
                </button>
              ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
