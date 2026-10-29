// Which customer addresses belong to a pausable service. One table, applied to the
// route list in src/routes.tsx, so a new page under one of these prefixes is gated
// without anybody remembering to. Admin pages (/admin/…) are never listed: the
// owner keeps managing a paused service.
import type { ServiceKey } from './core';

export const SERVICE_ROUTE_RULES: ReadonlyArray<readonly [RegExp, ServiceKey]> = [
  [/^\/publishing(\/|$)/, 'publishing'],
  [/^\/property\/publish$/, 'publishing'],
  [/^\/outreach\/calls(\/|$)/, 'ai_call_center'],
  [/^\/outreach\/agents(\/|$)/, 'ai_call_center'],
  [/^\/outreach\/whatsapp(\/|$)/, 'whatsapp'],
  [/^\/live-chat(\/|$)/, 'live_chat'],
  [/^\/design-studio(\/|$)/, 'design_studio'],
  // Live products (docs/claude/SERVICE_CONTROLS_INVENTORY.md). Never a platform address:
  // /property itself, /chat, /credits, /leads, /outreach (the shared hub) stay ungated.
  [/^\/find-property(\/|$)/, 'find_property'],
  [/^\/property\/[^/]+\/(matches|buyers|leads|buyer)(\/|$)/, 'find_buyers'],
  [/^\/verify(\/|$)/, 'verify'],
  [/^\/contracts(\/|$)/, 'contracts'],
  [/^\/mortgage(\/|$)/, 'mortgage'],
  [/^\/investment(\/|$)/, 'investment'],
  [/^\/for-expats(\/|$)/, 'for_expats'],
  [/^\/outreach\/meta(\/|$)/, 'meta_ads'],
  // Email Marketing (hidden 2026-10-29, fail closed): the campaign dashboard and every
  // sub-page, Email Studio, and the CRM email inbox alias. SMS keeps the historic key.
  [/^\/outreach\/email(\/|$)/, 'email_marketing'],
  [/^\/email-studio(\/|$)/, 'email_marketing'],
  [/^\/inbox\/email(\/|$)/, 'email_marketing'],
  [/^\/outreach\/sms(\/|$)/, 'email_campaigns'],
  [/^\/ai$/, 'ai_assistant'],
  // The directory and its public profiles, and the professional's own desk: two switches.
  // Hiding is reversible presentation; profiles, listings and payments are kept
  // (owner, 2026-10-18, replacing the earlier "Option A" that left /brokers public).
  [/^\/brokers(\/|$)/, 'brokers_directory'],
  [/^\/broker(\/|$)/, 'broker_desk'],
  [/^\/developers(\/|$)/, 'developers'],
];

export function serviceForPath(path: string): ServiceKey | null {
  if (path.startsWith('/admin')) return null;
  for (const [rule, key] of SERVICE_ROUTE_RULES) if (rule.test(path)) return key;
  return null;
}
