import { parsePdfOffLoop } from '../../runtime/pdfOffLoop.js';
import {Buffer} from 'node:buffer';
// Repository's local Buffer shim exposes only the string overload.
const bufferFromBytes=Buffer.from as unknown as (bytes:Uint8Array)=>Buffer;
const parseSourcePdf=(bytes:Buffer)=>parsePdfOffLoop(bytes,'default');
import {createHash} from 'node:crypto';
import {search,selectRecord,resumeRecord,type DocumentReference,type CaptchaRequired} from './service176/napr.js';
import type {CaptchaContext,CaptchaResolution} from '../../captcha/captchaService.js';
import {discoverSiteKey,NO_CHALLENGE} from '../../captcha/detect.js';
import {downloadDocument} from './service176/napr-documents.js';
import type {NaprOptions} from './service176/napr-api.js';
import {newDocumentShell,markComplete} from '../../documents/DocumentTypes.js';
import type {LegacySourceResult} from '../WorkflowResult.js';
import type {EntityQueue} from '../../entities/EntityQueue.js';
const SOURCE_URL='https://www.my.gov.ge/ka-ge/services/5/service/176';
/*
 * WHICH RECORDS THE CAPTCHA BUDGET OPENS (V1.1, 2026-10-23).
 *
 * NAPR gates many application records with their own reCAPTCHA, and the
 * per-task solve budget (maxSolvesPerJob) is fixed. Records were opened in the
 * source's order (newest first), so on parcel 01.14.07.001.044 the budget went
 * to a batch of refused (statusId 12) and terminated (13) applications, and
 * all 38 records left gated were COMPLETED registrations (10) — the ownership
 * and encumbrance history a buyer needs. Completed registrations are now
 * opened first; newest-first order is kept within each group. Same budget, no
 * extra spend; refused/terminated applications stay listed from the search.
 */
const STATUS_PRIORITY:Record<string,number>={'10':0,'13':2,'12':3};
export function prioritiseNaprRecords<T extends {statusId?:unknown}>(records:T[]):T[]{
 return records.map((r,i)=>({r,i,p:STATUS_PRIORITY[String(r.statusId??'')]??1})).sort((a,b)=>a.p-b.p||a.i-b.i).map(x=>x.r);
}
function newMyGovApiResult(query:string):LegacySourceResult {
 return {source:'mygov',sourceName:'Official Government Sources',sourceClass:'OFFICIAL_GOVERNMENT',sourceUrl:SOURCE_URL,startUrl:SOURCE_URL,finalUrl:'https://naprweb.reestri.gov.ge/_dea/#/search',frameUrls:[],adapter:'service176-public-api',searchControlUsed:'cadcode',queryEntered:typeof query==='string'?query.trim():null,submitAction:'POST /api/search',retrievalMethod:'PUBLIC_API',searched:false,resultContext:null,resultConfirmed:false,noResultConfirmed:false,resultValidated:false,status:'FAILED',traversal:null,retrievedAt:new Date().toISOString(),documents:[],discoveredEntities:[],error:null};
}
export type MyGovApiOptions=NaprOptions&{budgetMs?:number;recordReserveMs?:number;recordConcurrency?:number;now?:()=>number;parsePdf?:(bytes:Buffer)=>Promise<{text:string;numpages:number;info?:any}>;captcha?:CaptchaContext};
/*
 * A PARCEL WITH MANY RECORDS MUST NOT COST THE WHOLE SOURCE (prod 1ff4b786,
 * 2026-10-24). Code 88.20.21.767.117.2 has many NAPR records; each gated one
 * costs a CAPTCHA solve (~30-40 s) plus a PDF. The loop opened them until the
 * provider deadline aborted the run, and the abort threw away every document
 * already read: the job got "provider unavailable" and no registry data at
 * all. Now a record is only opened while at least RECORD_RESERVE_MS remain
 * (the rest stay listed from the search, as unvisited), and a hard deadline
 * that still hits keeps whatever was read.
 */
