import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Upload, GripVertical, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Eyebrow, GoldRule,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { SETTINGS_TABS } from './DeveloperSettingsPage';
import {
  listTemplates, saveTemplate, deleteTemplate, LEDGER_FIELDS,
  DEFAULT_LEDGER_COLUMNS, suggestFieldForHeader, type ExportTemplate,
} from '@/services/developer/exports';
import { readFile } from '@/lib/comm/importFile';
import { DevError } from '@/services/developer/client';

/**
 * A DEVELOPER'S OWN SALES FILE FORMAT (§42).
 *
 * The point is that the export comes out looking like the spreadsheet their
 * management already reads — same column names, same order, same language.
 *
 * WHAT IS TAKEN FROM AN UPLOADED WORKBOOK, EXACTLY: the text of the first
 * row, and the order it is in. That is all. No formula is read, no macro is
 * executed, nothing is stored from the file, and the file itself is discarded
 * the moment its header row has been turned into a list of strings. A custom
 * template in this product is a MAPPING of their words onto our fields, never
 * a copy of their document.
 */
export default function DeveloperExportTemplatesPage() {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();

  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExportTemplate | 'NEW' | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listTemplates(workspace.id, 'SALES_LEDGER'));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  return (
    <DeveloperShell
      title={t('dev_nav_settings')}
      description={t('dev_templates_subtitle')}
      tabs={<SubNav items={SETTINGS_TABS} />}
      actions={(
        <Button onClick={() => setEditing('NEW')}>
          <Plus className="mr-2 h-4 w-4" />
          {t('dev_template_new')}
        </Button>
      )}
    >
      {loading && <LoadingRows rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && templates.length === 0 && !editing && (
        <Panel>
          <EmptyState
            icon={<Upload className="h-7 w-7" />}
            title={t('dev_templates_empty_title')}
            description={t('dev_templates_empty_body')}
            action={<Button onClick={() => setEditing('NEW')}>{t('dev_template_new')}</Button>}
          />
        </Panel>
      )}

      {!loading && !error && templates.length > 0 && (
        <div className="mb-6 space-y-2">
          {templates.map((template) => (
            <Panel key={template.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{template.name}</p>
                <p className="truncate text-2xs text-muted-foreground">
                  {template.columns.map((c) => c.header).join(' · ')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(template)}>
                {t('dev_edit')}
              </Button>
              <Button
                size="icon" variant="ghost" aria-label={t('dev_remove')}
                onClick={async () => {
                  try {
                    await deleteTemplate(template.id);
                    toast.success(t('dev_template_deleted'));
                    await load();
                  } catch (e) {
                    toast.error(t(e instanceof DevError ? e.key : 'dev_err_generic'));
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Panel>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing === 'NEW' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

interface DraftColumn { header: string; field: string }

function TemplateEditor({
  template, onCancel, onSaved,
}: { template: ExportTemplate | null; onCancel: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [name, setName] = useState(template?.name ?? '');
  const [columns, setColumns] = useState<DraftColumn[]>(
    template?.columns.map((c) => ({ header: c.header, field: c.field }))
      ?? DEFAULT_LEDGER_COLUMNS.slice(0, 12).map((c) => ({ header: c.header, field: c.field })),
  );
  const [saving, setSaving] = useState(false);

  /*
   * Only the header row is taken, and it is taken by the same reader the
   * inventory import uses (§187) — so a semicolon-delimited CSV or a sheet
   * saved by an older Excel behaves here exactly as it does there.
   */
  const readTemplateFile = async (file: File) => {
    const sheet = await readFile(file);
    if (sheet.error === 'XLS_LEGACY') { toast.error(t('dev_imp_err_xls')); return; }
    if (sheet.error || sheet.headers.length === 0) { toast.error(t('dev_imp_err_empty')); return; }

    const headerRow = sheet.headers.filter(Boolean);
    // Their words, our fields — suggested, and confirmed below by a person.
    setColumns(headerRow.map((header) => ({
      header,
      field: suggestFieldForHeader(header)
        ?? LEDGER_FIELDS.find((f) => f.label.toLowerCase() === header.toLowerCase())?.field
        ?? '',
    })));
    if (!name) setName(file.name.replace(/.[^.]+$/, ''));
    toast.success(t('dev_template_read').replace('{n}', String(headerRow.length)));
  };

  const move = (index: number, delta: number) => {
    setColumns((cols) => {
      const next = [...cols];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cols;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    if (!workspace || !name.trim()) return;
    const usable = columns.filter((c) => c.field && c.header.trim());
    if (usable.length === 0) { toast.error(t('dev_template_need_columns')); return; }
    setSaving(true);
    try {
      await saveTemplate(workspace.id, {
        id: template?.id,
        name: name.trim(),
        kind: 'SALES_LEDGER',
        columns: usable.map((c) => ({
          header: c.header.trim(),
          field: c.field,
          format: LEDGER_FIELDS.find((f) => f.field === c.field)?.format ?? 'text',
        })),
      });
      toast.success(t('dev_saved'));
      onSaved();
    } catch (e) {
      toast.error(t(e instanceof DevError ? e.key : 'dev_err_generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title={template ? t('dev_template_edit') : t('dev_template_new')}
        description={t('dev_template_hint')}
      />
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr,auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dev-tpl-name">{t('dev_template_name')}</Label>
            <Input id="dev-tpl-name" value={name} onChange={(e) => setName(e.target.value)}
              maxLength={80} placeholder={t('dev_template_name_placeholder')} />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-gold-border/70 focus-within:ring-2 focus-within:ring-ring">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('dev_template_upload')}
            <input
              type="file" className="sr-only" accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readTemplateFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="text-2xs text-muted-foreground">{t('dev_template_upload_note')}</p>

        <section className="space-y-2">
          <div>
            <Eyebrow>{t('dev_template_columns')}</Eyebrow>
            <GoldRule className="mt-2" />
          </div>

          <ul className="space-y-1.5">
            {columns.map((column, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="flex flex-col">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                    aria-label={t('dev_move_up')}
                    className="px-1 text-muted-foreground disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => move(index, 1)}
                    disabled={index === columns.length - 1} aria-label={t('dev_move_down')}
                    className="px-1 text-muted-foreground disabled:opacity-30">▼</button>
                </span>
                <Input
                  value={column.header}
                  onChange={(e) => setColumns((cols) =>
                    cols.map((c, i) => (i === index ? { ...c, header: e.target.value } : c)))}
                  aria-label={t('dev_template_header')}
                  className="min-w-0 flex-1"
                  maxLength={60}
                />
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Select
                  value={column.field || 'NONE'}
                  onValueChange={(v) => setColumns((cols) =>
                    cols.map((c, i) => (i === index ? { ...c, field: v === 'NONE' ? '' : v } : c)))}
                >
                  <SelectTrigger className="w-[13rem] shrink-0" aria-label={t('dev_template_field')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t('dev_imp_ignore')}</SelectItem>
                    {LEDGER_FIELDS.map((f) => (
                      <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon" variant="ghost" aria-label={t('dev_remove')}
                  onClick={() => setColumns((cols) => cols.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>

          <Button size="sm" variant="outline"
            onClick={() => setColumns((cols) => [...cols, { header: '', field: '' }])}>
            <Plus className="mr-2 h-4 w-4" />
            {t('dev_template_add_column')}
          </Button>
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{t('dev_cancel')}</Button>
          <Button disabled={saving || !name.trim()} onClick={save}>
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
