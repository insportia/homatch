// HOMATCH — Contact 360.
//
// §15 is explicit that this is NOT a second CRM product: it is the existing
// outreach_contacts row, shown properly, with everything Homatch has learned
// about that person in one timeline.
//
// The compliance block is deliberately near the top. An operator about to
// press Call needs to know that this person asked not to be called BEFORE
// they press it, not in a toast afterwards.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, MessageSquare, Phone, PhoneOff, ShieldAlert, User, Clock, Sparkles,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  LoadingBlock, ErrorState, StatusBadge, relativeTime, formatPhone,
} from '@/components/communications/primitives';
import {
  getContact, getContactTimeline, setDoNotCall, suppressContact,
} from '@/services/communications';
import type { CommContact } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

interface TimelineEvent {
  id: string; at: string; kind: string; title: string; detail: string | null; href: string | null;
}

export default function ContactProfilePage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [contact, setContact] = useState<CommContact | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [c, events] = await Promise.all([getContact(id), getContactTimeline(id)]);
      if (!c) { setError('comm_contact_not_found'); return; }
      setContact(c);
      setTimeline(events);
    } catch {
      setError('comm_contact_load_failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onDoNotCall = useCallback(async () => {
    if (!contact) return;
    setBusy(true);
    try {
      const ok = await setDoNotCall(contact.id, !contact.do_not_call);
      toast[ok ? 'success' : 'error'](t(ok ? 'comm_contact_updated' : 'comm_save_failed'));
      if (ok) void load();
    } finally { setBusy(false); }
  }, [contact, load, t]);

  const onSuppress = useCallback(async () => {
    if (!contact) return;
    setBusy(true);
    try {
      const ok = await suppressContact(contact.id, 'suppressed from the contact profile');
      toast[ok ? 'success' : 'error'](t(ok ? 'comm_contact_suppressed' : 'comm_save_failed'));
      if (ok) void load();
    } finally { setBusy(false); }
  }, [contact, load, t]);

  if (loading) {
    return <RouteGuard><AppLayout><div className="mx-auto max-w-4xl"><LoadingBlock rows={6} /></div></AppLayout></RouteGuard>;
  }
  if (error || !contact) {
    return <RouteGuard><AppLayout><div className="mx-auto max-w-4xl">
      <ErrorState messageKey={error ?? 'comm_contact_not_found'} onRetry={() => { setLoading(true); void load(); }} />
    </div></AppLayout></RouteGuard>;
  }

  const blocked = Boolean(contact.suppressed || contact.do_not_contact || contact.unsubscribed);
  const facts: Array<[string, string | null]> = [
    ['comm_contact_intent', contact.transaction_type ?? contact.lead_type ?? null],
    ['comm_contact_property_type', contact.property_type],
    ['comm_contact_locations', contact.preferred_locations?.join(', ') ?? null],
    ['comm_contact_bedrooms', contact.bedrooms != null ? String(contact.bedrooms) : null],
    ['comm_contact_budget', contact.budget_max
      ? new Intl.NumberFormat(language, { style: 'currency', currency: contact.currency ?? 'USD', maximumFractionDigits: 0 }).format(contact.budget_max)
      : null],
    ['comm_contact_timeline', contact.timeline],
    ['comm_field_company', contact.company],
    ['comm_field_city', contact.city],
    ['comm_field_country', contact.country],
    ['comm_field_language', contact.language],
  ];

  return (
    <RouteGuard>
      <AppLayout>
        <div className="mx-auto max-w-4xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/contact-lists')}>
            <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_contact_lists')}
          </Button>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold">
                  {contact.full_name || formatPhone(contact.phone)}
                </h1>
                <p className="truncate text-sm text-muted-foreground">{formatPhone(contact.phone)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {contact.lead_stage ? (
                <StatusBadge status={contact.lead_stage} labelKey={`comm_stage_${contact.lead_stage.toLowerCase()}`} />
              ) : null}
              {contact.lead_score != null ? (
                <Badge variant="outline" className="text-[13px]">{t('comm_lead_score')} {contact.lead_score}</Badge>
              ) : null}
            </div>
          </div>

          {/* §15's compliance block, above everything an operator could act on. */}
          {blocked ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {contact.suppressed ? t('comm_contact_suppressed_note')
                  : contact.do_not_contact ? t('comm_contact_dnc_note')
                  : t('comm_contact_unsubscribed_note')}
                {contact.suppressed_reason ? ` ${contact.suppressed_reason}` : ''}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline"
              disabled={blocked || Boolean(contact.do_not_call) || !contact.phone_valid}
              onClick={() => navigate(`/outreach/campaigns/new?contact=${contact.id}`)}
            >
              <Phone className="me-1.5 h-3.5 w-3.5" />{t('comm_action_call')}
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={blocked || contact.whatsapp_opted_out}
              onClick={() => navigate(`/outreach/whatsapp/inbox?phone=${encodeURIComponent(contact.phone ?? '')}`)}
            >
              <MessageSquare className="me-1.5 h-3.5 w-3.5" />{t('comm_action_whatsapp')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onDoNotCall()}>
              <PhoneOff className="me-1.5 h-3.5 w-3.5" />
              {t(contact.do_not_call ? 'comm_action_allow_calls' : 'comm_action_do_not_call')}
            </Button>
            {!contact.suppressed ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void onSuppress()}>
                <Ban className="me-1.5 h-3.5 w-3.5" />{t('comm_action_suppress')}
              </Button>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card><CardContent className="p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                {t('comm_contact_intelligence')}
              </h2>
              {facts.some(([, v]) => v) ? (
                <dl className="divide-y text-xs">
                  {facts.filter(([, v]) => v).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 py-1.5">
                      <dt className="text-muted-foreground">{t(key as TKey)}</dt>
                      <dd className="text-end font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">{t('comm_contact_nothing_known')}</p>
              )}

              <h3 className="mb-1.5 mt-4 text-xs font-medium">{t('comm_contact_compliance')}</h3>
              <ul className="space-y-1 text-[13px]">
                <Flag labelKey="comm_flag_consent" value={contact.consent_status} />
                <Flag labelKey="comm_flag_dnc" value={contact.do_not_contact ? t('comm_yes') : t('comm_no')} />
                <Flag labelKey="comm_flag_do_not_call" value={contact.do_not_call ? t('comm_yes') : t('comm_no')} />
                <Flag labelKey="comm_flag_whatsapp_optout" value={contact.whatsapp_opted_out ? t('comm_yes') : t('comm_no')} />
                <Flag labelKey="comm_flag_phone_confidence" value={contact.phone_e164_confidence ?? '·'} />
              </ul>
            </CardContent></Card>

            <Card><CardContent className="p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {t('comm_contact_timeline')}
              </h2>
              {!timeline.length ? (
                <p className="text-xs text-muted-foreground">{t('comm_contact_no_activity')}</p>
              ) : (
                <ol className="space-y-2.5">
                  {timeline.map((event) => (
                    <li key={event.id} className="flex gap-2.5">
                      <span className={cn(
                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                        event.kind === 'CALL' ? 'bg-sky-500'
                          : event.kind === 'CONVERSATION' ? 'bg-emerald-500'
                          : event.kind === 'INSIGHT' ? 'bg-gold' : 'bg-muted-foreground',
                      )} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-medium">
                            {event.href ? (
                              <button type="button" className="hover:underline" onClick={() => navigate(event.href!)}>
                                {event.title}
                              </button>
                            ) : event.title}
                          </span>
                          <span className="shrink-0 text-[13px] text-muted-foreground">
                            {relativeTime(event.at, language)}
                          </span>
                        </p>
                        {event.detail ? (
                          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{event.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent></Card>
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

function Flag({ labelKey, value }: { labelKey: string; value: string }) {
  const { t } = useLanguage();
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{t(labelKey as TKey)}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}
