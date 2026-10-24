// EMAIL STUDIO — add or edit one lead (UX pass §3). First name, last name and email are required;
// everything else is optional. The address is validated as it is typed and checked against the
// owner's existing leads, so the same person is never added twice. Adding a lead does NOT opt it
// in: the consent section records consent only with a stated lawful basis and the owner's own
// confirmation, on the server (my_outreach_contact_set_email_consent).

import { AlertTriangle, BadgeCheck, CircleSlash, Loader2, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  createLead, createList, findByEmail, isValidEmail, type Lead, type LeadInput, LeadsError, leadStatus, recordConsent, updateLead, withdrawConsent,
} from '@/services/emailLeads';
import type { LawfulBasis } from '@/services/emailMarketing';

const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const BASES: LawfulBasis[] = ['CONSENT', 'CONTRACT', 'LEGITIMATE_INTEREST_EXISTING_CUSTOMER'];
const NEW_LIST = '__new__';

export function LeadStatusChip({ lead, className }: { lead: Pick<Lead, 'email' | 'email_valid' | 'unsubscribed' | 'suppressed' | 'do_not_contact' | 'consent_status'>; className?: string }) {
  const { t } = useLanguage();
  const s = leadStatus(lead);
  const tone = { CAN_RECEIVE: 'bg-emerald-100 text-emerald-900', CONSENT_MISSING: 'bg-amber-100 text-amber-900', UNSUBSCRIBED: 'bg-slate-200 text-slate-800', SUPPRESSED: 'bg-red-100 text-red-900', NO_EMAIL: 'bg-slate-100 text-slate-700' }[s];
  return <span className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold', tone, className)}>{t(`ems_lead_st_${s.toLowerCase()}`)}</span>;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead?: Lead | null;
  lists: Array<{ id: string; name: string }>;
  defaultListId?: string | null;
  onSaved: (lead: Lead) => void;
  onListCreated?: (l: { id: string; name: string }) => void;
}

