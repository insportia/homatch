import React from 'react';
import {Clock3,ShieldCheck} from 'lucide-react';
import {useLanguage} from '@/contexts/LanguageContext';

/*
 * The Verify "deep research takes 10-30 minutes" NOTE.
 *
 * It used to be rendered globally from App.tsx as a FIXED, bottom-pinned,
 * z-[75] panel, which floated over whatever happened to be underneath it. It
 * is now an ordinary block in VerifyPage's normal document flow, directly
 * under the action it explains, with no fixed/absolute positioning and no
 * z-index, so it cannot overlay anything in any state.
 *
 * WHY 10-30 MINUTES IS BACK
 *
 * It was removed for being an unmeasured promise. That was the wrong call: a
 * customer about to wait needs to know roughly how long, and "a few minutes"
 * under-promised a pipeline that genuinely runs for fifteen to twenty. The
 * real completion times in research_jobs sit between about six and
 * twenty-five minutes, so the range is honest.
 *
 * WHY THE BACKGROUND PROMISE IS ALLOWED
 *
 * Because it is now TRUE, and it was not before. Until the autonomous driver
 * landed, `advance()` was only ever called by a polling client, so telling a
 * customer they could close the page would have been telling them to freeze
 * their own verification. pg_cron now steps the pipeline with zero clients
 * connected and requests synthesis when research completes, so the sentence
 * describes the system as it actually behaves.
 *
 * The CAPTCHA sentence stays gone, with the CAPTCHA-gated sources it
 * described.
 *
 * The copy moved into the i18n bundle: this component used to carry inline
 * strings for ka/ru/en only, which silently served English to Turkish,
 * Arabic and Hebrew customers.
 */
export function ResearchDepthNotice(){
 const {t}=useLanguage();
 return <section aria-label={t('verify_depth_title')} className="w-full rounded-2xl border border-border bg-card/60 p-4 sm:p-5"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Clock3 className="h-4 w-4 text-primary"/></div><div className="min-w-0"><div className="flex items-start gap-2"><p className="text-sm font-semibold break-words">{t('verify_depth_title')}</p><ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5"/></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground break-words">{t('verify_depth_body')}</p></div></div></section>;
}
