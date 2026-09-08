// HOMATCH — Ask Homatch AI (grounded, per Deal Room).
//
// This is NOT the general assistant in `homatch-ai`. It answers questions
// about ONE property using ONLY that deal room's evidence, and it re-derives
// that evidence SERVER-SIDE from research_jobs rather than trusting anything
// the client sends. The client supplies a deal room id and a question; it
// cannot supply "facts".
//
// GROUNDING
// ---------
// Context assembly is deterministic and capped (see aiContext.ts). Every
// answer is persisted together with the refs it was grounded in, so a message
// can be audited later. An answer with an EMPTY grounding set is stored with
// an empty array and the UI labels it as a general explanation rather than a
// fact about the property — this is why the column is not nullable and why an
// empty array is meaningful rather than missing.
//
// A NOTE ON THE SHARED IMPORTS
// ----------------------------
// The domain modules below are imported by relative path from src/ rather
// than copied into _shared/. They are pure (no DOM, no Node, no npm) and use
// explicit .ts specifiers, so Deno resolves them directly, and this keeps ONE
// definition of the grounding rules for both the browser and this function.
// If a future bundler change breaks resolution outside supabase/, the fix is
// to move the four files into _shared/ — not to fork them.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { assembleContext, buildAskPrompt, groundingRefs } from '../../../src/dealroom/domain/aiContext.ts';
import type { ContextItem } from '../../../src/dealroom/domain/aiContext.ts';

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

    // The user-scoped client is deliberate: every read below goes through the
    // caller's own RLS, so a forged deal room id simply returns nothing. There
    // is no service-role path in this function.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const dealRoomId = String(body?.dealRoomId ?? '').trim();
    const question = String(body?.question ?? '').trim();
    let threadId = body?.threadId ? String(body.threadId) : null;

    if (!dealRoomId || !question) return json({ error: 'dealRoomId and question are required' }, 400);
    if (question.length > 2000) return json({ error: 'question too long' }, 400);

    /* ---- the deal room, via RLS ---- */
    const { data: room, error: roomErr } = await supabase
      .from('deal_rooms')
      .select('id,verify_job_id,property_type,cadastral_code')
      .eq('id', dealRoomId)
      .is('deleted_at', null)
      .maybeSingle();
    if (roomErr) throw roomErr;
    if (!room) return json({ error: 'deal room not found' }, 404);

    /* ---- the evidence, re-derived server-side ---- */
    let projection = null;
    if (room.verify_job_id) {
      const { data: job } = await supabase
        .from('research_jobs')
        .select('id,result_json')
        .eq('id', room.verify_job_id)
        .maybeSingle();
      if (job) projection = projectVerify({ jobId: job.id, report: job.result_json });
    }

    if (!projection) {
      return json({
        answer: null,
        grounded: [],
        reason: 'NO_VERIFY_EVIDENCE',
      });
    }

    /* ---- extras: contract findings + open actions, already owned ---- */
    const extras = await loadExtras(supabase, dealRoomId);

    const ctx = assembleContext(projection, question, extras);
    const { system, user } = buildAskPrompt(ctx, question);

    /* ---- the model ---- */
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'assistant_unavailable' }, 503);

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

    if (!res.ok) {
      // Never surface the provider's error body: it can echo request content.
      return json({ error: 'assistant_unavailable' }, 503);
    }

    const answer = textOf(await res.json());
    if (!answer) return json({ error: 'assistant_unavailable' }, 503);

    /* ---- persist, with grounding ---- */
    if (!threadId) {
      const { data: t, error: tErr } = await supabase
        .from('deal_room_ai_threads')
        .insert({ deal_room_id: dealRoomId, user_id: userId, title: question.slice(0, 80) })
        .select('id')
        .single();
      if (tErr) throw tErr;
      threadId = t.id as string;
    }

    const refs = groundingRefs(ctx);
    const { error: msgErr } = await supabase.from('deal_room_ai_messages').insert([
      { thread_id: threadId, user_id: userId, role: 'user', content: question, grounded_in: [] },
      { thread_id: threadId, user_id: userId, role: 'assistant', content: answer, grounded_in: refs },
    ]);
    if (msgErr) throw msgErr;

    return json({
      threadId,
      answer,
      // An empty array here is the signal the UI uses to label the reply as a
      // general explanation rather than a verified property fact.
      grounded: refs,
      incompleteSources: ctx.incompleteSources,
    });
  } catch (e) {
    console.error('deal-room-ai failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});

/**
 * Evidence that lives outside the Verify projection.
 *
 * Capped and reduced to statements here so the prompt cannot grow with the
 * size of the deal room. Contract CONTRADICTIONS are taken first because a
 * document disagreeing with the registry is the most decision-relevant thing
 * in the room.
 */
async function loadExtras(supabase: any, dealRoomId: string): Promise<ContextItem[]> {
  const out: ContextItem[] = [];

  const { data: findings } = await supabase
    .from('deal_room_document_findings')
    .select('finding_type,label,value,verify_relation,verify_fact_value')
    .eq('deal_room_id', dealRoomId)
    .eq('dismissed', false)
    .in('verify_relation', ['CONTRADICTS', 'AGREES'])
    .limit(8);

  for (const f of findings ?? []) {
    out.push({
      ref: `document.${f.finding_type}@uploaded-document`,
      statement:
        f.verify_relation === 'CONTRADICTS'
          ? `Uploaded document states ${f.label}: ${f.value}, which disagrees with the official record (${f.verify_fact_value}).`
          : `Uploaded document confirms ${f.label}: ${f.value}.`,
      certainty: f.verify_relation === 'CONTRADICTS' ? 'CONFLICTING' : 'CONFIRMED',
      sources: ['uploaded-document'],
    });
  }

  const { data: actions } = await supabase
    .from('deal_room_action_items')
    .select('title,why,priority')
    .eq('deal_room_id', dealRoomId)
    .eq('state', 'OPEN')
    .order('priority', { ascending: true })
    .limit(4);

  for (const a of actions ?? []) {
    out.push({
      ref: `plan.action@homatch`,
      statement: `Outstanding recommended step: ${a.title}. ${a.why ?? ''}`.trim(),
      certainty: 'CONFIRMED',
      sources: ['homatch-plan'],
    });
  }

  return out;
}
