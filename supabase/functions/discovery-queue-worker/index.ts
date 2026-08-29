Deno.serve(async(req:Request)=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  return new Response(JSON.stringify({
    success:false,
    paidLaunchesBlocked:true,
    error:'Paid external discovery is temporarily locked while Homatch cost and matching controls are being verified.'
  }),{status:423,headers});
});
