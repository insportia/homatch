// META LEAD ADS TERMS — accepted by the OWNER, on META's own page.
//
// Meta asks each Facebook Page to accept its Lead Ads Terms once before lead
// forms can be used. HOMATCH never accepts, simulates, embeds or copies them:
// it opens Meta's official page (instantForms.LEAD_TERMS_URL) in a separate
// Meta window — facebook.com cannot be framed — and, when the owner comes
// back, asks META again (forms_recheck → status). Only Meta's answer changes
// the state; a window closing proves nothing.
//
// Meta's terms page sends HOMATCH nothing back, so no window message is listened
// to at all: there is nothing to trust or forge. The draft is saved on the
// server and the builder page never navigates away, so nothing is lost.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { LEAD_TERMS_URL, termsOutcome, type TermsOutcome } from '@/lib/metaAds/instantForms';
import { recheckLeadForms, type MetaStatus } from '@/services/metaAds';
import { selectedAsset } from './steps';

const TIMEOUT_MS = 10 * 60_000;
const FOCUS_RECHECK_GAP_MS = 5_000;

export function LeadTermsFlow({ status, onRechecked, checkOnly = false }: {
  status: MetaStatus | null;
  /** RECHECK: Meta has not confirmed yet — offer "check with Meta" only, not the terms window. */
  checkOnly?: boolean;
  /** Reload the server status (the one place the Leads state is decided). */
  onRechecked: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const page = selectedAsset(status, 'PAGE');
  const [outcome, setOutcome] = useState<TermsOutcome>('IDLE');
  const win = useRef<Window | null>(null);
  const pageAtOpen = useRef<string | null>(null);
  const startedAt = useRef(0);
  const lastCheck = useRef(0);
  const busy = useRef(false);

  const recheck = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    lastCheck.current = Date.now();
    const windowOpen = !!win.current && !win.current.closed;
    if (!windowOpen) setOutcome('CHECKING');
    try {
      const r = await recheckLeadForms();
      await onRechecked();
      const next = termsOutcome({ pageAtOpen: pageAtOpen.current, pageNow: r.pageId ?? null, terms: r.checked?.terms, windowOpen });
      setOutcome(next);
      if (next !== 'WAITING') { win.current = null; }
    } catch (e) {
      const code = String((e as { code?: string })?.code ?? (e as { body?: { code?: string } })?.body?.code ?? '');
      setOutcome(code === 'SESSION_EXPIRED' || code === 'NOT_CONNECTED' ? 'SESSION_EXPIRED' : 'META_ERROR');
    } finally { busy.current = false; }
  }, [onRechecked]);

  /* While Meta's window is open: notice it closing, and the owner coming back
     to this tab (phones open a new tab, not a popup). Ten minutes at most. */
  useEffect(() => {
    if (outcome !== 'WAITING') return;
    const tick = setInterval(() => {
      if (Date.now() - startedAt.current > TIMEOUT_MS) { win.current = null; setOutcome('TIMEOUT'); return; }
      if (win.current && win.current.closed) void recheck();
    }, 1000);
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > FOCUS_RECHECK_GAP_MS) void recheck();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(tick); window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [outcome, recheck]);

  if (!page) return null;
  const url = LEAD_TERMS_URL(page.external_id);

  const open = () => {
    pageAtOpen.current = page.external_id;
    startedAt.current = Date.now();
    lastCheck.current = Date.now();
    /* Opened blank first so the new window loses its opener (no access back
       to HOMATCH), then sent to Meta's own page. */
    const w = window.open('', 'homatch-meta-lead-terms', 'popup,width=680,height=820');
    if (!w) { setOutcome('POPUP_BLOCKED'); return; }
    try { w.opener = null; } catch { /* already isolated */ }
    w.location.href = url;
    win.current = w;
    setOutcome('WAITING');
  };

  const waiting = outcome === 'WAITING' || outcome === 'POPUP_BLOCKED';
  const message: Partial<Record<TermsOutcome, string>> = {
    WAITING: 'mm_l_waiting', NOT_ACCEPTED: 'mm_l_not_accepted', UNCONFIRMED: 'mm_l_unconfirmed', POPUP_BLOCKED: 'mm_l_popup_blocked',
    META_ERROR: 'mm_l_meta_error', SESSION_EXPIRED: 'mm_l_session_expired', PAGE_CHANGED: 'mm_l_page_changed', TIMEOUT: 'mm_l_timeout',
    ACCEPTED: 'mm_l_accepted',
  };
  const key = message[outcome];

  return (
    <div data-mm-terms-flow={outcome} className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {outcome === 'POPUP_BLOCKED' ? (
          /* A real link the owner taps: browsers allow it where a script popup was blocked. */
          <a href={url} target="_blank" rel="noopener noreferrer" data-mm-terms-open="link"
            onClick={() => { startedAt.current = Date.now(); setOutcome('WAITING'); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[hsl(var(--gold))] px-4 text-[13px] font-semibold text-[#161309] hover:bg-[hsl(var(--gold-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
            {t('mm_l_terms_cta')}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : outcome !== 'ACCEPTED' && !(checkOnly && outcome === 'IDLE') && (
          <button type="button" onClick={open} data-mm-terms-open="popup" disabled={outcome === 'CHECKING'}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[hsl(var(--gold))] px-4 text-[13px] font-semibold text-[#161309] hover:bg-[hsl(var(--gold-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:opacity-70">
            {t('mm_l_terms_cta')}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {(waiting || checkOnly || ['NOT_ACCEPTED', 'UNCONFIRMED', 'META_ERROR', 'TIMEOUT', 'PAGE_CHANGED', 'CHECKING'].includes(outcome)) && (
          <button type="button" onClick={() => void recheck()} data-mm-terms-recheck="" disabled={outcome === 'CHECKING'}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))] bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
            {outcome === 'CHECKING' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            {t('mm_l_recheck_cta')}
          </button>
        )}
      </div>
      {key && (
        <p role="status" aria-live="polite" data-mm-terms-outcome={outcome}
          className={cn('flex items-start gap-1.5 text-[13px] leading-relaxed', outcome === 'ACCEPTED' ? 'font-medium text-[hsl(152_54%_26%)]' : 'text-muted-foreground')}>
          {outcome === 'ACCEPTED' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}{t(key)}
        </p>
      )}
    </div>
  );
}
