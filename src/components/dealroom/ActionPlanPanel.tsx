// HOMATCH — the Buyer Action Plan.
//
// Every item here was generated from actual evidence by buyerPlan.ts and
// carries its grounding. That is why an empty plan is shown as an empty plan:
// a property with no findings gets no advice, rather than a generic checklist
// that would look identical for every property in Georgia.
import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Check, RotateCcw, HelpCircle } from 'lucide-react';
import type { ActionItemRecord, QuestionRecord } from '@/services/dealRooms';

const PRIORITY_KEY: Record<number, string> = {
  1: 'dr_priority_high',
  2: 'dr_priority_medium',
  3: 'dr_priority_low',
};

const PRIORITY_VARIANT: Record<number, 'default' | 'secondary' | 'outline'> = {
  1: 'default',
  2: 'secondary',
  3: 'outline',
};

export function ActionPlanPanel({
  actions,
  questions,
  onToggle,
  onAnswer,
  busy,
}: {
  actions: ActionItemRecord[];
  questions: QuestionRecord[];
  onToggle: (item: ActionItemRecord, next: ActionItemRecord['state']) => void;
  onAnswer: (q: QuestionRecord, answer: string) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();

  if (!actions.length && !questions.length) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground leading-relaxed">{t('dr_plan_empty')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {actions.map((a) => {
        const done = a.state === 'DONE';
        return (
          <Card key={a.id} className={done ? 'opacity-60' : undefined}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <h3 className={`text-sm sm:text-base font-medium min-w-0 flex-1 break-words ${done ? 'line-through' : ''}`}>
                  {a.title}
                </h3>
                <Badge variant={PRIORITY_VARIANT[a.priority] ?? 'secondary'} className="shrink-0">
                  {t(PRIORITY_KEY[a.priority] ?? 'dr_priority_medium')}
                </Badge>
              </div>

              {a.why ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('dr_plan_why')}</p>
                  <p className="text-sm leading-relaxed mt-1 break-words">{a.why}</p>
                </div>
              ) : null}

              <Button
                variant={done ? 'outline' : 'default'}
                size="sm"
                disabled={busy}
                className="w-full sm:w-auto gap-2"
                onClick={() => onToggle(a, done ? 'OPEN' : 'DONE')}
              >
                {done ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                {done ? t('dr_plan_reopen') : t('dr_plan_mark_done')}
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {questions.length > 0 && (
        <div className="pt-2">
          <h3 className="text-base font-semibold mb-3">{t('dr_questions_title')}</h3>
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionCard key={q.id} question={q} onAnswer={onAnswer} busy={busy} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  question,
  onAnswer,
  busy,
}: {
  question: QuestionRecord;
  onAnswer: (q: QuestionRecord, answer: string) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(question.answer ?? '');
  const dirty = draft.trim() !== (question.answer ?? '').trim();

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex gap-2">
          <HelpCircle className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium min-w-0 break-words">{question.question}</p>
        </div>
        {question.why ? (
          <p className="text-xs text-muted-foreground leading-relaxed break-words">{question.why}</p>
        ) : null}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="text-sm"
          aria-label={question.question}
        />
        {dirty && (
          <Button size="sm" disabled={busy} className="w-full sm:w-auto" onClick={() => onAnswer(question, draft)}>
            {t('dr_notes_add')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
