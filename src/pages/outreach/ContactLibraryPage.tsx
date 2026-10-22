// THE UNLOCKED CONTACT LIBRARY — /outreach/library
//
// Every contact this account has legitimately obtained, in one place, with its
// provenance: contacts opened by an unlock, people found by the owner's own
// external campaigns, HOMATCH members whose demand fits a property, and contacts
// the owner imported. Read from my_contact_library (each branch under its own
// table's RLS) — nothing here unlocks or reveals anything new. Selected contacts
// go straight to Email Studio or the message assistant; nobody is copied by hand.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AtSign, BookUser, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { ContactPicker } from '@/components/communication/ContactPicker';
import { MessageAssistDialog } from '@/components/communication/MessageAssistDialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { type ContactKind, type LibraryContact, channelsOf, listLibraryContacts } from '@/services/contactLibrary';

export default function ContactLibraryPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<LibraryContact[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [messageTo, setMessageTo] = useState<LibraryContact[] | null>(null);

  const load = useCallback(async () => {
    setContacts(null);
    try { setContacts(await listLibraryContacts()); setFailed(false); } catch { setContacts([]); setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<ContactKind, number> = { OUTREACH_CONTACT: 0, UNLOCKED_MATCH: 0, CAMPAIGN_LEAD: 0, HOMATCH_MEMBER: 0 };
    (contacts ?? []).forEach((x) => { c[x.kind] += 1; });
    return c;
  }, [contacts]);
  const chosen = (contacts ?? []).filter((c) => selected.has(c.key));
  const emailable = chosen.filter((c) => channelsOf(c).includes('EMAIL'));

  return (
    <CommsWorkspace
      product="contacts"
      header={(
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold"><BookUser className="h-5 w-5 text-gold-ink" aria-hidden="true" />{t('cl_title')}</h1>
            <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{t('cl_subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{t('cl_refresh')}</Button>
            <Button size="sm" asChild><Link to="/outreach/email/studio"><AtSign className="me-2 h-4 w-4" aria-hidden="true" />{t('es_title')}</Link></Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4 pb-24">
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(Object.keys(counts) as ContactKind[]).map((k) => (
            <div key={k} className="min-w-0 rounded-xl border bg-card p-3">
              <dd className="text-2xl font-semibold tabular-nums">{contacts ? counts[k] : '—'}</dd>
              <dt className="text-2xs leading-snug text-muted-foreground break-words">{t(`cl_kind_${k.toLowerCase()}`)}</dt>
            </div>
          ))}
        </dl>

        {contacts === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('cw_loading')}</div>
        ) : failed ? (
          <p className="rounded-xl border bg-card p-4 text-sm" role="alert">{t('cl_load_failed')}</p>
        ) : (
          <div className="rounded-2xl border bg-card p-3 sm:p-4">
            <ContactPicker contacts={contacts} selected={selected} onChange={setSelected} />
          </div>
        )}
        <p className="text-2xs leading-relaxed text-muted-foreground">{t('cl_privacy_note')}</p>
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label={t('cw_selection_bar')}
          className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-2 rounded-2xl bg-[hsl(218_52%_11%)] px-4 py-3 text-white shadow-xl md:bottom-5">
          <span className="text-sm font-semibold">{t('cw_selected_n', { n: String(selected.size) })}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMessageTo(chosen)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold ring-1 ring-inset ring-white/25 hover:bg-white/15">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" />{t('cw_prepare_message')}
            </button>
            <button type="button" disabled={!emailable.length}
              onClick={() => navigate('/outreach/email/studio', { state: { recipients: emailable.map((c) => c.key) } })}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[hsl(40_94%_60%)] px-3 text-sm font-semibold text-[hsl(218_52%_11%)] disabled:opacity-50"
              title={emailable.length ? undefined : t('cl_needs_email')}>
              <AtSign className="h-4 w-4" aria-hidden="true" />{t('cl_compose_email', { n: String(emailable.length) })}
            </button>
          </div>
        </div>
      )}
      {messageTo && <MessageAssistDialog open recipients={messageTo} onClose={() => setMessageTo(null)} />}
    </CommsWorkspace>
  );
}
