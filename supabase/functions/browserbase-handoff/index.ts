import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// Browserbase is retired from Homatch Verify. Keep this tombstone temporarily so stale clients fail closed.
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{headers:C});return new Response(JSON.stringify({error:'Browserbase integration retired',code:'PROVIDER_RETIRED'}),{status:410,headers:{...C,'Content-Type':'application/json'}})});
