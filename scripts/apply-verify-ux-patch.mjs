import fs from 'node:fs';
const path='src/pages/VerifyPage.tsx';
let s=fs.readFileSync(path,'utf8');
const runAnchor="const run=async()=>{if(!valid)return;stop();setLoading(true);";
if(!s.includes(runAnchor))throw new Error('Verify run anchor missing');
s=s.replace(runAnchor,"const run=async()=>{if(!valid)return;if(mode==='cadastral'){const warning=lang==='ka'?'ღრმა საკადასტრო კვლევა შესაძლოა 10–30 წუთს გაგრძელდეს, ინფორმაციის მოცულობისა და ხელმისაწვდომი წყაროების მიხედვით. Homatch ამოწმებს ოფიციალურ რეესტრებს, დოკუმენტებს და საჯარო ინტერნეტს. კვლევის პროცესში დიდი ალბათობით დაგჭირდებათ თქვენი ჩართულობა CAPTCHA / ადამიანის ვერიფიკაციის გასავლელად — ასეთ შემთხვევაში გაიხსნება რეალური ინტერაქტიული ბრაუზერის სესია და კვლევა იმავე სესიიდან გაგრძელდება.\\n\\nგსურთ კვლევის დაწყება?':lang==='ru'?'Глубокое кадастровое исследование может занять 10–30 минут в зависимости от объёма информации и доступных источников. Homatch проверяет официальные реестры, документы и открытый интернет. В процессе, вероятно, потребуется ваше участие для прохождения CAPTCHA / проверки человеком — в таком случае откроется реальный интерактивный сеанс браузера, после чего исследование продолжится в той же сессии.\\n\\nНачать исследование?':'Deep cadastral research may take 10–30 minutes depending on the amount of information and available sources. Homatch checks official registries, documents, and the public web. You will likely need to participate if a CAPTCHA / human-verification step appears — Homatch will open a real interactive browser session and continue the research in that same session after you complete it.\\n\\nStart the research?';if(!window.confirm(warning))return;}stop();setLoading(true);");
// Customer report cleanup: keep evidence internally, but remove raw parser/engineering-style cards from the buyer-facing report.
s=s.replace('<ManualVerificationActionsCard actions={report.manualVerificationActions}/>','');
s=s.replace('<TechnicalFactsCard facts={report.technicalFacts}/>','');
s=s.replace('<PublicResearchCard pr={report.publicResearch}/>','');
s=s.replace('<DiscoveredEntitiesCard entities={report.discoveredEntities}/>','');
fs.writeFileSync(path,s);
console.log('patched VerifyPage customer UX');
