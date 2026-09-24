// HOMATCH Admin — WhatsApp, and what is missing if it does not work.
//
// The readiness probe already knows. What it produced was a list of
// identifiers — META_WHATSAPP_APP_SECRET, missing — which is the right
// answer to a question the reader has not asked yet. The first question
// is "can Homatch message people", and the answer to that is a sentence.
//
// So: the consequence, then the checklist of what is missing, then the
// identifiers behind a disclosure. Nothing is recomputed in the browser;
// comm-provider-status remains the only thing that decides.

import { ArrowRight, CheckCircle2 } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { AdminSection, CommunicationShell } from './CommunicationShell';
import { FactRow, SetupChecklist, TechnicalDetails, useCommStatus, type Verdict, VerdictBadge, verdictOf } from './status';

export default function CommunicationWhatsAppPage() {
  const { t } = useLanguage();
  const status = useCommStatus();
  const meta = status.providers.find((p) => p.provider === 'META');
  const wa = status.readiness.find((r) => r.channel === 'WHATSAPP');

  const verdict: Verdict = !status.ok ? 'UNKNOWN'
    : wa ? (wa.ready ? 'OK' : 'ACTION') : verdictOf(meta, status.ok);

  const allPresent = Boolean(meta && meta.credentials.every((c) => c.present));

  return (
    <CommunicationShell titleKey="wa_admin_title" subtitleKey="wa_admin_subtitle">
      <AdminSection title={t('admin_home_status_title')}>
        {status.loading ? <Skeleton className="h-16 w-full" /> : !status.ok ? (
          <Alert>
            <AlertDescription className="text-sm">
              {t('admin_status_unknown_why')}{status.reason ? ` — ${status.reason}` : ''}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            <VerdictBadge verdict={verdict} />
            {/* The sentence the reader came for, in their own language,
                derived from the same readiness verdict as the badge. */}
            <p className="max-w-[70ch] text-sm leading-relaxed text-foreground">
              {verdict === 'OK' ? t('wa_status_ready') : t('wa_status_blocked')}
            </p>
            {/* And the provider's own words, attributed rather than
                presented as Homatch's. They are English and name
                environment variables, which is what makes them useful to
                whoever has to go and set one. */}
            {(meta?.detail || (wa && wa.blockedBy.length > 0)) && (
              <div className="max-w-[70ch] rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('admin_provider_says')}
                </p>
                {meta?.detail && (
                  <p className="text-xs leading-relaxed text-foreground" dir="ltr">{meta.detail}</p>
                )}
                {wa?.blockedBy.map((b) => (
                  <p key={b} className="mt-1 text-xs leading-relaxed text-foreground" dir="ltr">{b}</p>
                ))}
              </div>
            )}
            <TechnicalDetails report={meta} />
          </div>
        )}
      </AdminSection>

      <div className="grid gap-3 sm:grid-cols-2">
        <AdminSection title={t('wa_env_label')}>
          {status.loading ? <Skeleton className="h-8 w-full" /> : (
            <Badge variant="outline" className="text-xs">
              {/* The probe reports which environment the number belongs to
                  in `facts` when Meta said so; nothing is guessed here. */}
              {typeof meta?.facts?.environment === 'string'
                ? String(meta.facts.environment)
                : t('admin_status_unknown')}
            </Badge>
          )}
        </AdminSection>

        <AdminSection title={t('wa_templates_title')}>
          {status.loading ? <Skeleton className="h-8 w-full" /> : (
            <div className="space-y-2">
              {typeof meta?.facts?.approved_templates === 'number' ? (
                <p className="text-sm text-foreground">{String(meta.facts.approved_templates)}</p>
              ) : (
                <p className="text-2xs leading-relaxed text-muted-foreground">{t('wa_templates_none')}</p>
              )}
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/outreach/whatsapp/templates">
                  {t('comms_manage')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </AdminSection>
      </div>

      <AdminSection title={t('wa_setup_title')}>
        {status.loading ? <Skeleton className="h-8 w-full" /> : allPresent ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#12A06B]" aria-hidden="true" />
            {t('wa_setup_done')}
          </p>
        ) : (
          <SetupChecklist report={meta} />
        )}
      </AdminSection>
    </CommunicationShell>
  );
}
