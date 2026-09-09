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
 /*
  * The CAPTCHA-participation sentence is gone with the two CAPTCHA-gated
  * sources that produced it, and so is the "10-30 minutes" promise: it was
  * never measured, and a number we cannot stand behind is worse than an
  * honest "a few minutes".
  */
 const c=lang==='ka'?{title:'ღრმა კვლევას შესაძლოა რამდენიმე წუთი დასჭირდეს',body:'Homatch რამდენიმე დამოუკიდებელ წყაროს, დოკუმენტსა და ღია მონაცემს აანალიზებს და მიღებულ ინფორმაციას ერთიან ინტელექტუალურ ანგარიშში აერთიანებს.'}:lang==='ru'?{title:'Глубокое исследование может занять несколько минут',body:'Homatch анализирует несколько независимых источников, документов и открытых данных и объединяет найденное в один аналитический отчёт.'}:{title:'Deep research may take a few minutes',body:'Homatch analyses several independent sources, documents and open data, and brings what it finds together into one intelligence report.'};
 return <section aria-label={c.title} className="w-full rounded-2xl border border-border bg-card/60 p-4 sm:p-5"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Clock3 className="h-4 w-4 text-primary"/></div><div className="min-w-0"><div className="flex items-start gap-2"><p className="text-sm font-semibold break-words">{c.title}</p><ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5"/></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground break-words">{c.body}</p></div></div></section>;
}
