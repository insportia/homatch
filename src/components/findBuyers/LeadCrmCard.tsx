// The lead's way into the CRM: save it as a prospect, or open the contact it already is.
// Saving keeps the source and match reasoning; it adds no address and records no consent.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Contact, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { FindBuyersCrmError, crmLadder, leadCrmContacts, saveLeadToCrm, type CrmLadderStep } from '@/services/findBuyersCrm';

const STEPS: CrmLadderStep[] = ['DISCOVERED', 'QUALIFIED', 'CONTACTABLE', 'EMAIL_ELIGIBLE'];

export function CrmLadder({ reached }: { reached: CrmLadderStep[] }) {
  const { t } = useLanguage();
  return (
    <ol className="flex flex-wrap gap-1.5" data-testid="crm-ladder">
      {STEPS.map((s) => {
        const on = reached.includes(s);
        return (
          <li key={s} data-step={s} data-reached={on ? 'true' : 'false'}
            className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ring-inset',
              on ? 'bg-[hsl(152_55%_94%)] text-[hsl(152_60%_24%)] ring-[hsl(152_45%_75%)]' : 'bg-white text-muted-foreground ring-border')}>
            {on ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
            {t(`fbcrm_step_${s}`)}
          </li>
        );
      })}
    </ol>
  );
}

export function LeadCrmCard({ leadId, matchCategory, saveable, className }: {
  leadId: string; matchCategory: string | null; saveable: boolean; className?: string;
}) {
  const { t } = useLanguage();
  const [contactId, setContactId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void leadCrmContacts([leadId]).then((m) => { if (alive) setContactId(m[leadId] ?? null); });
    return () => { alive = false; };
  }, [leadId]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveLeadToCrm(leadId);
      setContactId(r.contactId);
      toast.success(t(r.created ? 'fbcrm_saved' : 'fbcrm_already_saved'));
    } catch (e) {
      const code = e instanceof FindBuyersCrmError ? e.code : '';
      toast.error(t(code === 'NOT_A_SEEKER' ? 'fbcrm_err_not_seeker' : code === 'LEAD_REJECTED' ? 'fbcrm_err_rejected' : 'fbcrm_err_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={className} data-testid="fbld-crm">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Contact className="h-4 w-4 text-[hsl(34_90%_40%)]" aria-hidden="true" />{t('fbcrm_title')}</h2>
      <div className="mt-3"><CrmLadder reached={crmLadder({ matchCategory })} /></div>
      <p className="mt-3 flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('fbcrm_consent_note')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {contactId ? (
          <Link to={`/outreach/contacts/${contactId}`} data-testid="fbld-crm-open"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white hover:bg-[#1a2230]">
            <Check className="h-4 w-4 text-[hsl(40_94%_60%)]" aria-hidden="true" />{t('fbcrm_open_contact')}
          </Link>
        ) : contactId === null && saveable ? (
          <button type="button" onClick={() => void save()} disabled={busy} data-testid="fbld-crm-save"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[hsl(38_92%_54%)] px-4 text-sm font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Contact className="h-4 w-4" aria-hidden="true" />}
            {t('fbcrm_save')}
          </button>
        ) : contactId === null ? (
          <p className="text-2xs text-muted-foreground">{t('fbcrm_not_saveable')}</p>
        ) : null}
      </div>
    </section>
  );
}
