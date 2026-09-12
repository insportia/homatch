// Fixture rows for the Communications browser sweep.
//
// WHAT THIS IS NOT
//
// It is not a production auth bypass and it is not a second implementation of
// the app. Nothing here is imported by src/. The build under test is the
// ordinary bundle, pointed by .env.harness at an origin that does not resolve
// (https://stubproj.supabase.co); the test intercepts every request to that
// origin and answers from this file. So the REAL AuthContext, the REAL
// RouteGuard, the REAL services/communications.ts queries and the REAL page
// components all run — only the network on the far side is a fixture.
//
// That is the whole reason the sweep is worth running: it exercises the
// shipped code paths, including the ones the unapplied migration would
// otherwise make unreachable.
//
// The rows are deliberately ADVERSARIAL, because the point of a layout and
// copy sweep is to find what breaks:
//   - a 46-character unbroken Georgian compound in a campaign name
//   - a +995 number, a +971 number and a +1 number side by side
//   - a template rejected with a long English reason
//   - a null cost_usd, which must render as "no price set", not as zero
//   - an agent name containing an apostrophe and an em dash

const OWNER = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-09-12T09:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

/**
 * A session shaped the way supabase-js v2 persists it.
 *
 * THE EXPIRY IS READ FROM THE REAL CLOCK, NOT FROM `NOW`.
 *
 * Every row above is stamped from a frozen NOW so the data is deterministic.
 * The session must not be: supabase-js compares `expires_at` against the
 * actual time, and a token that looks expired sends it into a refresh loop
 * against /auth/v1/token. The fixture answers that with the same stale
 * session, so it loops forever, `loading` never resolves, and every single
 * screen renders RouteGuard's "Loading…" — which is exactly what the first
 * full sweep measured across all 115 pages before this was found.
 */
export function harnessSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: OWNER, role: 'authenticated', exp,
    email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: OWNER, aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: iso(60 * 24 * 30),
    },
  };
}

export const OWNER_ID = OWNER;

/** The `users` row AdminLayout reads to decide whether to render at all. */
const USER_ROW = {
  id: 'u-harness', auth_id: OWNER, email: 'harness@example.test',
  full_name: 'Harness Operator', is_admin: true, role: 'agent',
  preferred_language: null, created_at: iso(60 * 24 * 30),
  credits_balance: 4200, phone: '+995322000000', avatar_url: null,
};

/*
 * EVERY ROW BELOW MATCHES src/types/communications.ts COLUMN FOR COLUMN.
 *
 * The first draft of this file was written from memory and used `channel` on a
 * campaign, which was renamed to `campaign_type` in
 * 20260829180000_outreach_schema_reconciliation.sql. The Overview page read
 * `c.campaign_type.toLowerCase()`, got undefined, and the error boundary
 * blanked the entire screen — a "finding" that was entirely the fixture's
 * fault and would have sent an hour into debugging correct code.
 *
 * So: tests/browser/fixtureShape.test.mjs now checks these rows against the
 * declared types, and it fails if a column is invented, misspelled or given a
 * value outside the vocabulary the database CHECKs.
 */

