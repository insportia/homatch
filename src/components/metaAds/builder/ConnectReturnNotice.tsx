// What happened at Meta, in one calm line — never a raw OAuth error.
import React from 'react';
import { CheckCircle2, Info, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { connectResultOf } from '@/lib/metaAds/connectFlow';

type Result = NonNullable<ReturnType<typeof connectResultOf>>;
const COPY: Record<Result, string> = {
  ok: 'mm_x_connected',
  denied: 'mm_x_connect_cancelled',
  bad_state: 'madsb_connect_bad_state',
  error: 'mm_x_connect_failed',
  encryption_missing: 'madsb_connect_encryption_missing',
  mock_mode: 'madsb_connect_mock_mode',
};

export function ConnectReturnNotice({ result, refreshing }: { result: Result; refreshing: boolean }) {
  const { t } = useLanguage();
  const ok = result === 'ok';
  return (
    <div role="status" aria-live="polite" data-mm-connect-return={result}
      className={cn('flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[13px] leading-relaxed',
        ok ? 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/[0.07] text-foreground' : 'border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] text-foreground')}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_54%_30%)]" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden />}
      <span className="min-w-0">
        <span className="font-semibold">{t(COPY[result] as never)}</span>
        {ok && refreshing && <span className="ms-1.5 inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t('mm_x_connect_refreshing')}</span>}
        {!ok && <span className="block text-muted-foreground">{t('mm_x_connect_kept')}</span>}
      </span>
    </div>
  );
}
