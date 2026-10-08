import {URL} from 'node:url';
﻿import { ApiError, isAccessDeniedHtml, isExplicitCaptchaError, publicUrl } from './api.js';
export type RequestSpec = {url:string;method:'GET'|'POST';headers:Record<string,string>;body?:string};
export type NaprOptions = {fetch?:typeof fetch;timeoutMs?:number;retries?:number;retryDelayMs?:number};
export const NAPR_ORIGIN='https://naprweb.reestri.gov.ge';
export function requestSpec(path:string,body?:unknown):RequestSpec {
  const headers:Record<string,string>={Accept:'application/json, text/plain, */*'};
  if(body!==undefined)headers['Content-Type']='application/json;charset=utf-8';
  return {url:new URL(path,NAPR_ORIGIN).href,method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})};
}
export async function requestJson(spec:RequestSpec,options:NaprOptions={}):Promise<unknown>{
  publicUrl(spec.url);
  const retries=options.retries??1;
  if(!Number.isInteger(retries)||retries<0||retries>3)throw new Error('retries must be 0..3');
  const timeout=options.timeoutMs??15000;
  if(!Number.isFinite(timeout)||timeout<=0)throw new Error('timeoutMs must be positive');
  for(let attempt=0;;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await(options.fetch??fetch)(spec.url,{method:spec.method,headers:spec.headers,body:spec.body,credentials:'omit',redirect:'error',signal:controller.signal});
      const text=await response.text();
      if(isAccessDeniedHtml(text))throw new ApiError('access-denied',response.status);
      if(isExplicitCaptchaError(text))throw new ApiError('captcha',response.status);
      if(!response.ok){
        // Never replay a POST, particularly a one-use legitimate CAPTCHA continuation.
        if(spec.method==='GET'&&[429,502,503,504].includes(response.status)&&attempt<retries){clearTimeout(timer);await new Promise(r=>setTimeout(r,options.retryDelayMs??250));continue;}
        throw new ApiError('http',response.status);
      }
      try{return JSON.parse(text);}catch{throw new ApiError('malformed',response.status);}
    }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(controller.signal.aborted?'timeout':'network');}
    finally{clearTimeout(timer);}
  }
}
