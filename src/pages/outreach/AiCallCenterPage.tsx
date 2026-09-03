import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Phone, Plus, AlertCircle, Loader2, Mic, Rocket, PhoneCall, PhoneOff, PhoneIncoming, CheckCircle2, XCircle, Radio, Play } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { OutreachCampaign, ContactList } from '@/types/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOutreachProviderStatus } from '@/hooks/useOutreachProviderStatus';

interface OutreachSendRow {
  id: string;
  campaign_id: string;
  recipient_phone: string | null;
  status: string;
  provider: string;
  duration_sec: number | null;
  transcript: string | null;
  summary: string | null;
  recording_url: string | null;
  error_message: string | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  updated_at: string;
}

const CALL_STATUS_STYLES: Record<string, string> = {
  DIALING: 'bg-amber-500/10 text-amber-600 border-amber-400/40',
  ANSWERED: 'bg-green-500/10 text-green-700 border-green-500/40',
  COMPLETED: 'bg-blue-500/10 text-blue-700 border-blue-500/40',
  FAILED: 'bg-red-500/10 text-red-700 border-red-500/40',
};

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return <span className="font-mono tabular-nums">{mm}:{ss}</span>;
}

function PhoneVisual({ send }: { send: OutreachSendRow | null }) {
  const { t } = useLanguage();
  if (!send) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <div className="h-24 w-24 rounded-full bg-muted flex items-center justify-center">
          <PhoneOff className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">{t('callcenter_no_active_call')}</p>
      </div>
    );
  }
  const isLive = send.status === 'DIALING' || send.status === 'ANSWERED';
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <div className="relative h-28 w-28 flex items-center justify-center">
        {isLive && (
          <>
            <span className={cn('absolute inset-0 rounded-full animate-ping opacity-30',
              send.status === 'DIALING' ? 'bg-amber-400' : 'bg-green-400')} />
            <span className={cn('absolute inset-2 rounded-full animate-ping opacity-20 [animation-delay:300ms]',
              send.status === 'DIALING' ? 'bg-amber-400' : 'bg-green-400')} />
          </>
        )}
        <div className={cn('relative h-24 w-24 rounded-full flex items-center justify-center shadow-lg',
          send.status === 'DIALING' ? 'bg-amber-500' :
          send.status === 'ANSWERED' ? 'bg-green-600' :
          send.status === 'COMPLETED' ? 'bg-blue-600' : 'bg-red-600')}>
          {send.status === 'DIALING' && <PhoneIncoming className="h-10 w-10 text-white animate-pulse" />}
          {send.status === 'ANSWERED' && <PhoneCall className="h-10 w-10 text-white" />}
          {send.status === 'COMPLETED' && <CheckCircle2 className="h-10 w-10 text-white" />}
          {send.status === 'FAILED' && <XCircle className="h-10 w-10 text-white" />}
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="font-mono text-lg font-semibold">{send.recipient_phone ?? '—'}</p>
        <Badge className={cn('text-[11px]', CALL_STATUS_STYLES[send.status] ?? '')} variant="outline">
          {send.status}{send.provider === 'MOCK' ? ` ${t('callcenter_mock_suffix')}` : ''}
        </Badge>
        {isLive && send.call_started_at && (
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <Radio className="h-3 w-3 animate-pulse text-red-500" /> <LiveTimer startedAt={send.call_started_at} />
          </p>
        )}
        {!isLive && send.duration_sec != null && (
          <p className="text-xs text-muted-foreground">{Math.floor(send.duration_sec / 60)}:{String(send.duration_sec % 60).padStart(2, '0')}</p>
        )}
      </div>
      {isLive && (
        <div className="flex items-end gap-0.5 h-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="w-1 rounded-full bg-primary animate-pulse"
              style={{ height: `${8 + (i % 3) * 6}px`, animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}

const SUPPORTED_LANGS = [
  { code: 'en', label: 'English' }, { code: 'ka', label: 'ქართული' },
  { code: 'ru', label: 'Русский' }, { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' }, { code: 'he', label: 'עברית' },
];

export default function AiCallCenterPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const { status: providerStatus } = useOutreachProviderStatus();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', call_script: '', language: 'en',
    goal: '', guardrails: '', max_duration: '300', contact_list_id: '',
  });
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [liveCampaign, setLiveCampaign] = useState<OutreachCampaign | null>(null);
  const [liveSends, setLiveSends] = useState<OutreachSendRow[]>([]);
  const [expandedSendId, setExpandedSendId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select('id,name,status,audience_count,cost_estimate_usd,created_at,language,call_script,call_agent_config,contact_list_id,sent_count')
        .eq('owner_id', homatchUser.id).eq('campaign_type', 'AI_CALL')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setCampaigns(Array.isArray(data) ? data as OutreachCampaign[] : []);
    } finally { setLoading(false); }
  }, [homatchUser]);

  const loadContactLists = useCallback(async () => {
    if (!homatchUser) return;
    const { data } = await supabase.from('outreach_contact_lists')
      .select('id,name,valid_rows')
      .eq('owner_id', homatchUser.id)
      .order('created_at', { ascending: false });
    setContactLists(Array.isArray(data) ? data as ContactList[] : []);
  }, [homatchUser]);

  useEffect(() => { load(); loadContactLists(); }, [load, loadContactLists]);

  // Live counters on the campaign list itself
  useEffect(() => {
    if (!homatchUser) return;
    const channel = supabase.channel(`call-campaigns-${homatchUser.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'outreach_campaigns', filter: `owner_id=eq.${homatchUser.id}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [homatchUser, load]);

  // Live view: subscribe to outreach_sends for the open campaign so call
  // status/transcript/recording update in real time as Retell's webhook
  // (retell-webhook edge function) reports call_started / call_ended events.
  const loadLiveSends = useCallback(async (campaignId: string) => {
    const { data } = await supabase.from('outreach_sends')
      .select('id,campaign_id,recipient_phone,status,provider,duration_sec,transcript,summary,recording_url,error_message,call_started_at,call_ended_at,updated_at')
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: false })
      .limit(200);
    setLiveSends(Array.isArray(data) ? data as OutreachSendRow[] : []);
  }, []);

  useEffect(() => {
    if (!liveCampaign) return;
    loadLiveSends(liveCampaign.id);
    const channel = supabase.channel(`call-live-${liveCampaign.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'outreach_sends', filter: `campaign_id=eq.${liveCampaign.id}`,
      }, () => loadLiveSends(liveCampaign.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [liveCampaign, loadLiveSends]);

  const activeCall = useMemo(
    () => liveSends.find((s) => s.status === 'DIALING' || s.status === 'ANSWERED') ?? liveSends[0] ?? null,
    [liveSends]
  );

  const handleCreate = async () => {
    if (!form.name.trim() || !form.call_script.trim()) return;
    setCreating(true);
    try {
      const agentConfig = {
        role: 'Homatch real estate assistant',
        goal: form.goal || 'Qualify potential buyer and schedule a viewing',
        guardrails: form.guardrails || 'Never invent property facts. Unknown facts are unconfirmed.',
        prohibited_claims: ['guaranteed ROI', 'last unit', 'price will increase'],
        escalation: 'Transfer to human if caller is unsatisfied or requests human agent',
        language: form.language,
        fallback: 'I apologize, I cannot confirm that information. Please contact our team directly.',
      };
      const { error } = await supabase.functions.invoke('outreach-campaign-preview', {
        body: {
          campaign_type: 'AI_CALL', name: form.name, call_script: form.call_script,
          call_agent_config: agentConfig, language: form.language,
          max_call_duration_sec: parseInt(form.max_duration, 10) || 300,
          contact_list_id: form.contact_list_id || undefined,
        },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('call_campaign_created'));
      setCreateOpen(false);
      setForm({ name: '', call_script: '', language: 'en', goal: '', guardrails: '', max_duration: '300', contact_list_id: '' });
      load();
    } catch (err) {
      toast.error(t('call_campaign_create_error'));
    } finally { setCreating(false); }
  };

  const handleLaunch = async (campaign: OutreachCampaign) => {
    setLaunchingId(campaign.id);
    try {
      const { data, error } = await supabase.functions.invoke('outreach-send', {
        body: { campaign_id: campaign.id },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      if (data?.blocked) {
        toast.error(data.reason === 'PROVIDER_KILL_SWITCH_ACTIVE' ? t('call_blocked_kill_switch') : t('call_blocked_spend_cap'));
        return;
      }
      toast.success(`${t('call_launch_success')}: ${data?.sent ?? 0}`);
      load();
      setLiveCampaign(campaign);
    } catch (err) {
      toast.error(t('call_launch_error'));
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                {t('call_center_title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('call_center_subtitle')}</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 me-2" />{t('call_new_campaign')}
            </Button>
          </div>
          <Alert variant={providerStatus?.calling.real ? 'default' : undefined} className={providerStatus?.calling.real ? 'border-green-500/40 bg-green-500/5' : ''}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {!providerStatus
                ? t('outreach_status_checking')
                : providerStatus.kill_switch
                ? t('outreach_status_kill_switch')
                : providerStatus.calling.real
                ? t('call_calling_real', { provider: providerStatus.calling.provider })
                : t('call_calling_disabled')}
            </AlertDescription>
          </Alert>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Mic className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('call_empty_title')}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{t('call_empty_desc')}</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 me-2" />{t('call_new_campaign')}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <Card key={c.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <Phone className="h-8 w-8 shrink-0 text-muted-foreground/50 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{c.name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5">{c.status}</Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 uppercase">{c.language ?? 'en'}</Badge>
                        </div>
                        {c.call_script && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.call_script}</p>}
                        <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                          <span>{c.audience_count ?? 0} {t('call_contacts')}</span>
                          <span>{c.sent_count ?? 0} {t('call_dialed')}</span>
                          {(c.cost_estimate_usd ?? 0) > 0 && <span>${t('call_est')}: ${c.cost_estimate_usd?.toFixed(2)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {(c.status !== 'DRAFT') && (
                          <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1.5 text-xs" onClick={() => setLiveCampaign(c)}>
                            <Radio className="h-3.5 w-3.5" />{t('call_live_view')}
                          </Button>
                        )}
                        {!['COMPLETED', 'CANCELLED'].includes(c.status) && c.contact_list_id && (
                          <Button
                            size="sm" className="h-8 px-2.5 gap-1.5 text-xs"
                            disabled={launchingId === c.id}
                            onClick={() => handleLaunch(c)}
                          >
                            {launchingId === c.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Rocket className="h-3.5 w-3.5" />}
                            {c.status === 'RUNNING' ? t('call_continue_sending') : t('call_launch')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
            <DialogHeader><DialogTitle>{t('call_new_campaign')}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('call_campaign_name')}</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('call_campaign_name_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('call_language')}</Label>
                <Select value={form.language} onValueChange={(v) => setForm((f) => ({ ...f, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUPPORTED_LANGS.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('call_script_label')}</Label>
                <Textarea rows={3} value={form.call_script} onChange={(e) => setForm((f) => ({ ...f, call_script: e.target.value }))} placeholder={t('call_script_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('call_goal_label')}</Label>
                <Input value={form.goal} onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))} placeholder={t('call_goal_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('call_contact_list_label')}</Label>
                {contactLists.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('call_no_lists')}</p>
                ) : (
                  <Select value={form.contact_list_id} onValueChange={(v) => setForm((f) => ({ ...f, contact_list_id: v }))}>
                    <SelectTrigger><SelectValue placeholder={t('call_contact_list_placeholder')} /></SelectTrigger>
                    <SelectContent>
                      {contactLists.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.valid_rows ?? 0})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Alert className="py-2">
                <AlertCircle className="h-3.5 w-3.5" />
                <AlertDescription className="text-xs">{t('call_grounded_warning')}</AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('general_cancel')}</Button>
              <Button onClick={handleCreate} disabled={creating || !form.name.trim() || !form.call_script.trim()}>
                {creating && <Loader2 className="h-4 w-4 me-2 animate-spin" />}{t('general_create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!liveCampaign} onOpenChange={(open) => { if (!open) { setLiveCampaign(null); setExpandedSendId(null); } }}>
          <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                {liveCampaign?.name}
              </DialogTitle>
            </DialogHeader>

            <PhoneVisual send={activeCall} />

            <Alert className="py-2">
              <AlertCircle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs">{t('call_live_listen_note')}</AlertDescription>
            </Alert>

            <div className="space-y-2 mt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('call_recent_calls')}</p>
              {liveSends.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('call_no_calls_yet')}</p>
              ) : liveSends.map((s) => (
                <Card key={s.id} className="overflow-hidden">
                  <button
                    type="button"
                    className="w-full text-start p-3 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                    onClick={() => setExpandedSendId((id) => (id === s.id ? null : s.id))}
                  >
                    <div className={cn('h-8 w-8 rounded-full flex items-center justify-center shrink-0',
                      s.status === 'DIALING' ? 'bg-amber-500' : s.status === 'ANSWERED' ? 'bg-green-600' :
                      s.status === 'COMPLETED' ? 'bg-blue-600' : 'bg-red-600')}>
                      {s.status === 'FAILED' ? <XCircle className="h-4 w-4 text-white" /> : <Phone className="h-4 w-4 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm truncate">{s.recipient_phone ?? '—'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {s.duration_sec != null ? `${Math.floor(s.duration_sec / 60)}:${String(s.duration_sec % 60).padStart(2, '0')}` : '—'}
                        {s.provider === 'MOCK' ? ` · ${t('callcenter_mock_dot_suffix')}` : ''}
                        {s.error_message ? ` · ${s.error_message}` : ''}
                      </p>
                    </div>
                    <Badge className={cn('text-[10px] shrink-0', CALL_STATUS_STYLES[s.status] ?? '')} variant="outline">{s.status}</Badge>
                  </button>
                  {expandedSendId === s.id && (
                    <div className="border-t border-border p-3 space-y-2 bg-muted/20">
                      {s.recording_url && (
                        <div className="space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><Play className="h-3 w-3" />{t('call_recording')}</p>
                          <audio controls src={s.recording_url} className="w-full h-9" />
                        </div>
                      )}
                      {s.summary && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground">{t('call_summary')}</p>
                          <p className="text-xs">{s.summary}</p>
                        </div>
                      )}
                      {s.transcript && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground mb-1">{t('call_transcript')}</p>
                          <div className="rounded-lg bg-background border border-border p-2.5 max-h-48 overflow-y-auto">
                            <p className="text-xs whitespace-pre-wrap leading-relaxed">{s.transcript}</p>
                          </div>
                        </div>
                      )}
                      {!s.recording_url && !s.transcript && !s.summary && (
                        <p className="text-xs text-muted-foreground">{t('call_no_details_yet')}</p>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setLiveCampaign(null); setExpandedSendId(null); }}>{t('general_close')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppLayout>
    </RouteGuard>
  );
}
