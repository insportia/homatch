import React, { useEffect, useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Users, Download, Trash2, Plus, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { ContactList, ContactListStatus } from '@/types/types';
import { toast } from 'sonner';

const STATUS_BADGE: Record<ContactListStatus, { label: string; class: string }> = {
  PENDING:   { label: 'Pending',   class: 'bg-muted text-muted-foreground' },
  ANALYZING: { label: 'Analyzing', class: 'bg-yellow-500/10 text-yellow-700' },
  READY:     { label: 'Ready',     class: 'bg-green-500/10 text-green-700' },
  FAILED:    { label: 'Failed',    class: 'bg-red-500/10 text-red-700' },
  ARCHIVED:  { label: 'Archived',  class: 'bg-muted text-muted-foreground' },
};

export default function ContactListsPage() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('contact_lists')
        .select('id,name,description,import_status,total_rows,valid_rows,invalid_rows,duplicate_rows,missing_email,missing_phone,source_format,created_at,updated_at')
        .eq('owner_id', homatchUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setLists(Array.isArray(data) ? data as ContactList[] : []);
    } catch (err) {
      toast.error(t('contacts_load_error'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [homatchUser, t]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim() || !homatchUser) return;
    setCreating(true);
    try {
      const { error } = await supabase.from('contact_lists').insert({
        owner_id: homatchUser.id,
        name: newName.trim(),
        description: newDesc.trim() || null,
        import_status: 'PENDING',
      });
      if (error) throw error;
      toast.success(t('contacts_list_created'));
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      load();
    } catch (err) {
      toast.error(t('contacts_create_error'));
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('contacts_delete_confirm'))) return;
    const { error } = await supabase.from('contact_lists').delete().eq('id', id);
    if (error) toast.error(t('contacts_delete_error'));
    else { toast.success(t('contacts_deleted')); load(); }
  };

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {t('contacts_title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('contacts_subtitle')}</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 me-2" />
              {t('contacts_new_list')}
            </Button>
          </div>

          <Alert>
            <Upload className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('contacts_upload_hint')}</AlertDescription>
          </Alert>

          {/* Lists */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-80" /></CardContent></Card>
              ))}
            </div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">{t('contacts_empty_title')}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{t('contacts_empty_desc')}</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 me-2" />{t('contacts_new_list')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {lists.map((list) => {
                const sb = STATUS_BADGE[list.import_status] ?? STATUS_BADGE.PENDING;
                return (
                  <Card key={list.id} className="hover:border-primary/30 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <FileText className="h-8 w-8 text-muted-foreground/50 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{list.name}</span>
                            <Badge className={`text-[10px] px-1.5 ${sb.class}`}>{sb.label}</Badge>
                            {list.source_format && <Badge variant="outline" className="text-[10px] px-1.5">{list.source_format}</Badge>}
                          </div>
                          {list.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{list.description}</p>}
                          {(list.total_rows ?? 0) > 0 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-600" />{list.valid_rows ?? 0} {t('contacts_valid')}</span>
                              {(list.invalid_rows ?? 0) > 0 && <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3" />{list.invalid_rows} {t('contacts_invalid')}</span>}
                              {(list.duplicate_rows ?? 0) > 0 && <span>{list.duplicate_rows} {t('contacts_dupes')}</span>}
                              <span>{t('contacts_total')}: {list.total_rows ?? 0}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs"
                            onClick={() => toast.info('Export coming soon')}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleDelete(list.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Create dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('contacts_new_list')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="list-name">{t('contacts_list_name')}</Label>
                <Input id="list-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('contacts_list_name_placeholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="list-desc">{t('contacts_list_desc')}</Label>
                <Input id="list-desc" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder={t('contacts_list_desc_placeholder')} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('general_cancel')}</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                {t('general_create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppLayout>
    </RouteGuard>
  );
}
