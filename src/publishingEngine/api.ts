import { supabase } from '@/db/supabase';
export async function publishingApi(url:string,body?:unknown,signal?:AbortSignal) {
 const {data,error}=await supabase.functions.invoke('publishing-engine',{body:{url,body},signal});
 if(error||data?.code){
  let code=data?.code;
  if(!code&&error?.context instanceof Response){try{code=(await error.context.clone().json()).code;}catch{/* A transport failure has no structured response. */}}
  throw new Error(typeof code==='string'&&/^[A-Z_]{1,80}$/.test(code)?code:'PUBLISHING_REQUEST_FAILED');
 }return data;
}
