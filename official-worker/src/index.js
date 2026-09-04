import express from 'express';
import { chromium } from 'playwright';
import pdf from 'pdf-parse';
import { createHash } from 'crypto';
const app=express();
const ALLOWED_ORIGINS=new Set(['https://homatch.live','https://www.homatch.live']);
app.use((req,res,next)=>{const origin=String(req.headers.origin||'');if(origin&&(ALLOWED_ORIGINS.has(origin)||/^https:\/\/homatch-[a-z0-9-]+-insportia\.vercel\.app$/i.test(origin))){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next()});app.use(express.json({limit:'1mb'}));
const PORT=Number(process.env.PORT||3000),TOKEN=process.env.WORKER_TOKEN||'',SUPABASE_URL=process.env.SUPABASE_URL||'';const jobs=new Map(),sessions=new Map(),debugJobs=new Map(),TTL=15*60*1000;
// SOURCES.mygov (2026-09-04, round 6 — per direct instruction to deduplicate
// MYGOV and NAPR if they resolve to the same authority): job c81a4e1c-...
// proved this source's real search happens on naprweb.reestri.gov.ge, whose
// own page title (captured earlier this session) is "საჯარო რეესტრის
// ეროვნული სააგენტო" — literally "National Agency of Public Registry",
// i.e. NAPR. napr.gov.ge's own homepage (the `napr` source below) has no
// accessible public search entry point at all (confirmed earlier this
// session — only informational/corporate pages, no registry-lookup link).
// So MYGOV service 176 and NAPR are NOT two independent sources; they are
// the same authority reached two different ways, one of which (napr.gov.ge)
// simply has no working entry point. `authority` records this so downstream
// synthesis can describe the result correctly instead of implying "we
// checked NAPR twice, once succeeded once failed" — running `napr` as a
// SEPARATE cadastral-mode check was dropped in run() below (see comment
// there); the `napr` source definition is kept only for property mode.
const SOURCES={tas:{name:'TAS',class:'OFFICIAL_GOVERNMENT',url:'https://tas.ge/?p=searchdocument&menuItemId=7104'},msmap:{name:'MS Cadastral Map',class:'OFFICIAL_GOVERNMENT',url:'https://ms.gov.ge/msmap/#C=44.7433554-41.7850526@Z=19'},mygov:{name:'NAPR — საჯარო რეესტრის ეროვნული სააგენტო (MY.GOV.GE სერვისი 176 → naprweb.reestri.gov.ge)',class:'OFFICIAL_GOVERNMENT',url:'https://www.my.gov.ge/ka-ge/services/5/service/176',authority:'NAPR'},enreg:{name:'Entrepreneur Registry',class:'OFFICIAL_REGISTRY',url:'https://enreg.reestri.gov.ge/main.php?m=new_index'},napr:{name:'NAPR',class:'OFFICIAL_REGISTRY',url:'https://napr.gov.ge/'}};const now=()=>new Date().toISOString();

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
// (2026-09-04, round 2 — confirmed via job 4fddea39-...): TAS's real ExtJS
// result grid does NOT say "ვერ მოიძებნა" on an empty search — it renders a
// grid total counter "სულ მოიძებნა:\n0" plus the ExtJS-standard empty-grid
// caption "No data to display". Neither phrase was in the pattern list, so
// a genuinely confirmed zero-result search was being reported as the vaguer
// SUBMITTED_UNCONFIRMED instead of the true NO_RESULT_CONFIRMED. Added both.
const NO_RESULT_PATTERNS=[/ჩანაწერი\s*ვერ\s*მოიძებნა/i,/ვერ\s*მოიძებნა/i,/არ\s*მოიძებნა/i,/შედეგი\s*ვერ\s*მოიძებნა/i,/no\s*results?\s*(were\s*)?found/i,/nothing\s*found/i,/0\s*results?\b/i,/not\s*found/i,/не\s*найдено/i,/ничего\s*не\s*найдено/i,/სულ\s*მოიძებნა[:\s]*0\b/i,/no\s*data\s*to\s*display/i];
function hasNoResultPhrase(t){return NO_RESULT_PATTERNS.some(re=>re.test(t||''))}
// Positive-count signal (2026-09-04, round 2): TAS's result grid columns are
// document №/date/status/nomenclature/address — the cadastral CODE the user
// searched for is never echoed back into the result text, so `echoesQuery`
// (the only positive-evidence signal that existed before) can never fire on
// this source even for a genuine hit. "სულ მოიძებნა: <N>" (total found: N)
// is the grid's own authoritative count and is real evidence independent of
// whether the query string itself appears anywhere on the page.
function totalFoundCount(t){const m=/სულ\s*მოიძებნა\D{0,12}(\d+)/i.exec(t||'');return m?parseInt(m[1],10):null}
// Login-wall heuristics — used only when no search control could be matched,
// to distinguish "genuinely requires authentication" (AUTH_REQUIRED, a real
// fact worth reporting) from "our selectors just didn't find the field"
// (SEARCH_CONTROL_NOT_FOUND). Never asserted just because a login link
// exists somewhere on the page (most GE gov portals always show one) —
// only when a control also could not be found.
const AUTH_HINTS=[/ავტორიზაცი/i,/გაიარეთ\s*ავტორიზაცია/i,/გთხოვთ\s*გაიაროთ\s*ავტორიზაცია/i,/sign\s*in\s*to\s*continue/i,/please\s*log\s*in/i,/authorization\s*required/i];
function looksAuthGated(t){return AUTH_HINTS.some(re=>re.test(t||''))}
// BLOCKED status (2026-09-04, per mandate point 8 — evidence-status enum must
// distinguish "we could not find the control" from "the source actively
// refused us"): a WAF/rate-limit/access-denied page is a materially
// different, real fact from "our selectors didn't match" and must never be
// silently folded into SEARCH_CONTROL_NOT_FOUND (which implies our own
// adapter is at fault) or AUTH_REQUIRED (which implies a normal login wall).
// Checked BEFORE the auth check in collect() since a block page sometimes
// also mentions "access"/"denied" wording that could otherwise be
// mis-read as an auth gate.
const BLOCK_HINTS=[/access\s*denied/i,/403\s*forbidden/i,/\bblocked\b/i,/too\s*many\s*requests/i,/rate\s*limit/i,/request\s*unsuccessful/i,/temporarily\s*unavailable/i,/service\s*unavailable/i,/დაბლოკილია/i,/წვდომა\s*შეზღუდულია/i,/მოთხოვნების\s*რაოდენობა\s*გადააჭარბა/i];
function looksBlocked(t){return BLOCK_HINTS.some(re=>re.test(t||''))}
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
// Document integrity fields (2026-09-04, per mandate point 5 — "validate it,
// extract the COMPLETE relevant text, capture title/date/type/source URL,
// calculate SHA-256"). sha256() hashes the exact retrieved bytes (works for
// any document type, not just parsed PDFs) so a document's authenticity/
// identity can be checked independently of whether its text was extractable.
// extractDateFromText() looks for real dates actually printed in the
// document body (DD.MM.YYYY / DD/MM/YYYY / YYYY-MM-DD) — never invented, only
// what the source text itself states — falling back to PDF metadata
// CreationDate when no in-body date is found. Neither function guesses a
// date/title when none is present; both return null rather than fabricate.
function sha256(buf){try{return createHash('sha256').update(buf).digest('hex')}catch{return null}}
const DATE_PATTERNS=[/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/,/\b(\d{4})[-.](\d{1,2})[-.](\d{1,2})\b/];
function extractDateFromText(t){if(!t)return null;for(const re of DATE_PATTERNS){const m=re.exec(t);if(m)return m[0]}return null}
// parseFlexDate/diffLines/buildHistoricalComparison (mandate point 6 —
// "sort chronologically, compare older vs newer, identify actual evidenced
// changes, state which document proves each change, never invent a change
// when evidence is absent"): comparison is a plain LINE-LEVEL TEXT DIFF
// between two dated, successfully-parsed documents — a line is reported as
// added/removed only if it is literally present in one document's extracted
// text and literally absent from the other's. This is deliberately NOT an
// LLM-inferred summary of "what changed" — that would risk inventing a
// change the source text doesn't actually support. Short/boilerplate lines
// (<=3 chars) are dropped as noise; everything else is exact evidence,
// traceable back to the two source URLs it came from.
function parseFlexDate(s){if(!s)return null;let m=/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(String(s).trim());if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));m=/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/.exec(String(s).trim());if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));const d=new Date(s);return isNaN(d.getTime())?null:d}
function diffLines(oldText,newText){const norm=t=>new Set((t||'').split(/\n+/).map(l=>l.trim()).filter(l=>l.length>3));const oldLines=norm(oldText),newLines=norm(newText);return{added:[...newLines].filter(l=>!oldLines.has(l)).slice(0,25),removed:[...oldLines].filter(l=>!newLines.has(l)).slice(0,25)}}
function buildHistoricalComparison(allDocs){const dated=allDocs.filter(d=>d.parsed&&d.date&&d.text).map(d=>({...d,_dt:parseFlexDate(d.date)})).filter(d=>d._dt);if(dated.length<2)return{available:false,reason:dated.length===0?'no dated, text-extracted documents were found across any source — historical comparison requires at least two':'only one dated, text-extracted document was found — nothing to compare it against',documentsConsidered:dated.length};dated.sort((a,b)=>a._dt-b._dt);const comparisons=[];for(let i=1;i<dated.length;i++){const prev=dated[i-1],cur=dated[i],{added,removed}=diffLines(prev.text,cur.text),changed=added.length>0||removed.length>0;comparisons.push({olderDocument:{url:prev.url,date:prev.date,title:prev.title||prev.label||null},newerDocument:{url:cur.url,date:cur.date,title:cur.title||cur.label||null},changed,addedInNewer:added,removedFromOlder:removed,proof:changed?`evidenced by direct text comparison of the two retrieved documents (older: ${prev.url} , newer: ${cur.url})`:'no textual differences were found between these two documents\' extracted text'})}return{available:true,documentsConsidered:dated.length,chronology:dated.map(d=>({url:d.url,date:d.date,title:d.title||d.label||null})),comparisons}}

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
// Playwright sees (same frame set pageLinks()/interact() already use via
// contexts()), so a result rendered inside an embedded app is actually
// visible to the evidence-gating logic instead of silently invisible.
const text=async(p,n=120000)=>{const parts=[];for(const f of contexts(p)){try{parts.push(await f.locator('body').innerText({timeout:8000}))}catch{}}return parts.join('\n').slice(0,n)};async function visible(x){try{return await x.count()&&await x.isVisible()}catch{return false}}
async function challenge(p){for(const f of p.frames()){for(const s of ['iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','iframe[src*="turnstile" i]','.g-recaptcha','.h-captcha','.cf-turnstile','[class*="captcha" i]','[id*="captcha" i]','[role="checkbox"][aria-label*="robot" i]']){const x=f.locator(s).first();if(await visible(x))return{frame:f,el:x,matched:s}}const b=(await f.locator('body').innerText().catch(()=>'' )).slice(0,15000).toLowerCase();if(/verify you are human|i am not a robot|i'm not a robot|captcha|მე არ ვარ რობოტი|არ ვარ რობოტი/.test(b)){const x=f.locator('iframe,input,button,[role="checkbox"],[role="dialog"]').first();if(await visible(x))return{frame:f,el:x,matched:'text-fallback'}}}return null}const contexts=p=>[p.mainFrame(),...p.frames().filter(f=>f!==p.mainFrame())];
// ── Interaction-chain architecture (2026-09-04, round 3 — per direct
// instruction) ───────────────────────────────────────────────────────────
// The evidence model up to this point inferred outcomes from PAGE TEXT
// alone ("does the page contain a no-result phrase / a total-found
// number?"). That is necessary but not sufficient: text matching a pattern
// proves nothing about WHETHER OUR OWN SEARCH produced it — a grid caption
// like "სულ მოიძებნა: 0" could just as easily be the form's default,
// pre-search state. Real evidence requires a PROVEN CAUSAL CHAIN: the
// correct control was found -> the exact query was typed into it and
// verified -> the correct submit action was taken -> the result area
// changed in response, specifically by a recognizable signal (a no-result
// phrase, a total-found count, or the query being echoed) that was NOT
// already present before the submit. Every step is now recorded as an
// explicit trace array (OPEN/ENTER_FRAME/FILL/SUBMIT/RESULT/...) exposed
// per-source in the job so a human can audit exactly what the browser did,
// not just what text it eventually saw.
function extractSignal(t){if(hasNoResultPhrase(t))return{kind:'NO_RESULT'};const tf=totalFoundCount(t);if(tf!==null)return{kind:'TOTAL_COUNT',value:tf};return null}
// waitForResultSignal: polls the SPECIFIC frame the search control lives in
// (never the whole page — TAS's own portal chrome carries a live clock that
// ticks every second, which would make a naive whole-page text-diff always
// report "changed" regardless of whether a search ever ran) until a
// recognizable evidence signal appears that was NOT already present before
// the submit, or the query string itself newly appears. This is the actual
// proof that our click/Enter caused the result, not merely that some text
// resembling a result exists somewhere on the page.
async function waitForResultSignal(f,beforeText,qRaw,{timeoutMs=10000,pollMs=500}={}){const qn=qRaw.replace(/\s/g,'');const beforeSignal=extractSignal(beforeText);const beforeHasQuery=beforeText.replace(/\s/g,'').includes(qn);const start=Date.now();let last=beforeText;while(Date.now()-start<timeoutMs){const cur=await f.locator('body').innerText({timeout:3000}).catch(()=>last);last=cur;const curSignal=extractSignal(cur);const curHasQuery=qn&&cur.replace(/\s/g,'').includes(qn);const signalIsNew=curSignal&&(!beforeSignal||JSON.stringify(curSignal)!==JSON.stringify(beforeSignal));const queryIsNew=curHasQuery&&!beforeHasQuery;if(signalIsNew||queryIsNew)return{changed:true,after:cur,signal:curSignal,queryEchoed:curHasQuery,waitedMs:Date.now()-start};await new Promise(r=>setTimeout(r,pollMs))}return{changed:false,after:last,signal:extractSignal(last),queryEchoed:qn&&last.replace(/\s/g,'').includes(qn),waitedMs:Date.now()-start}}
// interact(): the shared "operate the form like a human" primitive. Tries
// the source's known-good `hints` selectors first (HINT scope, high
// confidence); only when `opts.fallback` is explicitly set does it also
// scan every visible input on the page (FALLBACK scope, excluding
// header/nav chrome) — this generic scan is intentionally NOT used for
// TAS/MSMAP/MYGOV any more (confirmed history of grabbing the wrong control
// on those sites), only for sources with no known-specific selectors yet
// (enreg, napr). Every step (frame entry, fill+verify, submit) is recorded.
// networkPattern (2026-09-04, round 4 — confirmed via live job d3a3fed1-...):
// TAS's ExtJS grid shows "სულ მოიძებნა: 0" / "No data to display" as its
// DEFAULT, pre-search state too — the real live text before and after the
// Enter keypress was byte-identical. A text-only proof can never tell
// "a real search that legitimately found 0" apart from "nothing happened
// yet" when the answer is zero either way. TAS's iframe loads DWR (Direct
// Web Remoting — dwr/engine.js, dwr/interface/*.js, confirmed in its raw
// HTML) — a real search fires an XHR to a `/dwr/` endpoint, which is
// protocol-level proof of causality independent of whatever the grid text
// says. When opts.networkPattern is set, interact() arms a
// page.waitForResponse() for it BEFORE the click/Enter and reports whether
// a matching response actually arrived.
async function interact(p,q,hints,opts={}){const{fallback=false,exclude=null,networkPattern=null}=opts;const trace=[{action:'OPEN',url:p.url()}];for(const f of contexts(p)){if(f!==p.mainFrame())trace.push({action:'ENTER_FRAME',frameUrl:f.url()});for(const s of hints){const x=f.locator(s).first();try{if(await visible(x)){if(exclude&&await exclude(x)){trace.push({action:'SKIP_EXCLUDED',selector:s});continue}await x.fill(q);const val=(await x.inputValue().catch(()=>'' )).replace(/\s/g,'');const verified=val===q.replace(/\s/g,'');trace.push({action:'FILL',selector:s,scope:'HINT',verified});if(verified){const before=await f.locator('body').innerText({timeout:5000}).catch(()=>'' );const netPromise=networkPattern?p.waitForResponse(r=>networkPattern.test(r.url()),{timeout:9000}).then(r=>({matched:true,url:r.url(),status:r.status()})).catch(()=>({matched:false})):null;const sub=await submitNear(p,{frame:f,el:x});const net=netPromise?await netPromise:null;trace.push({action:'SUBMIT',method:sub.method,clicked:sub.ok,network:net});return{found:true,frame:f,el:x,selector:s,scope:'HINT',before,sub,net,trace}}}}catch{}}}if(fallback){for(const f of contexts(p)){const inputs=f.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');const n=Math.min(await inputs.count().catch(()=>0),40);for(let i=0;i<n;i++){const x=inputs.nth(i);if(!await visible(x))continue;const inChrome=await x.evaluate(el=>!!el.closest('header, nav, [role="banner"], [role="navigation"]')).catch(()=>false);if(inChrome)continue;if(exclude&&await exclude(x))continue;const m=((await x.getAttribute('placeholder'))+' '+(await x.getAttribute('name'))+' '+(await x.getAttribute('id'))+' '+(await x.getAttribute('aria-label'))).toLowerCase();if(/საკადასტრო|cadast|cadastr|parcel|უძრავ|ძიება|search/.test(m)){try{await x.fill(q);const val=(await x.inputValue()).replace(/\s/g,'');if(val===q.replace(/\s/g,'')){trace.push({action:'FILL',selector:m,scope:'FALLBACK',verified:true});const before=await f.locator('body').innerText({timeout:5000}).catch(()=>'' );const sub=await submitNear(p,{frame:f,el:x});trace.push({action:'SUBMIT',method:sub.method,clicked:sub.ok});return{found:true,frame:f,el:x,selector:m,scope:'FALLBACK',before,sub,trace}}}catch{}}}}}return{found:false,trace}}
// submitNear now reports HOW it submitted (button label matched, or a plain
// Enter keypress) instead of a bare boolean — this is the SUBMIT_ACTION field
// requested for per-source diagnostics, so a human reviewer can tell "clicked
// a button labelled X" apart from "just pressed Enter and hoped".
async function submitNear(p,hit){if(!hit)return{ok:false,method:null};for(const re of [/მოძებნა/i,/ძიება/i,/search/i,/შემდეგ/i,/დადასტურება/i])for(const role of ['button','link']){const x=hit.frame.getByRole(role,{name:re}).first();try{if(await visible(x)){await x.click();await p.waitForTimeout(1000);return{ok:true,method:`CLICK ${role}[name~=${re.source}]`}}}catch{}}try{await hit.el.press('Enter');await p.waitForTimeout(1000);return{ok:true,method:'ENTER_KEY'}}catch{}return{ok:false,method:null}}
// domIframes: reads the DOM directly (document.querySelectorAll('iframe'))
// rather than relying on Playwright's own frame list, so a source whose
// embedded app iframe isn't showing up as a Playwright frame (confirmed on
// mygov — see mygovAdapter below) can still be discovered and, if found,
// navigated to directly.
async function domIframes(p){try{return await p.evaluate(()=>Array.from(document.querySelectorAll('iframe')).map(f=>f.getAttribute('src')||null))}catch{return[]}}
// pollForIframe (2026-09-04, round 4 — confirmed via live job d3a3fed1-...):
// mygov's DOM_IFRAME_SCAN still found no naprweb.reestri.gov.ge iframe at
// all — only the reCAPTCHA anchor. That anchor iframe's OWN src carries
// `anchor-ms=20000&execute-ms=30000`, i.e. Google's declared readiness
// window for this invisible reCAPTCHA is up to 20-30 SECONDS — far longer
// than the ~3s HEAVY_APP_SOURCES currently waits before giving up. A
// plausible, evidence-motivated hypothesis: the real search iframe doesn't
// exist in the DOM until the invisible challenge finishes executing. This
// polls for it over a much longer window instead of one static check.
async function pollForIframe(p,pattern,{timeoutMs=15000,pollMs=1000}={}){const start=Date.now();let srcs=[];while(Date.now()-start<timeoutMs){srcs=await domIframes(p);const hit=srcs.find(s=>s&&pattern.test(s));if(hit)return{found:true,src:hit,srcs,waitedMs:Date.now()-start};await new Promise(r=>setTimeout(r,pollMs))}return{found:false,srcs,waitedMs:Date.now()-start}}
// TAS: the one source whose real control/submit behaviour is fully
// confirmed live (input[name*="cad" i] inside the docs.tbilisi.gov.ge
// ExtJS iframe, submitted via Enter). No fallback scan — a prior version's
// blind `input[type="text"]` catch-all filled the wrong (portal-chrome)
// field and falsely reported submitted:true.
async function tasAdapter(p,q){const hit=await interact(p,q,['input[placeholder*="საკადასტრო" i]','input[name*="cad" i]','input[id*="cad" i]'],{networkPattern:/\/dwr\//i});if(!hit.found)return{adapter:'TAS_FRAME_AWARE',found:false,trace:hit.trace};const sig=await waitForResultSignal(hit.frame,hit.before,q);const netConfirmed=!!hit.net?.matched;hit.trace.push({action:'RESULT',changed:sig.changed,networkConfirmed:netConfirmed,signal:sig.signal,queryEchoed:sig.queryEchoed,waitedMs:sig.waitedMs});return{adapter:'TAS_FRAME_AWARE',found:true,submitted:hit.sub.ok,submitAction:hit.sub.method,frameUrl:hit.frame.url(),searchControlUsed:hit.selector,fillVerified:true,resultChanged:sig.changed||netConfirmed,resultTextAfter:sig.after,networkConfirmed:netConfirmed,trace:hit.trace}}
// MYGOV: hints only (no blind fallback — history of grabbing the sitewide
// header search box instead of the service-specific field). NEW this round:
// if no control is found on the top-level page, checks the DOM directly for
// an iframe pointing at reestri.gov.ge/naprweb (confirmed via curl to exist
// in the service page's raw HTML even when Playwright's own frame list
// didn't include it — job 4fddea39-...) and, if found, opens it directly in
// a fresh page in the same browser context and retries there.
async function mygovAdapter(p,q,ctx){const hints=['input[placeholder*="საკადასტრო" i]','input[name*="cad" i]','input[id*="cad" i]'];let hit=await interact(p,q,hints);let activePage=null,candidateInputs=null;if(!hit.found){const poll=await pollForIframe(p,/reestri\.gov\.ge|naprweb/i,{timeoutMs:15000,pollMs:1000});hit.trace.push({action:'DOM_IFRAME_SCAN',srcs:poll.srcs,waitedMs:poll.waitedMs,found:poll.found});const target=poll.found?poll.src:null;if(target){let full=target;try{full=new URL(target,p.url()).toString()}catch{}const p2=await ctx.newPage();try{await p2.goto(full,{waitUntil:'domcontentloaded',timeout:30000});await p2.waitForTimeout(2000);hit.trace.push({action:'DIRECT_NAVIGATE',url:full});const hit2=await interact(p2,q,hints);hit.trace.push(...hit2.trace);if(hit2.found){hit=hit2;activePage=p2}else{const retry=await candidateRankedRetry(p2,q);hit.trace.push({action:'CANDIDATE_SCAN',candidates:retry.candidates});candidateInputs=retry.candidates;if(retry.found){hit.trace.push(...retry.trace);hit=retry;activePage=p2}else{hit.trace.push({action:'NO_SAFE_CANDIDATE',note:'naprweb Angular app reached but no candidate input matched or verified'});await p2.close().catch(()=>{})}}}catch(e){hit.trace.push({action:'DIRECT_NAVIGATE_FAILED',error:String(e)});await p2.close().catch(()=>{})}}}if(!hit.found)return{adapter:'MYGOV_SERVICE',found:false,trace:hit.trace,activePage,candidateInputs};const sig=await waitForResultSignal(hit.frame,hit.before,q);hit.trace.push({action:'RESULT',changed:sig.changed,signal:sig.signal,queryEchoed:sig.queryEchoed,waitedMs:sig.waitedMs});return{adapter:'MYGOV_SERVICE',found:true,submitted:hit.sub.ok,submitAction:hit.sub.method,frameUrl:hit.frame.url(),searchControlUsed:hit.selector,fillVerified:true,resultChanged:sig.changed,resultTextAfter:sig.after,trace:hit.trace,activePage,candidateInputs}}
// MSMAP: confirmed live (job 4fddea39-...) that the only control matching
// the old generic hints (input[placeholder="ძიება"]) is the MAP LAYERS PANEL
// filter box — entering the cadastral code there left the full
// municipality/general-plan layer list completely unchanged, i.e. it is
// almost certainly the wrong control. `looksLikeLayersPanel` recognizes
// that specific box (its closest panel is dominated by
// "<name> გენერალური გეგმა" / "<name> მუნიციპალიტეტი" entries) and refuses
// to use it. If no better candidate is visible, this now honestly reports
// SEARCH_CONTROL_NOT_FOUND with a full dump of every candidate input found
// (placeholder/aria/name/id) instead of guessing — so the next live round
// has real data to identify the actual cadastral search UI from, rather
// than another blind guess.
async function looksLikeLayersPanel(x){try{return await x.evaluate(el=>{const panel=el.closest('div,section,aside')||el.parentElement;if(!panel)return false;const t=(panel.innerText||'').slice(0,4000);const hits=(t.match(/გენერალური\s*გეგმა|მუნიციპალიტეტი/g)||[]).length;return hits>=3})}catch{return false}}
async function scanCandidateInputs(p){const out=[];for(const f of contexts(p)){const inputs=f.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea');const n=Math.min(await inputs.count().catch(()=>0),25);for(let i=0;i<n;i++){const x=inputs.nth(i);if(!await visible(x))continue;out.push({frameUrl:f.url(),placeholder:await x.getAttribute('placeholder').catch(()=>null),ariaLabel:await x.getAttribute('aria-label').catch(()=>null),name:await x.getAttribute('name').catch(()=>null),id:await x.getAttribute('id').catch(()=>null),isLayersPanel:await looksLikeLayersPanel(x)})}}return out}
// Candidate ranking (2026-09-04, round 4 — confirmed via live job
// d3a3fed1-...): the candidate scan found TWO distinct fields sharing the
// same visible placeholder "ძიება" — name="filterText" (the one guessed
// last round; produced no signal change at all, consistent with it being
// the layers-list filter) AND name="searchText", which was never tried
// because the old logic just took candidates[0]. A field literally named
// "search" is a far stronger cadastral-search candidate than one named
// "filter" — rank by that instead of scan order, and hand ALL ranked
// guesses to interact() so it tries them in priority order and stops at
// the first one that actually fills+verifies.
function looksLikeCadastralField(c){return/cad|საკადასტრო|parcel|ნაკვეთ/i.test(c.name||'')||/cad|საკადასტრო|parcel|ნაკვეთ/i.test(c.ariaLabel||'')||/საკადასტრო|cad|ნაკვეთ/i.test(c.placeholder||'')}
function looksLikeSearchField(c){return/search/i.test(c.name||'')||/search/i.test(c.ariaLabel||'')}
function looksLikeFilterField(c){return/filter/i.test(c.name||'')||/filter/i.test(c.ariaLabel||'')}
// candidateRankedRetry (2026-09-04, round 5): shared "no known selector
// worked — scan every visible input, rank by how likely each name/aria/
// placeholder is to be the REAL cadastral/search field, and retry with the
// best few" fallback. Originally built for msmap (where it successfully
// found name="searchText" over the wrong name="filterText" — see below);
// generalized so mygov's naprweb Angular app (reachable this round for the
// first time, but its internal field names are still unknown) gets the
// same real, ranked-by-evidence retry instead of a blind guess.
async function candidateRankedRetry(page,q,opts={}){const candidates=await scanCandidateInputs(page);const usable=opts.excludeLayers?candidates.filter(c=>!c.isLayersPanel):candidates;const ranked=[...usable.filter(looksLikeCadastralField),...usable.filter(c=>!looksLikeCadastralField(c)&&looksLikeSearchField(c)),...usable.filter(c=>!looksLikeCadastralField(c)&&!looksLikeSearchField(c)&&!looksLikeFilterField(c)),...usable.filter(c=>!looksLikeCadastralField(c)&&!looksLikeSearchField(c)&&looksLikeFilterField(c))];const guessSels=dedupe(ranked.map(c=>c.name?`input[name="${c.name}"]`:c.id?`#${c.id}`:c.placeholder?`input[placeholder="${c.placeholder}"]`:null).filter(Boolean),x=>x);if(!guessSels.length)return{found:false,candidates};const hit=await interact(page,q,guessSels);return{...hit,candidates}}
async function msmapAdapter(p,q){const specific=['input[placeholder*="საკადასტრო" i]','input[placeholder*="ნაკვეთ" i]','input[aria-label*="საკადასტრო" i]'];let hit=await interact(p,q,specific,{exclude:looksLikeLayersPanel});if(hit.found){const sig=await waitForResultSignal(hit.frame,hit.before,q);hit.trace.push({action:'RESULT',changed:sig.changed,signal:sig.signal,queryEchoed:sig.queryEchoed,waitedMs:sig.waitedMs});return{adapter:'MSMAP_SPA',found:true,submitted:hit.sub.ok,submitAction:hit.sub.method,frameUrl:hit.frame.url(),searchControlUsed:hit.selector,fillVerified:true,resultChanged:sig.changed,resultTextAfter:sig.after,trace:hit.trace}}const retry=await candidateRankedRetry(p,q,{excludeLayers:true});hit.trace.push({action:'CANDIDATE_SCAN',candidates:retry.candidates});if(!retry.found){hit.trace.push({action:'NO_SAFE_CANDIDATE',note:'no candidate input matched or verified — refusing to guess further'});return{adapter:'MSMAP_SPA',found:false,trace:hit.trace,candidateInputs:retry.candidates}}hit.trace.push(...retry.trace);const sig=await waitForResultSignal(retry.frame,retry.before,q);hit.trace.push({action:'RESULT',changed:sig.changed,signal:sig.signal,queryEchoed:sig.queryEchoed,waitedMs:sig.waitedMs});return{adapter:'MSMAP_SPA',found:true,submitted:retry.sub.ok,submitAction:retry.sub.method,frameUrl:retry.frame.url(),searchControlUsed:retry.selector,fillVerified:true,resultChanged:sig.changed,resultTextAfter:sig.after,trace:hit.trace,candidateInputs:retry.candidates}}
// Generic fallback adapter (enreg, napr) — keeps the pre-existing
// header/nav-scoped fallback-scan behaviour these sources always relied on;
// no source-specific selectors are known for them yet.
async function genericAdapter(p,q){const hit=await interact(p,q,[],{fallback:true});if(!hit.found)return{adapter:'GENERIC',found:false,trace:hit.trace};const sig=await waitForResultSignal(hit.frame,hit.before,q);hit.trace.push({action:'RESULT',changed:sig.changed,signal:sig.signal,queryEchoed:sig.queryEchoed,waitedMs:sig.waitedMs});return{adapter:'GENERIC',found:true,submitted:hit.sub.ok,submitAction:hit.sub.method,frameUrl:hit.frame.url(),searchControlUsed:hit.selector,fillVerified:true,resultChanged:sig.changed,resultTextAfter:sig.after,trace:hit.trace}}
async function runAdapter(key,p,q,ctx){if(key==='tas')return tasAdapter(p,q);if(key==='msmap')return msmapAdapter(p,q);if(key==='mygov')return mygovAdapter(p,q,ctx);return genericAdapter(p,q)}
async function pageLinks(p){const out=[];for(const f of contexts(p)){try{out.push(...await f.locator('a[href]').evaluateAll(as=>as.slice(0,300).map(a=>({label:(a.textContent||'').trim().slice(0,240),url:a.href})).filter(x=>/^https?:/i.test(x.url))))}catch{}}return [...new Map(out.map(x=>[x.url,x])).values()]}
async function pdfEvidence(p,ls){const docs=[];for(const l of ls.filter(isRealDocumentLink).slice(0,12)){try{const r=await p.request.get(l.url,{timeout:20000}),b=await r.body(),ct=(r.headers()['content-type']||'').toLowerCase(),hash=sha256(b);if(ct.includes('pdf')||b.subarray(0,4).toString()==='%PDF'){const d=await pdf(b),bodyText=d.text||'',title=(d.info&&d.info.Title&&String(d.info.Title).trim())||l.label||null,date=extractDateFromText(bodyText.slice(0,4000))||(d.info&&d.info.CreationDate?String(d.info.CreationDate):null);docs.push({url:l.url,label:l.label,title,date,type:'PDF',sha256:hash,pages:d.numpages,text:bodyText.slice(0,100000),parsed:true,textExtractionAvailable:!!(bodyText&&bodyText.trim().length>20)})}else{docs.push({url:l.url,label:l.label,title:l.label||null,date:null,type:'DOCUMENT',sha256:hash,parsed:false,textExtractionAvailable:false,note:'TEXT_EXTRACTION_UNAVAILABLE: not a text-bearing PDF response'})}}catch(e){docs.push({url:l.url,label:l.label,title:l.label||null,date:null,type:'DOCUMENT',sha256:null,parsed:false,textExtractionAvailable:false,error:String(e)})}}return docs}
// collect(): produces the richer, source-classified evidence record. Status
// is now an explicit enum the downstream AI synthesis step (research-agent)
// can gate on, instead of a single ambiguous boolean:
//   SEARCH_CONFIRMED        — control found+verified, submitted, and the
//                             result area PROVABLY changed afterward with a
//                             positive signal (count>0 or query echoed)
//   NO_RESULT_CONFIRMED     — same causal proof, but the new signal is the
//                             source's own "not found" phrase
//   SUBMITTED_UNCONFIRMED   — control found+verified and submitted, but the
//                             result area showed no provable, new signal
//                             (this is now also what a genuinely wrong
//                             control — e.g. one that doesn't affect any
//                             result area — honestly falls back to)
//   SUBMIT_FAILED           — control found+verified but could not submit
//   AUTH_REQUIRED           — no control found AND the page shows a login gate
//   SEARCH_CONTROL_NOT_FOUND— no control found, no auth gate detected either
//   BLOCKED                 — no control found; the page itself is an access-
//                             denied/rate-limit/WAF-style refusal, not a
//                             selector-matching failure (added 2026-09-04 per
//                             mandate point 8 — must contribute ZERO confirmed
//                             facts, same as every other non-CONFIRMED status)
//   WAITING_HUMAN           — CAPTCHA/human-verification interstitial blocked progress
// IMPORTANT (per explicit user instruction, 2026-09-04): NO_RESULT_CONFIRMED
// is evidence ONLY that "this exact, verified, causally-proven search
// returned no matching record on THIS source" — it is NEVER evidence that
// the underlying property/record does not exist. A source's own "not found"
// wording (e.g. NAPR/MYGOV's "განცხადება ვერ მოიძებნა" — no APPLICATION
// found) may describe a narrower thing (no matching case/application) than
// "this parcel does not exist in the registry." Downstream synthesis
// (research-agent) must preserve this distinction and never collapse
// NO_RESULT_CONFIRMED into a claim of non-existence.
async function collect(p,key,sr){const src=SOURCES[key],ls=await pageLinks(p),cap=await challenge(p),docs=cap?[]:await pdfEvidence(p,ls),pageText=await text(p),qRaw=sr?.query||'',q=qRaw.replace(/\s/g,'');const foundControl=!!sr?.found,fillVerified=!!sr?.fillVerified,submitted=!!sr?.submitted,resultChanged=!!sr?.resultChanged,proven=resultChanged?(sr.resultTextAfter||''):'',pt=proven.replace(/\s/g,''),noResultMatch=resultChanged?NO_RESULT_PATTERNS.find(re=>re.test(proven)):null,noResult=!!noResultMatch,echoesQuery=resultChanged&&submitted&&(pt.includes(q)||docs.some(d=>d.text?.replace(/\s/g,'').includes(q))),totalFound=resultChanged?totalFoundCount(proven):null;let status,resultConfirmed=false,noResultConfirmed=false,authRequired=false,blocked=false,resultContext=null;if(cap){status='WAITING_HUMAN';resultContext='human-verification interstitial blocked further evaluation'}else if(!foundControl){blocked=looksBlocked(pageText);authRequired=!blocked&&looksAuthGated(pageText);status=blocked?'BLOCKED':(authRequired?'AUTH_REQUIRED':'SEARCH_CONTROL_NOT_FOUND');resultContext=blocked?snippetAround(pageText,(pageText.match(new RegExp(BLOCK_HINTS.map(r=>r.source).join('|'),'i'))||[])[0]||''):(authRequired?snippetAround(pageText,(pageText.match(new RegExp(AUTH_HINTS.map(r=>r.source).join('|'),'i'))||[])[0]||''):null)}else if(!fillVerified||!submitted){status='SUBMIT_FAILED'}else if(!resultChanged){status='SUBMITTED_UNCONFIRMED';resultContext='the exact query was verified in the correct field and the search was submitted, but no new result signal (count/no-result phrase/query echo) appeared in the result area afterward — no causal proof of a completed search'}else if(noResult){status='NO_RESULT_CONFIRMED';noResultConfirmed=true;resultContext=snippetAround(proven,noResultMatch.exec(proven)?.[0]||'')}else if(totalFound!==null&&totalFound>0){status='SEARCH_CONFIRMED';resultConfirmed=true;resultContext=`სულ მოიძებნა (total found): ${totalFound}`}else if(echoesQuery){status='SEARCH_CONFIRMED';resultConfirmed=true;resultContext=snippetAround(proven,qRaw)||snippetAround(proven,q)}else{status='SUBMITTED_UNCONFIRMED';resultContext='the result area changed after submission but no recognizable positive/negative signal was found in it'}
return{source:key,sourceName:src.name,sourceClass:src.class,sourceUrl:src.url,startUrl:src.url,finalUrl:p.url(),frameUrls:p.frames().map(f=>f.url()),domIframeSrcs:await domIframes(p),adapter:sr?.adapter||null,frameUrl:sr?.frameUrl||null,searchControlUsed:sr?.searchControlUsed||null,queryEntered:foundControl?qRaw:null,submitAction:sr?.submitAction||null,fillVerified,resultChanged,interactionTrace:sr?.trace||[],candidateInputs:sr?.candidateInputs||null,resultContext,retrievalMethod:submitted?'OFFICIAL_FORM_RESULT':'NO_VERIFIED_SEARCH',searchControlFound:foundControl,submitted,submissionConfirmed:submitted&&resultChanged,resultConfirmed,noResultConfirmed,authRequired,blocked,searched:submitted,resultValidated:resultConfirmed,status,captcha:!!cap,retrievedAt:now(),pageText,links:ls,documents:docs,documentsDiscovered:ls.filter(isRealDocumentLink).length,documentsExtracted:docs.filter(d=>d.parsed).length,documentLinks:ls.filter(isRealDocumentLink),error:status==='SEARCH_CONTROL_NOT_FOUND'?'source adapter could not locate a matching search control':status==='SUBMIT_FAILED'?'source adapter located the control but could not submit the search':status==='BLOCKED'?'the source actively refused/blocked this request (access-denied, rate-limit, or WAF-style page) — not a selector-matching failure':null}}
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
// finish bootstrapping before the adapter looks for a search field — that
// is the confirmed, evidenced reason those two sources still report
// AUTH_REQUIRED/SEARCH_CONTROL_NOT_FOUND rather than a real form. This does
// NOT guess at either app's internal selectors — it only gives them
// realistic bootstrap time before the frame-aware adapter gets its chance.
const HEAVY_APP_SOURCES=new Set(['tas','mygov']);
async function one(browser,job,key){const src=SOURCES[key],ctx=await browser.newContext({locale:'ka-GE',acceptDownloads:true,viewport:{width:1440,height:1000}}),p=await ctx.newPage();try{await p.goto(src.url,{waitUntil:'domcontentloaded',timeout:45000});await p.waitForTimeout(1500);if(HEAVY_APP_SOURCES.has(key)){try{await p.waitForLoadState('networkidle',{timeout:8000})}catch{}await p.waitForTimeout(1500)}if(await challenge(p))return hold(browser,ctx,p,job,key,{found:false,submitted:false,query:job.query,adapter:`${key.toUpperCase()}_PRESEARCH`});const ar=await runAdapter(key,p,job.query,ctx),activePage=ar.activePage||p,sr={...ar,query:job.query};if(await challenge(activePage))return hold(browser,ctx,activePage,job,key,sr);const r=await collect(activePage,key,sr);await ctx.close();return{r,keep:false}}catch(e){await ctx.close().catch(()=>{});return{r:{source:key,sourceName:src.name,sourceClass:src.class,sourceUrl:src.url,startUrl:src.url,finalUrl:null,frameUrls:[],searchControlUsed:null,queryEntered:null,submitAction:null,resultContext:null,status:'FAILED',searched:false,resultConfirmed:false,noResultConfirmed:false,resultValidated:false,error:String(e),retrievedAt:now(),pageText:'',links:[],documents:[]},keep:false}}}
async function run(job,start=0,browser=null){const keys=job.mode==='cadastral'?['tas','msmap','mygov']:['enreg','msmap','napr'];job.status='RUNNING';job.updatedAt=now();try{browser=browser||await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});for(let i=start;i<keys.length;i++){job.sourceIndex=i;job.stage=`CHECKING_${keys[i].toUpperCase()}`;const {r,keep}=await one(browser,job,keys[i]);job.results=job.results.filter(x=>x.source!==keys[i]);job.results.push(r);job.updatedAt=now();if(keep){job.status='WAITING_HUMAN';job.stage='CAPTCHA_REQUIRED';job.humanVerification={source:keys[i],url:r.finalUrl||r.sourceUrl,expiresAt:new Date(Date.now()+TTL).toISOString(),message:'წყარომ მოითხოვა ადამიანის დადასტურება. დაასრულეთ მხოლოდ ეს შემოწმება; იგივე სესია ავტომატურად გაგრძელდება.'};return}}job.status='COMPLETE';job.stage='COMPLETE';job.completedAt=now();job.officialEvidenceCount=job.results.filter(x=>x.resultConfirmed).length;job.historicalComparison=buildHistoricalComparison(job.results.flatMap(r=>r.documents||[]));await browser.close().catch(()=>{})}catch(e){job.status='FAILED';job.stage='FAILED';job.error=String(e);await browser?.close().catch(()=>{});job.updatedAt=now()}}
setInterval(async()=>{for(const[id,s]of sessions)if(Date.now()>s.expires){await s.ctx.close().catch(()=>{});await s.browser.close().catch(()=>{});sessions.delete(id)}},30000).unref();
app.get('/health',(_q,r)=>r.json({ok:true,service:'homatch-official-worker',version:'1.4.0',playwright:true,pdfExtraction:true,documentIntegrity:'sha256+title+date',historicalComparison:true,sourceAdapters:['tas-frame-aware','msmap-spa','mygov-service+dom-iframe-fallback','generic'],statuses:['SEARCH_CONFIRMED','NO_RESULT_CONFIRMED','SUBMITTED_UNCONFIRMED','SUBMIT_FAILED','AUTH_REQUIRED','SEARCH_CONTROL_NOT_FOUND','BLOCKED','WAITING_HUMAN','FAILED'],humanSessionControls:true,evidenceValidation:true,evidenceModel:'v3.3-blocked-status+doc-integrity+history-2026-09-04'}));
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
app.post('/research/:id/resume',auth,async(req,res)=>{const j=jobs.get(req.params.id),s=sessions.get(req.params.id);if(!j||!s)return res.status(404).json({error:'active human session not found'});if(await challenge(s.p))return res.status(409).json({error:'human verification is not complete'});let sr=s.sr;if(!sr?.submitted){const ar=await runAdapter(s.key,s.p,s.query,s.ctx);if(ar.activePage)s.p=ar.activePage;sr={...ar,query:s.query}}if(await challenge(s.p))return res.status(409).json({error:'human verification required after search submission'});if(!sr.submitted)return res.status(422).json({error:'cadastral search could not be submitted after verification'});const r=await collect(s.p,s.key,sr);j.results=j.results.filter(x=>x.source!==s.key);j.results.push(r);j.humanVerification=null;await s.ctx.close().catch(()=>{});sessions.delete(j.id);run(j,j.sourceIndex+1,s.browser);res.status(202).json({accepted:true,jobId:j.id,status:'RUNNING'})});
async function auth(req,res,next){const h=String(req.headers.authorization||'');if(TOKEN&&h===`Bearer ${TOKEN}`)return next();if(SUPABASE_URL&&h.startsWith('Bearer ')){try{const k=String(req.headers.apikey||'');if(!k)return res.status(401).json({error:'apikey required'});if((await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:h,apikey:k}})).ok)return next()}catch{}}return res.status(401).json({error:'unauthorized'})}
app.listen(PORT,'0.0.0.0',()=>console.log(`homatch-official-worker 1.4.0 listening on ${PORT}`));