const AGENTS = [
  {
    id: 'ag-1', owner_id: OWNER, name: 'ვაკე — გამყიდველის დაზუსტება',
    purpose: 'Qualify sellers who asked about a valuation',
    template_code: 'SELLER_QUALIFICATION', status: 'READY',
    channels: ['AI_CALL'], languages: ['ka', 'ru'],
    introduction: 'გამარჯობა, ჰომაჩიდან გირეკავთ.',
    primary_goal: 'Find out what they want to sell and when',
    business_context: 'Homatch is a property marketplace in Tbilisi.',
    target_audience: 'Owners who requested a valuation in the last 30 days',
    tone: 'WARM',
    qualification_questions: [
      { id: 'q1', text: 'რომელ უბანშია ბინა?' },
      { id: 'q2', text: 'რამდენი ოთახია?' },
      { id: 'q3', text: 'როდის გინდათ გაყიდვა?' },
    ],
    knowledge_notes: 'Never quote a price. Offer a viewing instead.',
    allowed_actions: ['BOOK_VIEWING', 'REQUEST_CALLBACK'],
    forbidden_actions: ['QUOTE_PRICE', 'PROMISE_TIMELINE'],
    escalation_instructions: 'If they ask for a human, hand over immediately.',
    callback_rules: 'Weekdays 10:00-19:00 Tbilisi time.',
    voice_id: 'voice-ka-1', voice_label: 'Nino — Georgian, warm',
    ai_disclosure_enabled: true, property_id: null,
    current_version: 4, last_used_at: iso(30),
    created_at: iso(60 * 24 * 9), updated_at: iso(30),
    campaignCount: 2, interactionCount: 268, qualifiedCount: 41,
  },
  {
    id: 'ag-2', owner_id: OWNER, name: "Buyer's follow-up — Tbilisi centre",
    purpose: 'Follow up on a listing enquiry over WhatsApp',
    template_code: 'PROPERTY_FOLLOWUP', status: 'DRAFT',
    channels: ['WHATSAPP'], languages: ['en', 'ka'],
    introduction: 'Hi, following up on the flat you asked about.',
    primary_goal: 'Book a viewing', business_context: null,
    target_audience: 'Anyone who messaged about a listing and went quiet',
    tone: 'PROFESSIONAL',
    qualification_questions: [],
    knowledge_notes: null,
    allowed_actions: ['BOOK_VIEWING'], forbidden_actions: ['QUOTE_PRICE'],
    escalation_instructions: null, callback_rules: null,
    voice_id: null, voice_label: null,
    ai_disclosure_enabled: true, property_id: null,
    current_version: 2, last_used_at: null,
    created_at: iso(60 * 24 * 3), updated_at: iso(220),
    campaignCount: 1, interactionCount: 44, qualifiedCount: 6,
  },
  {
    id: 'ag-3', owner_id: OWNER, name: 'Archived winter campaign agent',
    purpose: 'Announce a seasonal offer',
    template_code: 'COLD_REACTIVATION', status: 'ARCHIVED',
    channels: ['AI_CALL'], languages: ['ru'],
    introduction: 'Здравствуйте.', primary_goal: null, business_context: null,
    target_audience: null, tone: 'NEUTRAL',
    qualification_questions: [], knowledge_notes: null,
    allowed_actions: [], forbidden_actions: [],
    escalation_instructions: null, callback_rules: null,
    voice_id: 'voice-ru-2', voice_label: 'Anna — Russian, neutral',
    ai_disclosure_enabled: true, property_id: null,
    current_version: 7, last_used_at: iso(60 * 24 * 40),
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 40),
    campaignCount: 0, interactionCount: 0, qualifiedCount: 0,
  },
];

const CAMPAIGNS = [
  {
    id: 'cp-1', owner_id: OWNER, name: 'საახალწლო-გაყიდვების-შეთავაზება',
    campaign_type: 'AI_CALL', status: 'RUNNING',
    contact_list_id: 'cl-1', property_id: null, agent_id: 'ag-1',
    agent_version_id: 'av-4', channel_account_id: 'ca-2',
    template_id: null, template_variables: null,
    audience_count: 412, sent_count: 268, delivered_count: 257, reply_count: 61,
    cost_estimate_usd: 96.4, cost_actual_usd: 41.83, max_spend_usd: 150,
    risk_level: 'LOW', compliance_state: 'ALLOW', paused_reason: null,
    timezone: 'Asia/Tbilisi', send_window_start: 10, send_window_end: 19,
    max_attempts: 2, retry_gap_minutes: 180, concurrency: 4,
    scheduled_at: iso(600), launched_at: iso(600),
    created_at: iso(60 * 24 * 2), updated_at: iso(12),
  },
  {
    id: 'cp-2', owner_id: OWNER, name: 'WhatsApp re-engagement, Saburtalo',
    campaign_type: 'WHATSAPP', status: 'COMPLIANCE_PAUSED',
    contact_list_id: 'cl-2', property_id: null, agent_id: 'ag-2',
    agent_version_id: null, channel_account_id: 'ca-1',
    template_id: 'tp-1', template_variables: { 1: 'full_name', 2: 'listing_title' },
    audience_count: 180, sent_count: 44, delivered_count: 39, reply_count: 8,
    cost_estimate_usd: 12.6, cost_actual_usd: 0.37, max_spend_usd: 40,
    risk_level: 'HIGH', compliance_state: 'REVIEW',
    paused_reason: 'BLOCK_RATE_ABOVE_THRESHOLD',
    timezone: 'Asia/Tbilisi', send_window_start: 9, send_window_end: 20,
    max_attempts: 1, retry_gap_minutes: 0, concurrency: 2,
    scheduled_at: null, launched_at: iso(60 * 24 * 4),
    created_at: iso(60 * 24 * 5), updated_at: iso(90),
  },
  {
    id: 'cp-3', owner_id: OWNER, name: 'Draft — Batumi seafront owners',
    campaign_type: 'AI_CALL', status: 'DRAFT',
    contact_list_id: null, property_id: null, agent_id: null,
    agent_version_id: null, channel_account_id: null,
    template_id: null, template_variables: null,
    audience_count: 0, sent_count: 0, delivered_count: 0, reply_count: 0,
    cost_estimate_usd: 0, cost_actual_usd: 0, max_spend_usd: null,
    risk_level: null, compliance_state: null, paused_reason: null,
    timezone: 'Asia/Tbilisi', send_window_start: null, send_window_end: null,
    max_attempts: 1, retry_gap_minutes: 0, concurrency: 1,
    scheduled_at: null, launched_at: null,
    created_at: iso(60 * 6), updated_at: iso(60 * 6),
  },
];

