// Node >=22.18. Existing infrastructure only; this file does not deploy or provision services.
import {createClient} from '@supabase/supabase-js';
import {managedAdapters} from '../../supabase/functions/publishing-engine/server/adapters.ts';
import {processManagedPortal,supabaseManagedQueue} from '../../supabase/functions/publishing-engine/server/worker.ts';
if(process.argv.includes('--diagnostics')){
 console.log(JSON.stringify({execution:'MANAGED_HTTP',portals:managedAdapters.map(a=>a.diagnostics())}));
}else{
 if(process.env.HOMATCH_MANAGED_PUBLISHING_ENABLED!=='true')throw Error('MANAGED_PUBLISHING_DISABLED');
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('SERVER_CREDENTIAL_REQUIRED');
 const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const queue=supabaseManagedQueue(admin),controller=new AbortController();
 process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
 do{
  try{const scheduled=await admin.rpc('publishing_engine_schedule_managed',{p_limit:100});if(scheduled.error)throw Error('QUEUE_REQUEST_FAILED');}
  catch{console.error(JSON.stringify({code:'MANAGED_SCHEDULE_FAILED'}));}
  for(const adapter of managedAdapters){
   if(controller.signal.aborted)break;
   try{console.log(JSON.stringify(await processManagedPortal(queue,adapter,AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]))));}
   catch{console.error(JSON.stringify({portalId:adapter.id,code:'MANAGED_WORKER_FAILED'}));}
  }
  if(!process.argv.includes('--loop')||controller.signal.aborted)break;
  await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,30000);controller.signal.addEventListener('abort',done,{once:true});});
 }while(!controller.signal.aborted);
}
