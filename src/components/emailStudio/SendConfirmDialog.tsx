import { useEffect, useId, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_BUTTON, INK, QUIET_BUTTON } from './styles';

/** The last step: an explicit approval checkbox, then one button. */
export function SendConfirmDialog({
  open, onOpenChange, count, sender, sending, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  sender: string;
  sending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const [approved, setApproved] = useState(false);
  const checkId = useId();
  useEffect(() => { if (!open) setApproved(false); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className={cn('font-display text-xl', INK)}>{t('es_confirm_title')}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed">
            {t('es_confirm_body', { count, sender })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border border-[hsl(38_60%_75%)] bg-[hsl(42_100%_97%)] p-3.5">
          <Checkbox id={checkId} className="mt-0.5 h-5 w-5" checked={approved} disabled={sending}
            onCheckedChange={(v) => setApproved(v === true)} />
          <label htmlFor={checkId} className={cn('text-sm leading-relaxed', INK)}>{t('es_confirm_check')}</label>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" className={QUIET_BUTTON} disabled={sending} onClick={() => onOpenChange(false)}>{t('es_cancel')}</button>
          <button type="button" className={GOLD_BUTTON} disabled={!approved || sending || count === 0} onClick={onConfirm} aria-busy={sending}>
            {sending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {sending ? t('es_sending') : t('es_send_campaign')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