const SENDS = [
  {
    id: 'sd-1', campaign_id: 'cp-1', contact_id: 'ct-1', owner_id: OWNER,
    channel: 'AI_CALL', recipient_phone: '+995599123456', recipient_email: null,
    status: 'COMPLETED', provider: 'cartesia', outcome: 'INTERESTED',
    lead_score: 72, language: 'ka', duration_sec: 134,
    transcript: 'AGENT: გამარჯობა, ჰომაჩიდან გირეკავთ.\nCONTACT: დიახ, გისმენთ.',
    summary: 'Owner of a 3-room flat in Vake, wants to sell within three months.',
    recording_url: null, error_message: null,
    cost_usd: 0.59, attempt_count: 1,
    sent_at: iso(41), call_started_at: iso(41), call_ended_at: iso(38),
    created_at: iso(41), updated_at: iso(38),
  },
  {
    id: 'sd-2', campaign_id: 'cp-1', contact_id: 'ct-2', owner_id: OWNER,
    channel: 'AI_CALL', recipient_phone: '+971501234567', recipient_email: null,
    status: 'NO_ANSWER', provider: 'cartesia', outcome: null,
    lead_score: null, language: null, duration_sec: 0,
    transcript: null, summary: null, recording_url: null,
    error_message: null,
    // Null on purpose: a call that never connected was not free, it was
    // unpriced, and the billing screen has to say so rather than show $0.00.
    cost_usd: null, attempt_count: 2,
    sent_at: iso(36), call_started_at: iso(36), call_ended_at: iso(35),
    created_at: iso(36), updated_at: iso(35),
  },
  {
    id: 'sd-3', campaign_id: 'cp-2', contact_id: 'ct-3', owner_id: OWNER,
    channel: 'WHATSAPP', recipient_phone: '+12025550185', recipient_email: null,
    status: 'DELIVERED', provider: 'meta', outcome: null,
    lead_score: null, language: 'en', duration_sec: null,
    transcript: null, summary: null, recording_url: null, error_message: null,
    cost_usd: 0.0085, attempt_count: 1,
    sent_at: iso(20), call_started_at: null, call_ended_at: null,
    created_at: iso(20), updated_at: iso(20),
  },
  {
    id: 'sd-4', campaign_id: 'cp-1', contact_id: 'ct-4', owner_id: OWNER,
    channel: 'AI_CALL', recipient_phone: '+995577889900', recipient_email: null,
    status: 'ANSWERED', provider: 'cartesia', outcome: null,
    lead_score: null, language: 'ka', duration_sec: 31,
    transcript: null, summary: null, recording_url: null, error_message: null,
    cost_usd: null, attempt_count: 1,
    sent_at: iso(1), call_started_at: iso(1), call_ended_at: null,
    created_at: iso(1), updated_at: iso(1),
  },
  {
    id: 'sd-5', campaign_id: 'cp-2', contact_id: 'ct-1', owner_id: OWNER,
    channel: 'WHATSAPP', recipient_phone: '+995599123456', recipient_email: null,
    status: 'FAILED', provider: 'meta', outcome: null,
    lead_score: null, language: 'ka', duration_sec: null,
    transcript: null, summary: null, recording_url: null,
    error_message: 'the WhatsApp access token is invalid or expired',
    cost_usd: null, attempt_count: 1,
    sent_at: iso(18), call_started_at: null, call_ended_at: null,
    created_at: iso(18), updated_at: iso(18),
  },
];

