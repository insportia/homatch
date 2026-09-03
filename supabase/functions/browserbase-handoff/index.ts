import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

const ALLOWED_HOSTS = new Set([
  'tas.ge', 'www.tas.ge', 'docs.tbilisi.gov.ge',
  'napr.gov.ge', 'www.napr.gov.ge', 'my.gov.ge', 'www.my.gov.ge',
  'maps.gov.ge', 'www.maps.gov.ge', 'ms.gov.ge', 'www.ms.gov.ge',
  'reestri.gov.ge', 'enreg.reestri.gov.ge',
]);

function safeTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  const jwt = auth.replace(/^Bearer\s+/i, '');
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: 'Invalid session' }, 401);

  const apiKey = Deno.env.get('BROWSERBASE_API_KEY');
  if (!apiKey) return json({ error: 'Browserbase is not configured', code: 'BROWSERBASE_NOT_CONFIGURED' }, 503);

  const body = await req.json().catch(() => ({}));
  const targetUrl = safeTargetUrl(body.targetUrl) || 'https://tas.ge/?p=searchdocument&menuItemId=7104';
  const cadastralCode = typeof body.cadastralCode === 'string' ? body.cadastralCode.slice(0, 80) : null;

  const createRes = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: Deno.env.get('BROWSERBASE_PROJECT_ID') || undefined,
      region: 'eu-central-1',
      keepAlive: true,
      timeout: 900,
      browserSettings: {
        solveCaptchas: true,
        recordSession: true,
        logSession: true,
      },
      userMetadata: {
        product: 'homatch',
        purpose: 'property_research_human_verification',
        userId: user.id,
        targetUrl,
        cadastralCode,
      },
    }),
  });

  const session = await createRes.json().catch(() => null);
  if (!createRes.ok || !session?.id) {
    console.error('[browserbase-handoff] create failed', createRes.status, session);
    return json({ error: 'Could not start verification browser', code: 'BROWSERBASE_CREATE_FAILED' }, 502);
  }

  // Browserbase's Live URLs endpoint provides an embeddable debugger URL.
  // The browser may initially be blank; the user is given the exact official
  // target URL and can navigate there in the live session. Automatic CAPTCHA
  // solving remains enabled; the human is only needed when it cannot complete.
  let debug: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const d = await fetch(`https://api.browserbase.com/v1/sessions/${session.id}/debug`, {
      headers: { 'X-BB-API-Key': apiKey },
    });
    if (d.ok) {
      debug = await d.json().catch(() => null);
      if (debug?.debuggerFullscreenUrl || debug?.debuggerUrl) break;
    }
  }

  if (!debug?.debuggerFullscreenUrl && !debug?.debuggerUrl) {
    return json({ error: 'Verification browser started but Live View is not ready', code: 'LIVE_VIEW_NOT_READY', sessionId: session.id }, 502);
  }

  return json({
    status: 'HUMAN_VERIFICATION_READY',
    sessionId: session.id,
    liveViewUrl: debug.debuggerFullscreenUrl || debug.debuggerUrl,
    targetUrl,
    expiresAt: session.expiresAt || null,
    captchaPolicy: 'AUTO_THEN_HUMAN',
    message: 'Browserbase will solve supported CAPTCHA challenges automatically. If a challenge still requires interaction, complete it in this secure live browser and then return to Homatch.',
  });
});
