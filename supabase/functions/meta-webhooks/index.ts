// META ADS — webhook receiver.
//
// GET  = subscription verification (hub.challenge echo, verify token).
// POST = signed deliveries. Signature is HMAC-SHA256 of the RAW body with
// the app secret; unsigned or mis-signed payloads are stored (admin
// forensics) but never processed. Handlers are idempotent: the dedupe key
// makes a redelivered lead a no-op, not a duplicate row.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyWebhookSignature, graph, metaMode } from '../_shared/metaAds.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && token && token === Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  const raw = await req.text();
  const sigOk = await verifyWebhookSignature(raw, req.headers.get('X-Hub-Signature-256'));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { /* stored as-is below */ }

  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const dedupe = `${payload.object}:${entry.id}:${change.field}:${change.value?.leadgen_id ?? entry.time ?? ''}`;
      const { data: stored, error } = await sb.from('meta_webhook_events').insert({
        topic: `${payload.object}.${change.field}`, dedupe_key: dedupe,
        signature_ok: sigOk, payload: change,
      }).select('id').maybeSingle();
      if (error || !stored) continue;            // duplicate delivery → no-op
      if (!sigOk) continue;                       // stored for admin, never processed

      if (change.field === 'leadgen' && change.value?.leadgen_id) {
        try {
          await ingestLead(sb, change.value);
          await sb.from('meta_webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', stored.id);
        } catch (err) {
          await sb.from('meta_webhook_events').update({ error: String(err).slice(0, 400) }).eq('id', stored.id);
        }
      }
    }
  }
  // Meta expects a fast 200 regardless; failures are retried by Meta and
  // deduped by us.
  return new Response('ok', { status: 200 });
});

async function ingestLead(sb: any, value: { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string }) {
  // Owner = whoever holds this Page in their connected assets.
  const { data: pageAsset } = await sb.from('meta_assets')
    .select('user_id').eq('kind', 'PAGE').eq('external_id', String(value.page_id ?? '')).maybeSingle();
  if (!pageAsset) throw new Error('PAGE_OWNER_UNKNOWN');
  const uid = pageAsset.user_id as string;

  // Campaign attribution through the stored external ad id, when we have it.
  let campaignId: string | null = null;
  if (value.ad_id) {
    const { data: adRow } = await sb.from('meta_ad_entities')
      .select('campaign_id').eq('kind', 'AD').eq('external_id', String(value.ad_id)).maybeSingle();
    campaignId = adRow?.campaign_id ?? null;
  }

  // Field values come from Graph, with the OWNER's token (REAL mode).
  let fields: Record<string, unknown> = {};
  if (metaMode() === 'REAL') {
    const { data: conn } = await sb.from('meta_connections').select('id').eq('user_id', uid).maybeSingle();
    const { data: tok } = conn
      ? await sb.from('meta_tokens').select('access_token').eq('connection_id', conn.id).maybeSingle()
      : { data: null };
    if (tok?.access_token) {
      const lead = await graph(`/${value.leadgen_id}?fields=field_data,created_time`, {
        token: tok.access_token, audit: { sb, userId: uid },
      });
      for (const f of (lead.field_data as any[]) ?? []) {
        fields[String(f.name)] = Array.isArray(f.values) ? f.values[0] : f.values;
      }
    }
  }

  const { error } = await sb.from('meta_leads').insert({
    user_id: uid, campaign_id: campaignId, source: 'META_LEADGEN',
    external_lead_id: String(value.leadgen_id), form_external_id: value.form_id ?? null,
    fields, status: 'NEW',
  });
  if (error && !String(error.message).includes('duplicate')) throw error;
  if (!error) {
    await sb.rpc('notify_emit', {
      p_user_id: uid, p_type: 'META_LEAD', p_title: 'Meta Ads',
      p_body: 'NEW_LEAD', p_deep_link: '/outreach/meta/leads',
      p_group_key: `meta_leads_${uid}`,
    }).catch?.(() => {});
  }
}