const CONTACTS = [
  {
    id: 'ct-1', list_id: 'cl-1', owner_id: OWNER, full_name: 'ნინო ქავთარაძე',
    phone: '+995599123456', email: 'nino@example.test', company: null,
    language: 'ka', country: 'GE', city: 'Tbilisi', tags: ['seller', 'vake'],
    consent_status: 'GRANTED', consent_source: 'VALUATION_FORM',
    lead_stage: 'QUALIFIED', lead_score: 72, lead_type: 'SELLER',
    transaction_type: 'SELL', property_type: 'APARTMENT',
    preferred_locations: ['vake'], budget_min: null, budget_max: 185000,
    currency: 'USD', bedrooms: 3, timeline: 'WITHIN_3_MONTHS',
    notes: 'Prefers a viewing on Thursday afternoon.',
    phone_valid: true, email_valid: true, phone_e164_confidence: 'EXACT',
    do_not_contact: false, do_not_call: false, unsubscribed: false,
    whatsapp_opted_out: false, suppressed: false, suppressed_reason: null,
    last_contacted_at: iso(38), created_at: iso(60 * 24 * 20),
  },
  {
    id: 'ct-2', list_id: 'cl-1', owner_id: OWNER, full_name: 'Ahmed Al-Mansouri',
    phone: '+971501234567', email: null, company: 'Mansouri Holdings',
    language: 'ar', country: 'AE', city: 'Dubai', tags: ['investor'],
    consent_status: 'GRANTED', consent_source: 'IMPORT',
    lead_stage: 'REACHED', lead_score: null, lead_type: 'BUYER',
    transaction_type: 'INVEST', property_type: null,
    preferred_locations: [], budget_min: 200000, budget_max: 600000,
    currency: 'USD', bedrooms: null, timeline: null, notes: null,
    phone_valid: true, email_valid: null, phone_e164_confidence: 'EXACT',
    do_not_contact: false, do_not_call: false, unsubscribed: false,
    whatsapp_opted_out: false, suppressed: false, suppressed_reason: null,
    last_contacted_at: iso(35), created_at: iso(60 * 24 * 12),
  },
  {
    id: 'ct-3', list_id: 'cl-2', owner_id: OWNER, full_name: 'Dana Whitfield',
    phone: '+12025550185', email: 'dana@example.test', company: null,
    language: 'en', country: 'US', city: 'Washington', tags: [],
    consent_status: 'WITHDRAWN', consent_source: 'IMPORT',
    lead_stage: 'LOST', lead_score: null, lead_type: null,
    transaction_type: null, property_type: null,
    preferred_locations: null, budget_min: null, budget_max: null,
    currency: null, bedrooms: null, timeline: null,
    notes: 'Replied STOP. Suppressed everywhere.',
    phone_valid: true, email_valid: true, phone_e164_confidence: 'EXACT',
    do_not_contact: true, do_not_call: true, unsubscribed: true,
    whatsapp_opted_out: true, suppressed: true, suppressed_reason: 'OPTED_OUT',
    last_contacted_at: iso(60 * 24), created_at: iso(60 * 24 * 30),
  },
  {
    id: 'ct-4', list_id: 'cl-1', owner_id: OWNER, full_name: null,
    phone: '+995577889900', email: null, company: null,
    language: null, country: 'GE', city: null, tags: [],
    consent_status: 'GRANTED', consent_source: 'IMPORT',
    lead_stage: 'NEW', lead_score: null, lead_type: null,
    transaction_type: null, property_type: null,
    preferred_locations: null, budget_min: null, budget_max: null,
    currency: null, bedrooms: null, timeline: null, notes: null,
    // A row with no name at all: every screen that shows a contact has to
    // survive it, and one of them used to render "undefined".
    phone_valid: true, email_valid: null, phone_e164_confidence: 'LIKELY',
    do_not_contact: false, do_not_call: false, unsubscribed: false,
    whatsapp_opted_out: false, suppressed: false, suppressed_reason: null,
    last_contacted_at: null, created_at: iso(60 * 24 * 4),
  },
];

const CONVERSATIONS = [
  {
    id: 'cv-1', owner_id: OWNER, contact_id: 'ct-1', channel_account_id: 'ca-1',
    channel: 'WHATSAPP', peer_address: '+995599123456', peer_name: 'ნინო ქავთარაძე',
    language: 'ka', mode: 'AI_ACTIVE', mode_changed_at: iso(300),
    status: 'OPEN', lead_stage: 'INTERESTED', lead_score: 72, unread_count: 2,
    last_message_at: iso(4),
    last_message_preview: 'დიახ, მაინტერესებს ბინის ნახვა ხუთშაბათს.',
    last_inbound_at: iso(4),
    service_window_expires_at: new Date(NOW + 20 * 3600_000).toISOString(),
    assigned_to: null, campaign_id: 'cp-2',
    created_at: iso(60 * 5), updated_at: iso(4),
  },
  {
    id: 'cv-2', owner_id: OWNER, contact_id: 'ct-3', channel_account_id: 'ca-1',
    channel: 'WHATSAPP', peer_address: '+12025550185', peer_name: 'Dana Whitfield',
    language: 'en', mode: 'HUMAN_ACTIVE', mode_changed_at: iso(200),
    status: 'OPEN', lead_stage: 'LOST', lead_score: null, unread_count: 0,
    last_message_at: iso(200), last_message_preview: 'STOP',
    last_inbound_at: iso(200),
    // Expired on purpose: the thread must show that only a template can
    // reopen it, rather than offering a free-text box that would fail.
    service_window_expires_at: iso(30),
    assigned_to: 'u-harness', campaign_id: 'cp-2',
    created_at: iso(60 * 40), updated_at: iso(200),
  },
  {
    id: 'cv-3', owner_id: OWNER, contact_id: 'ct-4', channel_account_id: 'ca-1',
    channel: 'WHATSAPP', peer_address: '+995577889900', peer_name: null,
    language: null, mode: 'PENDING_HANDOFF', mode_changed_at: iso(9),
    status: 'OPEN', lead_stage: 'ENGAGED', lead_score: 40, unread_count: 1,
    last_message_at: iso(9), last_message_preview: 'დამაკავშირეთ ოპერატორთან.',
    last_inbound_at: iso(9),
    service_window_expires_at: new Date(NOW + 23 * 3600_000).toISOString(),
    assigned_to: null, campaign_id: null,
    created_at: iso(60 * 2), updated_at: iso(9),
  },
];

