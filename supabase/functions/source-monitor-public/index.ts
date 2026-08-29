Deno.serve(async (req: Request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  return new Response(JSON.stringify({
    success: false,
    paidLaunchesBlocked: true,
    provider: 'APIFY',
    error: 'Paid source monitoring is locked until Homatch paid-provider controls are explicitly enabled.',
  }), { status: 423, headers });
});
