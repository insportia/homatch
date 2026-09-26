// HOMATCH ADMIN — CONNECTED SOCIAL ACCOUNTS.
//
// One place to connect an account, and an honest account of what connecting
// buys. Four buttons and a status, not an engineering console — the technical
// detail lives behind Diagnostics, closed by default.
//
// THE ONE THING THIS SCREEN MUST NOT DO
//
// Show green because an account is connected. "Connected" and "readable" are
// different facts, and for Facebook groups they routinely disagree: an
// authorized account can see its groups, and Meta has exposed no supported
// programmatic way to read them since it removed the Groups API on 2024-04-22.
// So a group we belong to and cannot read renders as
//
//   MEMBER · API ACCESS UNAVAILABLE
//
// which is the honest state and the whole reason `readability` is computed from
// the acquisition matrix rather than inferred from membership. A screen that
// reported that group as working would sit above a sync that returns nothing
// forever, and the operator would go looking for the bug in the sync.
//
// A CONNECT BUTTON THAT CANNOT WORK SAYS SO BEFORE IT REDIRECTS
//
// With no platform app provisioned there is no client id to send. Redirecting
// anyway lands the operator on somebody else's error page with Homatch's name
// on it, so the button reports what is missing instead — by secret NAME, never
// value.
//
// NO TOKEN REACHES THIS FILE. The service layer selects columns explicitly and
// the tables hold no token at all: a connection carries the NAME of a platform
// secret. What renders is presence, health and expiry.

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Facebook, Instagram,
  Link2, Loader2, RefreshCw, Send, Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  getSocialConnections,
  startSocialAuthorization,
  disconnectSocialProvider,
  type SocialConnectionCard,
} from '@/services/social';
import { CommunityIntelligencePanel } from '@/components/admin/CommunityIntelligencePanel';

/** Platform identity for the card. Icons only where lucide has a real one. */
const LOOK: Record<string, { label: string; icon: React.ElementType | null; accent: string }> = {
  META: { label: 'Facebook', icon: Facebook, accent: 'text-[#1877F2]' },
  INSTAGRAM: { label: 'Instagram', icon: Instagram, accent: 'text-[#E1306C]' },
  VK: { label: 'VK', icon: null, accent: 'text-[#0077FF]' },
  REDDIT: { label: 'Reddit', icon: null, accent: 'text-[#FF4500]' },
  TELEGRAM: { label: 'Telegram', icon: Send, accent: 'text-[#26A5E4]' },
};

/**
 * How a status reads to a person.
 *
 * `tone` drives colour and nothing else. Note that CONNECTED is the only green:
 * CONFIGURATION_READY is not an achievement, it means nobody has connected yet.
 */
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'idle'> = {
  CONNECTED: 'ok',
  CONNECTED_PARTIAL: 'warn',
  AUTHORIZING: 'warn',
  TOKEN_EXPIRING: 'warn',
  CONFIGURATION_READY: 'idle',
  NOT_CONFIGURED: 'idle',
  CREDENTIALS_MISSING: 'warn',
  PERMISSION_MISSING: 'warn',
  APP_REVIEW_REQUIRED: 'warn',
  BUSINESS_VERIFICATION_REQUIRED: 'warn',
  TOKEN_EXPIRED: 'bad',
  REAUTH_REQUIRED: 'bad',
  DEGRADED: 'bad',
  DISABLED: 'idle',
  BLOCKED: 'bad',
  NOT_SUPPORTED: 'idle',
};

const TONE_CLASS: Record<string, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
  idle: 'border-border bg-muted/40 text-muted-foreground',
};

