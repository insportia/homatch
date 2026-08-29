import React, { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Plus, AlertCircle, Loader2 } from 'lucide-react';
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
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { OutreachCampaign } from '@/types/types';
import { toast } from 'sonner';

export default function SmsCampaignsPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', sms_template: '', language: 'en' });

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('outreach_campaigns')
        .select('id,name,status,audience_count,sent_count,cost_estimate_usd,created_at,language,sms_template')
        .eq('owner_id', homatchUser.id).eq('campaign_type', 'SMS')
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      setCampaigns(Array.isArray(data) ? data as OutreachCampaign[] : []);
    } finally { setLoading(false); }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { error } = await supabase.functions.invoke('outreach-campaign-preview', {
        body: { campaign_type: 'SMS', name: form.name, sms_template: form.sms_template, language: form.language },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('sms_campaign_created'));
      setCreateOpen(false);
      setForm({ name: '', sms_template: '', language: 'en' });
      load();
    } catch (err) {
      toast.error(t('sms_campaign_create_error'));
    } finally { setCreating(false); }
  };

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                {t('sms_campaigns_title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('sms_campaigns_subtitle')}</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 me-2" />{t('sms_new_campaign')}
            </Button>
          </div>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('sms_sending_disabled')}</AlertDescription>
          </Alert>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('sms_empty_title')}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{t('sms_empty_desc')}</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 me-2" />{t('sms_new_campaign')}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <Card key={c.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <MessageSquare className="h-8 w-8 shrink-0 text-muted-foreground/50 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{c.name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5">{c.status}</Badge>
                        </div>
                        {c.sms_template && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.sms_template}</p>}
                        <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                          <span>{c.audience_count ?? 0} {t('sms_recipients')}</span>
                          <span>{c.sent_count ?? 0} {t('sms_sent')}</span>
                          {(c.cost_estimate_usd ?? 0) > 0 && <span>${c.cost_estimate_usd?.toFixed(2)}</span>}
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
            <DialogHeader><DialogTitle>{t('sms_new_campaign')}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{t('sms_campaign_name')}</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('sms_campaign_name_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('sms_template_label')}</Label>
                <Textarea rows={3} value={form.sms_template} onChange={(e) => setForm((f) => ({ ...f, sms_template: e.target.value }))} placeholder={t('sms_template_placeholder')} />
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