const MESSAGES = [
  { id: 'ms-1', conversation_id: 'cv-1', owner_id: OWNER, direction: 'OUTBOUND', author: 'AI', author_user_id: null, kind: 'TEMPLATE', body: 'გამარჯობა! ჰომაჩიდან გწერთ ვაკეში განთავსებულ ბინასთან დაკავშირებით.', media_url: null, media_mime: null, transcript: null, template_id: 'tp-1', status: 'READ', error_message: null, cost_usd: 0.0085, sent_at: iso(300), delivered_at: iso(300), read_at: iso(298), created_at: iso(300) },
  { id: 'ms-2', conversation_id: 'cv-1', owner_id: OWNER, direction: 'INBOUND', author: 'CONTACT', author_user_id: null, kind: 'TEXT', body: 'გამარჯობა, რა ფასია?', media_url: null, media_mime: null, transcript: null, template_id: null, status: 'RECEIVED', error_message: null, cost_usd: null, sent_at: null, delivered_at: null, read_at: null, created_at: iso(120) },
  { id: 'ms-3', conversation_id: 'cv-1', owner_id: OWNER, direction: 'OUTBOUND', author: 'AI', author_user_id: null, kind: 'TEXT', body: '185 000 აშშ დოლარი, მოლაპარაკებით. გნებავთ ნახვა?', media_url: null, media_mime: null, transcript: null, template_id: null, status: 'DELIVERED', error_message: null, cost_usd: 0, sent_at: iso(60), delivered_at: iso(60), read_at: null, created_at: iso(60) },
  { id: 'ms-4', conversation_id: 'cv-1', owner_id: OWNER, direction: 'INBOUND', author: 'CONTACT', author_user_id: null, kind: 'TEXT', body: 'დიახ, მაინტერესებს ბინის ნახვა ხუთშაბათს.', media_url: null, media_mime: null, transcript: null, template_id: null, status: 'RECEIVED', error_message: null, cost_usd: null, sent_at: null, delivered_at: null, read_at: null, created_at: iso(4) },
  { id: 'ms-5', conversation_id: 'cv-2', owner_id: OWNER, direction: 'INBOUND', author: 'CONTACT', author_user_id: null, kind: 'TEXT', body: 'STOP', media_url: null, media_mime: null, transcript: null, template_id: null, status: 'RECEIVED', error_message: null, cost_usd: null, sent_at: null, delivered_at: null, read_at: null, created_at: iso(200) },
  { id: 'ms-6', conversation_id: 'cv-2', owner_id: OWNER, direction: 'OUTBOUND', author: 'HUMAN', author_user_id: 'u-harness', kind: 'TEXT', body: 'Understood, you will not hear from us again.', media_url: null, media_mime: null, transcript: null, template_id: null, status: 'FAILED', error_message: 'the WhatsApp access token is invalid or expired', cost_usd: null, sent_at: iso(199), delivered_at: null, read_at: null, created_at: iso(199) },
];

const TEMPLATES = [
  { id: 'tp-1', owner_id: OWNER, channel_account_id: 'ca-1', name: 'listing_intro_ka', language: 'ka', category: 'MARKETING', header_kind: null, header_text: null, body_text: 'გამარჯობა {{1}}, ჰომაჩიდან გწერთ {{2}}-თან დაკავშირებით.', footer_text: 'გამოწერის შესაწყვეტად მოგვწერეთ STOP', buttons: [], variables: [{ index: 1, sample: 'ნინო' }, { index: 2, sample: 'ვაკის ბინა' }], status: 'APPROVED', provider_template_id: '1122334455667788', rejection_reason: null, last_synced_at: iso(60 * 24), created_at: iso(60 * 24 * 14), updated_at: iso(60 * 24) },
  { id: 'tp-2', owner_id: OWNER, channel_account_id: 'ca-1', name: 'price_drop_en', language: 'en', category: 'MARKETING', header_kind: null, header_text: null, body_text: 'Hi {{1}}, the price on {{2}} just dropped. Want a viewing?', footer_text: 'Reply STOP to unsubscribe', buttons: [], variables: [{ index: 1, sample: 'Dana' }, { index: 2, sample: 'Saburtalo 2-bed' }], status: 'REJECTED', provider_template_id: '2233445566778899', rejection_reason: 'The template was rejected because its content is promotional and the opt-out instruction is not clearly separated from the body text.', last_synced_at: iso(60 * 10), created_at: iso(60 * 24 * 6), updated_at: iso(60 * 10) },
  { id: 'tp-3', owner_id: OWNER, channel_account_id: 'ca-1', name: 'viewing_reminder_ru', language: 'ru', category: 'UTILITY', header_kind: null, header_text: null, body_text: 'Здравствуйте, {{1}}. Напоминаем о просмотре {{2}}.', footer_text: null, buttons: [], variables: [{ index: 1, sample: 'Анна' }, { index: 2, sample: 'Ваке, 3 комнаты' }], status: 'PENDING', provider_template_id: null, rejection_reason: null, last_synced_at: iso(90), created_at: iso(60 * 24), updated_at: iso(90) },
];

