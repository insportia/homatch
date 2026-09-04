import express from 'express';
import { chromium } from 'playwright';
import pdf from 'pdf-parse';
const app=express();
const ALLOWED_ORIGINS=new Set(['https://homatch.live','https://www.homatch.live']);
app.use((req,res,next)=>{const origin=String(req.headers.origin||'');if(origin&&(ALLOWED_ORIGINS.has(origin)||/^https:\/\/homatch-[a-z0-9-]+-insportia\.vercel\.app$/i.test(origin))){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});app.use(express.json({limit:'1mb'}));
const PORT=Number(process.env.PORT||3000),TOKEN=process.env.WORKER_TOKEN||'',SUPABASE_URL=process.env.SUPABASE_URL||'';const jobs=new Map(),sessions=new Map(),TTL=15*60*1000;const SOURCES={tas:{name:'TAS',class:'OFFICIAL_GOVERNMENT',url:'https://tas.ge/?p=searchdocument&menuItemId=7104'},msmap:{name:'MS Cadastral Map',class:'OFFICIAL_GOVERNMENT',url:'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19'},mygov:{name:'MY.GOV.GE Property Service',class:'OFFICIAL_GOVERNMENT',url:'https://www.my.gov.ge/ka-ge/services/5/service/176'},enreg:{name:'Entrepreneur Registry',class:'OFFICIAL_REGISTRY',url:'https://enreg.reestri.gov.ge/main.php?m=new_index'},napr:{name:'NAPR',class:'OFFICIAL_REGISTRY',url:'https://napr.gov.ge/'}};const now=()=>new Date().toISOString();

// ── Evidence-gating (2026-09-04 fix) ─────────────────────────────────────────
// Verified against a REAL live job (01.18.06.019.055.03.01.501, job
// 8d85acee-...) run on this exact deployed worker: my.gov.ge's generic
// site-search echoes the query back inside "ძიების შედეგები
// \"<query>\"-სთვის" even when the page's own heading says "ჩანაწერი ვერ
// მოიძებნა" (no record found) — so a plain substring match on the query
// alone is not evidence, it is a guaranteed false positive on every
// "no results" page that repeats the search term. A real positive now
// requires the query to appear WITHOUT an explicit negative-result phrase
// dominating the page; a negative-result phrase always wins and is reported
// as NO_RESULT_CONFIRMED (still a fact — "not found" is a valid, evidenced
// outcome) rather than silently becoming a false RESULT_CONFIRMED.
const NO_RESULT_PATTERNS=[/ჩანაწერი\s*ვერ\s*მოიძებნა/i,/ვერ\s*მოიძებნა/i,/არ\s*მოიძებნა/i,/შედეგი\s*ვერ\s*მოიძებნა/i,/no\s*results?\s*(were\s*)?found/i,/nothing\s*found/i,/0\s*results?\b/i,/not\s*found/i,/не\s*найдено/i,/ничего\s*не\s*найдено/i];
function hasNoResultPhrase(t){return NO_RESULT_PATTERNS.some(re=>re.test(t||''))}
// Login-wall heuristics — used only when no search control could be matched,
// to distinguish "genuinely requires authentication" (AUTH_REQUIRED, a real
// fact worth reporting) from "our selectors just didn't find the field"
// (SEARCH_CONTROL_NOT_FOUND). Never asserted just because a login link
// exists somewhere on the page (most GE gov portals always show one) —
// only when a control also could not be found.
const AUTH_HINTS=[/ავტორიზაცი/i,/გაიარეთ\s*ავტორიზაცია/i,/გთხოვთ\s*გაიაროთ\s*ავტორიზაცია/i,/sign\s*in\s*to\s*continue/i,/please\s*log\s*in/i,/authorization\s*required/i];
function looksAuthGated(t){return AUTH_HINTS.some(re=>re.test(t||''))}
// Document-link matching (2026-09-04 fix): the previous regex matched bare
// "document"/"download" substrings, which caught the page's OWN url
// (?p=searchdocument) and TAS's Adobe Reader installer link
// (get.adobe.com/reader/download/...) as if they were retrieved evidence
// documents — confirmed live on TAS. Now requires either a real file
// extension or a strong Georgian/English document-retrieval phrase, and
// explicitly excludes known non-document hosts (browser/plugin installers,
// social platforms) regardless of keyword match.
const JUNK_DOC_HOSTS=/(get\.adobe\.com|adobe\.com|google\.com\/chrome|facebook\.com|twitter\.com|x\.com|youtube\.com|flickr\.com|instagram\.com)/i;
const DOC_EXT=/\.(pdf|docx?|xlsx?)(?:$|\?)/i;
const DOC_PHRASE=/ამონაწერ|გადმოწერ(?:ა|ეთ)?\s|დოკუმენტ(?:ის|ები)?\s*(გადმოწერ|ჩამოტვირთ)|extract\s*document|download\s*document/i;
function isRealDocumentLink(x){const u=String(x.url||'');if(JUNK_DOC_HOSTS.test(u))return false;if(DOC_EXT.test(u))return true;return DOC_PHRASE.test(`${x.label||''} ${u}`)}

function safeUrl(u){try{const x=new URL(u);return['http:','https:'].includes(x.protocol)?x.toString():null}catch{return null}}function official(u){try{return/(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge)$/i.test(new URL(u).hostname)}catch{return false}}function dedupe(a,k){return[...new Map(a.map(x=>[k(x),x])).values()]}
// Requested per-source diagnostic trace (2026-09-04, per direct instruction):
// every job result now carries START_URL/FINAL_URL/FRAME_URLS/
// SEARCH_CONTROL_USED/QUERY_ENTERED/SUBMIT_ACTION/RESULT_CONTEXT so the exact
// real DOM/frame structure and the evidence the status decision was based on
// is inspectable via GET /research/:id without guessing — this worker never
// had frame-level visibility before this change, so any prior "this looks
// like the tbilisi.gov.ge portal chrome" read was inferred from page TEXT
// content only, not from confirmed iframe structure.
function snippetAround(haystack,needle,radius=90){if(!haystack||!needle)return null;const i=haystack.indexOf(needle);if(i<0)return null;return haystack.slice(Math.max(0,i-radius),i+needle.length+radius).replace(/\s+/g,' ').trim()}
// text() (2026-09-04 fix): was reading ONLY the top-level document's body,
// which is why a real, confirmed submission on TAS (searchControlUsed:
// input[name*="cad" i], submitAction: ENTER_KEY, job f7cba28c-...) still
// produced an EMPTY resultContext and SUBMITTED_UNCONFIRMED — the actual
// ExtJS result content renders inside the docs.tbilisi.gov.ge iframe, which
// this never looked at. Now aggregates innerText across every frame
// Playwright sees (same frame set pageLinks()/fillAny() already use via
// contexts()), so a result rendered inside an embedded app is actually
// visible to the evidence-gating logic instead of silently invisible.
const text=async(p,n=120000)=>{const parts=[];for(const f of contexts(p)){try{parts.push(await f.locator('body').innerText({timeout:8000}))}catch{}}return parts.join('\n').slice(0,n)};async function visible(x){try{return await x.count()&&await x.isVisible()}catch{return false}}
async function challenge(p){for(const f of p.frames()){for(const s of ['iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','iframe[src*="turnstile" i]','.g-recaptcha','.h-captcha','.cf-turnstile','[class*="captcha" i]','[id*="captcha" i]','[role="checkbox"][aria-label*="robot" i]']){const x=f.locator(s).first();if(await visible(x))return{frame:f,el:x,matched:s}}const b=(await f.locator('body').innerText().catch(()=>'' )).slice(0,15000).toLowerCase();if(/verify you are human|i am not a robot|i'm not a robot|captcha|მე არ ვარ რობოტი|არ ვარ რობოტი/.test(b)){const x=f.locator('iframe,input,button,[role="checkbox"],[role="dialog"]').first();if(await visible(x))return{frame:f,el:x,matched:'text-fallback'}}}return null}const contexts=p=>[p.mainFrame(),...p.frames().filter(f=>f!==p.mainFrame())];
// fillAny: the specific `hints` selectors are tried first (highest
// confidence — these are the actual cadastral/property-search fields we
// know about per source). The generic fallback pass now EXCLUDES inputs
// living inside <header>/<nav>/[role=banner]/[role=navigation] — confirmed
// live on my.gov.ge that without this exclusion the fallback grabs the
// site-wide global search box in the page header (which happily accepts
// and echoes the cadastral code, then routes to a generic /search results
// page that is NOT the property service) instead of correctly reporting
// that no matching field exists on that specific service page.
async function fillAny(p,q,hints=[]){for(const f of contexts(p)){for(const s of hints){const x=f.locator(s).first();try{if(await visible(x)){await x.fill(q);if((await x.inputValue().catch(()=>'' )).replace(/\s/g,'')===q.replace(/\s/g,''))return{frame:f,el:x,selector:s,scope:'HINT'}}}catch{}}const inputs=f.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');const n=Math.min(await inputs.count().catch(()=>0),40);for(let i=0;i<n;i++){const x=inputs.nth(i);if(!await visible(x))continue;const inChrome=await x.evaluate(el=>!!el.closest('header, nav, [role="banner"], [role="navigation"]')).catch(()=>false);if(inChrome)continue;const m=((await x.getAttribute('placeholder'))+' '+(await x.getAttribute('name'))+' '+(await x.getAttribute('id'))+' '+(await x.getAttribute('aria-label'))).toLowerCase();if(/საკადასტრო|cadast|cadastr|parcel|უძრავ|ძიება|search/.test(m)){try{await x.fill(q);if((await x.inputValue()).replace(/\s/g,'')===q.replace(/\s/g,''))return{frame:f,el:x,selector:m,scope:'FALLBACK'}}catch{}}}}return null}
// submitNear now reports HOW it submitted (button label matched, or a plain
// Enter keypress) instead of a bare boolean — this is the SUBMIT_ACTION field
// requested for per-source diagnostics, so a human reviewer can tell "clicked
// a button labelled X" apart from "just pressed Enter and hoped".
async function submitNear(p,hit){if(!hit)return{ok:false,method:null};for(const re of [/მოძებნა/i,/ძიება/i,/search/i,/შემდეგ/i,/დადასტურება/i])for(const role of ['button','link']){const x=hit.frame.getByRole(role,{name:re}).first();try{if(await visible(x)){await x.click();await p.waitForTimeout(2000);return{ok:true,method:`CLICK ${role}[name~=${re.source}]`}}}catch{}}try{await hit.el.press('Enter');await p.waitForTimeout(2000);return{ok:true,method:'ENTER_KEY'}}catch{}return{ok:false,method:null}}
async function adapter(p,q,key,hints,name){await p.waitForTimeout(2500);const hit=await fillAny(p,q,hints);if(!hit)return{found:false,submitted:false,adapter:name,searchControlUsed:null,submitAction:null};const sub=await submitNear(p,hit);return{found:true,submitted:sub.ok,submitAction:sub.method,adapter:name,frameUrl:hit.frame.url(),searchControlUsed:hit.selector,scope:hit.scope}}
// TAS hints (2026-09-04 fix): dropped the blind `input[type="text"]`
// catch-all — confirmed live that ?p=searchdocument&menuItemId=7104 renders
// as the tbilisi.gov.ge portal chrome (login/registration widgets in the
// header) with the real document-search form not present as a plain text
// input on that render, so the old catch-all was filling an unrelated
// field and falsely reporting `submitted:true`. Now TAS relies on its
// specific hints plus the same auth-scoped fallback as everyone else, and
// an honest SEARCH_CONTROL_NOT_FOUND / AUTH_REQUIRED when neither matches,
// instead of a guessed submission.
async function search(p,key,q){if(key==='tas')return adapter(p,q,key,['input[placeholder*="საკადასტრო" i]','input[name*="cad" i]','input[id*="cad" i]'],'TAS_FRAME_AWARE');if(key==='msmap')return adapter(p,q,key,['input[placeholder="ძიება"]','input[placeholder*="ძიება" i]','input[type="search"]'],'MSMAP_SPA');if(key==='mygov')return adapter(p,q,key,['input[placeholder*="საკადასტრო" i]','input[name*="cad" i]','input[id*="cad" i]'],'MYGOV_SERVICE');return adapter(p,q,key,[],'GENERIC')}
async function pageLinks(p){const out=[];for(const f of contexts(p)){try{out.push(...await f.locator('a[href]').evaluateAll(as=>as.slice(0,300).map(a=>({label:(a.textContent||'').trim().slice(0,240),url:a.href})).filter(x=>/^https?:/i.test(x.url))))}catch{}}return [...new Map(out.map(x=>[x.url,x])).values()]}
async function pdfEvidence(p,ls){const docs=[];for(const l of ls.filter(isRealDocumentLink).slice(0,12)){try{const r=await p.request.get(l.url,{timeout:20000}),b=await r.body(),ct=(r.headers()['content-type']||'').toLowerCase();if(ct.includes('pdf')||b.subarray(0,4).toString()==='%PDF'){const d=await pdf(b);docs.push({url:l.url,label:l.label,type:'PDF',pages:d.numpages,text:(d.text||'').slice(0,100000),parsed:true,textExtractionAvailable:!!(d.text&&d.text.trim().length>20)})}else{docs.push({url:l.url,label:l.label,type:'DOCUMENT',parsed:false,textExtractionAvailable:false,note:'TEXT_EXTRACTION_UNAVAILABLE: not a text-bearing PDF response'})}}catch(e){docs.push({url:l.url,label:l.label,type:'DOCUMENT',parsed:false,textExtractionAvailable:false,error:String(e)})}}return docs}
// collect(): produces the richer, source-classified evidence record. Status
// is now an explicit enum the downstream AI synthesis step (research-agent)
// can gate on, instead of a single ambiguous boolean:
//   SEARCH_CONFIRMED        — control found, submitted, positive evidence, no negative-result phrase
//   NO_RESULT_CONFIRMED     — submitted successfully AND the source itself says "not found"
//   SUBMITTED_UNCONFIRMED   — submitted but neither a positive nor an explicit negative signal was found
//   AUTH_REQUIRED           — no control found AND the page shows a login gate
//   SEARCH_CONTROL_NOT_FOUND— no control found, no auth gate detected either
//   WAITING_HUMAN           — CAPTCHA/human-verification interstitial blocked progress
async function collect(p,key,sr){const src=SOURCES[key],ls=await pageLinks(p),cap=await challenge(p),docs=cap?[]:await pdfEvidence(p,ls),pageText=await text(p),qRaw=sr?.query||'',q=qRaw.replace(/\s/g,''),pt=pageText.replace(/\s/g,'');const foundControl=!!sr?.found,submitted=!!sr?.submitted,noResultMatch=NO_RESULT_PATTERNS.find(re=>re.test(pageText)),noResult=!!noResultMatch,echoesQuery=submitted&&(pt.includes(q)||docs.some(d=>d.text?.replace(/\s/g,'').includes(q)));let status,resultConfirmed=false,noResultConfirmed=false,authRequired=false,resultContext=null;if(cap){status='WAITING_HUMAN';resultContext='human-verification interstitial blocked further evaluation'}else if(!foundControl){authRequired=looksAuthGated(pageText);status=authRequired?'AUTH_REQUIRED':'SEARCH_CONTROL_NOT_FOUND';resultContext=authRequired?snippetAround(pageText,(pageText.match(new RegExp(AUTH_HINTS.map(r=>r.source).join('|'),'i'))||[])[0]||''):null}else if(!submitted){status='SUBMIT_FAILED'}else if(noResult){status='NO_RESULT_CONFIRMED';noResultConfirmed=true;resultContext=snippetAround(pageText,noResultMatch.exec(pageText)?.[0]||'')}else if(echoesQuery){status='SEARCH_CONFIRMED';resultConfirmed=true;resultContext=snippetAround(pageText,qRaw)||snippetAround(pageText,q)}else{status='SUBMITTED_UNCONFIRMED'}
return{source:key,sourceName:src.name,sourceClass:src.class,sourceUrl:src.url,startUrl:src.url,finalUrl:p.url(),frameUrls:p.frames().map(f=>f.url()),adapter:sr?.adapter||null,frameUrl:sr?.frameUrl||null,searchControlUsed:sr?.searchControlUsed||null,queryEntered:foundControl?qRaw:null,submitAction:sr?.submitAction||null,resultContext,retrievalMethod:submitted?'OFFICIAL_FORM_RESULT':'NO_VERIFIED_SEARCH',searchControlFound:foundControl,submitted,submissionConfirmed:submitted&&!noResult&&!echoesQuery?false:submitted,resultConfirmed,noResultConfirmed,authRequired,searched:submitted,resultValidated:resultConfirmed,status,captcha:!!cap,retrievedAt:now(),pageText,links:ls,documents:docs,documentsDiscovered:ls.filter(isRealDocumentLink).length,documentsExtracted:docs.filter(d=>d.parsed).length,documentLinks:ls.filter(isRealDocumentLink),error:status==='SEARCH_CONTROL_NOT_FOUND'?'source adapter could not locate a matching search control':status==='SUBMIT_FAILED'?'source adapter located the control but could not submit the search':null}}
async function hold(browser,ctx,p,job,key,sr){sessions.set(job.id,{browser,ctx,p,key,query:job.query,sr,expires:Date.now()+TTL});return{r:await collect(p,key,sr),keep:true}}
// Heavy-app wait (2026-09-04, confirmed via a live diagnostic run — see
// frameUrls captured in job af5456f0-...): tas.ge's search page and
// my.gov.ge's property-service page both turn out to EMBED a separate,
// heavier JS application in an iframe — tas.ge loads
// docs.tbilisi.gov.ge/architect/publicInformation.html (an ExtJS + DWR +
// OpenLayers app whose real search form is built entirely client-side, raw
// HTML body is empty) and my.gov.ge/services/5/service/176 loads
// naprweb.reestri.gov.ge/_dea/#/search (an AngularJS app, ng-app=
// "naprweb.main"). A flat 1.5-2.5s wait is not enough for either app to
// finish bootstrapping before fillAny() looks for a search field — that is
// the confirmed, evidenced reason those two sources still report
// AUTH_REQUIRED/SEARCH_CONTROL_NOT_FOUND rather than a real form. This does
// NOT guess at either app's internal selectors (still unknown, and not
// safe to guess) — it only gives them realistic bootstrap time before the
// existing, already-frame-aware fillAny() gets its chance.
const HEAVY_APP_SOURCES=new Set(['tas','mygov']);
async function one(browser,job,key){const src=SOURCES[key],ctx=await browser.newContext({locale:'ka-GE',acceptDownloads:true,viewport:{width:1440,height:1000}}),p=await ctx.newPage();try{await p.goto(src.url,{waitUntil:'domcontentloaded',timeout:45000});await p.waitForTimeout(1500);if(HEAVY_APP_SOURCES.has(key)){try{await p.waitForLoadState('networkidle',{timeout:8000})}catch{}await p.waitForTimeout(1500)}if(await challenge(p))return hold(browser,ctx,p,job,key,{found:false,submitted:false,query:job.query,adapter:`${key.toUpperCase()}_PRESEARCH`});const sr={...(await search(p,key,job.query)),query:job.query};if(await challenge(p))return hold(browser,ctx,p,job,key,sr);const r=await collect(p,key,sr);await ctx.close();return{r,keep:false}}catch(e){await ctx.close().catch(()=>{});return{r:{source:key,sourceName:src.name,sourceClass:src.class,sourceUrl:src.url,startUrl:src.url,finalUrl:null,frameUrls:[],searchControlUsed:null,queryEntered:null,submitAction:null,resultContext:null,status:'FAILED',searched:false,resultConfirmed:false,noResultConfirmed:false,resultValidated:false,error:String(e),retrievedAt:now(),pageText:'',links:[],documents:[]},keep:false}}}
async function run(job,start=0,browser=null){const keys=job.mode==='cadastral'?['tas','msmap','mygov','napr']:['enreg','msmap','napr'];job.status='RUNNING';job.updatedAt=now();try{browser=browser||await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});for(let i=start;i<keys.length;i++){job.sourceIndex=i;job.stage=`CHECKING_${keys[i].toUpperCase()}`;const {r,keep}=await one(browser,job,keys[i]);job.results=job.results.filter(x=>x.source!==keys[i]);job.results.push(r);job.updatedAt=now();if(keep){job.status='WAITING_HUMAN';job.stage='CAPTCHA_REQUIRED';job.humanVerification={source:keys[i],url:r.finalUrl||r.sourceUrl,expiresAt:new Date(Date.now()+TTL).toISOString(),message:'წყარომ მოითხოვა ადამიანის დადასტურება. დაასრულეთ მხოლოდ ეს შემოწმება; იგივე სესია ავტომატურად გაგრძელდება.'};return}}job.status='COMPLETE';job.stage='COMPLETE';job.completedAt=now();job.officialEvidenceCount=job.results.filter(x=>x.resultConfirmed).length;await browser.close().catch(()=>{})}catch(e){job.status='FAILED';job.stage='FAILED';job.error=String(e);await browser?.close().catch(()=>{});job.updatedAt=now()}}
setInterval(async()=>{for(const[id,s]of sessions)if(Date.now()>s.expires){await s.ctx.close().catch(()=>{});await s.browser.close().catch(()=>{});sessions.delete(id)}},30000).unref();
app.get('/health',(_q,r)=>r.json({ok:true,service:'homatch-official-worker',version:'1.2.0',playwright:true,pdfExtraction:true,sourceAdapters:['tas-frame-aware','msmap-spa','mygov-service'],humanSessionControls:true,evidenceValidation:true,evidenceModel:'v2-status-enum-2026-09-04'}));
app.post('/research',auth,(req,res)=>{const mode=req.body?.mode==='property'?'property':'cadastral',query=mode==='cadastral'?String(req.body?.query||'').trim().replace(/\s/g,''):String(req.body?.query||'').trim();if(!query)return res.status(400).json({error:'query required'});const id=crypto.randomUUID(),j={id,query,mode,status:'QUEUED',stage:'QUEUED',sourceIndex:0,results:[],createdAt:now(),updatedAt:now()};jobs.set(id,j);run(j);res.status(202).json({accepted:true,jobId:id,status:j.status})});
app.get('/research/:id',auth,(req,res)=>{const j=jobs.get(req.params.id);return j?res.json(j):res.status(404).json({error:'not found'})});
// Screenshot cropping (2026-09-04 fix): previously always returned the full
// 1440x1000 viewport with offsetX/offsetY hardcoded to 0, so the frontend's
// crop-around-the-challenge UI had no real bounding box to work with and any
// click coordinate math against a cropped preview would have been wrong. Now
// re-detects the actual captcha element and, when its bounding box is
// available, screenshots a padded region around exactly that element and
// reports the REAL top-left offset (in full-page pixels) so a click at
// (localX, localY) on the cropped image maps back via
// fullX = localX + offsetX, fullY = localY + offsetY — which is exactly what
// POST /research/:id/action already does with req.body.offsetX/offsetY.
app.get('/research/:id/screenshot',auth,async(req,res)=>{const s=sessions.get(req.params.id);if(!s)return res.status(404).json({error:'active human session not found'});const cap=await challenge(s.p);const PAD=40;let clip=null,offsetX=0,offsetY=0;if(cap){try{const box=await cap.el.boundingBox();if(box){const vp=s.p.viewportSize()||{width:1440,height:1000};const x=Math.max(0,Math.floor(box.x-PAD)),y=Math.max(0,Math.floor(box.y-PAD));const w=Math.min(vp.width-x,Math.ceil(box.width+PAD*2)),h=Math.min(vp.height-y,Math.ceil(box.height+PAD*2));if(w>0&&h>0){clip={x,y,width:w,height:h};offsetX=x;offsetY=y}}}catch{}}const img=clip?await s.p.screenshot({type:'jpeg',quality:85,clip}):await s.p.screenshot({type:'jpeg',quality:80});res.json({image:`data:image/jpeg;base64,${img.toString('base64')}`,width:clip?clip.width:1440,height:clip?clip.height:1000,offsetX,offsetY,cropped:!!clip,url:s.p.url(),source:s.key,captcha:true})});
app.post('/research/:id/action',auth,async(req,res)=>{const s=sessions.get(req.params.id);if(!s)return res.status(404).json({error:'active human session not found'});const x=Number(req.body.x)+Number(req.body.offsetX||0),y=Number(req.body.y)+Number(req.body.offsetY||0);await s.p.mouse.click(x,y);await s.p.waitForTimeout(700);s.expires=Date.now()+TTL;res.json({ok:true,captcha:!!(await challenge(s.p)),url:s.p.url()})});
app.post('/research/:id/resume',auth,async(req,res)=>{const j=jobs.get(req.params.id),s=sessions.get(req.params.id);if(!j||!s)return res.status(404).json({error:'active human session not found'});if(await challenge(s.p))return res.status(409).json({error:'human verification is not complete'});let sr=s.sr;if(!sr?.submitted)sr={...(await search(s.p,s.key,s.query)),query:s.query};if(await challenge(s.p))return res.status(409).json({error:'human verification required after search submission'});if(!sr.submitted)return res.status(422).json({error:'cadastral search could not be submitted after verification'});const r=await collect(s.p,s.key,sr);j.results=j.results.filter(x=>x.source!==s.key);j.results.push(r);j.humanVerification=null;await s.ctx.close().catch(()=>{});sessions.delete(j.id);run(j,j.sourceIndex+1,s.browser);res.status(202).json({accepted:true,jobId:j.id,status:'RUNNING'})});
async function auth(req,res,next){const h=String(req.headers.authorization||'');if(TOKEN&&h===`Bearer ${TOKEN}`)return next();if(SUPABASE_URL&&h.startsWith('Bearer ')){try{const k=String(req.headers.apikey||'');if(!k)return res.status(401).json({error:'apikey required'});if((await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:h,apikey:k}})).ok)return next()}catch{}}return res.status(401).json({error:'unauthorized'})}
app.listen(PORT,'0.0.0.0',()=>console.log(`homatch-official-worker 1.2.0 listening on ${PORT}`));