export function LeadDialog({ open, onOpenChange, lead, lists, defaultListId, onSaved, onListCreated }: Props) {
  const { t } = useLanguage();
  const editing = Boolean(lead);
  const [f, setF] = useState<LeadInput>({ first_name: '', last_name: '', email: '' });
  const [tagText, setTagText] = useState('');
  const [custom, setCustom] = useState<Array<{ k: string; v: string }>>([]);
  const [listChoice, setListChoice] = useState<string>('');
  const [newListName, setNewListName] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [dupe, setDupe] = useState<{ id: string; full_name: string | null } | null>(null);
  const [basis, setBasis] = useState<LawfulBasis | ''>('');
  const [attest, setAttest] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [current, setCurrent] = useState<Lead | null>(lead ?? null);

  useEffect(() => {
    if (!open) return;
    setCurrent(lead ?? null);
    const first = lead?.first_name ?? (lead?.full_name ?? '').split(/\s+/)[0] ?? '';
    const last = lead?.last_name ?? (lead?.full_name ?? '').split(/\s+/).slice(1).join(' ');
    setF({
      first_name: first, last_name: last, email: lead?.email ?? '', phone: lead?.phone ?? '', company: lead?.company ?? '', country: lead?.country ?? '',
      language: lead?.language ?? '', source: lead?.source_platform ?? '', notes: lead?.notes ?? '',
    });
    setTagText((lead?.tags ?? []).join(', '));
    setCustom(Object.entries(lead?.custom_fields ?? {}).map(([k, v]) => ({ k, v: String(v) })));
    setListChoice(lead?.list_id ?? defaultListId ?? '');
    setNewListName(''); setTouched({}); setDupe(null); setBasis(''); setAttest(false);
  }, [open, lead, defaultListId]);

  const emailOk = isValidEmail(f.email);
  useEffect(() => {
    if (!open || !emailOk) { setDupe(null); return; }
    const h = window.setTimeout(() => { void findByEmail(f.email, lead?.id).then(setDupe).catch(() => setDupe(null)); }, 400);
    return () => window.clearTimeout(h);
  }, [f.email, emailOk, open, lead?.id]);

  const errors = useMemo(() => ({
    first_name: !f.first_name.trim() ? t('ems_lead_err_required') : null,
    last_name: !f.last_name.trim() ? t('ems_lead_err_required') : null,
    email: !f.email.trim() ? t('ems_lead_err_required') : !emailOk ? t('ems_lead_err_email') : dupe ? t('ems_lead_err_duplicate', { name: dupe.full_name || f.email }) : null,
  }), [f, emailOk, dupe, t]);
  const valid = !errors.first_name && !errors.last_name && !errors.email && (listChoice !== NEW_LIST || newListName.trim());

  const set = (p: Partial<LeadInput>) => setF((x) => ({ ...x, ...p }));

  const save = async () => {
    setTouched({ first_name: true, last_name: true, email: true });
    if (!valid) return;
    setSaving(true);
    try {
      let listId = listChoice && listChoice !== NEW_LIST ? listChoice : null;
      if (listChoice === NEW_LIST) {
        const l = await createList(newListName);
        onListCreated?.(l);
        listId = l.id;
      }
      const input: LeadInput = {
        ...f, listId, tags: tagText.split(/[,;]+/).map((x) => x.trim()).filter(Boolean),
        custom_fields: Object.fromEntries(custom.filter((c) => c.k.trim() && c.v.trim()).map((c) => [c.k.trim(), c.v.trim()])),
      };
      const saved = editing && lead ? await updateLead(lead.id, input) : await createLead(input);
      toast.success(editing ? t('ems_lead_updated') : t('ems_lead_added'));
      onSaved(saved);
      if (!editing) onOpenChange(false);
      else setCurrent(saved);
    } catch (e) {
      const code = e instanceof LeadsError ? e.code : 'SAVE_FAILED';
      toast.error(t(`ems_lead_err_${code.toLowerCase()}`) === `ems_lead_err_${code.toLowerCase()}` ? t('ems_lead_err_save_failed') : t(`ems_lead_err_${code.toLowerCase()}`));
    } finally { setSaving(false); }
  };

  const consent = async (grant: boolean) => {
    if (!current) return;
    setConsentBusy(true);
    try {
      if (grant) {
        if (!basis || !attest) return;
        const r = await recordConsent([current.id], basis);
        if (r.failed.length) throw new LeadsError(r.failed[0].code);
        toast.success(t('ems_lead_consent_recorded'));
        setCurrent({ ...current, consent_status: 'CONSENTED', consent_lawful_basis: basis, consent_recorded_at: new Date().toISOString() });
      } else {
        await withdrawConsent([current.id]);
        toast.success(t('ems_lead_consent_withdrawn'));
        setCurrent({ ...current, consent_status: 'UNKNOWN', consent_lawful_basis: null });
      }
    } catch (e) {
      const code = e instanceof LeadsError ? e.code.toLowerCase() : 'failed';
      toast.error(t(`ems_consent_err_${code}`) === `ems_consent_err_${code}` ? t('ems_lead_consent_failed') : t(`ems_consent_err_${code}`));
    } finally { setConsentBusy(false); }
  };

  const Err = ({ k }: { k: 'first_name' | 'last_name' | 'email' }) => (touched[k] && errors[k] ? <p className="text-2xs text-red-700" role="alert">{errors[k]}</p> : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-[hsl(32_60%_38%)]" aria-hidden="true" />{editing ? t('ems_lead_edit') : t('ems_lead_add')}</DialogTitle>
          <DialogDescription>{editing ? t('ems_lead_edit_sub') : t('ems_lead_add_sub')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="lead-first" className="text-[13px]">{t('ems_lead_first')} <span className="text-red-700">*</span></Label>
            <Input id="lead-first" value={f.first_name} maxLength={80} autoFocus onChange={(e) => set({ first_name: e.target.value })} onBlur={() => setTouched((x) => ({ ...x, first_name: true }))} aria-invalid={Boolean(touched.first_name && errors.first_name)} />
            <Err k="first_name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-last" className="text-[13px]">{t('ems_lead_last')} <span className="text-red-700">*</span></Label>
            <Input id="lead-last" value={f.last_name} maxLength={80} onChange={(e) => set({ last_name: e.target.value })} onBlur={() => setTouched((x) => ({ ...x, last_name: true }))} aria-invalid={Boolean(touched.last_name && errors.last_name)} />
            <Err k="last_name" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="lead-email" className="text-[13px]">{t('ems_lead_email')} <span className="text-red-700">*</span></Label>
            <Input id="lead-email" type="email" dir="ltr" value={f.email} maxLength={254} onChange={(e) => set({ email: e.target.value })} onBlur={() => setTouched((x) => ({ ...x, email: true }))} aria-invalid={Boolean(touched.email && errors.email)} />
            <Err k="email" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-phone" className="text-[13px]">{t('ems_lead_phone')}</Label>
            <Input id="lead-phone" type="tel" dir="ltr" value={f.phone ?? ''} maxLength={40} onChange={(e) => set({ phone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-company" className="text-[13px]">{t('ems_lead_company')}</Label>
            <Input id="lead-company" value={f.company ?? ''} maxLength={160} onChange={(e) => set({ company: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-country" className="text-[13px]">{t('ems_lead_country')}</Label>
            <Input id="lead-country" dir="ltr" value={f.country ?? ''} maxLength={2} placeholder={t('ems_lead_country_ph')} onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px]">{t('ems_lead_language')}</Label>
            <Select value={f.language || '__none'} onValueChange={(v) => set({ language: v === '__none' ? '' : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{t('ems_lead_not_set')}</SelectItem>
                {LANGS.map((l) => <SelectItem key={l} value={l}>{t(`ems_lang_${l}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-source" className="text-[13px]">{t('ems_lead_source')}</Label>
            <Input id="lead-source" value={f.source ?? ''} maxLength={80} placeholder={t('ems_lead_source_ph')} onChange={(e) => set({ source: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-tags" className="text-[13px]">{t('ems_lead_tags')}</Label>
            <Input id="lead-tags" value={tagText} maxLength={400} placeholder={t('ems_lead_tags_ph')} onChange={(e) => setTagText(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[13px]">{t('ems_lead_list')}</Label>
            <Select value={listChoice || '__manual'} onValueChange={(v) => setListChoice(v === '__manual' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__manual">{t('ems_lead_list_manual')}</SelectItem>
                {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                <SelectItem value={NEW_LIST}>{t('ems_lead_list_new')}</SelectItem>
              </SelectContent>
            </Select>
            {listChoice === NEW_LIST ? <Input className="mt-1.5" value={newListName} maxLength={120} placeholder={t('ems_lead_list_new_ph')} onChange={(e) => setNewListName(e.target.value)} aria-label={t('ems_lead_list_new')} /> : null}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="lead-notes" className="text-[13px]">{t('ems_lead_notes')}</Label>
            <Textarea id="lead-notes" rows={2} value={f.notes ?? ''} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-[13px] font-medium">{t('ems_lead_custom')}</p>
            {custom.map((c, i) => (
              <div key={i} className="flex gap-1.5">
                <Input value={c.k} maxLength={40} placeholder={t('ems_lead_custom_key')} className="h-9" onChange={(e) => setCustom((cs) => cs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} aria-label={t('ems_lead_custom_key')} />
                <Input value={c.v} maxLength={300} placeholder={t('ems_lead_custom_value')} className="h-9" onChange={(e) => setCustom((cs) => cs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} aria-label={t('ems_lead_custom_value')} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={t('ems_d_delete')} onClick={() => setCustom((cs) => cs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {custom.length < 20 ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setCustom((cs) => [...cs, { k: '', v: '' }])}><Plus className="h-3.5 w-3.5" />{t('ems_lead_custom_add')}</Button> : null}
          </div>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-[hsl(32_60%_38%)]" aria-hidden="true" />{t('ems_lead_consent_title')}</p>
          {current ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <LeadStatusChip lead={current} />
                <span className="text-2xs text-muted-foreground">
                  {current.consent_status === 'CONSENTED'
                    ? t('ems_lead_consent_basis', { basis: t(`ems_basis_${(current.consent_lawful_basis ?? 'CONSENT').toLowerCase()}`), when: current.consent_recorded_at ? new Date(current.consent_recorded_at).toLocaleDateString() : '—' })
                    : t('ems_lead_consent_none')}
                </span>
              </div>
              <p className="text-2xs text-muted-foreground">{t('ems_lead_source_line', { source: t(`ems_src_${(current.source_kind ?? 'import').toLowerCase()}`), detail: current.source_platform ?? '—' })}</p>
              {current.consent_status === 'CONSENTED' ? (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={consentBusy} onClick={() => void consent(false)}><CircleSlash className="h-3.5 w-3.5" />{t('ems_lead_consent_withdraw')}</Button>
              ) : !current.unsubscribed && !current.suppressed ? (
                <div className="space-y-2">
                  <Select value={basis} onValueChange={(v) => setBasis(v as LawfulBasis)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder={t('ems_lead_basis_pick')} /></SelectTrigger>
                    <SelectContent>{BASES.map((b) => <SelectItem key={b} value={b}>{t(`ems_basis_${b.toLowerCase()}`)}</SelectItem>)}</SelectContent>
                  </Select>
                  <label className="flex items-start gap-2 text-2xs leading-snug">
                    <Checkbox checked={attest} onCheckedChange={(v) => setAttest(v === true)} className="min-h-0 mt-0.5" />
                    <span>{t('ems_lead_consent_attest')}</span>
                  </label>
                  <Button type="button" size="sm" className="h-8 gap-1.5" disabled={!basis || !attest || consentBusy} onClick={() => void consent(true)}>
                    {consentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}{t('ems_lead_consent_record')}
                  </Button>
                </div>
              ) : <p className="text-2xs text-muted-foreground">{t('ems_lead_consent_blocked')}</p>}
            </div>
          ) : (
            <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-snug text-muted-foreground"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />{t('ems_lead_consent_new')}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{editing ? t('ems_close') : t('ems_cancel')}</Button>
          <Button className="gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{editing ? t('ems_lead_save') : t('ems_lead_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
