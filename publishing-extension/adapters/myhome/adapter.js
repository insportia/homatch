// Injected only into the explicitly permitted MyHome statements origin. No session extraction.
(()=>{
const clean=s=>String(s??'').replace(/\*/g,'').replace(/\s+/g,' ').trim();
const visible=e=>!!(e.getClientRects().length)&&!e.disabled;
function labelText(label){const clone=label.cloneNode(true);for(const node of clone.querySelectorAll('button,input,textarea,svg'))node.remove();return clean(clone.textContent);}
function one(nodes,field){const xs=[...new Set(nodes)].filter(visible);if(xs.length!==1)throw Error(`${xs.length?'AMBIGUOUS':'MISSING'}_FIELD:${field}`);return xs[0];}
function input(label,name){
 if(name){const xs=[...document.querySelectorAll('input,textarea')].filter(e=>e.name===name);if(xs.length)return one(xs,label);}
 return one([...document.querySelectorAll('input:not([type=hidden]),textarea')].filter(e=>[...(e.labels||[])].some(l=>labelText(l)===clean(label))||clean(e.getAttribute('aria-label'))===clean(label)),label);
}
function set(e,v){const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
async function wait(check,code,ms=8000){const until=Date.now()+ms;while(Date.now()<until){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error(code);}
function exactOption(text,scope=document){return one([...scope.querySelectorAll('[role=option],label,button')].filter(e=>clean(e.textContent)===clean(text)),text);}
async function autocomplete(label,value,city){const e=input(label);e.focus();set(e,value);const option=await wait(()=>{const xs=[...document.querySelectorAll('[role=option]')].filter(n=>visible(n)&&clean(n.textContent)===clean(city?`${value}, ${city}`:value));if(xs.length>1)throw Error('AMBIGUOUS_LOCATION');return xs[0];},'AUTOCOMPLETE_SELECTION_REQUIRED');option.click();await wait(()=>clean(e.value)===clean(value)||clean(e.value)===clean(`${value}, ${city}`),'LOCATION_NOT_VERIFIED');}
const labels={streetNumber:'ქუჩის ნომერი',area:'ფართი',floor:'სართული',totalFloors:'სართულები სულ',rooms:'ოთახები',bedrooms:'საძინებლები',contactName:'სახელი',contactPhone:'ტელეფონის ნომერი'};
let review=null,submissionStarted=false;
const adapter={
 id:'myhome',version:'0.2.0',capabilities:{inspect:true,fill:true,uploadPhotos:true,publish:false,edit:false,remove:false,pause:false,resume:false},
 detect:()=>location.origin==='https://statements.myhome.ge',
 checkAuthentication(){const login=[...document.querySelectorAll('a,button')].find(e=>visible(e)&&['შესვლა','ავტორიზაცია'].includes(clean(e.textContent)));if(login)return {status:'AUTH_REQUIRED'};const form=document.querySelector('input[name=total_price]');return {status:form?'FORM_ACCESSIBLE':'AUTH_NOT_VERIFIED'};},
 inspect(){return {url:location.origin+location.pathname,fields:[...document.querySelectorAll('input:not([type=hidden]),textarea,select')].map(e=>({tag:e.tagName,type:e.type,name:e.name,label:[...(e.labels||[])].map(l=>clean(l.textContent)).join(' '),required:e.required})),livoControl:[...document.querySelectorAll('label')].filter(e=>/livo/i.test(e.textContent)).map(e=>({text:clean(e.textContent).slice(0,100),checked:e.querySelector('input')?.checked??null}))};},
 async fillListing(listing){review=null;if(submissionStarted)throw Error('RECONCILIATION_REQUIRED');if(listing.propertyType!=='apartment')throw Error('PROPERTY_TYPE_NOT_IMPLEMENTED');
  for(const key of ['projectType','heating','balconyArea','ceilingHeight','livingArea','yardArea','landArea'])if(listing[key]!=null&&listing[key]!=='')throw Error(`OPTIONAL_FIELD_MAPPING_REQUIRED:${key}`);
  exactOption('ბინა').click();exactOption(({sale:'იყიდება',rent:'ქირავდება',daily_rent:'ქირავდება დღიურად'})[listing.dealType]).click();
  if(listing.buildingType)exactOption(listing.buildingType).click();if(listing.condition)exactOption(listing.condition).click();
  await autocomplete('მდებარეობა',listing.city);await autocomplete('ქუჩა',listing.street,listing.city);
  set(input('ფასი','total_price'),listing.price);
  for(const [key,label]of Object.entries(labels))if(listing[key]!=null&&listing[key]!=='')set(input(label),listing[key]);
  if(listing.currency!=='USD')throw Error('CURRENCY_CONTROL_NOT_VERIFIED');
  let descriptions=[...document.querySelectorAll('textarea')].filter(e=>visible(e)&&(e.getAttribute('lang')==='ka'||e.name==='description_ka'));if(!descriptions.length)descriptions=[...document.querySelectorAll('textarea')].filter(visible);const description=one(descriptions,'description.ka');set(description,listing.description.ka);
  for(const locale of ['en','ru'])if(listing.description[locale]){const e=one([...document.querySelectorAll('textarea')].filter(e=>e.getAttribute('lang')===locale||e.name===`description_${locale}`),`description.${locale}`);set(e,listing.description[locale]);}
  return {status:'FORM_FILLED_REQUIRES_VERIFICATION'};
 },
 async uploadPhotos(photos){if(!photos.length||photos.length>16)throw Error('PHOTO_COUNT_INVALID');if(photos.some(p=>!['image/jpeg','image/png','image/webp'].includes(p.mime)||!p.base64))throw Error('PHOTO_INVALID');const e=one([...document.querySelectorAll('input[type=file]')],'photos');const dt=new DataTransfer();for(const p of photos){const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));dt.items.add(new File([bytes],p.name,{type:p.mime}));}e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));return {status:'UPLOAD_DISPATCHED',count:photos.length,verified:false};},
 verifyForm(listing){const errors=[];for(const [key,label]of Object.entries(labels)){if(listing[key]!=null&&listing[key]!==''){try{if(clean(input(label).value)!==clean(listing[key]))errors.push(key);}catch{errors.push(key);}}}try{if(Number(input('ფასი','total_price').value)!==listing.price)errors.push('price');}catch{errors.push('price');}
 for(const [field,label]of [['city','მდებარეობა'],['street','ქუჩა']]){try{const actual=clean(input(label).value);if(actual!==clean(listing[field])&&(field!=='street'||actual!==clean(`${listing.street}, ${listing.city}`)))errors.push(field);}catch{errors.push(field);}}
 for(const [field,text]of [['propertyType','ბინა'],['dealType',({sale:'იყიდება',rent:'ქირავდება',daily_rent:'ქირავდება დღიურად'})[listing.dealType]],['buildingType',listing.buildingType],['condition',listing.condition]])if(text){try{const e=exactOption(text),control=e.matches('input')?e:e.querySelector('input');if(!control?.checked&&e.getAttribute('aria-checked')!=='true'&&e.getAttribute('aria-pressed')!=='true')errors.push(field);}catch{errors.push(field);}}
 const currencies=[...document.querySelectorAll('input[name=currency],select[name=currency]')].filter(visible);if(currencies.length!==1||currencies[0].value!==listing.currency)errors.push('currency');
 for(const locale of ['ka','en','ru'])if(listing.description[locale]){let candidates=[...document.querySelectorAll('textarea')].filter(e=>visible(e)&&(e.name===`description_${locale}`||e.getAttribute('lang')===locale));if(locale==='ka'&&!candidates.length)candidates=[...document.querySelectorAll('textarea')].filter(visible);if(candidates.length!==1||candidates[0].value!==listing.description[locale])errors.push(`description.${locale}`);}
 const livo=[...document.querySelectorAll('label')].filter(e=>/livo/i.test(e.textContent));if(livo.some(e=>e.querySelector('input')?.checked)&&!listing.portalTargets.includes('livo'))errors.push('UNSELECTED_LIVO_CROSSPOST');
 const otp=[...document.querySelectorAll('input')].some(e=>visible(e)&&[...(e.labels||[])].some(l=>clean(l.textContent)==='კოდი'));if(otp)return {status:'WAITING_FOR_USER_OTP',errors};
 return {status:errors.length?'ACTION_REQUIRED':'FORM_FIELDS_MATCH',errors,publicationReady:false,reason:'PHOTO_CURRENCY_AUTH_AND_PUBLICATION_CONTROLS_REQUIRE_LIVE_VERIFICATION'};
 },
 preparePublish(listing){
  const check=adapter.verifyForm(listing);if(check.status!=='FORM_FIELDS_MATCH')return check;
  const e=input(labels.contactPhone),group=e.closest('label')?.parentElement;
  if(!group||!(/დადასტურებულია|ვერიფიცირებული/.test(group.textContent)||group.querySelector('[data-verified=true],[aria-label="Verified"]')))return {status:'PHONE_VERIFICATION_REQUIRED'};
  // A dispatched change event is not upload completion. Require portal-rendered completion markers.
  const uploaded=[...document.querySelectorAll('[data-upload-status="complete"], [data-testid="uploaded-photo"]')].filter(visible);
  if(!listing.photos.length||uploaded.length!==listing.photos.length)return {status:'ACTION_REQUIRED',code:'PHOTO_COMPLETION_NOT_VERIFIED'};
  const button=exactOption('გამოქვეყნება');if(!button||button.disabled)return {status:'ACTION_REQUIRED',code:'PUBLISH_BUTTON_DISABLED'};
  if(!/უფასო/.test(button.closest('section,footer,form')?.textContent||''))return {status:'ACTION_REQUIRED',code:'FREE_PUBLICATION_NOT_VERIFIED'};
  review={token:crypto.randomUUID(),fingerprint:JSON.stringify(listing),expires:Date.now()+120000};return {status:'READY_FOR_REVIEW',reviewToken:review.token};
 },
 publishAfterConfirmation(payload){
  if(submissionStarted)return {status:'ACTION_REQUIRED',code:'RECONCILIATION_REQUIRED'};
  if(!payload?.confirmed||!review||payload.reviewToken!==review.token||Date.now()>review.expires||JSON.stringify(payload.listing)!==review.fingerprint)return {status:'ACTION_REQUIRED',code:'REVIEW_CONFIRMATION_REQUIRED'};
  const checked=adapter.preparePublish(payload.listing);if(checked.status!=='READY_FOR_REVIEW'){review=null;return checked;}
  const button=exactOption('გამოქვეყნება');if(button.disabled)throw Error('PUBLISH_BUTTON_DISABLED');review=null;submissionStarted=true;button.click();return {status:'SUBMISSION_STARTED',verified:false};
 },
 extractPublishedListing(){const u=new URL(location.href);const match=u.pathname.match(/\/pr\/(\d+)(?:\/|$)/);return u.protocol==='https:'&&(u.hostname==='myhome.ge'||u.hostname==='www.myhome.ge')&&match?{status:'PUBLISHED',externalId:match[1],externalUrl:u.origin+u.pathname}:{status:'UNVERIFIED',code:'RECONCILIATION_REQUIRED'};},
 editListing(){return {status:'UNSUPPORTED_OPERATION'};},checkStatus(){return {status:'UNVERIFIED'};}
};globalThis.HOMATCH_ADAPTERS??={};globalThis.HOMATCH_ADAPTERS.myhome??=adapter;
})();