const CHANNEL_ACCOUNTS = [
  { id: 'ca-1', owner_id: null, label: 'Homatch Tbilisi', channel: 'WHATSAPP', provider: 'meta', phone_e164: '+995322400400', country: 'GE', display_name: 'Homatch', capabilities: ['TEXT', 'TEMPLATE', 'MEDIA'], status: 'CONNECTED', environment: 'TEST', quality_rating: 'YELLOW', messaging_tier: 'TIER_1K', verification_state: 'VERIFIED', webhook_verified_at: iso(60 * 24 * 10), last_inbound_at: iso(4), last_outbound_at: iso(18), created_at: iso(60 * 24 * 30) },
  { id: 'ca-2', owner_id: null, label: 'Outbound caller ID', channel: 'VOICE', provider: 'vapi', phone_e164: '+995322400401', country: 'GE', display_name: null, capabilities: ['OUTBOUND'], status: 'PENDING', environment: 'TEST', quality_rating: null, messaging_tier: null, verification_state: null, webhook_verified_at: null, last_inbound_at: null, last_outbound_at: iso(1), created_at: iso(60 * 24 * 2) },
];

const ACCOUNT_TRUST = [
  { id: 'at-1', owner_id: OWNER, tier: 'NEW', outbound_frozen: false, frozen_reason: null, block_rate: 0.041, complaint_count: 3, opt_out_rate: 0.028, window_start: iso(60 * 24 * 7), window_end: iso(0), updated_at: iso(15) },
];

const RISK = [
  { id: 'rk-1', owner_id: OWNER, campaign_id: 'cp-2', agent_id: null, decision: 'REVIEW', risk_level: 'HIGH', domain_verdict: 'IN_DOMAIN', domain_stage: 'LEXICAL', reasons: [{ code: 'BLOCK_RATE_ABOVE_THRESHOLD', weight: 40, detail: 'blocks rose to 4.1% over seven days', source: 'TRUST' }, { code: 'OPT_OUT_SPIKE', weight: 25, detail: 'opt-outs rose to 2.8%', source: 'TRUST' }], score: 78, reviewed_by: null, reviewed_at: null, review_decision: null, review_note: null, created_at: iso(90) },
  { id: 'rk-2', owner_id: OWNER, campaign_id: null, agent_id: 'ag-2', decision: 'ALLOW', risk_level: 'LOW', domain_verdict: 'IN_DOMAIN', domain_stage: 'LEXICAL', reasons: [{ code: 'NEW_AGENT', weight: 8, detail: 'no send history yet', source: 'HISTORY' }], score: 14, reviewed_by: 'u-harness', reviewed_at: iso(60 * 24 * 2), review_decision: 'ALLOW', review_note: 'Read the prompt; it is a normal follow-up.', created_at: iso(60 * 24 * 3) },
];

const EXTRACTIONS = [
  { id: 'ex-1', contact_id: 'ct-1', conversation_id: null, send_id: 'sd-1', source: 'CALL', method: 'DETERMINISTIC', confidence: 0.87, transaction_type: 'SELL', property_type: 'APARTMENT', locations: ['vake'], budget_min: null, budget_max: 185000, currency: 'USD', bedrooms: 3, timeline: 'WITHIN_3_MONTHS', interest_level: 'HIGH', objection: null, callback_requested: true, callback_at: new Date(NOW + 2 * 86400_000).toISOString(), viewing_interest: true, summary: 'Owner of a 3-room flat in Vake, wants to sell within three months.', next_action: 'Book a Thursday viewing', created_at: iso(38) },
];

