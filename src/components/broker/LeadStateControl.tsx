// LEAD WORKFLOW on an opened contact: NEW → REVIEWED → CONTACTED →
// IN PROGRESS → WON / CLOSED. The state is the owner's own note on their
// own match; set_match_lead_state re-checks ownership, refuses a suspended
// account, and refuses the contact states unless the contact was opened.
// Reads its own row so the match list query does not change shape.

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import { brokerErrorKey } from '@/components/broker/errors';
import { BrokerRpcError, LEAD_STATES, LEAD_TRANSITIONS, setMatchLeadState, type LeadState } from '@/services/brokerDesk';

export function LeadStateControl({ matchId, initialState, onChanged }: {
  matchId: string;
  /** Already known (the pipeline board read it): no per-card query. */
  initialState?: LeadState;
  onChanged?: (next: LeadState) => void;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<LeadState | null>(initialState ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    void supabase.from('matches').select('lead_state').eq('id', matchId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!cancelled && !e && data) setState((data as { lead_state: LeadState }).lead_state);
      });
    return () => { cancelled = true; };
  }, [matchId, initialState]);

  if (!state) return null;

  const change = async (next: LeadState) => {
    const prev = state;
    setState(next);
    setSaving(true);
    setError(null);
    try {
      await setMatchLeadState(matchId, next);
      onChanged?.(next);
    } catch (e) {
      setState(prev);
      setError(t(brokerErrorKey(e instanceof BrokerRpcError ? e.code : 'UNKNOWN')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={`lead-${matchId}`} className="block text-2xs font-semibold text-foreground">{t('lead_state_label')}</label>
      <div className="flex items-center gap-2">
        <select
          id={`lead-${matchId}`}
          value={state}
          disabled={saving}
          onChange={(e) => void change(e.target.value as LeadState)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
        >
          {LEAD_STATES.map((s) => (
            <option key={s} value={s} disabled={s !== state && !LEAD_TRANSITIONS[state].includes(s)}>{t(`lead_state_${s}` as TranslationKey)}</option>
          ))}
        </select>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>
      {error && <p role="alert" className="text-2xs text-destructive">{error}</p>}
    </div>
  );
}
