// HOMATCH Admin — Email, in one place.
//
// Email administration used to be spread across the provider routing
// panel, the readiness panel and the outreach workspace, which meant the
// question "can Homatch receive replies" had no page that answered it.
//
// It has two halves and they fail differently, so they are two rows:
// sending needs RESEND_API_KEY; receiving needs a webhook secret, an
// owned address AND mail that has actually arrived. A configured secret
// with no MX record is a working system with no inbound mail and no error
// anywhere, which is exactly the state that reads as fine and is not.
//
// NOTHING HERE IS EDITABLE, AND IT SAYS SO
//
// The sender address and the credentials live in the production
// environment, not in a table this screen could write. Rendering an
// editable box over a value the save cannot reach would be a lie with a
// cursor in it, so the values are shown as read-only facts and the page
// says where they are actually changed.

import { Mail } from 'lucide-react';
import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { AdminSection, CommunicationShell } from './CommunicationShell';
import { FactRow, SetupChecklist, TechnicalDetails, useCommStatus, VerdictBadge, verdictOf } from './status';

export default function CommunicationEmailPage() {
  const { t } = useLanguage();
  const status = useCommStatus();
  const resend = status.providers.find((p) => p.provider === 'RESEND');

  const has = React.useCallback(
    (name: string) => resend?.credentials.find((c) => c.name === name)?.present === true,
    [resend],
  );

  const canSend = has('RESEND_API_KEY');
  /* Receiving is only true when the provider report says HEALTHY, because
     that verdict is the one that also knows whether mail has ever
     arrived. A secret being present is not the same claim. */
  const canReceive = resend?.health === 'HEALTHY';

  return (
    <CommunicationShell titleKey="email_admin_title" subtitleKey="email_admin_subtitle">
      <AdminSection title={t('admin_home_status_title')}>
        {status.loading ? <Skeleton className="h-16 w-full" /> : !status.ok ? (
          <Alert>
            <AlertDescription className="text-sm">
              {t('admin_status_unknown_why')}{status.reason ? ` — ${status.reason}` : ''}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            <VerdictBadge verdict={verdictOf(resend, status.ok)} />
            <ul className="divide-y divide-border">
              <FactRow ok={canSend} text={canSend ? t('email_sending_ok') : t('email_sending_no')} />
              <FactRow ok={canReceive} text={canReceive ? t('email_receiving_ok') : t('email_receiving_no')} />
            </ul>
            {resend?.detail && (
              <p
                dir="ltr"
                className="max-w-[70ch] rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground"
              >
                {resend.detail}
              </p>
            )}
            <TechnicalDetails report={resend} />
          </div>
        )}
      </AdminSection>

      <div className="grid gap-3 sm:grid-cols-2">
        <AdminSection title={t('email_sending')}>
          {status.loading ? <Skeleton className="h-8 w-full" /> : (
            <div className="space-y-2">
              <VerdictBadge verdict={canSend ? 'OK' : 'ACTION'} />
              <p className="text-2xs leading-relaxed text-muted-foreground">{t('admin_managed_in_env')}</p>
            </div>
          )}
        </AdminSection>

        <AdminSection title={t('email_receiving')}>
          {status.loading ? <Skeleton className="h-8 w-full" /> : (
            <div className="space-y-2">
              <VerdictBadge verdict={canReceive ? 'OK' : 'ACTION'} />
              {!canReceive && has('RESEND_WEBHOOK_SECRET') && (
                <p className="text-2xs leading-relaxed text-muted-foreground">{t('email_never_received')}</p>
              )}
            </div>
          )}
        </AdminSection>
      </div>

      <AdminSection title={t('wa_setup_title')}>
        {status.loading ? <Skeleton className="h-8 w-full" /> : (
          resend && resend.credentials.every((c) => c.present)
            ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('admin_secret_present')}
              </p>
            )
            : <SetupChecklist report={resend} />
        )}
      </AdminSection>
    </CommunicationShell>
  );
}
