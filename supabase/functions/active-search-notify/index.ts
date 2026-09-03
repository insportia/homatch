// active-search-notify Edge Function (no-verify-jwt — called by background workers)
// POST { trigger: 'new_property' | 'new_signal', property_id?, signal_id? }
// Finds matching active search subscriptions and creates notifications
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { trigger, property_id, signal_id, match_id } = await req.json();
    const notified: string[] = [];

    if (trigger === 'new_property' && property_id) {
      // Find DEMAND side subscriptions that may match this new property
      // In a full implementation, compare property attributes against search_criteria
      // Here we notify all active DEMAND subscribers (they'll see relevant matches in their feed)
      const { data: subs } = await supabase.from('active_search_subscriptions')
        .select('user_id, id').eq('side', 'DEMAND').eq('is_active', true);

      for (const sub of subs ?? []) {
        await supabase.from('notifications').insert({
          user_id: sub.user_id,
          type: 'MATCH_AVAILABLE',
          // title/body are an English fallback only — the frontend renders a
          // localized string from type + metadata.kind at display time.
          title: 'New property match',
          body: 'A new property matching your search has been added.',
          is_read: false,
          metadata: { property_id, trigger: 'active_search', subscription_id: sub.id, kind: 'NEW_PROPERTY_MATCH' },
        }).catch(() => {});

        await supabase.from('active_search_subscriptions')
          .update({ last_notified_at: new Date().toISOString() }).eq('id', sub.id).catch(() => {});

        notified.push(sub.user_id);
      }
    }

    if (trigger === 'new_signal' && signal_id) {
      // Find SUPPLY side subscriptions (sellers/landlords) who should see new demand signals
      const { data: subs } = await supabase.from('active_search_subscriptions')
        .select('user_id, id, property_id').eq('side', 'SUPPLY').eq('is_active', true);

      for (const sub of subs ?? []) {
        await supabase.from('notifications').insert({
          user_id: sub.user_id,
          type: 'MATCH_AVAILABLE',
          // title/body are an English fallback only — the frontend renders a
          // localized string from type + metadata.kind at display time.
          title: 'New buyer/renter found',
          body: 'A new potential buyer or renter has been found for your property.',
          is_read: false,
          metadata: { signal_id, match_id: match_id || null, property_id: sub.property_id, trigger: 'active_search', subscription_id: sub.id, kind: 'NEW_SIGNAL_MATCH' },
        }).catch(() => {});

        await supabase.from('active_search_subscriptions')
          .update({ last_notified_at: new Date().toISOString() }).eq('id', sub.id).catch(() => {});

        notified.push(sub.user_id);
      }
    }

    return new Response(JSON.stringify({ notified_count: notified.length, trigger }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
