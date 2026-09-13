// HOMATCH Admin — what is actually stopping each Communications channel.
//
// The routing panel beside this one shows credentials and switches. A channel
// can have every credential set and no switch thrown and still be unable to
// place a call, because nobody has priced the product or registered a caller
// number. This is the screen that says so.
//
// WHY THE CHECK NAMES ARE NOT TRANSLATED
//
// They are identifiers — WEBHOOK_SECRET, AI_CALL_RETAIL_SET — and the detail
// beside them names the exact environment variable or column to change. That
// is the whole value of an admin screen, and translating an identifier makes
// it harder to act on, not easier. The channel headings and verdicts ARE
// translated, because those are read rather than typed.
//
// None of this reaches a customer. The customer-facing surfaces say
// "Setup required" and nothing more.

import React from 'react';
import { CheckCircle2, XCircle, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { ChannelReadinessRow } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const CHANNEL_LABEL: Record<ChannelReadinessRow['channel'], TKey> = {
  TELEPHONY: 'golive_ch_telephony',
  AI_TALK: 'golive_ch_ai_talk',
  WHATSAPP: 'golive_ch_whatsapp',
  NUMBERS: 'golive_ch_numbers',
};

export function CommunicationsGoLivePanel({
  readiness, probing, onRecheck,
}: {
  readiness: ChannelReadinessRow[];
  probing: boolean;
  onRecheck: () => void;
}) {
  const { t } = useLanguage();
  if (!readiness.length) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('golive_title')}</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('golive_sub')}
            </p>
          </div>
          {/*
            * "Recheck connection" is the button an owner presses right after
            * replacing a credential. A GET reads what was last stored; this
            * POSTs, which is what actually contacts the providers again.
            */}
          <Button
            variant="outline" size="sm" className="h-8 shrink-0 gap-1.5"
            onClick={onRecheck} disabled={probing}
          >
            {probing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            {t('golive_recheck')}
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {readiness.map((channel) => {
            const failing = channel.checks.filter((c) => !c.ok).length;
            return (
              <div
                key={channel.channel}
                className={cn(
                  'rounded-xl border p-3',
                  channel.ready ? 'border-green-600/30 bg-green-600/[0.04]' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="min-w-0 text-xs font-semibold [overflow-wrap:anywhere]">
                    {t(CHANNEL_LABEL[channel.channel])}
                  </h3>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-2xs',
                      channel.ready
                        ? 'border-green-600/40 text-green-700 dark:text-green-400'
                        : 'border-destructive/40 text-destructive',
                    )}
                  >
                    {t(channel.ready ? 'golive_ready' : 'golive_blocked')}
                  </Badge>
                </div>

                {!channel.ready ? (
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {t('golive_blocked_count')
                      .replace('{n}', String(failing))
                      .replace('{total}', String(channel.checks.length))}
                  </p>
                ) : null}

                <ul className="mt-2 space-y-1.5">
                  {channel.checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2">
                      {c.ok
                        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
                        : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {/* The identifier, verbatim, so it can be searched for. */}
                          <code className="font-mono text-2xs [overflow-wrap:anywhere]">{c.key}</code>
                          {!c.ok && c.ownerAction ? (
                            <Badge variant="outline" className="shrink-0 gap-1 text-2xs text-gold-ink">
                              <KeyRound className="h-2.5 w-2.5" aria-hidden="true" />
                              {t('golive_owner_action')}
                            </Badge>
                          ) : null}
                        </span>
                        {c.detail ? (
                          <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                            {c.detail}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
