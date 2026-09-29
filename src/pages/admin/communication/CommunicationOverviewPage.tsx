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
import { supabase } from '@/db/supabase';
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

      <AiRoutingDebug />
    </CommunicationShell>
  );
}

/* ── HOMATCH AI ROUTING — why a response behaved the way it did ──────────
 * One row per assistant turn, straight from ai_routing_events: the
 * validated intent label and web mode the model actually followed, what
 * internal context was on the table, real web-search count, actions
 * returned, latency, and whether internal retrieval FAILED (which is a
 * different fact from "the customer has no data"). Admin-only via RLS;
 * customers never see routing internals. */
function AiRoutingDebug() {
  const { t } = useLanguage();
  const [rows, setRows] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    let live = true;
    void supabase.from('ai_routing_events')
      .select('id,created_at,locale,intent,web_mode,internal_used,internal_failed,web_calls,internal_counts,action_ids,latency_ms')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (live) setRows(data ?? []); });
    return () => { live = false; };
  }, []);
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <h2 className="font-display text-base font-semibold text-foreground">{t('admin_air_title')}</h2>
        <p className="mb-3 text-[13px] text-muted-foreground">{t('admin_air_sub')}</p>
        {rows === null ? null : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin_air_empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-start text-muted-foreground">
                  <th className="pe-3 text-start">{t('admin_air_when')}</th>
                  <th className="pe-3 text-start">{t('admin_air_intent')}</th>
                  <th className="pe-3 text-start">{t('admin_air_mode')}</th>
                  <th className="pe-3 text-start">{t('admin_air_web')}</th>
                  <th className="pe-3 text-start">{t('admin_air_internal')}</th>
                  <th className="pe-3 text-start">{t('admin_air_actions')}</th>
                  <th className="text-end">{t('admin_air_latency')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-1.5 pe-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="pe-3">{r.intent ?? '—'}<span className="text-muted-foreground"> · {r.locale}</span></td>
                    <td className="pe-3 font-mono">{r.web_mode}</td>
                    <td className="pe-3 tabular-nums" dir="ltr">{r.web_calls}</td>
                    <td className="pe-3">
                      {r.internal_failed
                        ? <span className="font-semibold text-destructive">{t('admin_air_failed')}</span>
                        : `${r.internal_used ? '✓' : '—'} p${r.internal_counts?.properties ?? 0} m${r.internal_counts?.matches ?? 0} v${r.internal_counts?.verifications ?? 0}${r.internal_counts?.pageContext ? ` · ${r.internal_counts.pageContext}` : ''}`}
                    </td>
                    <td className="pe-3 font-mono">{(r.action_ids ?? []).join(', ') || '—'}</td>
                    <td className="text-end tabular-nums" dir="ltr">{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
