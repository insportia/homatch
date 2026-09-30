// Renaming a campaign in HOMATCH. The display name only: nothing is sent to
// Meta and nothing about delivery changes (the server action records the
// rename on the campaign's timeline, with before and after).
import React, { useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { renameCampaign } from '@/services/metaAds';
import type { T } from './shared';

export function CampaignNameButton({ t, onEdit }: { t: T; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} data-mm-rename=""
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/25 px-3 text-2xs font-semibold text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]">
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_name_edit')}
    </button>
  );
}

export function CampaignNameForm({ t, campaignId, current, onDone, onCancel }: {
  t: T; campaignId: string; current: string; onDone: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const clean = value.replace(/\s+/g, ' ').trim();
  const valid = clean.length >= 3 && clean.length <= 120;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await renameCampaign(campaignId, clean);
      onDone(r.name);
    } catch {
      toast.error(t('mm_c_name_failed'));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-4 shadow-card" data-mm-rename-form="">
      <label className="block text-[13px] font-semibold text-foreground" htmlFor="mm-c-name">{t('mm_c_name_label')}</label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id="mm-c-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus
          className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]" />
        <button type="submit" disabled={!valid || busy}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[hsl(var(--gold))] px-3.5 text-sm font-bold text-[#161309] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" aria-hidden="true" />}{t('mm_c_name_save')}
        </button>
        <button type="button" onClick={onCancel} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />{t('general_cancel')}
        </button>
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t('mm_c_name_note')}</p>
    </form>
  );
}
