// HOMATCH — the final AI due-diligence summary.
//
// The customer-facing replacement for the fragmented card dump. ONE
// conversational explanation of what was found, what matters, and what to do
// next.
//
// The deterministic plan decides what is TRUE. The model only decides how it
// READS, and its output is validated back against the plan before anything is
// returned. If the model invents a fact, cites a point that does not exist,
// omits a conflict, or leaks internal vocabulary, its output is DISCARDED and
// the deterministic rendering is returned instead — so the endpoint always
// succeeds and never returns unverified prose.
//
// Because of that fallback, this function does not fail when OPENAI_API_KEY
// is absent or the provider is down: it returns the deterministic rendering
// and says so via `mode`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { buildRenderPrompt, finalizeRendering } from '../../../src/dealroom/domain/render.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function textOf(p: any): string {
  if (p?.output_text) return p.output_text;
  const a: string[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') for (const c of i.content || []) if (c?.type === 'output_text' && c.text) a.push(c.text);
  }
  return a.join('\n').trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const jobId = String(body?.jobId ?? '').trim();
    if (!jobId) return json({ error: 'jobId is required' }, 400);

    // RLS decides whether this caller may see this job. A job that is not
    // theirs simply is not found.
    const { data: job, error } = await supabase
      .from('research_jobs')
      .select('id,result_json,status')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return json({ error: 'not found' }, 404);

    const projection = projectVerify({ jobId: job.id, report: job.result_json });

    // No evidence at all is a legitimate outcome, not an error: every source
    // may have been technically unavailable. Say so plainly rather than
    // rendering an empty report that looks like a clean bill of health.
    if (!projection.facts.length) {
      return json({
        verdict: projection.verdict,
        verdictReasons: projection.verdictReasons,
        sections: [],
        mode: 'DETERMINISTIC',
        propertyType: projection.propertyType,
        incompleteSources: projection.incomplete.map((o) => o.sourceName || o.source),
        empty: true,
      });
    }

    let raw: string | null = null;
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (apiKey) {
      const { system, user } = buildRenderPrompt(projection.synthesis);
      try {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            input: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
        if (res.ok) raw = textOf(await res.json());
      } catch (e) {
        // A provider outage degrades the prose, never the report.
        console.error('synthesis model call failed', e instanceof Error ? e.message : String(e));
      }
    }

    const final = finalizeRendering(projection.synthesis, raw);
    if (final.mode === 'DETERMINISTIC' && final.rejectedBecause.length) {
      // Worth knowing about: a model that keeps failing the gate is a
      // prompt/model problem we want visible in logs, not silently absorbed.
      console.warn('synthesis rendering rejected', JSON.stringify(final.rejectedBecause));
    }

    return json({
      verdict: final.verdict,
      verdictReasons: final.verdictReasons,
      sections: final.sections,
      mode: final.mode,
      propertyType: projection.propertyType,
      // Named for a customer, not by source key: "we could not complete X".
      incompleteSources: projection.incomplete.map((o) => o.sourceName || o.source),
      conflictCount: projection.conflicts.length,
      empty: false,
    });
  } catch (e) {
    console.error('verify-synthesis failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
