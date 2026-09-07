import fs from 'node:fs';
const path='src/pages/VerifyPage.tsx';
let s=fs.readFileSync(path,'utf8');
// Keep raw evidence persisted for synthesis/admin diagnostics, but do not
// render parser/worker-style dump cards in the customer due-diligence report.
for(const card of['<ManualVerificationActionsCard actions={report.manualVerificationActions}/>','<TechnicalFactsCard facts={report.technicalFacts}/>','<PublicResearchCard pr={report.publicResearch}/>','<DiscoveredEntitiesCard entities={report.discoveredEntities}/>'])s=s.replace(card,'');
// Customer-facing conclusion is intentionally three-level and plain-language:
// positive / moderately positive / negative. The explanatory strengths and
// findings remain immediately below the badge, so the label is never shown
// without the evidence-backed reasons that produced it.
const oldLabel="const overallAssessmentLabel=(lvl:OverallAssessmentLevel|undefined,t:(k:string)=>string)=>({VERY_POSITIVE:t('verify_assessment_very_positive'),POSITIVE:t('verify_assessment_positive'),GENERALLY_POSITIVE:t('verify_assessment_generally_positive'),NEUTRAL_MIXED:t('verify_assessment_neutral_mixed'),ATTENTION_REQUIRED:t('verify_assessment_attention_required')}[String(lvl||'')]||t('verify_assessment_generally_positive'));";
const newLabel="const overallAssessmentLabel=(lvl:OverallAssessmentLevel|undefined,_t:(k:string)=>string,lang:string)=>{const positive=lang==='ka'?'დადებითი':lang==='ru'?'Положительная':'Positive';const moderate=lang==='ka'?'საშუალოდ დადებითი':lang==='ru'?'Умеренно положительная':'Moderately positive';const negative=lang==='ka'?'უარყოფითი':lang==='ru'?'Отрицательная':'Negative';return({VERY_POSITIVE:positive,POSITIVE:positive,GENERALLY_POSITIVE:moderate,NEUTRAL_MIXED:moderate,ATTENTION_REQUIRED:negative} as Record<string,string>)[String(lvl||'')]||moderate};";
if(s.includes(oldLabel))s=s.replace(oldLabel,newLabel);
s=s.replace("function OverallAssessmentCard({oa,r}:{oa?:OverallAssessment|null;r:Report}){const{t}=useLanguage();","function OverallAssessmentCard({oa,r}:{oa?:OverallAssessment|null;r:Report}){const{t,lang}=useLanguage();");
s=s.replace('overallAssessmentLabel(oa.level,t)</Badge>','overallAssessmentLabel(oa.level,t,lang)</Badge>');
fs.writeFileSync(path,s);
console.log('applied Verify customer report cleanup + three-level assessment');
