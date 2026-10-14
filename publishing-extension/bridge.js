window.addEventListener('message',async event=>{
 if(!(location.origin==='http://127.0.0.1:4177'||(['https://homatch.live','https://www.homatch.live'].includes(location.origin)&&location.pathname==='/property/publish')))return;
 if(event.source!==window||event.origin!==location.origin||event.data?.source!=='HOMATCH_UI')return;
 const m=event.data;if(typeof m.requestId!=='string'||m.requestId.length>80)return;
 try{const response=await chrome.runtime.sendMessage(m.command);window.postMessage({source:'HOMATCH_CONNECTOR',requestId:m.requestId,response},location.origin);}catch{window.postMessage({source:'HOMATCH_CONNECTOR',requestId:m.requestId,response:{ok:false,code:'RELOAD_HOMATCH_EXTENSION'}},location.origin);}
});
