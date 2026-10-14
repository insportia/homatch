importScripts('adapters/contract.js','adapters/portals.js');
const contract=globalThis.HOMATCH_ADAPTER_CONTRACT,portals=globalThis.HOMATCH_PORTAL_REGISTRY.portals;
const actions=new Set(contract.actions);
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 let page;try{page=new URL(sender.tab?.url);}catch{return;}
 if(sender.id!==chrome.runtime.id||sender.frameId>0||!((page.origin==='http://127.0.0.1:4177')||(['https://homatch.live','https://www.homatch.live'].includes(page.origin)&&page.pathname==='/property/publish')))return;
 (async()=>{
  if(m.type==='HELLO')return {ok:true,extensionInstalled:true,contractVersion:contract.version,version:'0.3.0'};
  if(m.type==='CONNECT_PORTAL'){
   const portal=portals.find(p=>p.id===m.portalId);if(!portal?.browser?.connectUrl)throw Error('COMMAND_NOT_ALLOWED');
   const u=new URL(portal.browser.connectUrl);if(!portal.browser.writeOrigins.includes(u.origin))throw Error('COMMAND_NOT_ALLOWED');
   const matches=await chrome.tabs.query({url:portal.browser.writeOrigins.map(o=>o+'/*')});
   const tab=matches[0]||await chrome.tabs.create({url:u.href});return {ok:true,tab:{id:tab.id,portalId:portal.id},authenticationRequired:true};
  }
  if(m.type==='RUN_OPERATION'){
   const portal=portals.find(p=>p.id===m.portalId),op=m.operation;
   const method=contract.operationActions[op?.kind],proof=portal?.verifiedOperations?.[op?.kind];
   if(!method||op?.portal_id!==portal?.id||op.status!=='RUNNING'||!op.lease_token||!proof?.verified||!proof.evidence||portal.maintenance)return {ok:true,result:{status:'ACTION_REQUIRED',code:'CAPABILITY_UNVERIFIED',verified:false}};
   if(['PUBLISH','DELETE','REFRESH'].includes(op.kind)&&!op.confirmed_at)return {ok:true,result:{status:'ACTION_REQUIRED',code:'EXPLICIT_CONFIRMATION_REQUIRED',verified:false}};
   const tab=await chrome.tabs.get(m.tabId);if(!portal.browser.writeOrigins.includes(new URL(tab.url).origin))throw Error('PORTAL_TAB_CHANGED');
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:[portal.browser.script]});
   const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async(id,method,command,origins)=>{
    if(!origins.includes(location.origin))return {status:'ACTION_REQUIRED',code:'PORTAL_TAB_CHANGED',verified:false};
    const adapter=globalThis.HOMATCH_ADAPTERS?.[id];if(typeof adapter?.[method]!=='function')return {status:'UNSUPPORTED_OPERATION',code:'CAPABILITY_UNVERIFIED',verified:false};
    const auth=await adapter.checkAuthentication();if(auth.status!=='AUTHENTICATED'||auth.verified!==true)return {status:'AUTH_REQUIRED',code:'AUTH_REQUIRED',verified:false};
    const op=command.operation;
    try{
     let output;
     if(op.kind==='PUBLISH'){
      if(command.phase!=='CONFIRM'){
       await adapter.fillListing(command.listing);await adapter.uploadPhotos(command.photos||[]);
       const check=await adapter.preparePublish(command.listing);return {...check,verified:false};
      }
      if(command.approval!==true||typeof command.reviewToken!=='string')return {status:'ACTION_REQUIRED',code:'EXPLICIT_CONFIRMATION_REQUIRED',verified:false};
      const submitted=await adapter.publishAfterConfirmation({listing:command.listing,reviewToken:command.reviewToken,confirmed:true});
      if(submitted.status!=='SUBMISSION_STARTED')return {...submitted,verified:false};
      output=await adapter.extractPublishedListing();
     }else if(op.kind==='EDIT')output=await adapter.editListing(op.external_id,command.listing);
     else if(op.kind==='UPDATE_PHOTOS')output=await adapter.updatePhotos(op.external_id,command.photos);
     else if(op.kind==='CREATE')output=await adapter.fillListing(command.listing);
     else output=await adapter[method](op.external_id,op.desired_revision);
     return {...output,operationId:op.id,revision:op.desired_revision,payloadHash:op.payload_hash};
    }catch(e){return {status:'ACTION_REQUIRED',code:/^[A-Z_]+$/.test(e.message)?e.message:'REMOTE_UNVERIFIED',verified:false};}
   },args:[portal.id,method,m,portal.browser.writeOrigins]});return {ok:true,result};
  }
  if(m.type==='CONNECT'){
   const tabs=await chrome.tabs.query({url:portals.flatMap(p=>(p.browser?.writeOrigins||[]).map(o=>o+'/*'))});
   return {ok:true,tabs:tabs.flatMap(t=>{const u=new URL(t.url),portal=portals.find(p=>p.browser?.writeOrigins.includes(u.origin));return portal?[{id:t.id,portalId:portal.id,url:u.origin+u.pathname}]:[];})};
  }
  const portal=portals.find(p=>p.id===m.portalId);
  if(m.type!=='EXECUTE'||!actions.has(m.action)||!portal?.browser)throw Error('COMMAND_NOT_ALLOWED');
  if(m.action==='publishAfterConfirmation'&&portal.execution?.publicationBlocked!==false)return {ok:true,result:{status:'ACTION_REQUIRED',code:'LIVE_BROWSER_VERIFICATION_REQUIRED'}};
  const allowedOrigins=[...portal.browser.writeOrigins,...(contract.readPublished.includes(m.action)?portal.browser.readOrigins:[])];
  const tab=await chrome.tabs.get(m.tabId);if(!allowedOrigins.includes(new URL(tab.url).origin))throw Error('PORTAL_TAB_CHANGED');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:[portal.browser.script]});
  const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async(portalId,action,payload,origins,required)=>{
   try{
    if(!origins.includes(location.origin))return {status:'ACTION_REQUIRED',code:'PORTAL_TAB_CHANGED'};
    const adapter=globalThis.HOMATCH_ADAPTERS?.[portalId];
    if(adapter?.id!==portalId||required.some(k=>typeof adapter[k]!=='function'))return {status:'ACTION_REQUIRED',code:'ADAPTER_CONTRACT_INVALID'};
    return await adapter[action](payload);
   }catch(e){return {status:'ACTION_REQUIRED',code:String(e.message).split(':')[0],field:String(e.message).split(':')[1]};}
  },args:[portal.id,m.action,m.payload??null,allowedOrigins,contract.required]});return {ok:true,result};
 })().then(reply).catch(()=>reply({ok:false,code:'BROWSER_DISCONNECTED_OR_COMMAND_REJECTED'}));return true;
});
