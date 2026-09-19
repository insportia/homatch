// HOMATCH HOME FINANCING — the two sections with no arithmetic in them.
//
// WHAT TO CHECK IN THE CONTRACT keeps the four-part shape: what it
// means, why it matters, what to ask the bank, what to find in the
// document. Collapsed to one line each, because six open warnings is a
// wall of text and a wall of text is how a warning gets skipped.
//
// WHAT TO CHECK WITH THE BANK — the checklist — is the one that
// changed. It used to be fifteen mortgage terms with a tick box beside
// each, where the tick came from whether a field had been filled. Two
// things were wrong with that, and the second is the serious one.
//
//   IT SAID THE SAME FIFTEEN SENTENCES TO EVERYONE. "Ask whether the
//   rate is fixed" read identically to somebody who had already said it
//   was fixed and to somebody who had no idea. A checklist that cannot
//   see the scenario beside it is a printed leaflet.
//
//   A GREEN TICK BESIDE A BANK TERM READS AS THE BANK'S APPROVAL.
//   "Mandatory insurance ✓" is not a statement that the insurance is
//   reasonable, and nothing on this page is in a position to make that
//   statement. The state is now a word — ვიცით or გასარკვევია — which
//   says only how much this page knows.
//
// Each card now answers four things: what this is, what we know in THIS
// case with the figures, why it matters, and a question the reader can
// put to the consultant in one press. The fourth is the one that turns
// a list into something a person can act on; see askConsultant.tsx for
// why it fills the composer rather than sending.

import React, { useMemo, useState } from 'react';
import { ChevronDown, CircleDashed, FileSearch, MessageCircleQuestion } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module, formatMoney, intlLocaleFor } from '@/components/workspace/primitives';
import {
  CHECKLIST,
  CHECKLIST_GROUP_LABELS,
  CHECKLIST_GROUP_ORDER,
  SIGNING_TOPICS,
} from '@/mortgage/guidance';
import {
  checklistStates,
  knownCount,
  type ChecklistContext,
  type ChecklistState,
} from '@/mortgage/checklistState';
import { AskHomatch } from '../askConsultant';

/** The checklist item whose conversation each signing topic belongs to. */
const SIGNING_ASK: Readonly<Record<string, string>> = {
  early_repayment: 'mortgage_check_early_repayment_ask',
  fx_risk: 'mortgage_check_currency_risk_ask',
  closing_costs: 'mortgage_check_initial_fees_ask',
  insurance: 'mortgage_check_insurance_ask',
  legal_cap: 'mortgage_check_total_repayment_ask',
  grace_period: 'mortgage_check_grace_period_ask',
};

