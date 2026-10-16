import React from 'react';
import { Link } from 'react-router-dom';
import { PauseCircle } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { useServiceControls, type ServiceKey } from '@/lib/serviceControls';

export const SERVICE_NAME_KEYS: Record<ServiceKey, TranslationKey> = {
  publishing: 'svc_name_publishing',
  ai_call_center: 'svc_name_ai_call_center',
  ai_talk: 'svc_name_ai_talk',
  whatsapp: 'svc_name_whatsapp',
  live_chat: 'svc_name_live_chat',
  design_studio: 'svc_name_design_studio',
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
 * Renders its children only while the service is visible. Until the switches are
 * known nothing is mounted (no flash of a paused service, no request made by it).
 */
export function ServiceGate({ service, children }: { service: ServiceKey; children: React.ReactNode }) {
  const snapshot = useServiceControls();
  if (!snapshot.loaded) return <div className="min-h-[50vh]" aria-busy="true" />;
  if (!snapshot.services[service].frontend) return <ServiceUnavailable service={service} />;
  return <>{children}</>;
}