const PROVIDER_ROUTES = [
  { role: 'ORCHESTRATOR', provider: 'cartesia', priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['CARTESIA_API_KEY'], countryScope: [],           lastSuccessAt: iso(6),          lastErrorAt: null,    lastError: null, lastLatencyMs: 184 },
  { role: 'ORCHESTRATOR', provider: 'vapi',     priority: 2, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['VAPI_API_KEY'],     countryScope: [],           lastSuccessAt: iso(22),         lastErrorAt: null,    lastError: null, lastLatencyMs: 262 },
  { role: 'STT',          provider: 'cartesia', priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['CARTESIA_API_KEY'], countryScope: [],           lastSuccessAt: iso(6),          lastErrorAt: null,    lastError: null, lastLatencyMs: 171 },
  { role: 'TTS',          provider: 'cartesia', priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['CARTESIA_API_KEY'], countryScope: [],           lastSuccessAt: iso(6),          lastErrorAt: null,    lastError: null, lastLatencyMs: 158 },
  { role: 'LLM',          provider: 'openai',   priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['OPENAI_API_KEY'],   countryScope: [],           lastSuccessAt: iso(3),          lastErrorAt: null,    lastError: null, lastLatencyMs: 410 },
  { role: 'TELEPHONY',    provider: 'vapi',     priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['VAPI_API_KEY'],     countryScope: ['GE', 'AE'], lastSuccessAt: iso(22),         lastErrorAt: null,    lastError: null, lastLatencyMs: 262 },
  { role: 'MESSAGING',    provider: 'meta',     priority: 1, enabled: true,  killSwitch: false, credentialsPresent: true,  credentialNames: ['META_WA_TOKEN', 'META_WA_PHONE_ID'], countryScope: [], lastSuccessAt: iso(60 * 24 * 6), lastErrorAt: iso(1), lastError: 'HTTP_401', lastLatencyMs: 143 },
  { role: 'WHATSAPP_CALL',provider: 'meta',     priority: 1, enabled: false, killSwitch: false, credentialsPresent: true,  credentialNames: ['META_WA_TOKEN'],    countryScope: [],           lastSuccessAt: null,            lastErrorAt: null,    lastError: null, lastLatencyMs: null },
];

/**
 * comm-provider-status, as the deployed function returns it.
 *
 * `credentials_present` is a BOOLEAN by construction — the function has no
 * field that could carry a secret value, and the panel has nothing to render
 * even if someone later added one. `meta` is deliberately reported as down
 * with a 401, because that is the real, verified state of the production
 * WhatsApp token (see the completion report) and the sweep asserts the UI
 * surfaces it honestly rather than showing a green tick.
 */
const PROVIDER_STATUS = {
  ok: true,
  probed: false,
  routes: PROVIDER_ROUTES,
  providers: [
    {
      provider: 'cartesia', roles: ['ORCHESTRATOR', 'STT', 'TTS'], health: 'HEALTHY',
      credentials: [{ name: 'CARTESIA_API_KEY', present: true }],
      latencyMs: 184, lastTestedAt: iso(1), detail: null, errorCode: null,
      facts: { voicesVisible: 12, apiVersion: '2026-03-01' },
    },
    {
      provider: 'vapi', roles: ['ORCHESTRATOR', 'TELEPHONY'], health: 'HEALTHY',
      credentials: [{ name: 'VAPI_API_KEY', present: true }],
      latencyMs: 262, lastTestedAt: iso(1), detail: null, errorCode: null,
      facts: { assistantsVisible: 3, phoneNumbers: 1 },
    },
    {
      provider: 'meta', roles: ['MESSAGING', 'WHATSAPP_CALL'], health: 'DOWN',
      credentials: [
        { name: 'META_WA_TOKEN', present: true },
        { name: 'META_WA_PHONE_ID', present: true },
        { name: 'META_WA_WABA_ID', present: true },
        { name: 'META_WA_APP_SECRET', present: true },
        { name: 'META_WA_VERIFY_TOKEN', present: true },
      ],
      latencyMs: 143, lastTestedAt: iso(1),
      detail: 'The credentials are configured, but Graph rejected them. Both the phone-number and the WABA read returned 401.',
      errorCode: 'HTTP_401',
      facts: { apiVersion: 'v21.0', phoneNumberStatus: 401, wabaStatus: 401 },
    },
  ],
};

