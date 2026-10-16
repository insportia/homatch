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
];

export function serviceForPath(path: string): ServiceKey | null {
  if (path.startsWith('/admin')) return null;
  for (const [rule, key] of SERVICE_ROUTE_RULES) if (rule.test(path)) return key;
  return null;
}
