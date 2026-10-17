// SERVICE CONTROL CENTER — is a paused service ready to be switched back on?
//
// Pure: the edge function gathers the facts (secret PRESENCE, never values; which
// tables exist; each service's own downstream switches) and this decides.
//
//   missing  BLOCKING. Turning the backend ON is refused while any is listed: the
//            service could not do its basic job, so an ON switch would be a lie.
//   notes    Not blocking: the service runs, but one of its OWN switches or optional
//            pieces still holds part of it back (e.g. AI TALK on, its voice setting
//            off). Shown so "ON" never reads as "everything works".
//
// Codes only; the Admin page turns them into words in six languages.
import type { ServiceKey } from '../_shared/serviceControl.ts';

export interface Facts {
  secrets: Record<string, boolean>;
  r2Configured: boolean;
  tables: Record<string, boolean>;
  settings: Record<string, unknown>;
  routes: Array<{ role: string; provider: string; enabled: boolean; kill_switch: boolean }>;
  products: Array<{ code: string; enabled: boolean; pricing_active?: boolean | null; kill_switch?: boolean | null }>;
}

export interface Readiness { ready: boolean; missing: string[]; notes: string[] }

const secret = (f: Facts, name: string, code = `SECRET_${name}`) => (f.secrets[name] ? [] : [code]);
const table = (f: Facts, name: string) => (f.tables[name] ? [] : [`SCHEMA_${name}`]);
const route = (f: Facts, role: string, provider: string) => f.routes.find((r) => r.role === role && r.provider === provider);
const product = (f: Facts, code: string) => f.products.find((p) => p.code === code);
const isFalse = (v: unknown) => v === false || v === 'false';
const isTrue = (v: unknown) => v === true || v === 'true';
/** A note when a priced product is switched off, has no live price, or is killed. */
const priced = (f: Facts, code: string, note: string) => {
  const p = product(f, code);
  return p && (!p.enabled || p.kill_switch || p.pricing_active === false) ? [note] : [];
};
const apifyDisabled = (f: Facts) => {
  const list = f.settings.provider_disabled_list;
  const arr = Array.isArray(list) ? list : (() => { try { return JSON.parse(String(list ?? '[]')); } catch { return []; } })();
  return Array.isArray(arr) && arr.map(String).includes('APIFY');
};

export const SECRETS_CHECKED = [
  'PUBLISHING_WORKER_TOKEN', 'PUBLISHING_CREDENTIALS_KEY',
  'CARTESIA_API_KEY', 'OPENAI_API_KEY',
  'VAPI_PRIVATE_API_KEY',
  'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  'META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_VERIFY_TOKEN',
  'RUNPOD_API_KEY', 'RUNPOD_DS_ENDPOINT_ID',
  'META_APP_ID', 'META_APP_SECRET', 'RESEND_API_KEY',
] as const;
// R2 is not checked by name here: exactly one module may read an R2 credential
// (_shared/objectStore.ts), so its own envReport() answers "is R2 configured" and the
// edge function passes that in as facts.r2Configured.

export const TABLES_CHECKED = [
  'publishing_engine_listings', 'publishing_accounts', 'comm_talk_sessions', 'outreach_campaigns',
  'comm_conversations', 'live_chat_messages', 'ds_projects',
  'discovery_marketplace_searches', 'discovery_runs', 'matching_jobs', 'research_jobs', 'deal_room_documents',
  'mortgage_offers', 'expat_topics', 'meta_campaigns', 'email_studio_campaigns', 'broker_listing_purchases', 'dev_documents',
] as const;

/** Each live product's own admin_settings switches, read for the notes below (never written). */
export const SETTINGS_CHECKED = [
  'ai_talk_enabled', 'design_studio_billing_enabled',
  'marketplace_search_enabled', 'find_property_social_enabled', 'find_property_discovery_enabled', 'provider_disabled_list',
  'find_buyers_social_enabled', 'campaign_source_discovery_enabled', 'verify_billing_enabled',
  'meta_ads_enabled', 'meta_ads_publishing_enabled',
  'outreach_email_sending_enabled', 'outreach_sms_sending_enabled', 'email_studio_sending_enabled',
] as const;

