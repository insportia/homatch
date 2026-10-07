import http2 from 'node:http2';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {API_BASE} from './ssge-contract.mjs';
// Ordinary HTTP/2, as observed in the successful public browser responses.
// No browser fingerprint, cookie, TLS override, proxy or captured token reuse.
export function createGatewayHttp2Fetch({connect=http2.connect,fallbackFetch=fetch}={}) {
 return async function gatewayFetch(input,options={}) {
  const url=new URL(input);
  if(url.origin!==API_BASE)return fallbackFetch(input,options);
  if(options.signal?.aborted)throw options.signal.reason;
  return new Promise((resolve,reject)=>{
   const session=connect(url.origin),chunks=[];let stream,headers,finished=false;
   const close=()=>{options.signal?.removeEventListener('abort',abort);if(stream&&!stream.closed)stream.close();session.close();};
   const fail=error=>{if(finished)return;finished=true;close();session.destroy();reject(error);};
   const abort=()=>fail(options.signal.reason??new Error('HTTP/2 request aborted'));
   options.signal?.addEventListener('abort',abort,{once:true});
   session.on('error',fail);
   session.once('connect',()=>{
    if(finished)return;
    // Never silently fall back to the unresolved HTTP/1 transport.
    if(session.socket?.alpnProtocol!=='h2')return fail(new Error('Public gateway did not negotiate HTTP/2'));
    const outgoing={':method':options.method??'GET',':path':url.pathname+url.search};
    for(const [key,value]of new Headers(options.headers)){
     if(['connection','host','transfer-encoding','upgrade','keep-alive'].includes(key))return fail(new Error(`Invalid HTTP/2 header: ${key}`));
     outgoing[key]=value;
    }
    try{stream=session.request(outgoing);}catch(error){return fail(error);}
    stream.on('error',fail);stream.on('aborted',()=>fail(new Error('Public gateway HTTP/2 stream aborted')));
    stream.on('response',value=>{headers=value;});stream.on('data',chunk=>chunks.push(Buffer.from(chunk)));
    stream.once('end',()=>{
     if(finished)return;
     try{
      if(!headers)throw new Error('HTTP/2 response headers missing');
      const status=Number(headers[':status']),responseHeaders=new Headers();
      for(const [key,value]of Object.entries(headers))if(!key.startsWith(':')&&value!=null)responseHeaders.set(key,Array.isArray(value)?value.join(', '):String(value));
      let body=Buffer.concat(chunks);const encoding=responseHeaders.get('content-encoding');
      if(encoding==='gzip')body=gunzipSync(body);else if(encoding==='deflate')body=inflateSync(body);else if(encoding==='br')body=brotliDecompressSync(body);else if(encoding&&encoding!=='identity')throw new Error(`Unsupported gateway encoding: ${encoding}`);
      if(encoding){responseHeaders.delete('content-encoding');responseHeaders.delete('content-length');}
      const response=new Response([204,205,304].includes(status)?null:body,{status,headers:responseHeaders});
      response.ssgeTransport={protocol:'h2',alpn:session.socket.alpnProtocol,remoteAddress:session.socket.remoteAddress??null};
      finished=true;close();resolve(response);
     }catch(error){fail(error);}
    });
    stream.end(options.body??undefined);
   });
  });
 };
}
