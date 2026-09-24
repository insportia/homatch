// HOMATCH Admin — AI Call Center.
//
// "Vapi" is not the heading. The owner's question is whether calling
// works; the provider's name is the answer to a narrower question and
// sits where an answer sits — beside "Calling provider", and in the
// technical disclosure.

import { ArrowRight, PhoneCall } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { VoiceTuningControl } from '@/components/admin/VoiceTuningControl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { AdminSection, CommunicationShell } from './CommunicationShell';
import { FactRow, TechnicalDetails, useCommStatus, type Verdict, VerdictBadge, verdictOf } from './status';

export default function CommunicationCallCenterPage() {
  const { t } = useLanguage();
  const status = useCommStatus();
  const vapi = status.providers.find((p) => p.provider === 'VAPI');
  const telephony = status.readiness.find((r) => r.channel === 'TELEPHONY');
  const numbers = status.readiness.find((r) => r.channel === 'NUMBERS');

  const verdict: Verdict = !status.ok ? 'UNKNOWN'
    : telephony ? (telephony.ready ? 'OK' : 'ACTION') : verdictOf(vapi, status.ok);

  return (
    <CommunicationShell titleKey="cc_admin_title" subtitleKey="cc_admin_subtitle">
      {/* ── Status ─────────────────────────────────────────────────── */}
      <AdminSection title={t('admin_home_status_title')}>
        {status.loading ? <Skeleton className="h-10 w-full" /> : (
          <div className="space-y-3">
            <VerdictBadge verdict={verdict} />
            <p className="max-w-[70ch] text-sm leading-relaxed text-foreground">
              {verdict === 'OK' ? t('cc_status_ready') : t('cc_status_blocked')}
            </p>
            {!status.ok && status.reason && (
              <Alert><AlertDescription className="text-sm">{status.reason}</AlertDescription></Alert>
            )}
            {(vapi?.detail || (telephony && telephony.blockedBy.length > 0)) && (
              <div className="max-w-[70ch] rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('admin_provider_says')}
                </p>
                {vapi?.detail && (
                  <p className="text-xs leading-relaxed text-foreground" dir="ltr">{vapi.detail}</p>
                )}
                {telephony?.blockedBy.map((b) => (
                  <p key={b} className="mt-1 text-xs leading-relaxed text-foreground" dir="ltr">{b}</p>
                ))}
              </div>
            )}
            <TechnicalDetails report={vapi} />
          </div>
        )}
      </AdminSection>

      {/* ── Voice ──────────────────────────────────────────────────── */}
      <AdminSection title={t('comms_current_voice')} description={t('voice_cc_desc')}>
        <Alert className="mb-3">
          <AlertDescription className="text-xs leading-relaxed">{t('voice_cc_not_shared')}</AlertDescription>
        </Alert>
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link to="/outreach/agents">
            {t('voice_cc_open_agents')}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      </AdminSection>

      {/* ── How a call behaves ─────────────────────────────────────── */}
      <AdminSection title={t('voice_behaviour_title')}>
        <VoiceTuningControl />
      </AdminSection>

      {/* ── Numbers and agents ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminSection title={t('cc_numbers_title')}>
          {status.loading ? <Skeleton className="h-8 w-full" /> : (
            <div className="space-y-3">
              {numbers && (
                <ul>
                  <FactRow ok={numbers.ready} text={numbers.ready
                    ? t('admin_status_working')
                    : numbers.blockedBy.join(', ') || t('admin_status_action')} />
                </ul>
              )}
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/outreach/numbers">
                  {t('cc_numbers_manage')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </AdminSection>

        <AdminSection title={t('cc_agents_title')} description={t('cc_agents_desc')}>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/outreach/agents">
              {t('voice_cc_open_agents')}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
        </AdminSection>
      </div>

      {/* ── Connection ─────────────────────────────────────────────── */}
      <AdminSection title={t('cc_connection_title')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <PhoneCall className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {status.loading ? <Skeleton className="h-4 w-24" /> : <VerdictBadge verdict={verdictOf(vapi, status.ok)} />}
          <span className="font-mono text-2xs text-muted-foreground">Vapi</span>
        </div>
      </AdminSection>
    </CommunicationShell>
  );
}
