// social-post-generate Edge Function
// Generates grounded, platform/language-specific posts for a property+community.
// Never invents price, availability, amenities, contacts, verification.
// Review REQUIRED before posting. Auto-post disabled.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  TELEGRAM: 4096, FACEBOOK: 2000, VK: 4096,
  REDDIT: 40000, LINKEDIN: 3000, THREADS: 500, OTHER: 2000,
};

const LANG_NAMES: Record<string, string> = {
  en: 'English', ka: 'Georgian (ქართული)', ru: 'Russian (Русский)',
  tr: 'Turkish (Türkçe)', ar: 'Arabic (العربية) — use RTL text direction',
  he: 'Hebrew (עברית) — use RTL text direction',
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

    const {
      property_id, community_id, language = 'en',
      mode = 'ai_draft',  // 'manual'|'ai_draft'|'shorter'|'professional'|'investor'|'buyer'|'translate'
      ai_instructions = '',
      existing_content = '',
    } = await req.json();

    if (!property_id) return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400, headers: corsHeaders });

    // Safety: auto_post disabled
    const { data: flags } = await supabase.from('admin_settings')
      .select('key,value').in('key', ['community_auto_post_enabled', 'provider_kill_switch']);
    const flagMap = Object.fromEntries((flags ?? []).map((f: { key: string; value: unknown }) => [f.key, f.value]));
    const autoPostEnabled = flagMap['community_auto_post_enabled'] === true || flagMap['community_auto_post_enabled'] === 'true';
    if (autoPostEnabled) console.warn('[social-post-generate] WARNING: community_auto_post_enabled=true but post still requires human review');

    // Fetch property + verify ownership
    const { data: property } = await supabase.from('properties')
      .select('id,owner_id,title,description,property_type,transaction_type,price,currency,country,city,address')
      .eq('id', property_id).eq('owner_id', user.id).maybeSingle();
    if (!property) return new Response(JSON.stringify({ error: 'Property not found or forbidden' }), { status: 404, headers: corsHeaders });

    // Fetch community if provided
    let community: { platform: string; name: string; language: string; posting_policy: string } | null = null;
    if (community_id) {
      const { data: c } = await supabase.from('communities')
        .select('platform,name,language,posting_policy').eq('id', community_id).maybeSingle();
      community = c;
    }

    const platform = community?.platform ?? 'OTHER';
    const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 2000;
    const langName = LANG_NAMES[language] ?? language;

    // Build grounded prompt — only use verified property facts
    const promptParts: string[] = [
      `You are a real estate marketing assistant for Homatch, a property platform.`,
      `Generate a compelling social media post for this VERIFIED property listing.`,
      ``,
      `VERIFIED FACTS (use ONLY these — do not invent):`,
      `- Title: ${property.title ?? 'N/A'}`,
      `- Type: ${property.property_type ?? 'N/A'} for ${property.transaction_type ?? 'N/A'}`,
      `- Location: ${[property.city, property.country].filter(Boolean).join(', ') || 'N/A'}`,
      property.price ? `- Price: ${property.price} ${property.currency ?? 'USD'}` : `- Price: Contact for pricing`,
      property.description ? `- Description excerpt: ${String(property.description).slice(0, 300)}` : '',
      ``,
      `PLATFORM: ${platform} (${community?.name ?? 'general'})`,
      `LANGUAGE: ${langName}`,
      `CHARACTER LIMIT: ${charLimit}`,
      ``,
      `MODE: ${mode}${mode === 'translate' && existing_content ? ` — translate this content: "${existing_content.slice(0, 500)}"` : ''}`,
      ai_instructions ? `ADDITIONAL INSTRUCTIONS: ${ai_instructions}` : '',
      ``,
      `STRICT RULES:`,
      `- NEVER invent amenities, features, floor plans, HOA fees, or utilities not listed above`,
      `- NEVER claim "verified", "guaranteed", "best price", "last unit" unless in verified facts`,
      `- NEVER invent developer names, contact info, or availability dates`,
      `- Include a call-to-action to contact via Homatch`,
      `- Keep under ${charLimit} characters`,
      `- For Arabic and Hebrew: write right-to-left naturally`,
      `- Return ONLY the post content, no explanation`,
    ].filter(Boolean);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('INTEGRATIONS_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'AI generation not configured' }), { status: 503, headers: corsHeaders });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptParts.join('\n') }] }] }),
      }
    );

    const geminiJson = await geminiRes.json();
    const content = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!content) return new Response(JSON.stringify({ error: 'Generation failed', details: geminiJson }), { status: 502, headers: corsHeaders });

    // Save to social_posts as DRAFT (requires human review)
    const { data: post } = await supabase.from('social_posts').insert({
      owner_id: user.id,
      property_id,
      community_id: community_id ?? null,
      platform,
      language,
      content: content.trim(),
      generation_mode: mode,
      status: 'DRAFT',
      ai_instructions: ai_instructions || null,
      metadata: { char_limit: charLimit, mode, word_count: content.split(/\s+/).length },
    }).select('id').maybeSingle();

    return new Response(JSON.stringify({
      content: content.trim(),
      post_id: post?.id,
      platform, language,
      char_count: content.trim().length,
      char_limit: charLimit,
      status: 'DRAFT',
      review_required: true,
      auto_post_disabled: !autoPostEnabled,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[social-post-generate] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
