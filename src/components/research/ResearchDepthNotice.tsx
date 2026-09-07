import React from 'react';
import {Clock3,ShieldCheck} from 'lucide-react';
import {useLocation} from 'react-router-dom';
import {useLanguage} from '@/contexts/LanguageContext';

export function ResearchDepthNotice(){
 const {pathname}=useLocation(); const {lang}=useLanguage();
 if(pathname!=='/verify')return null;
 const c=lang==='ka'?{title:'ღრმა კვლევას შესაძლოა 10–30 წუთი დასჭირდეს',body:'Homatch ამოწმებს საკადასტრო და სხვა ოფიციალურ წყაროებს, დოკუმენტებს და ღია ინტერნეტს. დრო დამოკიდებულია ხელმისაწვდომ ინფორმაციასა და წყაროების პასუხზე. დიდი ალბათობით პროცესში თქვენი ჩართულობაც იქნება საჭირო CAPTCHA-ს გადასაჭრელად — ასეთ შემთხვევაში Homatch გაგიხსნით რეალურ ბრაუზერის სესიას და კვლევა იმავე ადგილიდან გაგრძელდება.'}:lang==='ru'?{title:'Глубокое исследование может занять 10–30 минут',body:'Homatch проверяет кадастровые и другие официальные источники, документы и открытый интернет. Время зависит от объёма доступной информации и ответа источников. Скорее всего, в процессе потребуется ваше участие для прохождения CAPTCHA — Homatch откроет реальный сеанс браузера и затем продолжит исследование с того же места.'}:{title:'Deep research may take 10–30 minutes',body:'Homatch checks cadastral and other official sources, documents, and the open web. Timing depends on the available information and source response times. Your participation may be required to complete a CAPTCHA; Homatch will open a real browser session and continue from the exact same point afterwards.'};
 return <div className="fixed left-1/2 -translate-x-1/2 bottom-5 z-[75] w-[min(760px,calc(100vw-24px))] rounded-2xl border bg-background/95 backdrop-blur shadow-xl p-4"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Clock3 className="h-4 w-4 text-primary"/></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-semibold">{c.title}</p><ShieldCheck className="h-4 w-4 text-primary shrink-0"/></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p></div></div></div>;
}
