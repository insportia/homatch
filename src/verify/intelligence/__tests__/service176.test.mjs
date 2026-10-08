import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectService176Evidence,service176PromptEvidence} from '../service176Evidence.ts';
import {buildEvidencePackage} from '../evidencePackage.ts';
import {buildIntelligencePrompt} from '../prompt.ts';
import {finalizeReport} from '../report.ts';
import {buildEvidenceGroups} from '../evidenceGroups.ts';

const query='generic-cadastral', id='generic-application', registration='generic-registration';
const url='https://bs.napr.gov.ge/GetBlob?pid=source&bid=source-value';
const record={appinfo:{r_info:[{APP_ID:id,CADCODE:query,REG_NUMBER:registration,ADDRESS:'Official address',FULL_TRANSACT:'Source application type'}]},edocuments:[{BLOB_URI:url,ICON:'signed-pdf',DOC_NAME:'Official extract'}],statuses:[],letters:[]};
async function acquired(status=20){
 // Contract fixture; the worker suite separately proves actual adapter output
 // reaches this boundary. Root CI requires no worker build or dependencies.
 const reference={recordId:id,url,sourceReference:url,cadastralCode:query,registrationNumber:registration};
 return {results:[{source:'mygov',adapter:'service176-public-api',queryEntered:query,
   status:status===10?'BLOCKED':'SEARCH_CONFIRMED',
   traversal:{search:{cadastralCode:query,records:[{appID:id,regNumber:registration,status:'Source application status'}]},
     records:status===10?[]:[{recordId:id,info:record.appinfo.r_info[0],documents:[reference]}]},
   documents:status===10?[]:[{url,complete:true,sha256:'a'.repeat(64),title:'Official extract',
     rawText:'Exact source PDF text. Registered right details are supported only by this source text.',
     sourceReference:reference,contentMetadata:{status:200,contentType:'application/pdf',signature:'%PDF-',byteLength:24,finalUrl:url}}]}]};
}
const baseline={publicResearch:{facts:['An existing provider finding remains available']},officialEvidence:[{statement:'Registered property address: Different official address'}]};

test('worker contract reaches normalized evidence with complete source identity',async()=>{
 const browser=await acquired();const facts=projectService176Evidence(browser);
 assert.ok(facts.some(f=>f.field==='CADCODE'&&f.value===query));
 assert.equal(facts[0].provenance.appID,id);assert.equal(facts[0].provenance.registrationNumber,registration);
 assert.equal(facts[0].provenance.sourceReference,url);assert.match(facts[0].provenance.sha256,/^[a-f0-9]{64}$/);
 const pkg=buildEvidencePackage({...baseline,service176Evidence:facts});
 assert.ok(pkg.items.some(i=>i.sourceIdentity?.appID===id&&i.certainty==='CONFIRMED'));
 assert.ok(buildEvidenceGroups(pkg.items).some(g=>g.rows.some(r=>r.claim.includes('Official address'))));
});
test('accepted facts reach actual buyer summary composition and validated source text reaches official prompt',async()=>{
 const browser=await acquired();const facts=projectService176Evidence(browser);
 const pkg=buildEvidencePackage({service176Evidence:facts});
 assert.ok(JSON.stringify(buildIntelligencePrompt(pkg)).includes('Official address'));
 const final=finalizeReport(pkg,null);
 assert.ok(JSON.stringify(final).includes('Official address'));
 const block=service176PromptEvidence(browser);
 assert.ok(block.includes('Exact source PDF text'));
 assert.ok(!block.includes('recaptcha'));assert.ok(!block.includes('APP_ID'));
});
test('conflicting source facts both survive; no source overwrites the existing finding',async()=>{
 const pkg=buildEvidencePackage({...baseline,service176Evidence:projectService176Evidence(await acquired())});
 assert.ok(pkg.items.some(i=>i.claim.includes('Different official address')));
 assert.ok(pkg.items.some(i=>i.claim==='Registered property address: Official address'));
 assert.ok(pkg.items.some(i=>i.claim.includes('existing provider finding')));
 // Existing conflict guidance consumes both statements; addition does not
 // manufacture a material adverse finding or change scoring.
});
test('interactive/unavailable source contributes no facts or adverse finding and preserves other summaries',async()=>{
 for(const browser of [await acquired(10),{results:[{source:'mygov',status:'FAILED'}]}]){
   assert.deepEqual(projectService176Evidence(browser),[]);assert.equal(service176PromptEvidence(browser),'');
   assert.deepEqual(buildEvidencePackage({...baseline,service176Evidence:[]}),buildEvidencePackage(baseline));
   assert.deepEqual(finalizeReport(buildEvidencePackage({...baseline,service176Evidence:[]}),null),finalizeReport(buildEvidencePackage(baseline),null));
 }
});
test('foreign record/document identity and incomplete or invalid PDFs cannot become evidence',async()=>{
 const original=await acquired();
 for(const mutate of [b=>b.results[0].traversal.records[0].info.APP_ID='foreign',
   b=>b.results[0].traversal.records[0].info.CADCODE='foreign',
   b=>b.results[0].documents[0].sourceReference.recordId='foreign',
   b=>b.results[0].documents[0].contentMetadata.signature='HTML',
   b=>b.results[0].documents[0].contentMetadata.status=403,
   b=>b.results[0].documents[0].complete=false]){
   const b=structuredClone(original);mutate(b);assert.deepEqual(projectService176Evidence(b),[]);
 }
});
test('duplicate record facts do not produce duplicate summary facts or raw technical payload',async()=>{
 const b=await acquired();b.results.push(structuredClone(b.results[0]));
 const facts=projectService176Evidence(b);assert.equal(facts.length,new Set(facts.map(f=>f.claim)).size);
 const final=finalizeReport(buildEvidencePackage({service176Evidence:facts}),null);
 const prose=JSON.stringify({summary:final.summary,keyFindings:final.keyFindings,sections:final.sections});
 for(const technical of ['APP_ID','appstatus','BLOB_URI','CAPTCHA_REQUIRED',id])assert.ok(!prose.includes(technical));
});
test('all validated source PDFs reach the prompt; extra unvalidated references do not',async()=>{
 const b=await acquired();const r=b.results[0];const second=structuredClone(r.documents[0]);
 second.url=url+'-second';second.sourceReference.url=second.url;
 second.sourceReference.sourceReference=second.url;second.contentMetadata.finalUrl=second.url;
 second.rawText='Second validated document contains additional source facts.';
 r.documents.push(second);r.traversal.records[0].documents.push(second.sourceReference);
 const bad=structuredClone(second);bad.rawText='Unvalidated text must never enter the prompt.';bad.complete=false;r.documents.push(bad);
 const prompt=service176PromptEvidence(b);
 assert.ok(prompt.includes('Exact source PDF text'));assert.ok(prompt.includes('Second validated document'));
 assert.ok(!prompt.includes('Unvalidated text'));
});
test('production edge wiring projects facts into persisted result and protects them from raw payload truncation',()=>{
 const edge=readFileSync(new URL('../../../../supabase/functions/research-agent/index.ts',import.meta.url),'utf8');
 assert.ok(edge.includes('service176Evidence: projectService176Evidence(prior.browserOfficial)'));
 assert.ok(edge.includes('slice(0, 24000) + service176PromptEvidence(p.browserOfficial)'));
 const ui=readFileSync(new URL('../../../components/verify/VerifyReport.tsx',import.meta.url),'utf8');
 assert.ok(ui.includes('SummaryHero'));assert.ok(ui.includes('EvidenceDrawer'));
});