export const RECORD_RESERVE_MS=75000;
export const MAX_RECORD_LANES=4;
/*
 * A record gated by NAPR's reCAPTCHA (status 10/15) is continued with a token
 * from the shared CAPTCHA service, through the source's own continuation
 * (resumeRecord). The source opening the record is the only proof of
 * acceptance; anything else is reported as rejected. Returns null when the
 * record stays gated — it then remains a non-blocking continuation exactly as
 * before, and the rest of the run continues.
 */
async function resolveNaprCaptcha(gated:CaptchaRequired,cap:CaptchaContext|undefined,fetcher:typeof fetch,http:NaprOptions,log:CaptchaResolution[]){
 if(!cap)return null;
 const res:CaptchaResolution={challengeDetected:true,type:null,attempts:0,outcome:'HUMAN_FALLBACK',latencyMs:0};log.push(res);
 const blocked=cap.service.gate(cap.policy,'mygov',cap.jobId);if(blocked){res.outcome=blocked;return null;}
 const pageUrl=gated.continuationContext.browserUrl;
 let found=NO_CHALLENGE;try{found=await discoverSiteKey(pageUrl,fetcher,process.env.NAPR_RECAPTCHA_SITEKEY??null);}catch{/* discovery failed: no spend */}
 res.type=found.type;
 if(!found.present||!found.siteKey){res.outcome='SITEKEY_NOT_FOUND';return null;}
 if(!found.supported){res.outcome='UNSUPPORTED';return null;}
 for(let i=0;i<cap.policy.maxAttemptsPerProvider;i++){
   const solved=await cap.service.solveRecaptchaV2({provider:'mygov',jobId:cap.jobId,pageUrl,siteKey:found.siteKey,invisible:found.type==='RECAPTCHA_V2_INVISIBLE',enterprise:found.type==='RECAPTCHA_ENTERPRISE'},cap.policy);
   res.attempts++;res.latencyMs+=solved.latencyMs;
   if(!solved.ok){res.outcome=solved.outcome;if(solved.outcome!=='TIMEOUT'&&solved.outcome!=='UNSOLVABLE')return null;continue;}
   try{const record=await resumeRecord(gated,solved.token,http);await cap.service.reportAcceptance({provider:'mygov',jobId:cap.jobId},solved,true);res.outcome='ACCEPTED';return record;}
   catch{await cap.service.reportAcceptance({provider:'mygov',jobId:cap.jobId},solved,false);res.outcome='REJECTED';}
 }
 return null;
}
export async function runMyGovApiWorkflow(query:string,entities?:EntityQueue,options:MyGovApiOptions={}):Promise<LegacySourceResult>{
 const base=newMyGovApiResult(query);
 const budget=options.budgetMs??(options.captcha?.policy.enabled?420000:45000);const captchaLog:CaptchaResolution[]=[];if(!Number.isFinite(budget)||budget<=0)throw new Error('Invalid My.gov provider budget');
 const now=options.now??Date.now;const reserve=Math.min(options.recordReserveMs??RECORD_RESERVE_MS,Math.floor(budget/2));const deadlineAt=now()+budget;const deferred:string[]=[];
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),budget);const requests:any[]=[];const continuations:any[]=[];const references:DocumentReference[]=[];const records:any[]=[];const failures:any[]=[];
 const transport:typeof fetch=async(input,init)=>{
   if(controller.signal.aborted)throw new Error('Provider deadline');
   // Capture only public request identity, never a continuation body or credentials.
   requests.push({url:String(input),method:init?.method??'GET'});
   const signal=AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])]);
   let abort:()=>void=()=>{};
   try{return await Promise.race([(options.fetch??globalThis.fetch)(input,{...init,signal}),new Promise<never>((_,reject)=>{abort=()=>reject(new Error('Provider request aborted'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
   finally{signal.removeEventListener('abort',abort);}
 };
 const http={...options,fetch:transport,retries:0,timeoutMs:options.timeoutMs??8000};
 const acquire=async()=>{
   const result=await search(query,http);if(controller.signal.aborted)throw new Error('Provider deadline');base.searched=true;base.submitted=true;base.submissionConfirmed=true;
   base.traversal={providerState:'SEARCH_RETURNED',search:result,records,continuations,documentReferences:references,failures,requests};
   if(!result.records.length){if(result.pages.some(page=>Number(page.total)>0))throw new Error('Empty page contradicts source total');base.status='NO_RESULT_CONFIRMED';base.noResultConfirmed=true;base.resultValidated=true;return;}
   // Records are opened in parallel lanes so CAPTCHA solves overlap: a parcel with many
   // records is read in full inside the budget instead of one 40 s solve after another.
   // Lanes never exceed maxAttemptsPerProvider, so in-flight solves never trip that cap.
   const queue=prioritiseNaprRecords(result.records as any[]);
   const lanes=Math.max(1,Math.min(options.recordConcurrency??(options.captcha?.policy.enabled?options.captcha.policy.maxAttemptsPerProvider:1),MAX_RECORD_LANES,queue.length));
   const openRecord=async(application:any)=>{
   if(controller.signal.aborted)throw new Error('Provider deadline');
   // Not enough time left to open one more record properly: stop here, keep what was read.
   if(deadlineAt-now()<reserve){deferred.push(String(application.appID));return;}
   try{
     const selected=await selectRecord(result,application.appID,http);if(controller.signal.aborted)throw new Error('Provider deadline');
     let opened:any=selected;
     if(selected.state==='CAPTCHA_REQUIRED'){
       const resumed=await resolveNaprCaptcha(selected,options.captcha,transport,http,captchaLog);if(controller.signal.aborted)throw new Error('Provider deadline');
       if(!resumed){continuations.push(selected);return;}
       opened=resumed;
     }
     // Every boundary must agree: search appID/registration, record APP_ID,
     // exact cadastral code and every returned source document association.
     if(opened.info.CADCODE!==result.cadastralCode||opened.info.REG_NUMBER!==application.regNumber)throw new Error('Source record identity mismatch');
     records.push(opened);references.push(...opened.documents);
     for(const reference of opened.documents){
       if(controller.signal.aborted)throw new Error('Provider deadline');
       if(reference.documentType!=='pdf-document')continue;
       const shell=newDocumentShell('mygov',reference.url,opened.recordId);shell.documentType='PDF_DOCUMENT';shell.title=String(reference.raw.DOC_NAME??reference.raw.STATUS_NAME??'')||null;
       try{const downloaded=await downloadDocument(reference,opened.recordId,http);if(controller.signal.aborted)throw new Error('Provider deadline');if(downloaded.metadata.finalUrl!==reference.url)throw new Error('Document final URL identity mismatch');shell.sha256=createHash('sha256').update(bufferFromBytes(downloaded.bytes)).digest('hex');
         const parsed=await (options.parsePdf??parseSourcePdf)(bufferFromBytes(downloaded.bytes));if(controller.signal.aborted)throw new Error('Provider deadline');shell.rawText=parsed.text??'';shell.pageCount=Number.isInteger(parsed.numpages)&&parsed.numpages>0?parsed.numpages:null;shell.pagesRead=shell.pageCount??0;
         // Bytes/signature alone cannot satisfy HOMATCH's readable-evidence contract.
         if(shell.rawText.trim().length>20)markComplete(shell);else shell.error='TEXT_EXTRACTION_UNAVAILABLE';
         Object.assign(shell,{sourceReference:reference,contentMetadata:downloaded.metadata});
       }catch(error){shell.error=error instanceof Error?error.message:'Document acquisition failed';}
       base.documents.push(shell);if(!shell.complete)failures.push({recordId:opened.recordId,url:reference.url,error:shell.error??'Incomplete document'});
     }
   }catch(error){failures.push({recordId:String(application.appID),error:error instanceof Error?error.message:'Record acquisition failed'});}
   };
   let next=0;
   await Promise.all(Array.from({length:lanes},async()=>{while(next<queue.length&&!controller.signal.aborted)await openRecord(queue[next++]);}));
   if(controller.signal.aborted)throw new Error('Provider deadline');
   (base as any).recordsDeferredForTime=deferred;
   const gated=continuations.length>0;const completeDocs=base.documents.filter(doc=>doc.complete);
   // One gated or unreadable record among many must not void the documents the
   // other records yielded (1ff4b786): readable official documents are the result,
   // the incomplete records stay listed in failures/continuations.
   const partial=completeDocs.length>0&&(gated||failures.length>0||deferred.length>0);(base as any).partial=partial;
   base.status=completeDocs.length?'SEARCH_CONFIRMED':gated?'BLOCKED':'SUBMITTED_UNCONFIRMED';
   base.captcha=gated;base.blocked=gated&&!completeDocs.length;base.authRequired=false;base.resultConfirmed=completeDocs.length>0;base.resultValidated=base.resultConfirmed;
   base.error=completeDocs.length?null:gated?`CAPTCHA_REQUIRED: ${captchaLog.length?`automatic verification ${captchaLog[captchaLog.length-1].outcome}`:'legitimate human record continuation is unavailable in this automatic run'}`:failures.length?'Service 176 acquisition incomplete':!completeDocs.length?'No readable official document acquired':null;
   base.resultContext=base.resultConfirmed?completeDocs.map(doc=>doc.rawText).join('\n\n'):null;
 };
 try{
   // Finite provider deadline, even if an injected parser/transport hangs.
   await Promise.race([acquire(),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Provider deadline')),{once:true}))]);
 }catch(error){
   const read=base.documents.filter(doc=>doc.complete);
   if(controller.signal.aborted&&read.length){
     // The deadline cut the run short, but official documents were read: they are the result.
     base.status='SEARCH_CONFIRMED';base.resultConfirmed=true;base.resultValidated=true;base.error=null;
     base.resultContext=read.map(doc=>doc.rawText).join('\n\n');(base as any).truncatedByDeadline=true;
   }else{base.status=controller.signal.aborted?'TIMEOUT':'FAILED';base.resultConfirmed=false;base.resultValidated=false;base.error=controller.signal.aborted?'Service 176 provider deadline exceeded':error instanceof Error?error.message:'Service 176 acquisition failed';}
 }
 finally{clearTimeout(timer);}
 const completeDocs=base.documents.filter(doc=>doc.complete);
 (base as any).captchaResolution=captchaLog;
 base.documentLinks=references;base.documentsDiscovered=references.length;base.documentsExtracted=completeDocs.length;
 if(base.traversal)base.traversal={...base.traversal,providerState:continuations.length?'CAPTCHA_REQUIRED':base.status,nonBlocking:true};
 base.workflowResult={source:'mygov',state:continuations.length?'CAPTCHA_REQUIRED':base.status,completed:base.status==='SEARCH_CONFIRMED'||base.noResultConfirmed,skipped:false,discoveredItems:(base.traversal as any)?.search?.records?.length??null,visitedItems:records.length,discoveredDocuments:references.length,readDocuments:completeDocs.length,unvisitedRelevantItems:continuations.length+failures.filter(item=>!item.url).length,evidenceIds:[],trace:requests};
 // Only readable source PDF evidence can seed downstream entity expansion.
 if(!controller.signal.aborted)for(const doc of completeDocs){try{entities?.scanText(doc.rawText,{source:'mygov',sourceDocument:doc.url,retrievedAt:base.retrievedAt});}catch{failures.push({stage:'entity-extraction',url:doc.url,error:'Entity extraction unavailable; source document preserved'});}}
 return structuredClone(base);
}
export async function runMyGovApiStep(query:string,entities?:EntityQueue,options:MyGovApiOptions={}){
 try{return{result:await runMyGovApiWorkflow(query,entities,options),keep:false as const};}
 catch(error){const result=newMyGovApiResult(query);result.error=error instanceof Error?error.message:'Service 176 provider failed';return{result,keep:false as const};}
}
