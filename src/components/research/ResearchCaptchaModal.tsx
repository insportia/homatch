import React,{useCallback,useEffect,useRef,useState}from'react';
import{Loader2,ShieldCheck,X,AlertTriangle,RefreshCw,SkipForward}from'lucide-react';
import{Button}from'@/components/ui/button';import{supabase}from'@/db/supabase';
import{useLanguage}from'@/contexts/LanguageContext';
const WORKER='https://homatch-official-worker-production.up.railway.app';const API_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY;
type Props={open:boolean;jobId?:string;site?:string;onComplete:()=>void|Promise<void>;onSkip?:()=>void|Promise<void>;onClose?:()=>void};type Shot={image:string;width:number;height:number;offsetX?:number;offsetY?:number;url?:string;captcha?:boolean;expiresAt?:string};
export function ResearchCaptchaModal({open,jobId,site,onComplete,onSkip,onClose}:Props){const{t}=useLanguage();const[shot,setShot]=useState<Shot|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState<string|null>(null),[finishing,setFinishing]=useState(false),[skipping,setSkipping]=useState(false);const img=useRef<HTMLImageElement|null>(null);
 const call=useCallback(async(body:any)=>{if(!jobId)throw new Error(t('verify_captcha_session_not_found'));const{data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error(t('verify_captcha_session_inactive'));const action=String(body.action||'screenshot');let path=`/research/${jobId}/screenshot`,method='GET',payload:any=undefined;if(action==='input'){path=`/research/${jobId}/action`;method='POST';payload={...body};delete payload.action}else if(action==='resume'){path=`/research/${jobId}/resume`;method='POST';payload={humanVerificationCompleted:true}}else if(action==='skip'){path=`/research/${jobId}/skip`;method='POST';payload={}}const r=await fetch(`${WORKER}${path}`,{method,headers:{Authorization:`Bearer ${session.access_token}`,apikey:API_KEY,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));if(!r.ok||data?.error)throw new Error(data?.error||`HTTP ${r.status}`);return data},[jobId,t]);
 const refresh=useCallback(async()=>{if(!open||!jobId)return;setBusy(true);setErr(null);try{setShot(await call({action:'screenshot'}))}catch(e:any){setErr(e?.message||t('verify_captcha_load_failed'))}finally{setBusy(false)}},[open,jobId,call,t]);useEffect(()=>{if(open)refresh();else{setShot(null);setErr(null)}},[open,refresh]);const click=async(e:React.MouseEvent<HTMLImageElement>)=>{if(busy||!shot||!img.current)return;const r=img.current.getBoundingClientRect(),x=(e.clientX-r.left)*shot.width/r.width,y=(e.clientY-r.top)*shot.height/r.height;setBusy(true);setErr(null);try{await call({action:'input',type:'click',x,y,offsetX:shot.offsetX||0,offsetY:shot.offsetY||0});await refresh()}catch(e:any){setErr(e?.message||t('verify_captcha_action_failed'));setBusy(false)}};if(!open)return null;
 // v30 CAPTCHA UX overhaul: the challenge viewport was previously capped at
 // max-w-2xl (672px) / max-h-[560px] regardless of the actual remote page
 // size, which cropped real multi-tile challenges. The modal is now sized to
 // the viewport itself (900-1100px desktop width, up to 90vh tall, full-
 // screen sheet on mobile) and the image area is a flexible, scrollable
 // region rather than a small fixed box — the <img> itself was already
 // unscaled/un-upscaled (max-w-full h-auto, natural aspect ratio preserved,
 // no object-fit stretching) so the only real defect was the container
 // around it being too small; scrolling (not clipping) is the fallback when
 // a challenge is still bigger than the available area.
 //
 // 2026-09-06 mandate (verbatim requirement this component satisfies): "Any
 // CAPTCHA/human-verification screen must be shown large enough for a human
 // to solve comfortably: desktop approx. 900-1100px wide, max 90vh,
 // scrollable and uncropped; mobile full-screen. Preserve and resume the
 // exact same browser/context/page/session after successful human
 // verification." The session-preservation half of that sentence is backend
 // behavior (official-worker/src/orchestrator/ResearchOrchestrator.ts's
 // resume()/skip(), which never call newContext()/newPage()/goto(sourceUrl)/
 // restartWorker() — see that file's own comment on the WAITING_HUMAN
 // `job.humanVerification` payload for the matching sessionId/
 // recommendedWidth/recommendedMaxHeight/fullInteractiveSession/scrollable
 // contract); this component is the sizing half.
 return <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
   <div className="w-full h-full sm:h-auto sm:w-[min(1100px,94vw)] sm:max-h-[90vh] rounded-none sm:rounded-2xl border-0 sm:border border-border bg-background shadow-2xl overflow-hidden flex flex-col">
     <div className="px-5 py-4 border-b flex items-center gap-3 bg-card shrink-0">
       <ShieldCheck className="h-5 w-5 text-primary shrink-0"/>
       <div className="flex-1 min-w-0">
         <p className="text-sm font-semibold">{t('verify_captcha_title')}</p>
         <p className="text-xs text-muted-foreground">{site?`${site}: `:''}{t('verify_captcha_description')}</p>
       </div>
       <Button size="icon" variant="ghost" onClick={refresh} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy?'animate-spin':''}`}/></Button>
       {onClose&&<Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button>}
     </div>
     <p className="px-5 py-2 text-xs text-muted-foreground bg-muted/40 border-b shrink-0">{t('verify_captcha_recommended_note')}</p>
     <div className="relative bg-neutral-950 flex-1 min-h-[320px] sm:min-h-[420px] overflow-auto grid place-items-center p-2">
       {busy&&!shot&&<div className="text-center text-white"><Loader2 className="h-7 w-7 animate-spin mx-auto"/><p className="text-xs mt-2">{t('verify_captcha_loading')}</p></div>}
       {err&&<div className="absolute z-10 top-3 left-3 right-3 p-3 rounded-lg bg-destructive text-destructive-foreground text-xs">{err}</div>}
       {shot?.image?<img ref={img} src={shot.image} onClick={click} draggable={false} className="max-w-full w-auto h-auto cursor-pointer select-none" alt={t('verify_captcha_alt')}/>:!busy&&<div className="text-center text-white p-8"><AlertTriangle className="h-7 w-7 mx-auto"/><p className="text-sm mt-2">{t('verify_captcha_session_load_failed')}</p></div>}
     </div>
     <div className="px-5 py-4 border-t bg-card flex flex-col gap-3 shrink-0">
       <p className="text-xs text-muted-foreground">{t('verify_captcha_hint')}</p>
       <div className="flex items-center justify-between gap-4">
         <Button variant="outline" disabled={finishing||skipping||busy} onClick={async()=>{if(!window.confirm(t('verify_captcha_confirm_skip')))return;setSkipping(true);setErr(null);try{await call({action:'skip'});await(onSkip?onSkip():onComplete())}catch(e:any){setErr(e?.message||t('verify_err_skip_failed'))}finally{setSkipping(false)}}}>{skipping?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:<SkipForward className="h-4 w-4 mr-2"/>}{t('verify_captcha_skip_button')}</Button>
         <Button disabled={finishing||skipping||busy||!shot} onClick={async()=>{setFinishing(true);setErr(null);try{await call({action:'resume'});await onComplete()}catch(e:any){setErr(e?.message||t('verify_captcha_resume_failed'));await refresh()}finally{setFinishing(false)}}}>{finishing?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:<ShieldCheck className="h-4 w-4 mr-2"/>}{t('verify_captcha_complete_button')}</Button>
       </div>
     </div>
   </div>
 </div>}