function statusWords(t: (k: string) => string, status: string): string {
  const key = `social_status_${status.toLowerCase()}`;
  const copy = t(key);
  // An unknown status renders the raw token rather than an empty badge: an
  // operator seeing NOT_SUPPORTED can act; an operator seeing nothing cannot.
  return copy === key ? status.replace(/_/g, ' ').toLowerCase() : copy;
}

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AdminSocialDiscoveryPage() {
  const { t } = useLanguage();
  const [cards, setCards] = useState<SocialConnectionCard[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openDiagnostics, setOpenDiagnostics] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getSocialConnections();
      setCards(result.cards);
      setDiagnostics(result.diagnostics);
    } catch (error) {
      setCards([]);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async (provider: string) => {
    setBusy(provider);
    try {
      const result = await startSocialAuthorization(provider);
      /*
       * The platform's own authorization page, in this tab. Homatch never
       * renders a password field and never sees the credential.
       */
      window.location.assign(result.authorizeUrl);
    } catch (error) {
      /*
       * A refusal here is usually CONFIGURATION_REQUIRED, which is not a fault —
       * it means an app has to exist before an account can be connected. The
       * message names the missing secrets so the next step is obvious.
       */
      toast.error(error instanceof Error ? error.message : String(error));
      setBusy(null);
      void load();
    }
  };

  const disconnect = async (provider: string) => {
    setBusy(provider);
    try {
      await disconnectSocialProvider(provider);
      toast.success(t('social_disconnected'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t('social_title')}</h1>
        <p className="text-sm text-muted-foreground" dir="auto">{t('social_subtitle')}</p>
      </header>

      {cards === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-56 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const look = LOOK[card.provider] ?? { label: card.provider, icon: null, accent: '' };
            const Icon = look.icon;
            const tone = STATUS_TONE[card.status] ?? 'idle';
            const connected = card.status === 'CONNECTED' || card.status === 'CONNECTED_PARTIAL';

            return (
              <Card key={card.provider} className="overflow-hidden">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {Icon
                        ? <Icon className={cn('h-5 w-5 shrink-0', look.accent)} />
                        : <Link2 className={cn('h-5 w-5 shrink-0', look.accent)} />}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{look.label}</p>
                        {card.account?.name ? (
                          <p className="truncate text-xs text-muted-foreground">{card.account.name}</p>
                        ) : null}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('shrink-0 text-xs', TONE_CLASS[tone])}>
                      {statusWords(t, card.status)}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground" dir="auto">{card.statusDetail}</p>

                  {/*
                    * WHAT IS MISSING, BY NAME. The names of secrets an operator
                    * must provision — never a value, and never a field to paste
                    * one into. A platform credential belongs in the platform's
                    * secret store.
                    */}
                  {card.missingAppCredentials.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <p className="text-xs text-muted-foreground">
                        {t('social_needs_app')}{' '}
                        <span className="font-mono text-[11px]">
                          {card.missingAppCredentials.join(', ')}
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Targets: the honest four numbers, including the awkward one. */}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <dt className="text-xs text-muted-foreground" dir="auto">{t('social_readable')}</dt>
                      <dd className="font-semibold tabular-nums">{card.targets.readable}</dd>
                    </div>
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <dt className="text-xs text-muted-foreground" dir="auto">{t('social_join_required')}</dt>
                      <dd className="font-semibold tabular-nums">{card.targets.joinRequired}</dd>
                    </div>
                    {/*
                      * THE ROW THAT MUST EXIST. A community we are a member of and
                      * cannot read programmatically. Hiding it would make the
                      * platform's restriction look like our bug.
                      */}
                    {card.targets.memberButUnreadable > 0 && (
                      <div className="col-span-2 rounded-md border border-border bg-background px-3 py-2">
                        <dt className="text-xs text-muted-foreground" dir="auto">
                          {t('social_member_unreadable')}
                        </dt>
                        <dd className="font-semibold tabular-nums">{card.targets.memberButUnreadable}</dd>
                      </div>
                    )}
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <dt className="text-xs text-muted-foreground" dir="auto">{t('social_demand_found')}</dt>
                      <dd className="font-semibold tabular-nums">{card.volume.demandFound}</dd>
                    </div>
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <dt className="text-xs text-muted-foreground" dir="auto">{t('social_supply_found')}</dt>
                      <dd className="font-semibold tabular-nums">{card.volume.supplyFound}</dd>
                    </div>
                  </dl>

                  {card.lastSuccessAt && (
                    <p className="text-xs text-muted-foreground">
                      {t('social_last_sync')} {ago(card.lastSuccessAt)}
                    </p>
                  )}
                  {card.lastErrorCode && (
                    <p className="text-xs text-destructive">{card.lastErrorCode}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {!connected ? (
                      <Button
                        className="w-full sm:w-auto"
                        onClick={() => connect(card.provider)}
                        disabled={busy === card.provider || card.connectMechanism === 'CREDENTIALS'}
                      >
                        {busy === card.provider
                          ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
                          : <Link2 className="me-2 h-4 w-4" />}
                        {t(`social_connect_${card.provider.toLowerCase()}`)}
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => connect(card.provider)}
                          disabled={busy === card.provider}>
                          <RefreshCw className="me-2 h-3.5 w-3.5" />
                          {t('social_reauthorize')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => disconnect(card.provider)}
                          disabled={busy === card.provider}>
                          <Unplug className="me-2 h-3.5 w-3.5" />
                          {t('social_disconnect')}
                        </Button>
                      </>
                    )}
                  </div>

                  {/*
                    * WHAT THIS PLATFORM CAN REACH AT ALL — answered before anyone
                    * connects, because "what would this buy me" is the question an
                    * operator has while looking at the button.
                    */}
                  <div className="space-y-1.5 border-t border-border/60 pt-3">
                    {card.surfaces.slice(0, 6).map((surface) => (
                      <div key={surface.surface} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground" dir="auto">
                          {t(`social_surface_${surface.surface.toLowerCase()}`)}
                        </span>
                        <span className={cn(
                          'shrink-0 font-medium',
                          surface.best === 'AVAILABLE' ? 'text-emerald-600'
                            : surface.best === 'UNAVAILABLE' ? 'text-muted-foreground line-through'
                              : 'text-amber-600',
                        )}>
                          {t(`social_avail_${surface.best.toLowerCase()}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/*
        * WHAT THE CONNECTIONS ABOVE HAVE ACTUALLY PRODUCED.
        *
        * Placed here on purpose: the cards say what each platform COULD reach, and
        * this says what is in the store. A screen that only ever showed capability
        * would look identical whether the syncs were working or had returned nothing
        * for a month.
        */}
      <CommunityIntelligencePanel />

      {/*
        * Diagnostics, closed. Every capability row with its evidence and the date
        * the documentation was read — because a capability matrix is a claim about
        * somebody else's product and those have a shelf life.
        */}
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 p-4 text-start"
            onClick={() => setOpenDiagnostics((open) => !open)}
          >
            <span className="text-sm font-semibold" dir="auto">{t('social_diagnostics')}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform',
              openDiagnostics && 'rotate-180')} />
          </button>
          {openDiagnostics && (
            <div className="max-h-96 overflow-auto border-t border-border/60 p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span dir="auto">{t('social_security_note')}</span>
      </p>
    </div>
  );
}
