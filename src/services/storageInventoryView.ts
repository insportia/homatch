/* Pure helpers for the storage inventory (no network): testable in node. */

export interface InventoryR2Row {
  namespace: string; category: string; lifecycle: string; objects: number; bytes: number; last_upload: string | null;
}

/**
 * The HOMATCH service an object belongs to, from its R2 namespace and
 * category (keys.ts) or its Supabase bucket. A key never names a person, so
 * this is the only grouping a dashboard can show.
 */
export function serviceOf(namespaceOrBucket: string, category?: string | null): string {
  const c = category ?? namespaceOrBucket;
  if (namespaceOrBucket === 'design-studio' || c.startsWith('design-studio')) return 'design_studio';
  if (c === 'property-photos' || namespaceOrBucket === 'publishing-engine-photos') return 'property';
  if (namespaceOrBucket === 'meta-ads-media') return 'meta_ads';
  if (c === 'deal-room-documents') return 'contracts';
  if (c.startsWith('mortgage')) return 'mortgage';
  if (c.startsWith('developer')) return 'developer';
  if (c === 'voice-auditions') return 'voice';
  if (c === 'generated-reports') return 'reports';
  if (namespaceOrBucket.startsWith('verify-')) return 'verify';
  if (['dm-media', 'live-chat-media', 'contact-imports'].includes(namespaceOrBucket)) return 'communications';
  if (namespaceOrBucket.startsWith('broker-')) return 'brokers';
  if (c === 'site-assets') return 'site';
  if (['diagnostics', 'retention-selftest', 'system', 'research'].includes(namespaceOrBucket)) return 'system';
  return 'other';
}

export interface ServiceUsage { service: string; prefixes: string[]; objects: number; bytes: number }

/** Active R2 objects grouped by service, largest first. */
export function r2ByService(rows: InventoryR2Row[]): ServiceUsage[] {
  const by = new Map<string, ServiceUsage>();
  for (const r of rows) {
    if (r.lifecycle !== 'ACTIVE') continue;
    const service = serviceOf(r.namespace, r.category);
    const prefix = r.namespace === 'users' ? `users/<account>/${r.category}/` : `${r.namespace}/`;
    const u = by.get(service) ?? { service, prefixes: [], objects: 0, bytes: 0 };
    if (!u.prefixes.includes(prefix)) u.prefixes.push(prefix);
    u.objects += Number(r.objects) || 0;
    u.bytes += Number(r.bytes) || 0;
    by.set(service, u);
  }
  return [...by.values()].sort((a, b) => b.bytes - a.bytes);
}
