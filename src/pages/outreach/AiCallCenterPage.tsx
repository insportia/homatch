import React, { useEffect, useState, useCallback } from 'react';
import { Phone, Plus, AlertCircle, Loader2, Mic } from 'lucide-react';
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
import { OutreachCampaign } from '@/types/types';
import { toast } from 'sonner';

const SUPPORTED_LANGS = [
  { code: 'en', label: 'English' }, { code: 'ka', label: 'ქართული' },
  { code: 'ru', label: 'Русский' }, { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' }, { code: 'he', label: 'עברית' },
];

export default function AiCallCenterPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', call_script: '', language: 'en',
    goal: '', guardrails: '', max_duration: '300',
  });

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select('id,name,status,audience_count,cost_estimate_usd,created_at,language,call_script,call_agent_config')
        .eq('owner_id', homatchUser.id).eq('campaign_type', 'AI_CALL')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setCampaigns(Array.isArray(data) ? data as OutreachCampaign[] : []);
    } finally { setLoading(false); }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

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
        },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('call_campaign_created'));
      setCreateOpen(false);
      setForm({ name: '', call_script: '', language: 'en', goal: '', guardrails: '', max_duration: '300' });
      load();
    } catch (err) {
      toast.error(t('call_campaign_create_error'));
    } finally { setCreating(false); }
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
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('call_calling_disabled')}</AlertDescription>
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
                          {(c.cost_estimate_usd ?? 0) > 0 && <span>${t('call_est')}: ${c.cost_estimate_usd?.toFixed(2)}</span>}
                        </div>
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
      </AppLayout>
    </RouteGuard>
  );
}
