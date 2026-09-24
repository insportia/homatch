// HOMATCH Admin — the four products, in under ten seconds.
//
// One card each, and each card answers exactly three things: is it
// working, what is it, and what is it currently set to. Everything else
// is behind Manage. A card that tried to be a dashboard would be the
// screen this whole redesign replaced.

import { ArrowRight, AudioLines, Mail, MessageCircle, PhoneCall } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { getAiTalkVoice } from '@/services/communications';
import { CommunicationShell } from './CommunicationShell';
import { useCommStatus, type Verdict, VerdictBadge, verdictOf } from './status';

function ProductCard({
  icon: Icon, titleKey, descriptionKey, verdict, facts, to, loading,
}: {
  icon: typeof AudioLines;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  verdict: Verdict;
  facts: Array<{ label: string; value: string }>;
  to: string;
  loading: boolean;
}) {
  const { t } = useLanguage();
  const needsSetup = verdict === 'ACTION' || verdict === 'PROBLEM';
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
            <Icon className="h-4 w-4 text-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-[8rem] flex-1">
            <h2 className="font-display text-base font-semibold text-foreground">{t(titleKey)}</h2>
            {loading ? <Skeleton className="mt-1 h-3 w-24" /> : <VerdictBadge verdict={verdict} />}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{t(descriptionKey)}</p>

        {facts.length > 0 && (
          <dl className="space-y-1">
            {facts.map((f) => (
              <div key={f.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <dt className="text-2xs text-muted-foreground">{f.label}</dt>
                <dd className="min-w-0 break-all font-mono text-2xs text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-auto pt-1">
          <Button asChild size="sm" variant={needsSetup ? 'default' : 'outline'} className="gap-1.5">
            <Link to={to}>
              {needsSetup ? t('comms_fix_setup') : t('comms_manage')}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CommunicationOverviewPage() {
  const { t } = useLanguage();
  const status = useCommStatus();
  const [voice, setVoice] = React.useState<{ id: string | null; speed: number | null } | null>(null);

  React.useEffect(() => {
    let live = true;
    void getAiTalkVoice().then((v) => {
      if (!live) return;
      setVoice({
        id: typeof v?.voice_id === 'string' ? v.voice_id : null,
        speed: typeof v?.speed === 'number' ? v.speed : null,
      });
    });
    return () => { live = false; };
  }, []);

  const byProvider = React.useMemo(() => {
    const m = new Map(status.providers.map((p) => [p.provider, p]));
    return m;
  }, [status.providers]);

  const channelVerdict = React.useCallback((name: 'AI_TALK' | 'TELEPHONY' | 'WHATSAPP', provider: string): Verdict => {
    if (!status.ok) return 'UNKNOWN';
    const row = status.readiness.find((r) => r.channel === name);
    if (row) return row.ready ? 'OK' : 'ACTION';
    return verdictOf(byProvider.get(provider), status.ok);
  }, [status.ok, status.readiness, byProvider]);

  return (
    <CommunicationShell titleKey="comms_admin_title" subtitleKey="comms_admin_subtitle">
      {!status.loading && !status.ok && status.reason && (
        <Alert>
          <AlertDescription className="text-sm">
            {t('comms_not_loaded')} — {status.reason}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ProductCard
          icon={AudioLines}
          titleKey="comms_card_ai_talk"
          descriptionKey="comms_card_ai_talk_desc"
          verdict={channelVerdict('AI_TALK', 'CARTESIA')}
          loading={status.loading}
          facts={[
            { label: t('comms_current_voice'), value: voice?.id ?? t('admin_no_data') },
            ...(voice?.speed != null ? [{ label: t('comms_speed'), value: `${voice.speed.toFixed(2)}×` }] : []),
          ]}
          to="/admin/communication/voice"
        />
        <ProductCard
          icon={PhoneCall}
          titleKey="admin_nav_call_center"
          descriptionKey="comms_card_call_center_desc"
          verdict={channelVerdict('TELEPHONY', 'VAPI')}
          loading={status.loading}
          facts={status.ok && byProvider.get('VAPI')
            ? [{ label: t('comms_provider'), value: 'Vapi' }] : []}
          to="/admin/communication/call-center"
        />
        <ProductCard
          icon={Mail}
          titleKey="admin_nav_email"
          descriptionKey="comms_card_email_desc"
          verdict={verdictOf(byProvider.get('RESEND'), status.ok)}
          loading={status.loading}
          facts={status.ok && byProvider.get('RESEND')
            ? [{ label: t('comms_provider'), value: 'Resend' }] : []}
          to="/admin/communication/email"
        />
        <ProductCard
          icon={MessageCircle}
          titleKey="admin_nav_whatsapp"
          descriptionKey="comms_card_whatsapp_desc"
          verdict={channelVerdict('WHATSAPP', 'META')}
          loading={status.loading}
          facts={status.ok && byProvider.get('META')
            ? [{ label: t('comms_provider'), value: 'Meta' }] : []}
          to="/admin/communication/whatsapp"
        />
      </div>
    </CommunicationShell>
  );
}
