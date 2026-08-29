// outreach-campaign-preview Edge Function
// Creates a campaign DRAFT + computes cost estimate + suppression preview.
// NEVER sends emails, SMS, or initiates calls.
// Real execution requires flag + explicit approval.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { previewEmailCost, previewSmsCost, previewCallCost, PricingConfig } from '../_shared/cost_preview.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: profileRow } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!profileRow) return new Response(JSON.stringify({ error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    const ownerId = profileRow.id;

    const body = await req.json();
    const {
      campaign_type, name, property_id, contact_list_id,
      subject, html_body, text_body, language = 'en',
      sender_name, sender_email, reply_to, ai_instructions,
      scheduled_at, call_script, call_agent_config,
      sms_template, avg_call_duration_min = 3,
    } = body;

    if (!campaign_type || !name) {
      return new Response(JSON.stringify({ error: 'campaign_type and name required' }), { status: 400, headers: corsHeaders });
    }

    // Load safety flags + pricing
    const { data: settings } = await supabase.from('admin_settings')
      .select('key,value')
      .in('key', [
        'outreach_email_sending_enabled','outreach_sms_sending_enabled','outreach_calling_enabled',
        'provider_kill_switch','outreach_email_price_per_1k','outreach_sms_unit_price',
        'outreach_call_price_per_min','community_recommend_price',
      ]);
    const fm = Object.fromEntries((settings ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));

    const pricingConfig: PricingConfig = {
      email_price_per_1k: parseFloat(String(fm['outreach_email_price_per_1k'] ?? 0.50)),
      sms_unit_price: parseFloat(String(fm['outreach_sms_unit_price'] ?? 0.02)),
      call_price_per_min: parseFloat(String(fm['outreach_call_price_per_min'] ?? 0.15)),
      community_recommend_price: parseFloat(String(fm['community_recommend_price'] ?? 0.10)),
    };

    // Count eligible contacts
    let eligibleCount = 0;
    if (contact_list_id) {
      const { data: cnt } = await supabase.rpc('get_eligible_contact_count', { p_list_id: contact_list_id });
      eligibleCount = Number(cnt ?? 0);
    }

    // Build cost preview
    let costPreview = null;
    if (campaign_type === 'EMAIL') {
      costPreview = previewEmailCost(eligibleCount, pricingConfig);
    } else if (campaign_type === 'SMS') {
      costPreview = previewSmsCost(eligibleCount, pricingConfig);
    } else if (campaign_type === 'AI_CALL') {
      costPreview = previewCallCost(eligibleCount, avg_call_duration_min, pricingConfig);
    }

    // Create DRAFT campaign
    const { data: campaign, error: insertErr } = await supabase.from('outreach_campaigns').insert({
      owner_id: ownerId,
      name,
      campaign_type,
      status: 'DRAFT',
      property_id: property_id ?? null,
      contact_list_id: contact_list_id ?? null,
      subject: subject ?? null,
      html_body: html_body ?? null,
      text_body: text_body ?? null,
      language,
      sender_name: sender_name ?? null,
      sender_email: sender_email ?? null,
      reply_to: reply_to ?? null,
      ai_instructions: ai_instructions ?? null,
      scheduled_at: scheduled_at ?? null,
      call_script: call_script ?? null,
      call_agent_config: call_agent_config ?? {},
      sms_template: sms_template ?? null,
      audience_count: eligibleCount,
      cost_estimate_usd: costPreview?.total_estimate_usd ?? 0,
      provider: 'MOCK',
    }).select('id,status,created_at').maybeSingle();

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: corsHeaders });
    }

    const sendingFlags = {
      email_enabled: fm['outreach_email_sending_enabled'] === true || fm['outreach_email_sending_enabled'] === 'true',
      sms_enabled: fm['outreach_sms_sending_enabled'] === true || fm['outreach_sms_sending_enabled'] === 'true',
      calling_enabled: fm['outreach_calling_enabled'] === true || fm['outreach_calling_enabled'] === 'true',
      kill_switch: fm['provider_kill_switch'] === true || fm['provider_kill_switch'] === 'true',
    };

    return new Response(JSON.stringify({
      campaign,
      eligible_contacts: eligibleCount,
      cost_preview: costPreview,
      sending_flags: sendingFlags,
      execution_blocked: true,
      message: 'Campaign created as DRAFT. Sending requires explicit flag enable + approval.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[outreach-campaign-preview] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