export function BeforeYouSignView() {
  const { t } = useLanguage();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Module
      id="before-you-sign"
      eyebrowKey="mortgage_mod_sign_eyebrow"
      titleKey="mortgage_mod_sign_title"
      subtitleKey="mortgage_mod_sign_sub"
    >
      <ul className="space-y-2.5">
        {SIGNING_TOPICS.map((topic) => {
          const isOpen = open === topic.id;
          const askKey = SIGNING_ASK[topic.id];
          return (
            <li key={topic.id} className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--secondary))]">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : topic.id)}
                aria-expanded={isOpen}
                aria-controls={`sign-${topic.id}`}
                className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-start"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{t(topic.titleKey)}</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">
                    {t(topic.summaryKey)}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </button>

              {isOpen ? (
                <div id={`sign-${topic.id}`} className="space-y-4 border-t border-border px-4 py-4">
                  <p className="max-w-[64ch] text-sm leading-relaxed text-muted-foreground">{t(topic.whatKey)}</p>

                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
                      {t('mortgage_sign_why_label')}
                    </p>
                    <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-foreground">{t(topic.whyKey)}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border p-3.5">
                      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('mortgage_sign_ask_label')}
                      </p>
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground">{t(topic.askKey)}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3.5">
                      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('mortgage_sign_check_label')}
                      </p>
                      <p className="mt-1.5 text-sm leading-relaxed text-foreground">{t(topic.checkKey)}</p>
                    </div>
                  </div>

                  {askKey ? <AskHomatch question={t(askKey)} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-5 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_hidden_disclaimer')}
      </p>
    </Module>
  );
}

export function ChecklistView({ input, result, breakdown }: ChecklistContext) {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [open, setOpen] = useState<string | null>(null);

  const states = useMemo(
    () => checklistStates({ input, result, breakdown }),
    [input, result, breakdown],
  );
  const byId = useMemo(() => new Map(states.map((s) => [s.id, s])), [states]);
  const done = knownCount(states);

  /*
   * The engine hands back raw amounts and says which they are, because
   * it has no locale. Formatting them here is what stops "თვეში
   * დაახლოებით 1765" — a number about somebody's salary with no
   * currency on it — reaching a Georgian screen.
   */
  const say = (state: ChecklistState) => {
    const vars: Record<string, string | number> = { ...(state.vars ?? {}) };
    for (const name of state.moneyVars ?? []) {
      if (typeof vars[name] === 'number') {
        vars[name] = formatMoney(vars[name] as number, state.currency ?? 'GEL', locale);
      }
    }
    for (const [name, key] of Object.entries(state.varKeys ?? {})) vars[name] = t(String(key));
    return t(state.stateKey, vars);
  };

  return (
    <Module
      id="checklist"
      eyebrowKey="mortgage_mod_checklist_eyebrow"
      titleKey="mortgage_mod_checklist_title"
      subtitleKey="mortgage_mod_checklist_sub"
    >
      <p className="mb-5 text-sm text-muted-foreground">
        {t('mortgage_checklist_progress', { done, total: CHECKLIST.length })}
      </p>

      <div className="space-y-6">
        {CHECKLIST_GROUP_ORDER.map((group) => {
          const items = CHECKLIST.filter((item) => item.group === group);
          return (
            <div key={group}>
              <h3 className="mb-2.5 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
                {t(CHECKLIST_GROUP_LABELS[group])}
              </h3>
              <ul className="space-y-1.5">
                {items.map((item) => {
                  const state = byId.get(item.id);
                  const isKnown = state?.status === 'KNOWN';
                  const isOpen = open === item.id;
                  return (
                    <li key={item.id} className="rounded-xl border border-border bg-[hsl(var(--secondary))]">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        aria-controls={`check-${item.id}`}
                        className="flex w-full items-start gap-3 px-4 py-3 text-start"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{t(item.labelKey)}</span>
                          {/* The state, in this scenario, on the closed card.
                              Somebody scanning the list should not have to
                              open fifteen panels to find the two that still
                              need an answer. */}
                          {state ? (
                            <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">
                              {say(state)}
                            </span>
                          ) : null}
                        </span>
                        {/*
                          A WORD, NOT A TICK. See the header: a green check
                          beside a bank term is read as the bank's approval,
                          and this page is not in a position to give one.
                        */}
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium',
                            isKnown
                              ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                              : 'border border-dashed border-border text-muted-foreground',
                          )}
                        >
                          {t(isKnown ? 'mortgage_state_known' : 'mortgage_state_open')}
                        </span>
                        <ChevronDown
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      {isOpen ? (
                        <div id={`check-${item.id}`} className="space-y-3 border-t border-border px-4 py-3.5">
                          <p className="max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
                            {t(item.whyKey)}
                          </p>
                          {state?.findKey ? (
                            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
                              <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {t(state.findKey)}
                            </p>
                          ) : null}
                          {!item.field ? (
                            <p className="text-2xs leading-relaxed text-muted-foreground">
                              {t('mortgage_checklist_contract_only')}
                            </p>
                          ) : null}
                          <AskHomatch question={t(item.askKey)} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-6 max-w-[64ch] text-2xs leading-relaxed text-muted-foreground">
        {t('mortgage_checklist_note')}
      </p>
    </Module>
  );
}
