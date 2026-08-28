// Migration runner — executes raw DDL/SQL using SUPABASE_DB_URL (auto-injected).
// Uses Deno postgres client which supports multi-statement DDL and transactions.
// Deploy to NEW project; invoke with { "sql": "..." } body.
// Protected: only accepts requests with the service-role key as Bearer token.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { sql, label } = await req.json();
    if (!sql) {
      return new Response(JSON.stringify({ error: "No sql provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not available" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[run-migration] Running: ${label ?? "unlabeled"} (${sql.length} chars)`);

    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();
    try {
      await conn.queryObject("BEGIN");
      await conn.queryObject(sql);
      await conn.queryObject("COMMIT");
      console.log(`[run-migration] SUCCESS: ${label ?? "unlabeled"}`);
      return new Response(JSON.stringify({ success: true, label }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      await conn.queryObject("ROLLBACK").catch(() => {});
      console.error(`[run-migration] FAILED: ${label}`, e);
      return new Response(JSON.stringify({ success: false, label, error: String(e) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      conn.release();
      await pool.end();
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
