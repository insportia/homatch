// HOMATCH — agent authoring: generate, publish, preview, test.
//
// §11's builder is a seven-step wizard, but only four of its steps need the
// server. Everything else is form state the browser owns.
//
//   generate   step 2's "Generate with AI", which is real-estate-gated both
//              on the way in and on the way out
//   publish    step 7, freezing a version (§11's versioning requirement)
//   preview    the human-readable summary the review step shows, built from
//              the same assembler the call will use, so what is reviewed is
//              what runs
//   test       a short-lived grant for the live browser test in step 6
//
// The domain gate runs on generation because a purpose written here becomes an
// agent, and an agent becomes a campaign. Catching "promote my casino" at the
// campaign gate works; catching it when it is typed is better.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { authenticate, serviceClient, json, preflight, checkRateLimit, logEvent } from '../_shared/comm/auth.ts';
import { generateAgentDescription, llmAvailable } from '../_shared/comm/llm.ts';
import { classifyDomain } from '../_shared/comm/generated/domainClassifier.ts';
import { buildAgentRuntime } from '../_shared/comm/agentPrompt.ts';
import { createCartesiaProvider, cartesiaCredentialsPresent, ensureBaseAgent } from '../_shared/comm/cartesia.ts';

interface AgentRequest {
  action: 'generate' | 'publish' | 'preview' | 'test';
  agentId?: string;
  rough?: string;
  template?: string;
  languages?: string[];
  locale?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: AgentRequest;
  try { body = await req.json() as AgentRequest; } catch { return json({ error: 'bad_request' }, 400); }

  const sb = serviceClient();

  switch (body.action) {
    case 'generate': return await generate(sb, caller.userId, body);
    case 'publish':  return await publish(sb, caller.userId, body);
    case 'preview':  return await preview(sb, caller.userId, body);
    case 'test':     return await test(sb, caller.userId, body);
    default:         return json({ error: 'unknown_action' }, 400);
  }
});

type Sb = ReturnType<typeof serviceClient>;

async function generate(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  const rough = String(body.rough ?? '').trim();
  if (rough.length < 8) return json({ error: 'too_short', code: 'BAD_REQUEST' }, 400);

  if (!llmAvailable()) {
    // The wizard stays usable: the user writes the description themselves.
    // Blocking agent creation because a model key is absent would be a much
    // worse failure than losing a convenience.
    return json({ ok: false, code: 'GENERATION_UNAVAILABLE' }, 503);
  }

  // Generation costs money, and the button is one click.
  const limit = await checkRateLimit(sb, 'agent_generate', 20, 3600, { userId });
  if (!limit.allowed) return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);

  // Gate the INPUT. Cheap, deterministic, and it stops an obviously
  // out-of-scope request before it reaches a model at all.
  const inbound = classifyDomain({ text: rough, agentTemplate: body.template ?? null });
  if (inbound.verdict === 'BLOCK') {
    logEvent('comm-agent', 'generate_blocked_input', { signals: inbound.signals.map((s) => s.code).join(',') });
    return json({ ok: false, code: 'OUT_OF_SCOPE', message: 'Homatch agents are for real estate and property services.' }, 422);
  }

  const result = await generateAgentDescription({
    rough,
    template: String(body.template ?? 'CUSTOM'),
    languages: Array.isArray(body.languages) && body.languages.length ? body.languages : ['ka'],
    locale: String(body.locale ?? 'en'),
  });

  if (!result.ok) {
    return json({ ok: false, code: result.error === 'out_of_scope' ? 'OUT_OF_SCOPE' : 'GENERATION_FAILED' },
      result.error === 'out_of_scope' ? 422 : 502);
  }

  // Gate the OUTPUT too. A model that has been talked into writing a
  // non-property description must not have that description saved.
  const outbound = classifyDomain({
    text: [result.purpose, result.primaryGoal, result.introduction].filter(Boolean).join('\n'),
    agentTemplate: body.template ?? null,
  });
  if (outbound.verdict === 'BLOCK') {
    logEvent('comm-agent', 'generate_blocked_output', { signals: outbound.signals.map((s) => s.code).join(',') });
    return json({ ok: false, code: 'OUT_OF_SCOPE' }, 422);
  }

  logEvent('comm-agent', 'generated', { userId, template: body.template ?? 'CUSTOM' });

  return json({
    ok: true,
    purpose: result.purpose ?? null,
    introduction: result.introduction ?? null,
    primaryGoal: result.primaryGoal ?? null,
    questions: result.questions ?? [],
  });
}

