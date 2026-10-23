// V2 research synthesis, in code (VERIFY_V2_PLAN.md decision D1).
//
// V1 asks the research model for an executive summary, key strengths and items
// to verify, then rebuilds every other SYNTHESIS field from the earlier stages
// when the model leaves it out (research-agent finish()). The customer report
// is written by verify-synthesis from the evidence package, which never reads
// these three, so V2 derives them from the legal-status matrix — the same
// per-category official outcome the report already shows — and makes no call.
//
// Nothing here may claim more than the matrix says: a strength is a category a
// public source confirmed with no adverse result; an item to verify is one no
// source confirmed yet. A confirmed-but-adverse category is neither — it is a
// material finding, reported as one elsewhere.

export type LegalStatusValue = 'CONFIRMED_POSITIVE' | 'CONFIRMED_ATTENTION' | 'NOT_CONFIRMED' | 'HUMAN_VERIFICATION_REQUIRED';
export interface LegalStatusEntryLike { status: LegalStatusValue | string; label: string; note: string }

export interface CodeSynthesis {
  executiveSummary: string;
  keyStrengths: string[];
  itemsToVerify: string[];
}

const SUMMARY_SOME: Record<string, string> = {
  en: '{{subject}}: {{confirmed}} of {{total}} official checks returned a confirmed result; {{open}} still need confirmation.',
  ka: '{{subject}}: {{total}} ოფიციალური შემოწმებიდან {{confirmed}} დადასტურებული შედეგით დასრულდა; {{open}} ჯერ კიდევ საჭიროებს დადასტურებას.',
  ru: '{{subject}}: {{confirmed}} из {{total}} официальных проверок дали подтверждённый результат; {{open}} ещё требуют подтверждения.',
  tr: '{{subject}}: {{total}} resmi kontrolün {{confirmed}} tanesi doğrulanmış sonuç verdi; {{open}} tanesi hâlâ doğrulama bekliyor.',
  ar: '{{subject}}: أسفرت {{confirmed}} من أصل {{total}} عمليات تحقق رسمية عن نتيجة مؤكدة؛ ولا تزال {{open}} بحاجة إلى تأكيد.',
  he: '{{subject}}: {{confirmed}} מתוך {{total}} בדיקות רשמיות הניבו תוצאה מאושרת; {{open}} עדיין דורשות אישור.',
};
const SUMMARY_ALL: Record<string, string> = {
  en: '{{subject}}: all {{total}} official checks returned a confirmed result.',
  ka: '{{subject}}: ყველა {{total}} ოფიციალური შემოწმება დადასტურებული შედეგით დასრულდა.',
  ru: '{{subject}}: все {{total}} официальных проверок дали подтверждённый результат.',
  tr: '{{subject}}: {{total}} resmi kontrolün tamamı doğrulanmış sonuç verdi.',
  ar: '{{subject}}: أسفرت جميع عمليات التحقق الرسمية ({{total}}) عن نتيجة مؤكدة.',
  he: '{{subject}}: כל {{total}} הבדיקות הרשמיות הניבו תוצאה מאושרת.',
};

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const line = (e: LegalStatusEntryLike) => `${e.label} — ${e.note}`;

export function codeSynthesis(legalStatus: Record<string, LegalStatusEntryLike> | null | undefined, subject: string, lang: string): CodeSynthesis {
  const entries = Object.values(legalStatus || {}).filter((e) => e && typeof e.label === 'string' && typeof e.note === 'string');
  const positive = entries.filter((e) => e.status === 'CONFIRMED_POSITIVE');
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED_POSITIVE' || e.status === 'CONFIRMED_ATTENTION').length;
  // A source the person chose not to complete first: it is the one they can act on.
  const open = [
    ...entries.filter((e) => e.status === 'HUMAN_VERIFICATION_REQUIRED'),
    ...entries.filter((e) => e.status === 'NOT_CONFIRMED'),
  ];
  const vars = { subject: subject.trim(), confirmed, total: entries.length, open: open.length };
  const executiveSummary = !entries.length || !vars.subject
    ? ''
    : fill((open.length ? SUMMARY_SOME : SUMMARY_ALL)[lang] || (open.length ? SUMMARY_SOME : SUMMARY_ALL).en, vars);
  return {
    executiveSummary,
    keyStrengths: positive.map(line).slice(0, 5),
    itemsToVerify: open.map(line).slice(0, 4),
  };
}
