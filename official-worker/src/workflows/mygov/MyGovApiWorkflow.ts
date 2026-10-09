import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
// Repository's local Buffer shim exposes only the string overload.
const bufferFromBytes=Buffer.from as unknown as (bytes:Uint8Array)=>Buffer;
const parseSourcePdf=(bytes:Buffer)=>createRequire(import.meta.url)('pdf-parse/lib/pdf-parse.js')(bytes);
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
function newMyGovApiResult(query:string):LegacySourceResult {
 return {source:'mygov',sourceName:'Official Government Sources',sourceClass:'OFFICIAL_GOVERNMENT',sourceUrl:SOURCE_URL,startUrl:SOURCE_URL,finalUrl:'https://naprweb.reestri.gov.ge/_dea/#/search',frameUrls:[],adapter:'service176-public-api',searchControlUsed:'cadcode',queryEntered:typeof query==='string'?query.trim():null,submitAction:'POST /api/search',retrievalMethod:'PUBLIC_API',searched:false,resultContext:null,resultConfirmed:false,noResultConfirmed:false,resultValidated:false,status:'FAILED',traversal:null,retrievedAt:new Date().toISOString(),documents:[],discoveredEntities:[],error:null};
}
export type MyGovApiOptions=NaprOptions&{budgetMs?:number;parsePdf?:(bytes:Buffer)=>Promise<{text:string;numpages:number;info?:any}>;captcha?:CaptchaContext};
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
 const budget=options.budgetMs??(options.captcha?.policy.enabled?180000:45000);const captchaLog:CaptchaResolution[]=[];if(!Number.isFinite(budget)||budget<=0)throw new Error('Invalid My.gov provider budget');
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
   for(const application of result.records){
     if(controller.signal.aborted)throw new Error('Provider deadline');
     try{
       const selected=await selectRecord(result,application.appID,http);if(controller.signal.aborted)throw new Error('Provider deadline');
       let opened:any=selected;
       if(selected.state==='CAPTCHA_REQUIRED'){
         const resumed=await resolveNaprCaptcha(selected,options.captcha,transport,http,captchaLog);if(controller.signal.aborted)throw new Error('Provider deadline');
         if(!resumed){continuations.push(selected);continue;}
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
   }
   const gated=continuations.length>0;const completeDocs=base.documents.filter(doc=>doc.complete);
   base.status=gated?'BLOCKED':failures.length?'SUBMITTED_UNCONFIRMED':completeDocs.length?'SEARCH_CONFIRMED':'SUBMITTED_UNCONFIRMED';
   base.captcha=gated;base.blocked=gated;base.authRequired=false;base.resultConfirmed=!gated&&!failures.length&&completeDocs.length>0;base.resultValidated=base.resultConfirmed;
   base.error=gated?`CAPTCHA_REQUIRED: ${captchaLog.length?`automatic verification ${captchaLog[captchaLog.length-1].outcome}`:'legitimate human record continuation is unavailable in this automatic run'}`:failures.length?'Service 176 acquisition incomplete':!completeDocs.length?'No readable official document acquired':null;
   base.resultContext=base.resultConfirmed?completeDocs.map(doc=>doc.rawText).join('\n\n'):null;
 };
 try{
   // Finite provider deadline, even if an injected parser/transport hangs.
   await Promise.race([acquire(),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Provider deadline')),{once:true}))]);
 }catch(error){base.status=controller.signal.aborted?'TIMEOUT':'FAILED';base.resultConfirmed=false;base.resultValidated=false;base.error=controller.signal.aborted?'Service 176 provider deadline exceeded':error instanceof Error?error.message:'Service 176 acquisition failed';}
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
