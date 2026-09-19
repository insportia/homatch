// HOMATCH HOME FINANCING — the two topics with no arithmetic in them.
//
// BEFORE YOU SIGN is the four-part shape: what it is, why it matters,
// what to ask the bank, what to find in the contract. Collapsed to one
// line each by default, because six open topics is a wall of text and a
// wall of text is how a warning gets skipped.
//
// THE CHECKLIST ticks itself where it honestly can. An item tied to a
// field the borrower has filled in is marked answered; an item about a
// contractual clause stays open, because nothing in a calculator knows
// what a contract says and a checklist that pretends otherwise is worse
// than no checklist.

import React, { useState } from 'react';
import { Check, ChevronDown, CircleHelp, FileSearch, MessageCircleQuestion } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Module } from '@/components/workspace/primitives';
import {
  CHECKLIST,
  CHECKLIST_GROUP_LABELS,
  CHECKLIST_GROUP_ORDER,
  SIGNING_TOPICS,
  answeredChecklistItems,
} from '@/mortgage/guidance';
import type { MortgageInput } from '@/mortgage/types';

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

export function ChecklistView({ input }: { input: MortgageInput | null }) {
  const { t } = useLanguage();
  const answered = answeredChecklistItems(input);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Module
      id="checklist"
      eyebrowKey="mortgage_mod_checklist_eyebrow"
      titleKey="mortgage_mod_checklist_title"
      subtitleKey="mortgage_mod_checklist_sub"
    >
      <p className="mb-5 text-sm text-muted-foreground">
        {t('mortgage_checklist_progress', { done: answered.size, total: CHECKLIST.length })}
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
                  const done = answered.has(item.id);
                  const isOpen = open === item.id;
                  return (
                    <li key={item.id} className="rounded-xl border border-border bg-[hsl(var(--secondary))]">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-3 px-4 py-3 text-start"
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                            done
                              ? 'border-[hsl(var(--success)/0.5)] bg-[hsl(var(--success)/0.15)]'
                              : 'border-border',
                          )}
                          aria-hidden="true"
                        >
                          {done ? <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-foreground">{t(item.labelKey)}</span>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      {isOpen ? (
                        <div className="space-y-3 border-t border-border px-4 py-3.5">
                          <p className="max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
                            {t(item.whyKey)}
                          </p>
                          <p className="flex items-start gap-1.5 text-sm leading-relaxed text-foreground">
                            <MessageCircleQuestion
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            {t(item.askKey)}
                          </p>
                          {!item.field ? (
                            <p className="flex items-start gap-1.5 text-2xs italic leading-relaxed text-muted-foreground">
                              <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {t('mortgage_checklist_contract_only')}
                            </p>
                          ) : null}
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
