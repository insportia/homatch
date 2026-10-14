// SS.ge DOM adapter. Uses the existing browser session; never reads session storage/cookies.
// Named controls derive from recording steps 63, 97-104, 184, 210 and 216.
// Semantic fallbacks require a unique match; generated classes are deliberately excluded.
(()=>{
'use strict';
if(globalThis.HOMATCH_ADAPTERS?.ssge)return;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const visible=e=>!!e.getClientRects().length&&!e.disabled;
const all=(s,root=document)=>[...root.querySelectorAll(s)];
const one=(xs,key)=>{xs=[...new Set(xs)].filter(visible);if(xs.length!==1)throw Error(`${xs.length?'AMBIGUOUS':'MISSING'}_FIELD:${key}`);return xs[0];};
const mappings={
 area:{names:['totalArea'],labels:['საერთო ფართი']},floor:{names:['floor'],labels:['სართული']},
 totalFloors:{names:['floors'],labels:['სართულიანობა']},streetNumber:{names:['house-number'],labels:['სახლის ნომერი']},
 rooms:{names:['rooms'],labels:['ოთახები','ოთახების რაოდენობა']},bedrooms:{names:['bedrooms'],labels:['საძინებლები','საძინებელი']},
 price:{names:['price','totalPrice'],labels:['ფასი']},contactName:{names:['contactName'],labels:['სახელი გამოჩნდება თქვენს გაცხადებაზე']},
 contactPhone:{names:['phone','contactPhone'],labels:['ტელეფონის ნომერი']},
 city:{names:['city'],labels:['ქალაქი','მდებარეობა']},district:{names:['district'],labels:['უბანი','რაიონი']},street:{names:['street'],labels:['ქუჩა']},
 kitchenArea:{names:['kitchenArea'],labels:['სამზარეულოს ფართი']},livingArea:{names:['livingArea'],labels:['საცხოვრებელი ფართი']},
 landArea:{names:['landArea'],labels:['მიწის ფართი']},yardArea:{names:['yardArea'],labels:['ეზოს ფართი']},
 balconyArea:{names:['balconyArea'],labels:['აივნის ფართი']},ceilingHeight:{names:['ceilingHeight'],labels:['ჭერის სიმაღლე']}
};
const types={apartment:'ბინა',house:'კერძო სახლი',land:'მიწის ნაკვეთი',commercial:'კომერციული ფართი',hotel:'სასტუმრო'};
const deals={sale:'იყიდება',rent:'ქირავდება',daily_rent:'ქირავდება დღიურად'};
const choices={buildingType:['ძველი აშენებული','ახალი აშენებული','მშენებარე'],condition:['ახალი გარემონტებული','ძველი გარემონტებული','სარემონტო']};
function field(key){const m=mappings[key];for(const name of m.names){const xs=all('input,textarea,select').filter(e=>e.name===name&&visible(e));if(xs.length)return one(xs,key);}return one(all('input,textarea,select').filter(e=>m.labels.includes(clean(e.placeholder))||m.labels.includes(clean(e.getAttribute('aria-label')))||[...(e.labels||[])].some(l=>m.labels.includes(clean(l.textContent)))),key);}
function set(e,v){const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
function option(text){const e=one(all('button,label,[role=radio],[role=option]').filter(e=>clean(e.textContent)===clean(text)),text);if(e.matches('button')&&e.type==='submit')throw Error('UNSAFE_SUBMIT_CONTROL');return e;}
function selected(e){return e.checked===true||e.querySelector('input')?.checked===true||['aria-checked','aria-selected','aria-pressed'].some(k=>e.getAttribute(k)==='true');}
async function wait(fn,code){const until=Date.now()+6000;while(Date.now()<until){const x=fn();if(x)return x;await new Promise(r=>setTimeout(r,100));}throw Error(code);}
async function autocomplete(key,value){const e=field(key);if(e.tagName==='SELECT'){const xs=[...e.options].filter(o=>clean(o.textContent)===clean(value));if(xs.length!==1)throw Error(`AMBIGUOUS_LOCATION:${key}`);set(e,xs[0].value);return;}e.focus();set(e,value);const menu=await wait(()=>{const xs=all('[role=option]').filter(n=>visible(n)&&clean(n.textContent)===clean(value));if(xs.length>1)throw Error(`AMBIGUOUS_LOCATION:${key}`);return xs[0];},`LOCATION_SELECTION_REQUIRED:${key}`);menu.click();await wait(()=>clean(e.value)===clean(value),`LOCATION_NOT_VERIFIED:${key}`);}
function description(locale){const xs=all('textarea').filter(e=>e.name===`description_${locale}`||e.getAttribute('lang')===locale);if(xs.filter(visible).length)return one(xs,`description.${locale}`);if(locale==='ka')return one(all('textarea').filter(e=>e.placeholder==='ჩაწერე აქ...'),'description.ka');throw Error(`MISSING_FIELD:description.${locale}`);}
function currency(value,write=false){const xs=all('select[name=currency],input[name=currency]').filter(visible);if(xs.length){if(xs.every(e=>e.type==='radio')){const radio=one(xs.filter(n=>n.value===value),'currency');if(write)radio.click();return radio.checked;}const e=one(xs,'currency');if(write)set(e,value);return e.value===value;}const text={USD:'$ გამოჩნდეს საიტზე',GEL:'₾ გამოჩნდეს საიტზე'}[value];if(!text)throw Error('UNSUPPORTED_CURRENCY');const e=option(text);if(write)e.click();return selected(e);}
function validate(x){const errors=[];if(!x||!types[x.propertyType]||!deals[x.dealType])errors.push('category');for(const k of ['area','price'])if(!Number.isFinite(x?.[k])||x[k]<=0)errors.push(k);for(const k of ['city','street','streetNumber','contactName','contactPhone'])if(!clean(x?.[k]))errors.push(k);if(!x?.description?.ka)errors.push('description.ka');if(!['USD','GEL'].includes(x?.currency))errors.push('currency');if(!x?.portalTargets?.includes('ssge'))errors.push('portalTargets');if(x?.floor>x?.totalFloors&&x?.totalFloors!=null)errors.push('floor');return errors;}
const supplied=(x,k)=>x[k]!=null&&x[k]!=='';
let uploadDispatched=false;
const adapter={
 id:'ssge',version:'0.3.0',capabilities:{inspect:true,fill:true,uploadPhotos:true,publish:false,edit:false,remove:false,pause:false,resume:false},
 detect:()=>location.origin==='https://home.ss.ge',
 checkAuthentication(){if(all('input[type=password],input[autocomplete=one-time-code]').some(visible))return {status:'AUTH_REQUIRED',manual:true};if(all('input[name=totalArea]').some(visible))return {status:'FORM_ACCESSIBLE'};return {status:'AUTH_NOT_VERIFIED',manual:true};},
 inspect(){return {url:location.origin+location.pathname,fields:all('input:not([type=password]):not([type=hidden]):not([autocomplete=one-time-code]),textarea,select').map(e=>({tag:e.tagName,type:e.type,name:e.name,label:clean(e.getAttribute('aria-label')||e.placeholder||[...(e.labels||[])].map(l=>l.textContent).join(' ')),required:e.required})),valuesIncluded:false};},
 previewListing(x){return {status:'DRAFT_PREVIEW',portalId:'ssge',errors:validate(x),category:types[x?.propertyType],operation:deals[x?.dealType],location:[x?.city,x?.district,x?.street,x?.streetNumber].filter(Boolean),price:x?.price,currency:x?.currency,description:x?.description,photos:(x?.photos||[]).map(p=>({name:p.name,mime:p.mime})),savedOnPortal:false};},
 async fillListing(x){const errors=validate(x);if(errors.length)throw Error(`LISTING_INVALID:${errors.join(',')}`);if(adapter.checkAuthentication().status!=='FORM_ACCESSIBLE')throw Error('AUTH_NOT_VERIFIED');
  // Unsupported optional values must never disappear silently.
  for(const key of ['projectType','heating'])if(supplied(x,key))throw Error(`OPTIONAL_FIELD_MAPPING_REQUIRED:${key}`);
  for(const key of Object.keys(choices))if(supplied(x,key)&&!choices[key].includes(x[key]))throw Error(`OPTIONAL_FIELD_MAPPING_REQUIRED:${key}`);
  option(types[x.propertyType]).click();option(deals[x.dealType]).click();
  for(const k of ['buildingType','condition'])if(supplied(x,k))option(x[k]).click();
  await autocomplete('city',x.city);if(x.district)await autocomplete('district',x.district);await autocomplete('street',x.street);
  for(const k of Object.keys(mappings))if(!['city','district','street'].includes(k)&&supplied(x,k))set(field(k),x[k]);currency(x.currency,true);
  for(const locale of ['ka','en','ru'])if(x.description[locale])set(description(locale),x.description[locale]);
  return {status:'FORM_FILLED_REQUIRES_VERIFICATION',publicationReady:false};
 },
 async uploadPhotos(photos){if(uploadDispatched)throw Error('UPLOAD_RECONCILIATION_REQUIRED');if(!Array.isArray(photos)||!photos.length||photos.length>16)throw Error('PHOTO_COUNT_INVALID');const dt=new DataTransfer();for(const p of photos){if(!['image/jpeg','image/png','image/webp'].includes(p.mime)||!p.base64)throw Error('PHOTO_INVALID');const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));if(bytes.length<12||bytes.length>8000000)throw Error('PHOTO_SIZE_INVALID');const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)?'image/png':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;if(mime!==p.mime)throw Error('PHOTO_CONTENT_MISMATCH');dt.items.add(new File([bytes],p.name,{type:p.mime}));}const inputs=all('input[type=file]').filter(e=>!e.disabled);if(inputs.length!==1)throw Error('PHOTO_INPUT_AMBIGUOUS');const e=inputs[0];uploadDispatched=true;e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));return {status:'UPLOAD_DISPATCHED',count:photos.length,verified:false};},
 verifyForm(x){const errors=validate(x);for(const k of Object.keys(mappings))if(supplied(x,k)){try{const e=field(k);const actual=e.tagName==='SELECT'?e.selectedOptions[0]?.textContent:e.value;if(clean(actual)!==clean(x[k]))errors.push(k);}catch{errors.push(k);}}for(const [key,text]of [['propertyType',types[x.propertyType]],['dealType',deals[x.dealType]],['buildingType',x.buildingType],['condition',x.condition]])if(text){try{if(!selected(option(text)))errors.push(key);}catch{errors.push(key);}}try{if(!currency(x.currency))errors.push('currency');}catch{errors.push('currency');}for(const locale of ['ka','en','ru'])if(x.description?.[locale]){try{if(description(locale).value!==x.description[locale])errors.push(`description.${locale}`);}catch{errors.push(`description.${locale}`);}}if(all('[aria-invalid=true],input:invalid,textarea:invalid,select:invalid').some(visible))errors.push('PORTAL_VALIDATION');return {status:errors.length?'ACTION_REQUIRED':'FORM_FIELDS_MATCH',errors:[...new Set(errors)],publicationReady:false};},
 preparePublish(x){const result=adapter.verifyForm(x);return {...result,status:'ACTION_REQUIRED',code:result.errors.length?'FORM_VERIFICATION_FAILED':'LIVE_BROWSER_VERIFICATION_REQUIRED',preview:adapter.previewListing(x),unverified:['authenticated account identity','photo upload completion','verified contact phone','free publication controls','submission result']};},
 publishAfterConfirmation(){return {status:'ACTION_REQUIRED',code:'PUBLISH_BLOCKED_UNTIL_LIVE_VERIFIED'};},
 extractPublishedListing(){return {status:'UNVERIFIED',code:'RECONCILIATION_REQUIRED'};},
 editListing(){return {status:'UNSUPPORTED_OPERATION',code:'LIVE_MANAGEMENT_VERIFICATION_REQUIRED'};},
 checkStatus(){return {status:'UNVERIFIED',url:location.origin+location.pathname,code:'LIVE_MANAGEMENT_VERIFICATION_REQUIRED'};}
};globalThis.HOMATCH_ADAPTERS??={};globalThis.HOMATCH_ADAPTERS.ssge=adapter;
})();
