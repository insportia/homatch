// The three communication directions, as product modules.
//
// WHY THESE ARE NOT THREE ROWS IN A LIST
//
// AI calling, WhatsApp messaging and WhatsApp calling are three independent
// products that happen to share contacts, agents, a wallet and an inbox. A
// customer can run WhatsApp without ever placing a call, and can run calls
// while WhatsApp is switched off. A list of links does not say that; three
// modules of equal visual weight, each with its own state and its own actions,
// does.
//
// The old Overview had them as four small "channel cards" a quarter the size
// of the campaign table beneath, which is how the WhatsApp product ended up
// invisible on the screen that is supposed to introduce it.
//
// WHAT A MODULE MAY CLAIM
//
// Only what is true. `state` comes from the server, and when it is anything
// other than ACTIVE the module says what to do about it in a customer's words
// — never the flag, secret or table that made it so. A module with no data
// shows what it is FOR, not a row of zeros pretending to be metrics.

import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/**
 * What a customer may be told about a channel.
 *
 * Deliberately four states and no more. "Setup required" is something they
 * can act on; "temporarily unavailable" is ours to fix and says so without
 * naming a provider, a route table or an environment variable.
 */
export type ChannelState = 'ACTIVE' | 'SETUP_REQUIRED' | 'NOT_ACTIVATED' | 'UNAVAILABLE';

const STATE_STYLE: Record<ChannelState, string> = {
  ACTIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  SETUP_REQUIRED: 'border-gold/50 bg-gold/10 text-gold-ink',
  NOT_ACTIVATED: 'border-border bg-muted/60 text-muted-foreground',
  UNAVAILABLE: 'border-border bg-muted/60 text-muted-foreground',
};

const STATE_LABEL: Record<ChannelState, string> = {
  ACTIVE: 'comms_state_active',
  SETUP_REQUIRED: 'comms_state_setup',
  NOT_ACTIVATED: 'comms_state_not_activated',
  UNAVAILABLE: 'comms_state_unavailable',
};

export interface ChannelStat {
  labelKey: string;
  /** null renders a placeholder, never a zero that reads as a measurement. */
  value: string | number | null;
}

export interface ChannelModuleProps {
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  /** One line saying what this channel is for. Shown always, including empty. */
  purposeKey: string;
  state: ChannelState;
  /** Shown under the badge when the state is not ACTIVE. Customer language. */
  stateDetailKey?: string | null;
  stats?: ChannelStat[];
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  links?: Array<{ label: string; onClick: () => void }>;
  loading?: boolean;
  /** The module that leads. Slightly stronger surface, never a different shape. */
  featured?: boolean;
}

export function ChannelModule({
  icon: Icon, titleKey, purposeKey, state, stateDetailKey,
  stats, primary, links, loading, featured,
}: ChannelModuleProps) {
  const { t } = useLanguage();
  const live = state === 'ACTIVE';

  return (
    <Card className={cn(
      'flex min-w-0 flex-col transition-colors',
      featured ? 'border-foreground/15 bg-card' : 'bg-card',
      'hover:border-foreground/25',
    )}>
      <CardContent className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
            live ? 'border-gold/40 bg-gold/[0.07] text-gold-ink' : 'border-border bg-muted/60 text-muted-foreground',
          )}>
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{t(titleKey as TKey)}</h3>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t(purposeKey as TKey)}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[13px] font-medium',
            STATE_STYLE[state],
          )}>
            {live ? <span className="relative flex h-1.5 w-1.5">
              {/* The only animation on this card, and only when something is
                  genuinely live. motion-reduce turns it off. */}
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span> : null}
            {t(STATE_LABEL[state] as TKey)}
          </span>
          {!live && stateDetailKey ? (
            <span className="text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t(stateDetailKey as TKey)}
            </span>
          ) : null}
        </div>

        {stats?.length ? (
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
            {stats.map((s) => (
              <div key={s.labelKey} className="min-w-0">
                <dt className="text-[13px] leading-[1.25] text-muted-foreground [overflow-wrap:anywhere]">
                  {t(s.labelKey as TKey)}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums">
                  {loading ? <Skeleton className="h-5 w-10" />
                    : s.value === null || s.value === undefined
                      ? <span className="text-muted-foreground">·</span>
                      : s.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {primary ? (
            <Button size="sm" className="h-8 gap-1.5" onClick={primary.onClick} disabled={primary.disabled}>
              {primary.label}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Button>
          ) : null}
          {links?.map((l) => (
            <Button key={l.label} variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={l.onClick}>
              {l.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What to do next, derived from what the account actually has.
 *
 * Not a tutorial overlay and not a checklist that congratulates you for
 * existing: each step reads real state, and a step already done is struck
 * through rather than removed, so the shape of the journey stays visible.
 *
 * It disappears entirely once every step is done — an onboarding panel that
 * outlives its usefulness is just a permanent strip of nagging.
 */
export interface SetupStep {
  titleKey: string;
  bodyKey: string;
  done: boolean;
  action: { label: string; onClick: () => void };
}

export function SetupProgress({ steps, loading }: { steps: SetupStep[]; loading?: boolean }) {
  const { t } = useLanguage();
  const doneCount = steps.filter((s) => s.done).length;
  if (!loading && doneCount === steps.length) return null;

  const next = steps.findIndex((s) => !s.done);

  return (
    <Card className="border-gold/30 bg-gold/[0.03]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-snug">{t('comms_setup_title')}</h2>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t('comms_setup_sub')}</p>
          </div>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t('comms_setup_progress', { done: doneCount, total: steps.length })}
          </p>
        </div>

        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li
              key={s.titleKey}
              className={cn(
                'flex min-w-0 flex-col rounded-lg border p-3',
                s.done ? 'border-border bg-background/40' : i === next ? 'border-gold/40 bg-background' : 'border-border bg-background/40',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums',
                  s.done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-foreground/[0.07] text-muted-foreground',
                )}>
                  {s.done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
                </span>
                <p className={cn(
                  'min-w-0 text-xs font-medium leading-snug [overflow-wrap:anywhere]',
                  s.done && 'text-muted-foreground line-through decoration-muted-foreground/40',
                )}>
                  {t(s.titleKey as TKey)}
                </p>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {t(s.bodyKey as TKey)}
              </p>
              {!s.done ? (
                <Button
                  variant={i === next ? 'default' : 'ghost'}
                  size="sm"
                  className="mt-2.5 h-7 self-start px-2 text-xs"
                  onClick={s.action.onClick}
                >
                  {s.action.label}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
