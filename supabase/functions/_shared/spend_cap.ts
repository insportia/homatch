// ── Spend Cap Check (shared) ───────────────────────────────────
// Extracted from spend-cap-check/index.ts so other edge functions
// (outreach-send, etc.) can call it in-process without an extra HTTP hop.
export async function checkSpendCap(supabase: any, provider: string): Promise<{
  allowed: boolean;
  provider_blocked: boolean;
  global_blocked: boolean;
  provider_pct: number;
  global_pct: number;
  warning: boolean;
}> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [settingsRes, costsRes] = await Promise.all([
    supabase.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
    supabase.from('cost_events').select('provider, cost_usd').gte('timestamp', monthStart.toISOString()),
  ]);

  const caps: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) {
    caps[s.key.replace('spend_cap_', '')] = Number(s.value);
  }

  const spent: Record<string, number> = {};
  for (const c of costsRes.data ?? []) {
    const k = (c.provider as string).toLowerCase();
    spent[k] = (spent[k] ?? 0) + Number(c.cost_usd ?? 0);
  }

  const globalSpent = Object.values(spent).reduce((a, b) => a + b, 0);
  const globalCap = caps['global'] ?? 999999;
  const providerKey = provider.toLowerCase();
  const providerSpent = spent[providerKey] ?? 0;
  const providerCap = caps[providerKey] ?? 999999;

  const global_pct = globalCap > 0 ? (globalSpent / globalCap) * 100 : 0;
  const provider_pct = providerCap > 0 ? (providerSpent / providerCap) * 100 : 0;

  const global_blocked = global_pct >= 100;
  const provider_blocked = provider_pct >= 100;
  const warning = global_pct >= 80 || provider_pct >= 80;

  return {
    allowed: !global_blocked && !provider_blocked,
    provider_blocked,
    global_blocked,
    provider_pct,
    global_pct,
    warning,
  };
}
