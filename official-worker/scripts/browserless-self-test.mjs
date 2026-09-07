const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let last='';
for(let i=0;i<20;i++){
  try{
    const r=await fetch('http://127.0.0.1:3000/health/browserless',{signal:AbortSignal.timeout(40000)});
    const body=await r.text();
    if(r.ok){console.log(`BROWSERLESS_SELF_TEST_OK ${body}`);process.exit(0)}
    last=`HTTP ${r.status} ${body}`;
  }catch(e){last=String(e)}
  await sleep(1000);
}
console.error(`BROWSERLESS_SELF_TEST_FAILED ${last}`);
process.exit(1);
