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

export const SECRETS_CHECKED = [
  'PUBLISHING_WORKER_TOKEN', 'PUBLISHING_CREDENTIALS_KEY',
  'CARTESIA_API_KEY', 'OPENAI_API_KEY',
  'VAPI_PRIVATE_API_KEY',
  'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  'META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_VERIFY_TOKEN',
  'RUNPOD_API_KEY', 'RUNPOD_DS_ENDPOINT_ID',
] as const;
// R2 is not checked by name here: exactly one module may read an R2 credential
// (_shared/objectStore.ts), so its own envReport() answers "is R2 configured" and the
// edge function passes that in as facts.r2Configured.

export const TABLES_CHECKED = [
  'publishing_engine_listings', 'publishing_accounts', 'comm_talk_sessions', 'outreach_campaigns',
  'comm_conversations', 'live_chat_messages', 'ds_projects',
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
  }
  return { ready: missing.length === 0, missing, notes };
}
