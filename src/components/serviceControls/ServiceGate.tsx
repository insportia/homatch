import React from 'react';
import { Link } from 'react-router-dom';
import { PauseCircle } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { shownBeforeAnswer, useServiceControls, type ServiceKey } from '@/lib/serviceControls';

export const SERVICE_NAME_KEYS: Record<ServiceKey, TranslationKey> = {
  publishing: 'svc_name_publishing',
  ai_call_center: 'svc_name_ai_call_center',
  ai_talk: 'svc_name_ai_talk',
  whatsapp: 'svc_name_whatsapp',
  live_chat: 'svc_name_live_chat',
  design_studio: 'svc_name_design_studio',
  find_property: 'svc_name_find_property',
  find_property_deep: 'svc_name_find_property_deep',
  find_buyers: 'svc_name_find_buyers',
  find_buyers_external: 'svc_name_find_buyers_external',
  internal_matching: 'svc_name_internal_matching',
  curated_leads: 'svc_name_curated_leads',
  verify: 'svc_name_verify',
  contracts: 'svc_name_contracts',
  mortgage: 'svc_name_mortgage',
  investment: 'svc_name_investment',
  for_expats: 'svc_name_for_expats',
  meta_ads: 'svc_name_meta_ads',
  email_campaigns: 'svc_name_email_campaigns',
  ai_assistant: 'svc_name_ai_assistant',
  brokers_directory: 'svc_name_brokers_directory',
  broker_desk: 'svc_name_broker_desk',
  developers: 'svc_name_developers',
};

/**
 * A PAUSED SERVICE'S ADDRESS.
 *
 * The owner paused this service in Admin → Service Control Center. A typed or
 * remembered URL lands here: the service's page is never mounted, so nothing of it
 * initialises, loads data or calls a provider. Its records are kept; it comes back
 * when the owner switches it on again.
 */
export function ServiceUnavailable({ service }: { service: ServiceKey }) {
  const { t } = useLanguage();
  const { session } = useAuth();
  return (
    <AppLayout>
      <div data-testid="service-unavailable" data-service={service}
        className="mx-auto flex max-w-lg flex-col items-center gap-5 py-16 text-center sm:py-24">
        <div className="grid h-16 w-16 place-items-center rounded-[1.1rem] border border-border bg-secondary">
          <PauseCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t(SERVICE_NAME_KEYS[service])}</p>
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">{t('svc_unavailable_title')}</h1>
          <p className="measure text-base leading-relaxed text-ink-soft">{t('svc_unavailable_body')}</p>
        </div>
        <Button asChild>
          <Link to={session ? '/dashboard' : '/'}>{t(session ? 'svc_unavailable_dashboard' : 'svc_unavailable_home')}</Link>
        </Button>
      </div>
    </AppLayout>
  );
}

/**
 * Renders its children only while the service is visible. For the six paused-by-default
 * services and the two broker services nothing is mounted until the switches are known
 * (no flash of a paused service, no request made by it). A live product renders at once
 * from what this browser last knew, so Verify or Find Property never wait on this check.
 */
export function ServiceGate({ service, children }: { service: ServiceKey; children: React.ReactNode }) {
  const snapshot = useServiceControls();
  if (!snapshot.loaded && !shownBeforeAnswer(service)) return <div className="min-h-[50vh]" aria-busy="true" />;
  if (!snapshot.services[service].frontend) return <ServiceUnavailable service={service} />;
  return <GateBoundary service={service} loaded={snapshot.loaded}>{children}</GateBoundary>;
}

/*
 * A live product renders before the first answer, so a paused one can mount for a moment
 * in a browser that has never seen the pause. If it throws in that moment, the app-wide
 * error page would replace the "currently unavailable" page for good (seen in CI,
 * 2026-10-17). So an error before the first answer waits for that answer: paused → the
 * gate shows ServiceUnavailable (this boundary is unmounted); live → the error goes on to
 * the app's boundary exactly as before.
 */
class GateBoundary extends React.Component<{ service: ServiceKey; loaded: boolean; children: React.ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() {
    if (this.state.error == null) return this.props.children;
    if (!this.props.loaded) return <div className="min-h-[50vh]" aria-busy="true" />;
    throw this.state.error;
  }
}
