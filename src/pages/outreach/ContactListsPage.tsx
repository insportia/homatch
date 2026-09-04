import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { parseCsv } from '@/lib/csv';

const IMPORT_ROW_CAP = 5000;

interface ImportPreview {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  missing_email: number;
  missing_phone: number;
}

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
      const { data, error } = await supabase.from('outreach_contact_lists')
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
      const { error } = await supabase.from('outreach_contact_lists').insert({
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
    const { error } = await supabase.from('outreach_contact_lists').delete().eq('id', id);
    if (error) toast.error(t('contacts_delete_error'));
    else { toast.success(t('contacts_deleted')); load(); }
  };

  const [exportingId, setExportingId] = useState<string | null>(null);

  // ── CSV import (Task #63) ──────────────────────────────────────
  // contact-import already existed as a real, working edge function but was
  // never wired to any UI — this page only ever created empty lists. XLSX
  // parsing needs a library (SheetJS) that this sandbox cannot install (npm
  // registry access is blocked entirely, confirmed by testing a fresh
  // `npm install papaparse` in an empty project), so only CSV is supported
  // here; the dialog says so explicitly rather than silently failing on an
  // XLSX upload.
  const [importList, setImportList] = useState<ContactList | null>(null);
  const [importStage, setImportStage] = useState<'pick' | 'parsing' | 'preview' | 'importing'>('pick');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importRowCapHit, setImportRowCapHit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetImportDialog = () => {
    setImportList(null);
    setImportStage('pick');
    setImportFile(null);
    setImportRows([]);
    setImportPreview(null);
    setImportRowCapHit(false);
  };

  const handleFileChosen = async (file: File) => {
    if (/\.xlsx?$/i.test(file.name) && !/\.csv$/i.test(file.name)) {
      toast.error(t('contacts_import_xlsx_unsupported'));
      return;
    }
    setImportFile(file);
    setImportStage('parsing');
    try {
      const text = await file.text();
      const { rows } = parseCsv(text, IMPORT_ROW_CAP + 1);
      if (rows.length === 0) {
        toast.error(t('contacts_import_empty_error'));
        setImportStage('pick');
        return;
      }
      const capHit = rows.length > IMPORT_ROW_CAP;
      const finalRows = capHit ? rows.slice(0, IMPORT_ROW_CAP) : rows;
      setImportRowCapHit(capHit);
      setImportRows(finalRows);

      if (!importList) return;
      const { data, error } = await supabase.functions.invoke('contact-import', {
        body: { list_id: importList.id, raw_rows: finalRows, preview_only: true },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      setImportPreview(data?.preview ?? null);
      setImportStage('preview');
    } catch (err) {
      console.error(err);
      toast.error(t('contacts_import_parse_error'));
      setImportStage('pick');
    }
  };

  const handleConfirmImport = async () => {
    if (!importList || importRows.length === 0) return;
    setImportStage('importing');
    try {
      const { data, error } = await supabase.functions.invoke('contact-import', {
        body: { list_id: importList.id, raw_rows: importRows, preview_only: false },
      });
      if (error) { const msg = await error?.context?.text(); throw new Error(msg ?? error.message); }
      toast.success(t('contacts_import_success', { count: data?.inserted ?? importRows.length }));
      resetImportDialog();
      load();
    } catch (err) {
      console.error(err);
      toast.error(t('contacts_import_error'));
      setImportStage('preview');
    }
  };

  const handleExport = async (list: ContactList) => {
    setExportingId(list.id);
    try {
      const columns = [
        'full_name', 'email', 'phone', 'company', 'country', 'city',
        'language', 'budget_min', 'budget_max', 'currency', 'lead_type',
        'tags', 'notes', 'email_valid', 'phone_valid', 'is_duplicate',
      ] as const;
      const { data, error } = await supabase.from('outreach_contacts')
        .select(columns.join(','))
        .eq('list_id', list.id)
        .order('created_at', { ascending: true })
        .limit(20000);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        toast.info(t('contacts_export_empty'));
        return;
      }
      const escape = (v: unknown) => {
        if (v == null) return '';
        const s = Array.isArray(v) ? v.join('; ') : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        columns.join(','),
        ...rows.map((r: Record<string, unknown>) => columns.map(c => escape(r[c])).join(',')),
      ].join('\n');
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${list.name.replace(/[^a-z0-9-_]+/gi, '_')}_contacts.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('contacts_export_success'));
    } catch (err) {
      toast.error(t('contacts_export_error'));
      console.error(err);
    } finally {
      setExportingId(null);
    }
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
                          {list.import_status === 'PENDING' && (
                            <Button variant="outline" size="sm" className="h-8 px-2.5 gap-1.5 text-xs"
                              onClick={() => setImportList(list)}>
                              <Upload className="h-3.5 w-3.5" />{t('contacts_import_button')}
                            </Button>
                          )}
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs"
                            disabled={exportingId === list.id}
                            onClick={() => handleExport(list)}>
                            {exportingId === list.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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

        {/* Import dialog (Task #63) */}
        <Dialog open={!!importList} onOpenChange={(open) => { if (!open) resetImportDialog(); }}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('contacts_import_dialog_title')}{importList ? `: ${importList.name}` : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Alert className="py-2">
                <AlertCircle className="h-3.5 w-3.5" />
                <AlertDescription className="text-xs">{t('contacts_import_xlsx_unsupported')}</AlertDescription>
              </Alert>

              {importStage === 'pick' && (
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); e.target.value = ''; }}
                  />
                  <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" />{t('contacts_import_pick_file')}
                  </Button>
                </div>
              )}

              {importStage === 'parsing' && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />{t('contacts_import_parsing')}
                </div>
              )}

              {importStage === 'preview' && importPreview && (
                <div className="space-y-3">
                  {importFile && <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 shrink-0" />{importFile.name}</p>}
                  {importRowCapHit && (
                    <Alert className="py-2">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <AlertDescription className="text-xs">{t('contacts_import_row_cap', { max: IMPORT_ROW_CAP })}</AlertDescription>
                    </Alert>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-border p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_total')}</p>
                      <p className="text-lg font-semibold">{importPreview.total}</p>
                    </div>
                    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_valid')}</p>
                      <p className="text-lg font-semibold text-green-700">{importPreview.valid}</p>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_invalid')}</p>
                      <p className="text-lg font-semibold">{importPreview.invalid}</p>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_dupes')}</p>
                      <p className="text-lg font-semibold">{importPreview.duplicates}</p>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_missing_email')}</p>
                      <p className="text-lg font-semibold">{importPreview.missing_email}</p>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                      <p className="text-muted-foreground">{t('contacts_import_preview_missing_phone')}</p>
                      <p className="text-lg font-semibold">{importPreview.missing_phone}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setImportStage('pick')}>
                    {t('contacts_import_choose_another')}
                  </Button>
                </div>
              )}

              {importStage === 'importing' && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />{t('contacts_import_importing')}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetImportDialog}>{t('general_cancel')}</Button>
              {importStage === 'preview' && (
                <Button onClick={handleConfirmImport}>{t('contacts_import_confirm')}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppLayout>
    </RouteGuard>
  );
}
