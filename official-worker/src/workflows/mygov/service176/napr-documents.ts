import { validatePdf } from './documents.js';
import { publicUrl,ApiError } from './api.js';
import type { DocumentReference } from './napr.js';
import type { NaprOptions } from './napr-api.js';
import {classifyReference} from './document-references.js';
export function downloadRequest(reference:DocumentReference,selectedRecordId:string){if(reference.recordId!==selectedRecordId)throw new Error('Document association mismatch');if(classifyReference(reference).documentType!=='pdf-document')throw new Error('Reference is not an expected PDF document');return{url:publicUrl(reference.url).href,method:'GET' as const};}
export async function downloadDocument(reference:DocumentReference,selectedRecordId:string,options:NaprOptions={}){
 const request=downloadRequest(reference,selectedRecordId);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??15000);
 try{const response=await(options.fetch??fetch)(request.url,{method:'GET',credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw new ApiError('http',response.status);const bytes=new Uint8Array(await response.arrayBuffer());const metadata=validatePdf(bytes,response.headers.get('content-type'));return{recordId:selectedRecordId,reference,bytes,metadata:{...metadata,status:response.status,contentDisposition:response.headers.get('content-disposition'),finalUrl:response.url||request.url,registrationNumber:reference.registrationNumber??null,cadastralCode:reference.cadastralCode??null,retrievedAt:new Date().toISOString()},request};}
 catch(error){if(controller.signal.aborted)throw new ApiError('timeout');throw error;}finally{clearTimeout(timer);}
}

