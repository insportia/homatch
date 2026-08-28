// One-shot Edge Function: enables Google OAuth provider in Supabase Auth
// Uses the platform-injected INTEGRATIONS_API_KEY (Miaoda management token)
// to call the Supabase Management API and enable the Google provider.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const integrationsApiKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

    console.log("[enable-google-oauth] supabaseUrl:", supabaseUrl);
    console.log("[enable-google-oauth] integrationsApiKey present:", !!integrationsApiKey);
    console.log("[enable-google-oauth] googleClientId present:", !!googleClientId);
    console.log("[enable-google-oauth] googleClientSecret present:", !!googleClientSecret);

    if (!googleClientId || !googleClientSecret) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET secret not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!integrationsApiKey) {
      return new Response(
        JSON.stringify({ error: "INTEGRATIONS_API_KEY not available — platform injection missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract project ref: https://lxatsnjscesjzniylksl.supabase.co → lxatsnjscesjzniylksl
    const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
    console.log("[enable-google-oauth] projectRef:", projectRef);

    // Supabase Management API — PATCH auth config to enable Google provider
    const mgmtResponse = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${integrationsApiKey}`,
        },
        body: JSON.stringify({
          external_google_enabled: true,
          external_google_client_id: googleClientId,
          external_google_secret: googleClientSecret,
        }),
      }
    );

    const mgmtBody = await mgmtResponse.text();
    console.log(`[enable-google-oauth] Management API status: ${mgmtResponse.status}`);
    console.log(`[enable-google-oauth] Management API body: ${mgmtBody}`);

    if (!mgmtResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          status: mgmtResponse.status,
          detail: mgmtBody,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Google OAuth provider enabled successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[enable-google-oauth] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
