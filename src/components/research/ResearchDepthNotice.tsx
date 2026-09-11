import React from 'react';
import {Clock3,ShieldCheck} from 'lucide-react';
import {useLanguage} from '@/contexts/LanguageContext';

/*
 * The Verify "deep research may take 10-30 minutes" NOTE.
 *
 * It used to be rendered globally from App.tsx as a FIXED, bottom-pinned,
 * z-[75] panel (`fixed left-1/2 -translate-x-1/2 bottom-5 z-[75]`), which
 * floated over whatever happened to be underneath it: the Ask-AI button at
 * the end of a finished report, the progress card on short screens, and — on
 * mobile — AppLayout's own fixed MobileBottomNav and AIFloatingButton, plus
 * the phone browser's bottom chrome.
 *
 * It is now an ordinary block in VerifyPage's normal document flow, placed
 * directly under the cadastral input (the action it actually explains). It
 * has NO fixed/absolute positioning, no transform, no negative margin and no
 * z-index, so it cannot overlay anything in any state; vertical separation
 * comes from the page's own `space-y-*` rhythm. VerifyPage is now its only
 * caller, so the old pathname guard is gone with the global mount.
 */
export function ResearchDepthNotice(){
 const {lang}=useLanguage();
 const c=lang==='ka'?{title:'ღრმა კვლევას შესაძლოა 10–30 წუთი დასჭირდეს',body:'Homatch ამოწმებს საკადასტრო და სხვა ოფიციალურ წყაროებს, დოკუმენტებს და ღია ინტერნეტს. დრო დამოკიდებულია ხელმისაწვდომ ინფორმაციასა და წყაროების პასუხზე. დიდი ალბათობით პროცესში თქვენი ჩართულობაც იქნება საჭირო CAPTCHA-ს გადასაჭრელად — ასეთ შემთხვევაში Homatch გაგიხსნით რეალურ ბრაუზერის სესიას და კვლევა იმავე ადგილიდან გაგრძელდება.'}:lang==='ru'?{title:'Глубокое исследование может занять 10–30 минут',body:'Homatch проверяет кадастровые и другие официальные источники, документы и открытый интернет. Время зависит от объёма доступной информации и ответа источников. Скорее всего, в процессе потребуется ваше участие для прохождения CAPTCHA — Homatch откроет реальный сеанс браузера и затем продолжит исследование с того же места.'}:{title:'Deep research may take 10–30 minutes',body:'Homatch checks cadastral and other official sources, documents, and the open web. Timing depends on the available information and source response times. Your participation may be required to complete a CAPTCHA; Homatch will open a real browser session and continue from the exact same point afterwards.'};
 return <section aria-label={c.title} className="w-full rounded-2xl border border-border bg-card/60 p-4 sm:p-5"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Clock3 className="h-4 w-4 text-primary"/></div><div className="min-w-0"><div className="flex items-start gap-2"><p className="font-display text-lg font-bold tracking-[-0.012em] break-words">{c.title}</p><ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5"/></div><p className="measure mt-1.5 text-base leading-relaxed text-ink-soft break-words">{c.body}</p></div></div></section>;
}
