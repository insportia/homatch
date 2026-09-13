// HOMATCH — phone numbers and channel accounts.
//
// §40. The identities Homatch speaks through, and what each one can actually
// do. Two rules govern what is on this screen:
//
//   Users should not see API secrets. There are none here — not masked, not
//   partially shown, not behind a reveal. The page renders identifiers Meta
//   and the carriers already treat as public, and nothing else (§139).
//
//   "Do not promise +995 or any specific inventory without real provider
//   confirmation." So there is no "buy a Georgian number" flow and no list of
//   available countries. What is shown is what an account actually has.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, MessageSquare, ShieldAlert, RefreshCw } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge,
  ScrollTable, relativeTime, formatPhone,
} from '@/components/communications/primitives';
import { listChannelAccounts } from '@/services/communications';
import type { CommChannelAccount } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

export default function ChannelAccountsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<CommChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setAccounts(await listChannelAccounts()); }
    catch { setError('comm_numbers_load_failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const anyTest = accounts.some((a) => a.environment === 'TEST');

  return (
    <CommsWorkspace>
        <div className="space-y-4">
          <PageHeader
            title={t('comm_numbers_title')}
            subtitle={t('comm_numbers_subtitle')}
            secondary={{ label: t('comm_refresh'), onClick: () => { setLoading(true); void load(); } }}
          />

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {anyTest ? (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">{t('comm_numbers_test_note')}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? <LoadingBlock rows={3} /> : !accounts.length ? (
            <EmptyState icon={Phone} titleKey="comm_numbers_empty" bodyKey="comm_numbers_empty_body" />
          ) : (
            <ScrollTable minWidth={880}>
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                    <th>{t('comm_col_label')}</th>
                    <th>{t('comm_col_number')}</th>
                    <th>{t('comm_col_channel')}</th>
                    <th>{t('comm_col_capabilities')}</th>
                    <th>{t('comm_col_environment')}</th>
                    <th>{t('comm_col_status')}</th>
                    <th>{t('comm_wa_last_inbound')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2">
                      <td className="max-w-[200px]">
                        <span className="block truncate font-medium">{a.display_name || a.label}</span>
                        {a.owner_id === null ? (
                          <span className="text-[13px] text-muted-foreground">{t('comm_platform_number')}</span>
                        ) : null}
                      </td>
                      <td className="font-mono">{formatPhone(a.phone_e164)}</td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          {a.channel === 'WHATSAPP'
                            ? <MessageSquare className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                            : <Phone className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                          {t(`comm_channel_${a.channel.toLowerCase()}` as TKey)}
                        </span>
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-1">
                          {a.capabilities.length
                            ? a.capabilities.map((c) => (
                                <Badge key={c} variant="outline" className="text-[13px]">
                                  {t(`comm_cap_${c.toLowerCase()}` as TKey)}
                                </Badge>
                              ))
                            : <span className="text-muted-foreground">·</span>}
                        </span>
                      </td>
                      <td>
                        <Badge
                          variant="outline"
                          className={a.environment === 'TEST'
                            ? 'border-amber-500/40 bg-amber-500/10 text-[13px] text-amber-700 dark:text-amber-400'
                            : 'text-[13px]'}
                        >
                          {t(a.environment === 'TEST' ? 'comm_test_mode' : 'comm_production')}
                        </Badge>
                      </td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="text-muted-foreground">{relativeTime(a.last_inbound_at, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          )}

          {/*
            * PROCUREMENT, STATED HONESTLY.
            *
            * Buying a number from inside the product needs a provider that can
            * search purchasable inventory and quote a real cost. Nothing
            * configured here does: the telephony provider lists the numbers the
            * account already owns and has no inventory-search endpoint at all.
            *
            * So this says so. It does NOT render a catalogue of numbers that
            * cannot be bought, and it does not print a price that no provider
            * quoted — an invented price is worse than an absent one, because a
            * customer can act on it.
            */}
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold">{t('comms_numbers_buy_title')}</h2>
              <p className="mt-1 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {t('comms_numbers_buy_body')}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {t('comms_numbers_capability_note')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold">{t('comm_numbers_production_title')}</h2>
              {/* §108: never ask a customer to attach their personal WhatsApp. */}
              <p className="mt-1 text-xs text-muted-foreground">{t('comm_numbers_production_body')}</p>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-[13px] text-muted-foreground">
                <li>{t('comm_numbers_step1')}</li>
                <li>{t('comm_numbers_step2')}</li>
                <li>{t('comm_numbers_step3')}</li>
              </ol>
            </CardContent>
          </Card>
        </div>
    </CommsWorkspace>
  );
}
