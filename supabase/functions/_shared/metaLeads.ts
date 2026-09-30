// Lead ingestion, shared by the webhook and the maintenance retry.
//
// Owner resolution, in order of certainty:
//   1. the ad → our meta_ad_entities row → the campaign → its owner
//   2. otherwise the ONE HOMATCH user holding this Page
// Two users holding the same Page with no ad to disambiguate is recorded as
// ambiguous and not guessed: a lead delivered to the wrong customer is a
// privacy incident, a lead held back is a support ticket.
import { graph, metaMode, openToken } from './metaAds.ts';
import { notify } from './notify.ts';
import { mapLeadAnswers } from '../../../src/lib/metaAds/leadForms.ts';
import { NEW_LEAD, normLocale, t6 } from '../../../src/lib/metaAds/messages.ts';
import { scrubPii } from '../../../src/lib/metaAds/events.ts';

export interface LeadValue { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number }

export async function ingestLead(sb: any, value: LeadValue): Promise<{ inserted: boolean; note: string | null }> {
  let uid: string | null = null;
  let campaignId: string | null = null;
  let campaignName: string | null = null;
  let propertyId: string | null = null;
  let adsetId: string | null = null;

  if (value.ad_id) {
    const { data: adRow } = await sb.from('meta_ad_entities')
      .select('campaign_id, parent_external_id, meta_campaigns!inner(user_id,name,property_id)')
      .eq('kind', 'AD').eq('external_id', String(value.ad_id)).maybeSingle();
    if (adRow) {
      campaignId = adRow.campaign_id;
      adsetId = adRow.parent_external_id ?? null;
      const camp = adRow.meta_campaigns as { user_id?: string; name?: string; property_id?: string } | null;
      uid = camp?.user_id ?? null;
      campaignName = camp?.name ?? null;
      propertyId = camp?.property_id ? String(camp.property_id) : null;
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
  let answers: Record<string, string> = {};
  let createdTime: string | null = value.created_time ? new Date(Number(value.created_time) * 1000).toISOString() : null;
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
    const fieldData = (lead.field_data as Array<{ name?: string; values?: string[] }>) ?? [];
    for (const f of fieldData) {
      fields[String(f.name)] = Array.isArray(f.values) ? f.values[0] : f.values;
    }
    // The qualifying answers (budget, timeframe…) as HOMATCH keys, for the Leads Center.
    answers = mapLeadAnswers(fieldData);
    if (lead.created_time) createdTime = new Date(String(lead.created_time)).toISOString();
  }

  const { error } = await sb.from('meta_leads').insert({
    user_id: uid, campaign_id: campaignId, source: 'META_LEADGEN',
    external_lead_id: String(value.leadgen_id), form_external_id: value.form_id ?? null,
    ad_external_id: value.ad_id ? String(value.ad_id) : null, adset_external_id: adsetId, property_id: propertyId,
    answers, meta_created_time: createdTime,
    fields, status: 'NEW',
  });
  if (error && !String(error.message).includes('duplicate')) throw error;
  if (!error) {
    /* The ONE notification pipeline (in-app → push, preferences honoured:
       category meta_leads). The text never carries the person's details. */
    try {
      const { data: u } = await sb.from('users').select('preferred_language,language').eq('id', uid).maybeSingle();
      const loc = normLocale(u?.preferred_language ?? u?.language);
      await notify(sb, {
        userId: uid!, type: 'META_LEAD', title: t6(NEW_LEAD.title, loc),
        body: scrubPii(t6(NEW_LEAD.body, loc, { campaign: campaignName ?? 'Meta Ads' })), priority: 'HIGH',
        deepLink: campaignId ? `/outreach/meta?tab=leads&campaign=${campaignId}` : '/outreach/meta?tab=leads',
        entityType: campaignId ? 'META_CAMPAIGN' : null, entityId: campaignId,
        // Not grouped: a lead is one person asking — never folded into a count.
        dedupeKey: `meta_lead:${value.leadgen_id}`,
        metadata: { kind: 'META_LEAD', category: 'LEADS', pref: 'meta_leads' },
      });
    } catch { /* notification is best-effort */ }
  }
  return { inserted: !error, note: error ? 'DUPLICATE_LEAD' : campaignId ? null : 'UNATTRIBUTED_CAMPAIGN' };
}
