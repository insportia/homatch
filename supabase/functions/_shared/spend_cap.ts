// ── Spend Cap Check (shared) ───────────────────────────────────
//
// Month-to-date spend per provider, lower-cased keys, NULL cost = 0.
// Summed in SQL (provider_spend_totals_since, migration 20261114100000): the
// earlier row-by-row select stopped at PostgREST's max rows and under-counted
// once a month held more rows than that (capacity audit 2026-10-18). Until the
// function is applied (PGRST202) the rows are read page by page instead —
// never a truncated sum.
const SPEND_PAGE = 1000;
const SPEND_MAX_PAGES = 500;

export function sumSpendRows(rows: Array<{ provider: unknown; cost_usd: unknown }>, into: Record<string, number> = {}): Record<string, number> {
  for (const c of rows) {
    const k = String(c.provider ?? '').toLowerCase();
    into[k] = (into[k] ?? 0) + Number(c.cost_usd ?? 0);
  }
  return into;
}

export async function monthToDateSpend(supabase: any, sinceIso: string): Promise<Record<string, number>> {
  const agg = await supabase.rpc('provider_spend_totals_since', { p_since: sinceIso });
  if (!agg.error) return sumSpendRows(agg.data ?? []);
  if (agg.error?.code !== 'PGRST202') throw new Error(`spend totals unavailable: ${agg.error?.message ?? agg.error}`);
  const spent: Record<string, number> = {};
  for (let page = 0; page < SPEND_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.from('cost_events').select('provider, cost_usd')
      .gte('timestamp', sinceIso).order('id', { ascending: true })
      .range(page * SPEND_PAGE, page * SPEND_PAGE + SPEND_PAGE - 1);
    if (error) throw new Error(`spend rows unavailable: ${error.message ?? error}`);
    sumSpendRows(data ?? [], spent);
    if ((data ?? []).length < SPEND_PAGE) return spent;
  }
  throw new Error('spend rows exceed the paging bound');
}

// Extracted from spend-cap-check/index.ts so other edge functions
// (outreach-send, etc.) can call it in-process without an extra HTTP hop.
export async function checkSpendCap(supabase: any, provider: string): Promise<{
  allowed: boolean;
  provider_blocked: boolean;
  global_blocked: boolean;
  provider_pct: number;
  global_pct: number;
  warning: boolean;
  spend_unknown?: boolean;
}> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  let settingsRes: any;
  let spent: Record<string, number>;
  try {
    [settingsRes, spent] = await Promise.all([
      supabase.from('admin_settings').select('key, value').like('key', 'spend_cap_%'),
      monthToDateSpend(supabase, monthStart.toISOString()),
    ]);
  } catch (e) {
    // Spend could not be read: refuse the paid send instead of treating the
    // month as $0 spent (which the row-select version did on a read error).
    // Callers already handle allowed:false as a clean, retryable refusal.
    console.error(JSON.stringify({ scope: 'spend_cap', provider, outcome: 'SPEND_UNKNOWN_REFUSED', error: String((e as any)?.message ?? e).slice(0, 200) }));
    return { allowed: false, provider_blocked: true, global_blocked: false, provider_pct: 0, global_pct: 0, warning: true, spend_unknown: true };
  }

  const caps: Record<string, number> = {};
  for (const s of settingsRes.data ?? []) {
    caps[s.key.replace('spend_cap_', '')] = Number(s.value);
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
