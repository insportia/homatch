import React, { useState, useCallback, useEffect } from 'react';
import { Search, User, Building2, Mail, Phone, CreditCard, Bot, DollarSign, Eye, Loader2, ChevronRight, ArrowLeft, Shield, Brain, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/db/supabase';
import { User360 } from '@/types/types';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { labelFor } from '@/admin/labels';
import { Confirm, When } from '@/components/admin/control/AdminKit';
import { writeImpersonation, type ImpersonationState } from '@/lib/impersonation';
import {
  endImpersonationById, listImpersonationSessions, searchUsers, startImpersonation,
  type ImpersonationSessionRow, type UserSearchRow,
} from '@/services/adminControl';

/*
 * USER 360.
 *
 * The search is admin_search_users (every account, by name, email, username,
 * id, phone digits or an owned property's six-digit reference) rather than an
 * edge function that string-built a PostgREST filter from the typed text.
 *
 * "Log in as user" is real now and deliberately heavy: a stated reason, a
 * confirmation that says what will happen, and a server that refuses when the
 * feature is switched off, when the target is an administrator, or when the
 * account has no confirmed email. See supabase/functions/impersonate-user.
 */
export default function AdminUser360Page() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserSearchRow[]>([]);
  const [selected, setSelected] = useState<User360 | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');
  const [sessions, setSessions] = useState<{ enabled: boolean; rows: ImpersonationSessionRow[] } | null>(null);

  const handleSearch = useCallback(async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSelected(null);
    try {
      setResults(await searchUsers(query.trim(), 50));
    } catch (err) {
      toast.error(t('admin_cc_search_failed'));
      console.error(err);
    } finally {
      setSearching(false);
    }
  }, [query, t]);

  const loadUser360 = useCallback(async (targetUserId: string) => {
    setLoadingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-user360', {
        body: { action: 'user360', target_user_id: targetUserId },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      setSelected(data as User360);
      const url = new URL(window.location.href);
      url.searchParams.set('user', targetUserId);
      url.searchParams.delete('ended');
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch (err) {
      toast.error(t('admin_cc_profile_failed'));
      console.error(err);
    } finally {
      setLoadingUser(false);
    }
  }, [t]);

  /* Arriving with ?user= opens that account; with ?ended= the tab has just
     come back from viewing as somebody, so close that session by id in case
     the in-session Exit could not (an expired token, a dropped request). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ended = params.get('ended');
    if (ended) {
      endImpersonationById(ended)
        .then(() => toast.success(t('admin_impersonation_ended_toast')))
        .catch(() => toast.success(t('admin_impersonation_ended_toast')));
    }
    const user = params.get('user');
    if (user) void loadUser360(user);
    listImpersonationSessions(50).then(setSessions).catch(() => setSessions(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const target = selected?.user as (User360['user'] & { has_phone?: boolean }) | null | undefined;

  const handleImpersonate = useCallback(async () => {
    if (!target) return;
    setImpersonating(true);
    try {
      const data = await startImpersonation(target.id, reason.trim());
      const state: ImpersonationState = {
        session_id: String(data.session_id),
        access_token: String(data.access_token),
        expires_at: Number(data.expires_at),
        started_at: String(data.started_at),
        reason: String(data.reason ?? reason.trim()),
        user: data.user as ImpersonationState['user'],
        target_user: data.target_user as ImpersonationState['target_user'],
      };
      writeImpersonation(state);
      /* A full load, so the whole app — the Supabase client included — starts
         again as the customer. The admin's own login is untouched. */
      window.location.assign('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin_cc_imp_failed'));
      setImpersonating(false);
    }
  }, [target, reason, t]);

  const targetSessions = (sessions?.rows ?? []).filter((s) => s.target?.id === target?.id).slice(0, 5);
  const canImpersonate = !!sessions?.enabled && !!target && !target.is_admin;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          {t('admin_user360_title')}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t('admin_user360_page_subtitle')}</p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t('admin_cc_user_search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <Button onClick={handleSearch} disabled={searching || query.trim().length < 2}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ms-2 hidden sm:inline">{t('verify_btn_search')}</span>
        </Button>
      </div>

      {/* Results list */}
      {!selected && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('admin_user360_results_count', { count: results.length })}</p>
          {results.map((u) => (
            <Card key={u.id} className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => loadUser360(u.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{u.full_name ?? t('admin_user360_no_name')}</span>
                    {u.is_admin && <Badge className="text-[13px] px-1.5 bg-red-500/10 text-red-700">{t('admin_users_admin_badge')}</Badge>}
                    <Badge variant="outline" className="text-2xs">{labelFor(t, 'matchedBy', u.matched_by)}{u.property_reference ? ` #${u.property_reference}` : ''}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}{u.phone_hint ? ` · ${u.phone_hint}` : ''}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 rtl:rotate-180" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!selected && !searching && results.length === 0 && query.trim().length >= 2 && (
        <p className="text-sm text-muted-foreground">{t('admin_users_empty')}</p>
      )}

      {/* Loading user360 */}
      {loadingUser && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {/* User360 detail */}
      {selected && !loadingUser && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-2 -ms-2">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('admin_user360_back_to_results')}
          </Button>

          {/* User card */}
          <Card>
            <CardHeader className="p-4 pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{target?.full_name ?? t('admin_user360_no_name')}</CardTitle>
                    <p className="truncate text-sm text-muted-foreground">{target?.email}</p>
                    <p className="text-2xs text-muted-foreground">
                      {target?.has_phone ? t('admin_cc_has_phone') : t('admin_cc_no_phone')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-stretch gap-1 sm:items-end">
                  <Button size="sm" variant="outline" className="shrink-0 gap-2"
                    onClick={() => { setReason(''); setAskReason(true); }}
                    disabled={impersonating || !canImpersonate}>
                    {impersonating
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Eye className="h-3.5 w-3.5" />}
                    {t('admin_cc_log_in_as')}
                  </Button>
                  {!canImpersonate && (
                    <span className="max-w-[16rem] text-2xs text-muted-foreground">
                      {target?.is_admin ? t('admin_cc_imp_not_admins') : sessions && !sessions.enabled ? t('admin_cc_imp_disabled') : null}
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label={t('admin_properties_title')} value={selected.properties.length} icon={<Building2 className="h-3.5 w-3.5" />} />
                <Stat label={t('admin_user360_campaigns_title')} value={selected.campaigns.length} icon={<Mail className="h-3.5 w-3.5" />} />
                <Stat label={t('contacts_title')} value={selected.contact_lists.length} icon={<Phone className="h-3.5 w-3.5" />} />
                <Stat label={t('admin_nav_credits')} value={selected.credits?.balance ?? 0} icon={<CreditCard className="h-3.5 w-3.5" />} />
              </div>
              {target && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`/admin/intelligence?tab=demand&user=${target.id}`}><Brain className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_tab_demand')}</a>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`/admin/intelligence?tab=signals&user=${target.id}`}><History className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_tab_signals')}</a>
                  </Button>
                  <Button asChild size="sm" variant="outline"><a href={`/admin/properties?owner=${target.id}`}>{t('admin_properties_title')}</a></Button>
                  <Button asChild size="sm" variant="outline"><a href={`/admin/supply-matches?user=${target.id}`}>{t('admin_cc_matches_title')}</a></Button>
                  <Button asChild size="sm" variant="outline"><a href={`/admin/notifications?recipient=${target.id}`}>{t('admin_cc_notif_title')}</a></Button>
                </div>
              )}
            </CardContent>
          </Card>

          {targetSessions.length > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{t('admin_cc_imp_history')}</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-1">
                {targetSessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-1 text-xs last:border-0">
                    <span className="min-w-0 flex-1 truncate">{s.admin?.email ?? '—'} · {s.reason}</span>
                    <span className="text-muted-foreground"><When at={s.started_at} />{s.ended_at ? '' : ` · ${t('admin_cc_imp_open')}`}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Confirm
            open={askReason}
            onOpenChange={setAskReason}
            title={t('admin_cc_imp_confirm_title', { name: target?.full_name || target?.email || '' })}
            description={t('admin_cc_imp_confirm_body')}
            confirmLabel={t('admin_cc_log_in_as')}
            onConfirm={handleImpersonate}
            busy={impersonating}
            confirmDisabled={reason.trim().length < 5}
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                      placeholder={t('admin_cc_reason_placeholder')} aria-label={t('admin_cc_reason_placeholder')} />
          </Confirm>

          {/* Properties */}
          {selected.properties.length > 0 && (
            <Section title={t('admin_properties_title')} icon={<Building2 className="h-4 w-4" />}>
              {selected.properties.map((p) => (
                <Row key={p.id} primary={p.title} secondary={`${p.property_type} · ${p.matching_status}`} date={p.created_at} />
              ))}
            </Section>
          )}

          {/* Campaigns */}
          {selected.campaigns.length > 0 && (
            <Section title={t('admin_user360_campaigns_title')} icon={<Mail className="h-4 w-4" />}>
              {selected.campaigns.map((c) => (
                <Row key={c.id} primary={c.name}
                  secondary={`${c.campaign_type} · ${c.status} · ${c.audience_count ?? 0} contacts`}
                  badge={c.status} date={c.created_at} />
              ))}
            </Section>
          )}

          {/* Contact lists */}
          {selected.contact_lists.length > 0 && (
            <Section title={t('contacts_title')} icon={<Phone className="h-4 w-4" />}>
              {selected.contact_lists.map((l) => (
                <Row key={l.id} primary={l.name}
                  secondary={`${l.import_status} · ${l.valid_rows ?? 0}/${l.total_rows ?? 0} valid`}
                  date={l.created_at} />
              ))}
            </Section>
          )}

          {/* Credits & costs */}
          {selected.credits && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />{t('admin_user360_credits_spending_title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Balance" value={selected.credits.balance} icon={<CreditCard className="h-3.5 w-3.5" />} />
                  <Stat label="Purchased" value={selected.credits.lifetime_purchased} icon={<DollarSign className="h-3.5 w-3.5" />} />
                  <Stat label="Spent" value={selected.credits.lifetime_spent} icon={<DollarSign className="h-3.5 w-3.5" />} />
                </div>
                {selected.recent_cost_events.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{t('admin_user360_recent_cost_events')}</p>
                    {selected.recent_cost_events.slice(0, 5).map((e, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate">{e.operation_type}</span>
                        <span className="font-medium shrink-0 ms-2">${Number(e.cost_usd).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI usage */}
          {selected.ai_conversations.length > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" />{t('admin_user360_ai_conversations_title', { count: selected.ai_conversations.length })}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-xs text-muted-foreground">{t('admin_user360_last_label')} {new Date(selected.ai_conversations[0].created_at).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          )}

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t('admin_user360_compliance_notice')}
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 p-2 bg-muted/40 rounded-lg">
      <div className="flex items-center gap-1 text-muted-foreground">{icon}<span className="text-[13px]">{label}</span></div>
      <span className="text-base font-semibold">{value}</span>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-1">{children}</CardContent>
    </Card>
  );
}

function Row({ primary, secondary, badge, date }: { primary: string; secondary?: string; badge?: string; date?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{primary}</p>
        {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge && <Badge variant="outline" className="text-[13px] px-1.5">{badge}</Badge>}
        {date && <span className="text-[14px] text-muted-foreground whitespace-nowrap">{new Date(date).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}
