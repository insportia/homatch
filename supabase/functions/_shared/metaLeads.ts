// Lead ingestion, shared by the webhook and the maintenance retry.
//
// Owner resolution, in order of certainty:
//   1. the ad → our meta_ad_entities row → the campaign → its owner
//   2. otherwise the ONE HOMATCH user holding this Page
// Two users holding the same Page with no ad to disambiguate is recorded as
// ambiguous and not guessed: a lead delivered to the wrong customer is a
// privacy incident, a lead held back is a support ticket.
import { graph, metaMode, openToken } from './metaAds.ts';

export interface LeadValue { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number }

export async function ingestLead(sb: any, value: LeadValue): Promise<{ inserted: boolean; note: string | null }> {
  let uid: string | null = null;
  let campaignId: string | null = null;

  if (value.ad_id) {
    const { data: adRow } = await sb.from('meta_ad_entities')
      .select('campaign_id, meta_campaigns!inner(user_id)')
      .eq('kind', 'AD').eq('external_id', String(value.ad_id)).maybeSingle();
    if (adRow) {
      campaignId = adRow.campaign_id;
      uid = (adRow.meta_campaigns as { user_id?: string } | null)?.user_id ?? null;
    }
  }
  if (!uid) {
    const { data: owners } = await sb.from('meta_assets')
      .select('user_id').eq('kind', 'PAGE').eq('external_id', String(value.page_id ?? ''));
    const distinct = [...new Set((owners ?? []).map((o: { user_id: string }) => o.user_id))];
    if (distinct.length === 0) throw new Error('PAGE_OWNER_UNKNOWN');
    if (distinct.length > 1) throw new Error('PAGE_OWNER_AMBIGUOUS');
    uid = distinct[0] as string;
  }

  // Field values come from Graph, with the OWNER's token (REAL mode).
  const fields: Record<string, unknown> = {};
  if (metaMode() === 'REAL') {
    const { data: conn } = await sb.from('meta_connections').select('id,status').eq('user_id', uid).maybeSingle();
    const { data: tok } = conn
      ? await sb.from('meta_tokens').select('access_token').eq('connection_id', conn.id).maybeSingle()
      : { data: null };
    const token = await openToken(tok?.access_token);
    if (!token) throw new Error('OWNER_TOKEN_UNAVAILABLE');
    const lead = await graph(`/${value.leadgen_id}?fields=field_data,created_time,ad_id,form_id`, {
      token, audit: { sb, userId: uid, campaignId },
    });
    for (const f of (lead.field_data as Array<{ name?: string; values?: unknown }>) ?? []) {
      fields[String(f.name)] = Array.isArray(f.values) ? f.values[0] : f.values;
    }
  }

  const { error } = await sb.from('meta_leads').insert({
    user_id: uid, campaign_id: campaignId, source: 'META_LEADGEN',
    external_lead_id: String(value.leadgen_id), form_external_id: value.form_id ?? null,
    fields, status: 'NEW',
  });
  if (error && !String(error.message).includes('duplicate')) throw error;
  if (!error) {
    try {
      await sb.rpc('notify_emit', {
        p_user_id: uid, p_type: 'META_LEAD', p_title: 'Meta Ads',
        p_body: 'NEW_LEAD', p_deep_link: '/outreach/meta?tab=leads',
        p_group_key: `meta_leads_${uid}`,
      });
    } catch { /* notification is best-effort */ }
  }
  return { inserted: !error, note: error ? 'DUPLICATE_LEAD' : campaignId ? null : 'UNATTRIBUTED_CAMPAIGN' };
}
