// HOMATCH MORTGAGE — the National Bank of Georgia's official rates, kept fresh.
//
// The mortgage calculator lets a person type any amount in any currency and
// turns it into the loan currency. The rates it uses live in
// public.mortgage_fx_rates (readable by anyone, written only here with the
// service role). This function refreshes that table from the NBG's public
// endpoint when the stored rates are older than REFRESH_AFTER_MS, and always
// answers with whatever the table holds afterwards.
//
// Never a silent zero: a failed fetch leaves the previous rows in place and
// says so (`refreshed: false, error`), and a currency the NBG did not quote is
// simply absent, which the browser shows as "no current rate". Billing's own
// fx_rates table is deliberately NOT touched.
//
// Public data, cheap, idempotent: the gateway JWT check stays on (the anon key
// passes it), and the six hour cooldown means callers cannot make us hammer
// the NBG.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchCurrentFx } from '../_shared/fx.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

type Row = { currency: string; gel_per_unit: number | string; rate_date: string; fetched_at: string };

async function readRows(sb: ReturnType<typeof createClient>): Promise<Row[]> {
  const { data } = await sb.from('mortgage_fx_rates').select('currency,gel_per_unit,rate_date,fetched_at').order('currency');
  return (data ?? []) as Row[];
}

const shape = (rows: Row[]) => rows.map((r) => ({ currency: r.currency, gelPerUnit: Number(r.gel_per_unit), rateDate: r.rate_date }));

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    let rows = await readRows(sb);
    const newest = rows.reduce((max, r) => Math.max(max, Date.parse(r.fetched_at) || 0), 0);
    if (rows.length > 0 && Date.now() - newest < REFRESH_AFTER_MS) {
      return json({ rates: shape(rows), refreshed: false, fetchedAt: new Date(newest).toISOString() });
    }

    const table = await fetchCurrentFx();
    if (!table) {
      return json({ rates: shape(rows), refreshed: false, error: 'NBG_UNAVAILABLE', fetchedAt: newest ? new Date(newest).toISOString() : null });
    }

    const fetchedAt = new Date().toISOString();
    const upserts = Object.entries(table)
      .map(([pair, entry]) => ({ currency: pair.slice(0, 3), gel_per_unit: entry.rate, rate_date: String(entry.asOf ?? fetchedAt).slice(0, 10), fetched_at: fetchedAt, source: 'National Bank of Georgia' }))
      .filter((r) => /^[A-Z]{3}$/.test(r.currency) && r.currency !== 'GEL' && r.gel_per_unit > 0);
    if (upserts.length) {
      const { error } = await sb.from('mortgage_fx_rates').upsert(upserts, { onConflict: 'currency' });
      if (error) console.error('mortgage-fx-rates: upsert failed', error.message);
    }
    rows = await readRows(sb);
    return json({ rates: shape(rows), refreshed: upserts.length > 0, fetchedAt });
  } catch (e) {
    console.error('mortgage-fx-rates failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'could not read rates' }, 500);
  }
});