/** billable_products rows whose pricing the notes below report on. */
export const PRODUCTS_CHECKED = [
  'AI_CALL', 'WHATSAPP', 'VERIFY', 'FIND_CLIENTS', 'FIND_PROPERTY', 'CONTRACT_INTELLIGENCE', 'EMAIL_CAMPAIGN',
  'BROKER_DIRECTORY_LISTING', 'AI_CHAT_RESPONSE',
] as const;

export function readiness(key: ServiceKey, f: Facts): Readiness {
  let missing: string[] = [];
  const notes: string[] = [];
  switch (key) {
    case 'publishing': {
      // The owner-handoff workspace needs only its schema. HOMATCH-account automation
      // needs more — reported, not blocking, because publishing works without it.
      missing = table(f, 'publishing_engine_listings');
      if (!f.tables.publishing_accounts) notes.push('PUBLISHING_CENTRAL_MIGRATION_NOT_APPLIED');
      if (!f.secrets.PUBLISHING_WORKER_TOKEN) notes.push('PUBLISHING_WORKER_TOKEN_NOT_SET');
      if (!f.secrets.PUBLISHING_CREDENTIALS_KEY) notes.push('PUBLISHING_CREDENTIALS_KEY_NOT_SET');
      notes.push('PUBLISHING_AUTOMATION_RAILWAY_FLAG');
      break;
    }
    case 'ai_talk': {
      missing = [...table(f, 'comm_talk_sessions'), ...secret(f, 'CARTESIA_API_KEY'), ...secret(f, 'OPENAI_API_KEY')];
      if (isFalse(f.settings.ai_talk_enabled)) notes.push('AI_TALK_SETTING_OFF');
      break;
    }
    case 'ai_call_center': {
      missing = [...table(f, 'outreach_campaigns'), ...secret(f, 'VAPI_PRIVATE_API_KEY')];
      const telephony = route(f, 'TELEPHONY', 'VAPI');
      if (!telephony || !telephony.enabled || telephony.kill_switch) missing.push('ROUTE_TELEPHONY_VAPI_OFF');
      const p = product(f, 'AI_CALL');
      if (!p || !p.enabled || p.kill_switch || p.pricing_active === false) notes.push('PRODUCT_AI_CALL_NOT_PRICED');
      break;
    }
    case 'whatsapp': {
      missing = [
        ...table(f, 'comm_conversations'),
        ...secret(f, 'META_WHATSAPP_ACCESS_TOKEN'), ...secret(f, 'META_WHATSAPP_PHONE_NUMBER_ID'), ...secret(f, 'META_WHATSAPP_BUSINESS_ACCOUNT_ID'),
      ];
      const messaging = route(f, 'MESSAGING', 'META');
      if (!messaging || !messaging.enabled || messaging.kill_switch) missing.push('ROUTE_MESSAGING_META_OFF');
      if (!f.secrets.META_WHATSAPP_APP_SECRET || !f.secrets.META_WHATSAPP_VERIFY_TOKEN) notes.push('WHATSAPP_WEBHOOK_SECRETS_NOT_SET');
      const p = product(f, 'WHATSAPP');
      if (!p || !p.enabled || p.kill_switch || p.pricing_active === false) notes.push('PRODUCT_WHATSAPP_NOT_PRICED');
      break;
    }
    case 'live_chat': {
      missing = table(f, 'live_chat_messages');
      break;
    }
    case 'design_studio': {
      missing = [
        ...table(f, 'ds_projects'),
        ...secret(f, 'OPENAI_API_KEY'), ...secret(f, 'RUNPOD_API_KEY'), ...secret(f, 'RUNPOD_DS_ENDPOINT_ID'),
        ...(f.r2Configured ? [] : ['STORAGE_R2_NOT_CONFIGURED']),
      ];
      if (!(f.settings.design_studio_billing_enabled === true || f.settings.design_studio_billing_enabled === 'true')) notes.push('DESIGN_STUDIO_BILLING_OFF');
      break;
    }
    /* ── Live products (seeded ON). A note never blocks; it says which of the
       product's OWN switches still holds part of it back. ───────────────── */
    case 'find_property': {
      missing = [...table(f, 'discovery_marketplace_searches'), ...secret(f, 'OPENAI_API_KEY')];
      if (isFalse(f.settings.marketplace_search_enabled)) notes.push('FIND_PROPERTY_MARKETPLACE_SETTING_OFF');
      break;
    }
    case 'find_property_deep': {
      // The APIFY credential itself is read by one module only (_shared/findBuyers/memo23Client.ts,
      // tests/matrix/retiredProviders.test.mjs); what is reported here is its Admin switch.
      missing = table(f, 'discovery_runs');
      if (!isTrue(f.settings.find_property_social_enabled)) notes.push('FIND_PROPERTY_SOCIAL_SETTING_OFF');
      if (!isTrue(f.settings.find_property_discovery_enabled)) notes.push('FIND_PROPERTY_DISCOVERY_SETTING_OFF');
      if (apifyDisabled(f)) notes.push('PROVIDER_APIFY_DISABLED');
      notes.push(...priced(f, 'FIND_PROPERTY', 'PRODUCT_FIND_PROPERTY_NOT_PRICED'));
      break;
    }
    case 'find_buyers': {
      missing = [...table(f, 'matching_jobs'), ...secret(f, 'OPENAI_API_KEY')];
      if (!isTrue(f.settings.find_buyers_social_enabled)) notes.push('FIND_BUYERS_SOCIAL_SETTING_OFF');
      if (apifyDisabled(f)) notes.push('PROVIDER_APIFY_DISABLED');
      notes.push(...priced(f, 'FIND_CLIENTS', 'PRODUCT_FIND_CLIENTS_NOT_PRICED'));
      break;
    }
    case 'verify': {
      missing = [...table(f, 'research_jobs'), ...secret(f, 'OPENAI_API_KEY')];
      notes.push(...priced(f, 'VERIFY', 'PRODUCT_VERIFY_NOT_PRICED'));
      break;
    }
    case 'contracts': {
      missing = [...table(f, 'deal_room_documents'), ...secret(f, 'OPENAI_API_KEY')];
      notes.push(...priced(f, 'CONTRACT_INTELLIGENCE', 'PRODUCT_CONTRACTS_NOT_PRICED'));
      break;
    }
    case 'mortgage': {
      missing = table(f, 'mortgage_offers');
      if (!f.secrets.OPENAI_API_KEY) notes.push('MORTGAGE_CONSULTANT_NO_AI');
      break;
    }
    case 'investment': {
      missing = secret(f, 'OPENAI_API_KEY');
      break;
    }
    case 'for_expats': {
      missing = table(f, 'expat_topics');
      break;
    }
    case 'meta_ads': {
      missing = [...table(f, 'meta_campaigns'), ...secret(f, 'META_APP_ID'), ...secret(f, 'META_APP_SECRET')];
      if (isFalse(f.settings.meta_ads_enabled)) notes.push('META_ADS_SETTING_OFF');
      if (isFalse(f.settings.meta_ads_publishing_enabled)) notes.push('META_ADS_PUBLISHING_SETTING_OFF');
      break;
    }
    case 'email_campaigns': {
      missing = table(f, 'outreach_campaigns');
      if (!isTrue(f.settings.outreach_email_sending_enabled)) notes.push('EMAIL_SENDING_SETTING_OFF');
      if (!isTrue(f.settings.outreach_sms_sending_enabled)) notes.push('SMS_SENDING_SETTING_OFF');
      if (!isTrue(f.settings.email_studio_sending_enabled)) notes.push('EMAIL_STUDIO_SENDING_SETTING_OFF');
      if (!f.secrets.RESEND_API_KEY) notes.push('EMAIL_PROVIDER_KEY_NOT_SET');
      break;
    }
    case 'ai_assistant': {
      missing = secret(f, 'OPENAI_API_KEY');
      break;
    }
    case 'brokers_directory': {
      missing = table(f, 'broker_listing_purchases');
      notes.push(...priced(f, 'BROKER_DIRECTORY_LISTING', 'PRODUCT_BROKER_LISTING_NOT_PRICED'));
      break;
    }
    case 'broker_desk': {
      notes.push('BROKER_DESK_USES_FIND_BUYERS_AND_DIRECTORY');
      break;
    }
    case 'developers': {
      missing = table(f, 'dev_documents');
      break;
    }
  }
  return { ready: missing.length === 0, missing, notes };
}
