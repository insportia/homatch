// ============================================================
// HOMATCH — system-health Edge Function
// Returns a full production health snapshot:
//   DB, Storage, provider statuses, last matching runs
// Admin-only. Logs result to system_health_log.
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Auth: admin only ────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: hUser } = await supabase
    .from('users')
    .select('is_admin')
    .eq('auth_id', user.id)
    .maybeSingle();
  if (!hUser?.is_admin) return json({ error: 'Forbidden — admin only' }, 403);

  // ── 1. DB reachable ─────────────────────────────────────────
  let db_reachable = false;
  try {
    const { error } = await supabase.from('admin_settings').select('key').limit(1);
    db_reachable = !error;
  } catch { /* */ }

  // ── 2. Storage reachable ────────────────────────────────────
  let storage_reachable = false;
  try {
    const { error } = await supabase.storage.listBuckets();
    storage_reachable = !error;
  } catch { /* */ }

  // ── 3. Provider statuses ────────────────────────────────────
  const { data: providerRows } = await supabase
    .from('provider_health')
    .select('provider, status, last_success_at, last_error, success_count, failure_count, latency_ms')
    .order('provider');

  const provider_statuses = (providerRows ?? []).reduce((acc: Record<string, unknown>, r) => {
    acc[r.provider] = {
      status: r.status,
      last_success_at: r.last_success_at,
      last_error: r.last_error,
      success_rate: r.success_count + r.failure_count > 0
        ? Math.round((r.success_count / (r.success_count + r.failure_count)) * 100)
        : null,
      latency_ms: r.latency_ms,
    };
    return acc;
  }, {});

  // ── 4. Last matching runs ────────────────────────────────────
  const { data: recentRuns } = await supabase
    .from('matching_campaigns')
    .select('updated_at, status')
    .order('updated_at', { ascending: false })
    .limit(20);

  const lastOk = (recentRuns ?? []).find(r => r.status === 'ACTIVE' || r.status === 'COMPLETED');
  const lastFailed = (recentRuns ?? []).find(r => r.status === 'ERROR');

  // ── 5. Spend cap snapshot ───────────────────────────────────
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
  const globalCap = caps['global'] ?? 250;

  const spend_summary = {
    global_spent_usd: Math.round(globalSpent * 100) / 100,
    global_cap_usd: globalCap,
    global_pct: globalCap > 0 ? Math.round((globalSpent / globalCap) * 100) : 0,
    global_blocked: globalSpent >= globalCap,
    by_provider: Object.fromEntries(
      Object.keys(caps).filter(k => k !== 'global').map(k => [k, {
        spent: Math.round((spent[k] ?? 0) * 100) / 100,
        cap: caps[k],
        pct: caps[k] > 0 ? Math.round(((spent[k] ?? 0) / caps[k]) * 100) : 0,
        blocked: (spent[k] ?? 0) >= caps[k],
      }])
    ),
  };

  // ── 6. Mock mode status ─────────────────────────────────────
  const { data: mockSetting } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', 'mock_data_providers')
    .maybeSingle();
  const mock_mode_active = mockSetting?.value === '"true"' || mockSetting?.value === 'true';

  // ── 7. Build result ─────────────────────────────────────────
  const result = {
    checked_at: new Date().toISOString(),
    production_status: db_reachable && storage_reachable ? 'HEALTHY' : 'DEGRADED',
    db_reachable,
    storage_reachable,
    supabase_reachable: db_reachable,
    mock_mode_active,
    provider_statuses,
    last_match_run_at: lastOk?.updated_at ?? null,
    last_match_run_ok: !!lastOk,
    last_failed_run_at: lastFailed?.updated_at ?? null,
    spend_summary,
  };

  // ── 8. Persist to system_health_log ────────────────────────
  await supabase.from('system_health_log').insert({
    db_reachable,
    storage_reachable,
    supabase_reachable: db_reachable,
    provider_statuses,
    last_match_run_at: lastOk?.updated_at ?? null,
    last_match_run_ok: !!lastOk,
    last_failed_run_at: lastFailed?.updated_at ?? null,
    notes: mock_mode_active ? 'WARNING: mock_data_providers=true' : null,
  });

  return json(result);
});
