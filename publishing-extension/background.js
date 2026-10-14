const actions=new Set(['checkAuthentication','inspect','fillListing','uploadPhotos','verifyForm','preparePublish','publishAfterConfirmation','extractPublishedListing','editListing','checkStatus']);
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 let page;try{page=new URL(sender.tab?.url);}catch{return;}
 if(sender.id!==chrome.runtime.id||sender.frameId>0||!((page.origin==='http://127.0.0.1:4177')||(['https://homatch.live','https://www.homatch.live'].includes(page.origin)&&page.pathname==='/property/publish')))return;
 (async()=>{
  if(m.type==='CONNECT'){const tabs=await chrome.tabs.query({url:['https://statements.myhome.ge/*']});return {ok:true,tabs:tabs.map(t=>({id:t.id,portalId:'myhome',url:new URL(t.url).origin+new URL(t.url).pathname}))};}
  if(m.type!=='EXECUTE'||!actions.has(m.action)||m.portalId!=='myhome')throw Error('COMMAND_NOT_ALLOWED');
  const tab=await chrome.tabs.get(m.tabId),origin=new URL(tab.url).origin;const readPublished=['extractPublishedListing','checkStatus'].includes(m.action)&&['https://myhome.ge','https://www.myhome.ge'].includes(origin);if(origin!=='https://statements.myhome.ge'&&!readPublished)throw Error('PORTAL_TAB_CHANGED');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['adapters/myhome/adapter.js']});
  const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async(action,payload)=>{try{const read=['extractPublishedListing','checkStatus'].includes(action);if(location.origin!=='https://statements.myhome.ge'&&!(read&&['https://myhome.ge','https://www.myhome.ge'].includes(location.origin)))return {status:'ACTION_REQUIRED',code:'PORTAL_TAB_CHANGED'};return await globalThis.HOMATCH_ADAPTERS.myhome[action](payload);}catch(e){return {status:'ACTION_REQUIRED',code:String(e.message).split(':')[0],field:String(e.message).split(':')[1]};}},args:[m.action,m.payload??null]});return {ok:true,result};
 })().then(reply).catch(()=>reply({ok:false,code:'BROWSER_DISCONNECTED_OR_COMMAND_REJECTED'}));return true;
});
