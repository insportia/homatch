importScripts('adapters/contract.js','adapters/portals.js');
const contract=globalThis.HOMATCH_ADAPTER_CONTRACT,portals=globalThis.HOMATCH_PORTAL_REGISTRY.portals;
const actions=new Set(contract.actions);
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 let page;try{page=new URL(sender.tab?.url);}catch{return;}
 if(sender.id!==chrome.runtime.id||sender.frameId>0||!((page.origin==='http://127.0.0.1:4177')||(['https://homatch.live','https://www.homatch.live'].includes(page.origin)&&page.pathname==='/property/publish')))return;
 (async()=>{
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
