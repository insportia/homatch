import fs from 'node:fs';
const path='src/pages/VerifyPage.tsx';
let s=fs.readFileSync(path,'utf8');
// The 10–30 minute/CAPTCHA notice is now native in VerifyPage. This build-time
// pass only removes internal/raw evidence-dump cards from the customer report;
// the underlying fields remain persisted for synthesis/admin diagnostics.
for(const card of[
 '<ManualVerificationActionsCard actions={report.manualVerificationActions}/>',
 '<TechnicalFactsCard facts={report.technicalFacts}/>',
 '<PublicResearchCard pr={report.publicResearch}/>',
 '<DiscoveredEntitiesCard entities={report.discoveredEntities}/>'
])s=s.replace(card,'');
fs.writeFileSync(path,s);
console.log('applied Verify customer report cleanup');
