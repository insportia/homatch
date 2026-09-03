import React,{useEffect,useState}from'react';
import{Loader2,ShieldCheck,X,AlertTriangle}from'lucide-react';
import{Button}from'@/components/ui/button';

type Props={open:boolean;url?:string;site?:string;onComplete:()=>void|Promise<void>;onClose?:()=>void};
export function ResearchCaptchaModal({open,url,site,onComplete,onClose}:Props){
 const[finishing,setFinishing]=useState(false);const[loaded,setLoaded]=useState(false);
 useEffect(()=>{if(open)setLoaded(false)},[open,url]);
 if(!open)return null;
 return <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-3 md:p-6 flex items-center justify-center">
  <div className="w-full h-full max-w-6xl max-h-[900px] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden flex flex-col">
   <div className="px-4 py-3 border-b flex items-center gap-3 bg-card"><ShieldCheck className="h-5 w-5 text-primary"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold">ადამიანის დადასტურებაა საჭირო</p><p className="text-xs text-muted-foreground truncate">კვლევა დროებით შეჩერდა {site?`— ${site}`:''}. გაიარეთ CAPTCHA აქვე; შემდეგ Homatch გააგრძელებს კვლევას.</p></div>{onClose&&<Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button>}</div>
   <div className="relative flex-1 bg-white">{!loaded&&<div className="absolute inset-0 grid place-items-center bg-background"><div className="text-center"><Loader2 className="h-7 w-7 animate-spin mx-auto text-primary"/><p className="text-xs text-muted-foreground mt-2">ოფიციალური გვერდი იტვირთება…</p></div></div>}{url?<iframe src={url} title="Official human verification" onLoad={()=>setLoaded(true)} className="w-full h-full border-0" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-downloads"/>:<div className="h-full grid place-items-center p-8 text-center"><AlertTriangle className="h-7 w-7 text-amber-400 mx-auto"/><p className="text-sm mt-2">ოფიციალური verification URL არ დაბრუნდა.</p></div>}</div>
   <div className="px-4 py-3 border-t bg-card flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">CAPTCHA-ს დასრულების შემდეგ დააჭირეთ გაგრძელებას. კვლევა იმავე job-ში განახლდება.</p><Button disabled={finishing} onClick={async()=>{setFinishing(true);try{await onComplete()}finally{setFinishing(false)}}}>{finishing?<Loader2 className="h-4 w-4 animate-spin mr-2"/>:<ShieldCheck className="h-4 w-4 mr-2"/>}გავაგრძელოთ კვლევა</Button></div>
  </div>
 </div>
}