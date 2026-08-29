import React, { useEffect, useState, useCallback } from 'react';
import { Mail, Plus, Play, Pause, Eye, AlertCircle, Loader2, BarChart2 } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { OutreachCampaign, OutreachCampaignStatus } from '@/types/types';
import { toast } from 'sonner';

const STATUS_STYLES: Record<OutreachCampaignStatus, string> = {
  DRAFT:     'bg-muted text-muted-foreground',
  READY:     'bg-blue-500/10 text-blue-700',
  SCHEDULED: 'bg-purple-500/10 text-purple-700',
  RUNNING:   'bg-green-500/10 text-green-700',
  PAUSED:    'bg-yellow-500/10 text-yellow-700',
  COMPLETED: 'bg-green-700/10 text-green-800',
  CANCELLED: 'bg-red-500/10 text-red-700',
};

export default function EmailCampaignsPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', text_body: '', language: 'en' });

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select('id,name,status,campaign_type,audience_count,sent_count,open_count,cost_estimate_usd,created_at,language,subject')
        .eq('owner_id', homatchUser.id)
        .eq('campaign_type', 'EMAIL')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setCampaigns(Array.isArray(data) ? data as OutreachCampaign[] : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('outreach-campaign-preview', {
        body: { campaign_type: 'EMAIL', name: form.name, subject: form.subject, text_body: form.text_body, language: form.language },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('email_campaign_created'));
      setCreateOpen(false);
      setForm({ name: '', subject: '', text_body: '', language: 'en' });
      load();
    } catch (err) {
      toast.error(t('email_campaign_create_error'));
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                {t('email_campaigns_title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('email_campaigns_subtitle')}</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 me-2" />{t('email_new_campaign')}
            </Button>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('email_sending_disabled')}</AlertDescription>
          </Alert>

          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Mail className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('email_empty_title')}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{t('email_empty_desc')}</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 me-2" />{t('email_new_campaign')}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <Card key={c.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Mail className="h-8 w-8 shrink-0 text-muted-foreground/50" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{c.name}</span>
                          <Badge className={`text-[10px] px-1.5 ${STATUS_STYLES[c.status]}`}>{c.status}</Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 uppercase">{c.language ?? 'en'}</Badge>
                        </div>
                        {c.subject && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.subject}</p>}
                        <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><BarChart2 className="h-3 w-3" />{c.audience_count ?? 0} {t('email_audience')}</span>
                          <span>{c.sent_count ?? 0} {t('email_sent')}</span>
                          <span>{c.open_count ?? 0} {t('email_opens')}</span>
                          {(c.cost_estimate_usd ?? 0) > 0 && <span>${c.cost_estimate_usd?.toFixed(2)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => toast.info('Preview coming soon')}><Eye className="h-3.5 w-3.5" /></Button>
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
            <DialogHeader><DialogTitle>{t('email_new_campaign')}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('email_campaign_name')}</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('email_campaign_name_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('email_subject')}</Label>
                <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder={t('email_subject_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('email_body')}</Label>
                <Textarea rows={4} value={form.text_body} onChange={(e) => setForm((f) => ({ ...f, text_body: e.target.value }))} placeholder={t('email_body_placeholder')} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('general_cancel')}</Button>
              <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
                {creating && <Loader2 className="h-4 w-4 me-2 animate-spin" />}{t('general_create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppLayout>
    </RouteGuard>
  );
}
