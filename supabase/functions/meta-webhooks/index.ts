// META ADS — webhook receiver.
//
// GET  = subscription verification (hub.challenge echo, verify token).
// POST = signed deliveries. Signature is HMAC-SHA256 of the RAW body with
// the app secret, and it is checked BEFORE anything claims a dedupe key.
// An unsigned or mis-signed payload is kept for admin forensics under a key
// of its own, so it can never pre-claim the key a genuine delivery needs
// (the earlier order let a forged POST with a real leadgen_id make Meta's
// real, signed delivery look like a duplicate and be dropped).
//
// Handlers are idempotent: the dedupe key makes a redelivered lead a no-op,
// not a duplicate row, and meta_leads is unique on (user_id, external_lead_id).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyWebhookSignature, scrubText } from '../_shared/metaAds.ts';
import { ingestLead } from '../_shared/metaLeads.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const expected = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 });

  const raw = await req.text();
  const sigOk = await verifyWebhookSignature(raw, req.headers.get('X-Hub-Signature-256'));
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { /* stored below */ }

  if (!sigOk) {
    await sb.from('meta_webhook_events').insert({
      topic: `${payload?.object ?? 'unknown'}.unsigned`,
      dedupe_key: `unsigned:${crypto.randomUUID()}`,
      signature_ok: false,
      payload: { bytes: raw.length, object: payload?.object ?? null },
    });
    // 200 so a probe learns nothing; nothing is processed.
    return new Response('ok', { status: 200 });
  }

  const { data: switchRow } = await sb.from('admin_settings').select('value').eq('key', 'meta_ads_lead_sync_enabled').maybeSingle();
  const leadSyncEnabled = switchRow?.value !== false;

  const entries: any[] = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const dedupe = `${payload.object}:${entry.id}:${change.field}:${change.value?.leadgen_id ?? entry.time ?? ''}`;
      const { data: stored, error } = await sb.from('meta_webhook_events').insert({
        topic: `${payload.object}.${change.field}`, dedupe_key: dedupe,
        signature_ok: true, payload: change,
      }).select('id').maybeSingle();
      if (error || !stored) continue; // duplicate delivery → no-op

      if (change.field === 'leadgen' && change.value?.leadgen_id) {
        if (!leadSyncEnabled) {
          await sb.from('meta_webhook_events').update({ error: 'LEAD_SYNC_DISABLED' }).eq('id', stored.id);
          continue;
        }
        try {
          const result = await ingestLead(sb, change.value);
          await sb.from('meta_webhook_events').update({
            processed_at: new Date().toISOString(), error: result.note,
          }).eq('id', stored.id);
        } catch (err) {
          // Kept unprocessed with its reason; meta-ads-api's maintenance pass retries it.
          await sb.from('meta_webhook_events').update({
            error: scrubText(err instanceof Error ? err.message : String(err)).slice(0, 400),
          }).eq('id', stored.id);
        }
      } else if (payload.object === 'ad_account' || payload.object === 'page') {
        /* A change Meta tells us about (ad objects in review / with issues,
           a page change). The webhook only ACCELERATES: the campaigns it may
           concern are moved to the front of the next reconciliation pass,
           which reads Meta itself. Nothing is changed from the payload. */
        const id = String(entry.id ?? '');
        if (/^[0-9]{1,32}$/.test(id)) {
          const col = payload.object === 'ad_account' ? 'ad_account_external_id' : 'page_external_id';
          const ids = payload.object === 'ad_account' ? [`act_${id}`, id] : [id];
          await sb.from('meta_campaigns').update({ last_synced_at: null, insights_synced_at: null })
            .in(col, ids).in('status', ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED']);
        }
        await sb.from('meta_webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', stored.id);
      }
    }
  }
  // Meta expects a fast 200; our own failures are retried by maintenance.
  return new Response('ok', { status: 200 });
});
