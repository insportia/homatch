// HOMATCH AI, inline. The campaign draft never leaves the page: this is a
// side sheet over the builder, it knows the campaign (the server reads the
// offer, goal and destination itself), and it only ever SUGGESTS. Nothing is
// written into the ad until the customer accepts a suggestion — and even then
// it lands in the editable fields, where they can keep changing it.
import React, { useState } from 'react';
import { Sparkles, Loader2, Check, X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { aiCopy, type AiCopyOp, type AiCopyVariant } from '@/services/metaAds';

const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
const OPS: AiCopyOp[] = ['GENERATE', 'IMPROVE', 'SHORTEN', 'PROFESSIONAL', 'ALTERNATIVES', 'TRANSLATE'];

export function AiCopyPanel({ open, onOpenChange, campaignId, current, onAccept }: {
  open: boolean; onOpenChange: (v: boolean) => void; campaignId: string;
  current: AiCopyVariant; onAccept: (v: AiCopyVariant) => void;
}) {
  const { t, lang } = useLanguage();
  const [target, setTarget] = useState<string>(LANGS.includes(lang as never) ? lang : 'ka');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<AiCopyOp | null>(null);
  const [lastOp, setLastOp] = useState<AiCopyOp | null>(null);
  const [variants, setVariants] = useState<AiCopyVariant[]>([]);
  const hasCurrent = !!(current.primaryText.trim() || current.headline.trim());
  const rtl = target === 'ar' || target === 'he';

  const run = async (op: AiCopyOp) => {
    setBusy(op);
    setLastOp(op);
    try {
      const r = await aiCopy(campaignId, op, target, current, notes);
      setVariants(r.variants);
    } catch (e: any) {
      toast.error(t(e?.code === 'AI_UNAVAILABLE' ? 'madsb_ai_unavailable' : e?.code === 'AI_RATE_LIMITED' ? 'madsb_ai_rate_limited' : 'madsb_ai_failed'));
    } finally { setBusy(null); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_ai_title')}</SheetTitle>
          <SheetDescription>{t('madsb_ai_lead')}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-foreground">{t('madsb_ai_language')}</p>
            <div className="flex flex-wrap gap-1.5">
              {LANGS.map((l) => (
                <button key={l} type="button" aria-pressed={target === l} onClick={() => setTarget(l)}
                  className={cn('rounded-full border px-2.5 py-1 text-2xs font-semibold uppercase',
                    target === l ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-foreground' : 'border-border text-muted-foreground')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">{t('madsb_ai_notes')}</span>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('madsb_ai_notes_ph')} maxLength={600} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {OPS.map((op) => {
              const needsText = op !== 'GENERATE' && op !== 'ALTERNATIVES';
              return (
                <Button key={op} type="button" variant={op === 'GENERATE' ? 'default' : 'outline'} size="sm"
                  disabled={busy !== null || (needsText && !hasCurrent)} onClick={() => run(op)} className="justify-start gap-1.5">
                  {busy === op ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {t(`madsb_ai_op_${op.toLowerCase()}` as never)}
                </Button>
              );
            })}
          </div>

          {variants.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-foreground">{t('madsb_ai_suggestions')}</p>
                {lastOp && (
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => run(lastOp)}>
                    <RotateCcw className="h-3.5 w-3.5" />{t('madsb_ai_regenerate')}
                  </Button>
                )}
              </div>
              {variants.map((v, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3" dir={rtl ? 'rtl' : undefined}>
                  {v.headline && <p className="text-sm font-semibold text-foreground">{v.headline}</p>}
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground/90">{v.primaryText}</p>
                  {v.description && <p className="mt-1 text-2xs text-muted-foreground">{v.description}</p>}
                  <div className="mt-2.5 flex gap-2" dir="ltr">
                    <Button type="button" size="sm" className="gap-1.5" onClick={() => { onAccept(v); toast.success(t('madsb_ai_applied')); }}>
                      <Check className="h-3.5 w-3.5" />{t('madsb_ai_accept')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="gap-1.5"
                      onClick={() => setVariants((cur) => cur.filter((_, j) => j !== i))}>
                      <X className="h-3.5 w-3.5" />{t('madsb_ai_reject')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-2xs leading-relaxed text-muted-foreground">{t('madsb_ai_disclaimer')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