async function publish(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  if (!body.agentId) return json({ error: 'agent_required' }, 400);

  const { data: agent } = await sb.from('comm_agents')
    .select('id, owner_id, name, purpose, primary_goal, introduction, business_context, template_code, property_id, voice_id, languages, channels')
    .eq('id', body.agentId).maybeSingle();

  if (!agent) return json({ error: 'not_found' }, 404);
  if (agent.owner_id !== userId) return json({ error: 'forbidden' }, 403);

  // An agent must be able to open its mouth and must know what it is for.
  const missing: string[] = [];
  if (!agent.name?.trim()) missing.push('name');
  if (!agent.purpose?.trim() && !agent.primary_goal?.trim()) missing.push('purpose');
  if (!Array.isArray(agent.languages) || !agent.languages.length) missing.push('languages');
  if (missing.length) return json({ ok: false, code: 'INCOMPLETE', missing }, 422);

  // The boundary again, at the last moment before this becomes a runnable
  // artefact. Everything after this reads the frozen snapshot.
  const domain = classifyDomain({
    text: [agent.name, agent.purpose, agent.primary_goal, agent.introduction, agent.business_context]
      .filter(Boolean).join('\n'),
    agentTemplate: agent.template_code,
    hasPropertyContext: Boolean(agent.property_id),
  });
  if (domain.verdict === 'BLOCK') {
    return json({ ok: false, code: 'OUT_OF_SCOPE', message: 'Homatch agents are for real estate and property services.' }, 422);
  }

  const { data, error } = await sb.rpc('comm_publish_agent', { p_agent_id: body.agentId, p_actor: userId });
  if (error) {
    logEvent('comm-agent', 'publish_failed', { agentId: body.agentId, error: error.message });
    return json({ error: 'publish_failed' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  logEvent('comm-agent', 'published', { agentId: body.agentId, version: row?.version });

  return json({ ok: true, version: row?.version ?? null, versionId: row?.version_id ?? null });
}

/**
 * §11 step 7's review screen.
 *
 * Built from buildAgentRuntime, which is the SAME assembler the dispatcher
 * uses to place a call. A separate summary written for the UI would drift, and
 * the customer would be reviewing something other than what runs.
 */
async function preview(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  if (!body.agentId) return json({ error: 'agent_required' }, 400);

  const { data: agent } = await sb.from('comm_agents')
    .select('id, owner_id, name, status, current_version, languages, channels, voice_label, ai_disclosure_enabled, qualification_questions, escalation_instructions')
    .eq('id', body.agentId).maybeSingle();
  if (!agent || agent.owner_id !== userId) return json({ error: 'forbidden' }, 403);

  const runtime = await buildAgentRuntime(sb, { agentId: body.agentId });
  if (!runtime) return json({ error: 'not_found' }, 404);

  return json({
    ok: true,
    summary: {
      name: agent.name,
      status: agent.status,
      version: agent.current_version,
      languages: agent.languages,
      channels: agent.channels,
      voice: agent.voice_label,
      aiDisclosure: agent.ai_disclosure_enabled !== false,
      opensWith: runtime.config.firstMessage,
      goal: runtime.config.systemPrompt.split('## What you are doing')[1]?.split('##')[0]?.trim() ?? null,
      questions: agent.qualification_questions ?? [],
      escalation: agent.escalation_instructions ?? null,
      maxDurationSec: runtime.config.maxDurationSec,
      recordingEnabled: runtime.recordingEnabled,
    },
    // The assembled prompt is shown to the OWNER of the agent, which is
    // legitimate — it is their own instructions. It is not shown to a contact
    // and is not returned to anyone else.
    systemPrompt: runtime.config.systemPrompt,
  });
}

/**
 * §11 step 6 and §12's Live Test: a grant for a browser conversation with this
 * agent, before it is saved as READY.
 *
 * Uses the agent's real assembled prompt, so the test is a test of the agent
 * and not of a simplified stand-in.
 */
async function test(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  if (!body.agentId) return json({ error: 'agent_required' }, 400);
  if (!cartesiaCredentialsPresent().ok) return json({ error: 'voice_unavailable' }, 503);

  const { data: agent } = await sb.from('comm_agents').select('owner_id').eq('id', body.agentId).maybeSingle();
  if (!agent || agent.owner_id !== userId) return json({ error: 'forbidden' }, 403);

  const limit = await checkRateLimit(sb, 'agent_voice_test', 20, 3600, { userId });
  if (!limit.allowed) return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);

  const runtime = await buildAgentRuntime(sb, { agentId: body.agentId, maxDurationSec: 180 });
  if (!runtime) return json({ error: 'not_found' }, 404);

  const baseAgent = await ensureBaseAgent(sb as never, { language: runtime.config.primaryLanguage });
  if (!baseAgent.ok || !baseAgent.data) return json({ error: 'voice_unavailable' }, 502);

  const grant = await createCartesiaProvider().mintGrant({ ttlSeconds: 240, scopes: ['agent', 'stt'] });
  if (!grant.ok || !grant.data) return json({ error: 'voice_unavailable' }, 502);

  logEvent('comm-agent', 'test_granted', { agentId: body.agentId, userId });

  return json({
    ok: true,
    token: grant.data.token,
    expiresAt: grant.data.expiresAt,
    agentId: baseAgent.data.agentId,
    provider: 'CARTESIA',
    instructions: runtime.config.systemPrompt,
    firstMessage: runtime.config.firstMessage,
    voiceId: runtime.config.voiceId,
    primaryLanguage: runtime.config.primaryLanguage,
    endpointing: runtime.config.endpointing,
    // A test is capped harder than a real call: nobody needs ten minutes to
    // hear whether an agent sounds right.
    maxDurationSec: Math.min(180, runtime.config.maxDurationSec),
  });
}
