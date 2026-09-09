// HOMATCH — the Buyer Intelligence Report.
//
// The customer-facing output of Verify. ONE editorial due-diligence briefing:
// what was found, what it means in context, what deserves attention, what
// could not be confirmed, and what this buyer should do before paying.
//
// WHAT CHANGED AND WHY
// --------------------
// This used to hand the model a list of finished sentences stripped of source,
// date, provenance and certainty — and the model, holding nothing to reason
// with, produced "a mortgage exists" where the research already knew the same
// bank publicly finances the project. buildEvidencePackage() now reads the
// WHOLE report (including `publicResearch`, which nothing read before) and
// keeps provenance attached, tiered so registry evidence is never crowded out
// by social noise.
//
// The safety property is unchanged and still enforced: the model may cite only
// evidence ids that exist, every substantial claim must carry one, and an
// output that fails is DISCARDED in favour of a deterministic report built
// from the same evidence. There is no path by which invented prose reaches a
// customer.
//
// Because of that fallback the function does not fail when OPENAI_API_KEY is
// absent or the provider is down: it returns the deterministic report and says
// so via `mode`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { buildEvidencePackage } from '../../../src/verify/intelligence/evidencePackage.ts';
import { buildIntelligencePrompt } from '../../../src/verify/intelligence/prompt.ts';
import { finalizeReport } from '../../../src/verify/intelligence/report.ts';

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

    // The projection still supplies the deterministic property model (type,
    // buyer plan, what completed and what did not). The evidence package is
    // what the model reasons over.
    const projection = projectVerify({ jobId: job.id, report: job.result_json });
    const pkg = buildEvidencePackage(job.result_json);

    // No evidence at all is a legitimate outcome, not an error: every source
    // may have been technically unavailable. Say so plainly rather than
    // returning an empty report that reads like a clean bill of health.
    if (!pkg.items.length) {
      return json({
        report: null,
        mode: 'DETERMINISTIC',
        propertyType: projection.propertyType,
        incompleteSources: projection.incomplete.map((o) => o.sourceName || o.source),
        unconfirmed: pkg.unavailable,
        empty: true,
      });
    }

    let raw: string | null = null;
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (apiKey) {
      const { system, user } = buildIntelligencePrompt(pkg);
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

    const final = finalizeReport(pkg, raw);
    if (final.mode === 'DETERMINISTIC' && final.rejectedBecause.length) {
      // Worth knowing about: a model that keeps failing the gate is a
      // prompt/model problem we want visible in logs, not silently absorbed.
      console.warn('buyer intelligence rejected', JSON.stringify(final.rejectedBecause));
    }

    return json({
      report: {
        overallView: final.overallView,
        executiveSummary: final.executiveSummary,
        sections: final.sections,
        attentionPoints: final.attentionPoints,
        unconfirmed: final.unconfirmed,
        buyerActions: final.buyerActions,
        finalView: final.finalView,
        contractUpload: final.contractUpload,
      },
      // The sources behind the prose, so the UI can offer them underneath
      // without the customer having to read raw research output.
      evidence: final.evidenceUsed,
      market: pkg.market,
      mode: final.mode,
      propertyType: projection.propertyType,
      // Named for a customer, not by source key: "we could not complete X".
      incompleteSources: projection.incomplete.map((o) => o.sourceName || o.source),
      evidenceCounts: pkg.tierCounts,
      empty: false,
    });
  } catch (e) {
    console.error('verify-synthesis failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
