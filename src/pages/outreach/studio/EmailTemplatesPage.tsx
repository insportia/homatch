// EMAIL STUDIO — Templates (/outreach/email/templates). Owner brief §7: the HOMATCH library
// (built-in, editable designer documents) and the owner's own saved templates — preview, use,
// duplicate, rename, delete, favourite. "Use" starts a new campaign from the template.

import { Copy, Eye, LayoutTemplate, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import { EmptyState, PageHeader } from '@/components/communications/primitives';
import { EmailPreviewFrame } from '@/components/emailStudio/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { builtInTemplate, TEMPLATE_KINDS, type TemplateKind, templateSubject } from '@/emailMarketing/designer/templates';
import { cn } from '@/lib/utils';
import { deleteTemplate, listTemplates, patchTemplate, saveCampaign, saveTemplate, type UserTemplate } from '@/services/emailCampaignStudio';

const LANGS = ['ka', 'en', 'ru'] as const;

export default function EmailTemplatesPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [mine, setMine] = useState<UserTemplate[] | null>(null);
  const [tplLang, setTplLang] = useState<string>(LANGS.includes(lang as typeof LANGS[number]) ? lang : 'en');
  const [preview, setPreview] = useState<{ title: string; doc: EmailDoc; subject: string; language: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { try { setMine(await listTemplates()); } catch { setMine([]); } }, []);
  useEffect(() => { void load(); }, [load]);

  const ordered = useMemo(() => (mine ?? []).filter((x) => x.kind !== 'SECTION').sort((a, b) => Number(b.favorite) - Number(a.favorite)), [mine]);
  const sections = useMemo(() => (mine ?? []).filter((x) => x.kind === 'SECTION'), [mine]);

  const startFromTemplate = async (doc: EmailDoc, subject: string, language: string, name: string) => {
    setBusy(name);
    try {
      const c = await saveCampaign(null, { name, language, subject, design: doc });
      navigate(`/outreach/email/campaigns/${c.id}?step=1`);
    } catch { toast.error(t('ems_err_save_failed')); } finally { setBusy(null); }
  };
  const duplicate = async (x: UserTemplate) => {
    try { const c = await saveTemplate({ name: `${x.name} (${t('ems_copy')})`.slice(0, 120), kind: x.kind, language: x.language, subject: x.subject, preview_text: x.preview_text, design: x.design }); setMine((m) => [c, ...(m ?? [])]); }
    catch { toast.error(t('ems_tpl_save_failed')); }
  };
  const rename = async (x: UserTemplate) => {
    const name = window.prompt(t('ems_tpl_name_prompt'), x.name);
    if (!name?.trim() || name.trim() === x.name) return;
    try { await patchTemplate(x.id, { name: name.trim().slice(0, 120) }); setMine((m) => (m ?? []).map((y) => (y.id === x.id ? { ...y, name: name.trim() } : y))); }
    catch { toast.error(t('ems_tpl_save_failed')); }
  };
  const favorite = async (x: UserTemplate) => {
    try { await patchTemplate(x.id, { favorite: !x.favorite }); setMine((m) => (m ?? []).map((y) => (y.id === x.id ? { ...y, favorite: !x.favorite } : y))); }
    catch { toast.error(t('ems_tpl_save_failed')); }
  };
  const remove = async (x: UserTemplate) => {
    if (!window.confirm(t('ems_tpl_delete_confirm', { name: x.name }))) return;
    try { await deleteTemplate(x.id); setMine((m) => (m ?? []).filter((y) => y.id !== x.id)); } catch { toast.error(t('ems_tpl_delete_failed')); }
  };

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={t('ems_nav_templates')} subtitle={t('ems_tpl_subtitle')}
        primary={{ label: t('ems_new_campaign'), onClick: () => navigate('/outreach/email/campaigns/new'), icon: Plus }} />
    }>
      <Section titleKey="ems_tpl_library" sub={t('ems_tpl_library_sub')}>
        <div className="mb-3 inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label={t('ems_f_language')}>
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={tplLang === l} onClick={() => setTplLang(l)}
              className={cn('h-7 rounded-md px-2.5 text-xs', tplLang === l ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>{t(`ems_lang_${l}`)}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATE_KINDS.map((k: TemplateKind) => {
            const doc = builtInTemplate(k, tplLang);
            const title = t(`ems_tpl_${k.toLowerCase()}`);
            return (
              <article key={k} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
                <div className="h-28 bg-[#EFEAE2] p-3">
                  <div className="h-full overflow-hidden rounded-lg bg-white shadow-sm">
                    <div className="h-6 bg-[#0C1119]" />
                    <div className="space-y-1.5 p-2.5"><div className="h-2 w-3/4 rounded bg-foreground/20" /><div className="h-1.5 w-full rounded bg-foreground/10" /><div className="h-1.5 w-5/6 rounded bg-foreground/10" /><div className="mt-2 h-3 w-16 rounded bg-[hsl(38_85%_55%)]" /></div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-3.5">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-0.5 flex-1 text-2xs leading-snug text-muted-foreground">{t(`ems_tpl_${k.toLowerCase()}_sub`)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setPreview({ title, doc, subject: templateSubject(k, tplLang), language: tplLang })}><Eye className="h-3.5 w-3.5" />{t('ems_preview')}</Button>
                    <Button size="sm" className="h-auto min-h-8 flex-1 whitespace-normal bg-[#0C1119] text-white hover:bg-[#1B2230]" disabled={busy === title}
                      onClick={() => void startFromTemplate(doc, templateSubject(k, tplLang), tplLang, title)}>
                      {busy === title ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{t('ems_tpl_use')}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      <Section titleKey="ems_tpl_mine_title">
        {mine === null ? <Skeleton className="h-24 w-full rounded-2xl" /> : ordered.length === 0 ? (
          <EmptyState icon={LayoutTemplate} titleKey="ems_tpl_mine_empty" bodyKey="ems_tpl_mine_empty_body" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {ordered.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <button type="button" aria-label={t(x.favorite ? 'ems_tpl_unfavorite' : 'ems_tpl_favorite')} aria-pressed={x.favorite} onClick={() => void favorite(x)}
                  className="shrink-0 text-muted-foreground hover:text-[hsl(38_85%_45%)]">
                  <Star className={cn('h-4 w-4', x.favorite && 'fill-[hsl(38_90%_55%)] text-[hsl(38_90%_45%)]')} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{x.name}</p>
                  <p className="text-2xs text-muted-foreground">{x.language ? t(`ems_lang_${x.language}`) : ''} · {new Date(x.updated_at).toLocaleDateString(lang)}</p>
                </div>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setPreview({ title: x.name, doc: x.design, subject: x.subject ?? x.name, language: x.language ?? 'en' })}>{t('ems_preview')}</Button>
                <Button size="sm" className="h-8 bg-[#0C1119] text-white hover:bg-[#1B2230]" disabled={busy === x.name}
                  onClick={() => void startFromTemplate(x.design, x.subject ?? '', x.language ?? 'en', x.name)}>{t('ems_tpl_use')}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t('ems_more_actions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void rename(x)}><Pencil className="me-2 h-4 w-4" />{t('ems_tpl_rename')}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void duplicate(x)}><Copy className="me-2 h-4 w-4" />{t('ems_duplicate')}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void remove(x)} className="text-red-700"><Trash2 className="me-2 h-4 w-4" />{t('ems_tpl_delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {sections.length ? (
        <Section titleKey="ems_d_sections">
          <ul className="flex flex-wrap gap-2">
            {sections.map((x) => (
              <li key={x.id} className="flex items-center gap-1.5 rounded-full border bg-card py-1 pe-1 ps-3 text-[13px]">
                {x.name}
                <button type="button" aria-label={t('ems_tpl_delete')} onClick={() => void remove(x)} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Dialog open={Boolean(preview)} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{preview?.title}</DialogTitle></DialogHeader>
          {preview ? (
            <EmailPreviewFrame subject={preview.subject} html={renderDesignBody(preview.doc).html} text={renderDesignBody(preview.doc).text} language={preview.language} />
          ) : null}
        </DialogContent>
      </Dialog>
    </CommsWorkspace>
  );
}
