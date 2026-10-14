// Generated from engine.js; do not edit.
// @ts-nocheck
const transitions={CONNECT_BROWSER:['CHECK_AUTH','ACTION_REQUIRED'],CHECK_AUTH:['VALIDATE_LISTING','AUTH_REQUIRED'],AUTH_REQUIRED:['CHECK_AUTH'],VALIDATE_LISTING:['FILL_FORM','ACTION_REQUIRED'],FILL_FORM:['UPLOAD_PHOTOS','ACTION_REQUIRED'],UPLOAD_PHOTOS:['VERIFY_FORM','ACTION_REQUIRED'],VERIFY_FORM:['READY_FOR_REVIEW','PHONE_VERIFICATION_REQUIRED','ACTION_REQUIRED'],PHONE_VERIFICATION_REQUIRED:['WAITING_FOR_USER_OTP'],WAITING_FOR_USER_OTP:['VERIFYING'],VERIFYING:['VERIFIED','VERIFICATION_FAILED'],VERIFICATION_FAILED:['WAITING_FOR_USER_OTP'],VERIFIED:['VERIFY_FORM'],READY_FOR_REVIEW:['SUBMITTING','VERIFY_FORM','ACTION_REQUIRED'],SUBMITTING:['VERIFY_PUBLISHED','ACTION_REQUIRED'],VERIFY_PUBLISHED:['PUBLISHED','ACTION_REQUIRED'],ACTION_REQUIRED:['CHECK_AUTH','VERIFY_PUBLISHED'],PUBLISHED:[]};
export function advance(job,state,{confirmed=false,externalId,externalUrl,code,allowedDomains=[]}={}){
 if(job.state==='ACTION_REQUIRED'&&job.events.some(e=>e.state==='SUBMITTING')&&state!=='VERIFY_PUBLISHED')throw Error('RECONCILIATION_REQUIRED');
 if(!transitions[job.state]?.includes(state))throw Error('INVALID_JOB_TRANSITION');
 if(state==='SUBMITTING'&&!confirmed)throw Error('PUBLICATION_CONFIRMATION_REQUIRED');
 if(state==='PUBLISHED'){
  const u=new URL(externalUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||!allowedDomains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))||!externalId)throw Error('PUBLICATION_NOT_VERIFIED');
 }
 return {...job,state,revision:job.revision+1,updatedAt:new Date().toISOString(),...(state==='PUBLISHED'?{externalId,externalUrl}:{}),events:[...job.events,{state,at:new Date().toISOString(),...(code?{code:String(code).replace(/[^A-Z_]/g,'').slice(0,60)}:{})}]};
}
export function capabilityError(operation){return {ok:false,code:'UNSUPPORTED_OPERATION',operation};}