const ADMIN_SETTINGS = [
  { key: 'comm_voice_tuning', value: { min_silence_ms: 260, complete_silence_ms: 620, continuation_grace_ms: 900, max_silence_ms: 1900, semantic_endpointing: true, interruption_enabled: true, interruption_threshold_ms: 380, georgian_lock_threshold: 0.72, max_call_duration_sec: 300, recording_default: false }, description: 'Voice endpointing', updated_at: iso(60) },
  { key: 'ai_talk_limits', value: { session_seconds: 120, daily_seconds: 420, global_concurrent: 25, per_visitor_concurrent: 1, daily_sessions: 4 }, description: 'AI Talk allowance', updated_at: iso(60) },
  { key: 'ai_talk_enabled', value: true, description: 'AI Talk demo on', updated_at: iso(60) },
  { key: 'spend_cap_global', value: '"2000"', description: 'Global ceiling', updated_at: iso(60 * 48) },
  { key: 'spend_cap_dataforseo', value: '"300"', description: null, updated_at: iso(60 * 48) },
  { key: 'spend_cap_apify', value: '"200"', description: null, updated_at: iso(60 * 48) },
  { key: 'spend_cap_zenrows', value: '"150"', description: null, updated_at: iso(60 * 48) },
  { key: 'spend_cap_scrapingbee', value: '"150"', description: null, updated_at: iso(60 * 48) },
  { key: 'spend_cap_brightdata', value: '"250"', description: null, updated_at: iso(60 * 48) },
  { key: 'spend_cap_openai', value: '"400"', description: null, updated_at: iso(60 * 48) },
  { key: 'rate_limit_imports_per_hour', value: '"10"', description: null, updated_at: iso(60 * 48) },
  { key: 'rate_limit_matching_per_day', value: '"25"', description: null, updated_at: iso(60 * 48) },
  { key: 'rate_limit_unlocks_per_hour', value: '"20"', description: null, updated_at: iso(60 * 48) },
  { key: 'max_photos_per_property', value: '"30"', description: null, updated_at: iso(60 * 48) },
  { key: 'max_import_retries', value: '"3"', description: null, updated_at: iso(60 * 48) },
  { key: 'circuit_breaker_threshold', value: '"5"', description: null, updated_at: iso(60 * 48) },
  { key: 'cache_ttl_hours', value: '"12"', description: null, updated_at: iso(60 * 48) },
  { key: 'mock_data_providers', value: '"false"', description: null, updated_at: iso(60 * 48) },
];

/** Tables the sweep answers. Anything not listed answers as an empty set. */
export const TABLES = {
  users: [USER_ROW],
  comm_agents: AGENTS,
  outreach_campaigns: CAMPAIGNS,
  outreach_sends: SENDS,
  outreach_contacts: CONTACTS,
  comm_conversations: CONVERSATIONS,
  comm_messages: MESSAGES,
  comm_whatsapp_templates: TEMPLATES,
  comm_channel_accounts: CHANNEL_ACCOUNTS,
  comm_account_trust: ACCOUNT_TRUST,
  comm_risk_assessments: RISK,
  comm_extractions: EXTRACTIONS,
  comm_provider_routes: PROVIDER_ROUTES,
  admin_settings: ADMIN_SETTINGS,
  billable_products: [
    { code: 'AI_CALL', name: 'AI call', unit_kind: 'SECOND', unit_price_usd: 0.0044, active: true },
    { code: 'WHATSAPP', name: 'WhatsApp message', unit_kind: 'MESSAGE', unit_price_usd: 0.0085, active: true },
    { code: 'AI_TALK', name: 'AI Talk', unit_kind: 'SECOND', unit_price_usd: 0, active: true },
  ],
  credit_packs: [
    { code: 'PACK_20', name: '20 USD', price_usd: 20, credits: 2000, active: true, sort_order: 1 },
    { code: 'PACK_50', name: '50 USD', price_usd: 50, credits: 5250, active: true, sort_order: 2 },
    { code: 'PACK_100', name: '100 USD', price_usd: 100, credits: 11000, active: true, sort_order: 3 },
  ],
};

/** Edge functions the sweep answers, by the name in the URL path. */
export const FUNCTIONS = {
  'comm-provider-status': PROVIDER_STATUS,
  'cartesia-access-token': {
    voices: [
      { id: 'voice-ka-1', name: 'Nino', description: 'Georgian, warm', language: 'ka' },
      { id: 'voice-ka-2', name: 'Giorgi', description: 'Georgian, neutral', language: 'ka' },
      { id: 'voice-ru-2', name: 'Anna', description: 'Russian, neutral', language: 'ru' },
      { id: 'voice-en-1', name: 'Ellis', description: 'English, neutral', language: 'en' },
    ],
  },
  'outreach-provider-status': {
    kill_switch: false,
    email: { flag_enabled: true, real: true, provider: 'resend' },
    sms: { flag_enabled: false, real: false, provider: 'none' },
    calling: { flag_enabled: true, real: true, provider: 'cartesia' },
  },
  'my-entitlements': {
    balance: 4200, reserved: 860, credits_per_usd: 105,
    products: [
      { code: 'AI_CALL', unit_price_usd: 0.0044, active: true },
      { code: 'WHATSAPP', unit_price_usd: 0.0085, active: true },
      { code: 'AI_TALK', unit_price_usd: 0, active: true },
    ],
  },
  'comm-campaign-launch': {
    recipients: 412, reachable: 398, suppressed: 14,
    estimated_cost_usd: 96.4, estimated_units: 21900, currency: 'USD',
  },
  'comm-agent': { ok: true, version: 5 },
  'whatsapp-sync': { ok: true, templates: 3, accounts: 2 },
  'ai-talk-session': { session_id: 'talk-1', seconds_remaining: 120, token: 'stub', agent_id: 'talk-agent' },
};

export const SCENARIOS = ['ready', 'empty'];
