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
import {
  createCartesiaProvider, cartesiaCredentialsPresent, synthesizeSpeech,
} from '../_shared/comm/cartesia.ts';
import { callLlm } from '../_shared/comm/llm.ts';
import { transcribeSpeech, transcriptionAvailable, scriptLanguage } from '../_shared/comm/transcribe.ts';

interface AgentRequest {
  action: 'generate' | 'publish' | 'preview' | 'test' | 'turn' | 'transcribe';
  agentId?: string;
  rough?: string;
  template?: string;
  languages?: string[];
  locale?: string;
  /** turn: what the tester just said, and the conversation so far. */
  text?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** transcribe: one finished utterance, base64 WAV, 16 kHz mono PCM. */
  audioBase64?: string;
  /** transcribe: a language to prefer, or absent to let the provider decide. */
  languageHint?: string;
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
    case 'turn':     return await agentTurn(sb, caller.userId, body);
    case 'transcribe': return await agentTranscribe(sb, caller.userId, body);
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
    // The customer gets "generation failed"; an admin gets the reason.
    //
    // Without this line, a broken model call is indistinguishable from a
    // refused one in the logs, and "Generate with AI does not work" had to be
    // diagnosed by reasoning about the request rather than by reading what
    // the provider said. The value is a code or an HTTP status, never a
    // credential and never the customer's text.
    logEvent('comm-agent', 'generate_failed', { reason: result.error ?? 'unknown' });
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

  /*
   * The browser gets `stt` and nothing more.
   *
   * The provider's agents socket carried this conversation and returned audio
   * with no text, so a test could never show what the agent said. The turn
   * action below assembles the exchange server-side instead, which also means
   * the test speaks in the agent's OWN configured voice rather than whatever
   * the provider defaults to.
   */
  const grant = await createCartesiaProvider().mintGrant({ ttlSeconds: 240, scopes: ['stt'] });
  if (!grant.ok || !grant.data) return json({ error: 'voice_unavailable' }, 502);

  logEvent('comm-agent', 'test_granted', { agentId: body.agentId, userId });

  return json({
    ok: true,
    token: grant.data.token,
    expiresAt: grant.data.expiresAt,
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

/**
 * One turn of an agent's live browser test.
 *
 * The same shape as the public demo's turn, with the two differences that are
 * the whole point of a test: it runs the AGENT's assembled prompt, and it
 * speaks in the agent's OWN voice. Testing a simplified stand-in in somebody
 * else's voice tests nothing anyone is going to ship.
 */
/**
 * One utterance from the Voice Studio tester, turned into words.
 *
 * The same move as AI Talk, for the same reason: the browser used to stream
 * the microphone straight to Cartesia STT, and Cartesia will not transcribe
 * Georgian. An agent built for Georgian callers could not be tested in
 * Georgian, which is most of the point of testing it.
 *
 * The audio is transcribed and dropped. Nothing is stored and no transcript
 * reaches a log.
 */
async function agentTranscribe(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  if (!body.agentId) return json({ error: 'agent_required' }, 400);

  const { data: agent } = await sb.from('comm_agents')
    .select('owner_id').eq('id', body.agentId).maybeSingle();
  if (!agent || agent.owner_id !== userId) return json({ error: 'forbidden' }, 403);

  const limit = await checkRateLimit(sb, 'agent_test_transcribe', 240, 3600, { userId });
  if (!limit.allowed) return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);

  if (!transcriptionAvailable()) return json({ ok: false, reason: 'UNAVAILABLE' }, 503);

  const b64 = String(body.audioBase64 ?? '');
  if (!b64) return json({ ok: false, reason: 'EMPTY' }, 400);
  if (b64.length > 2_800_000) return json({ ok: false, reason: 'TOO_LONG' }, 413);

  let audio: Uint8Array;
  try {
    const bin = atob(b64);
    audio = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i);
  } catch {
    return json({ ok: false, reason: 'BAD_AUDIO' }, 400);
  }

  const result = await transcribeSpeech({
    audio,
    mime: 'audio/wav',
    languageHint: body.languageHint ? String(body.languageHint).slice(0, 5) : null,
  });

  if (!result.ok) {
    logEvent('comm-agent', 'transcribe_failed', {
      bytes: audio.byteLength, model: result.model,
      status: result.status ?? null, detail: result.error ?? null,
    });
    return json({ ok: false, reason: 'TRANSCRIBE_FAILED' }, 502);
  }

  const language = (result.text ? scriptLanguage(result.text) : null) ?? result.language ?? null;
  return json({ ok: true, text: result.text, language, ms: result.latencyMs });
}

async function agentTurn(sb: Sb, userId: string, body: AgentRequest): Promise<Response> {
  if (!body.agentId) return json({ error: 'agent_required' }, 400);
  const said = String(body.text ?? '').trim();
  if (!said) return json({ ok: false, reason: 'EMPTY' }, 400);

  const { data: agent } = await sb.from('comm_agents')
    .select('owner_id').eq('id', body.agentId).maybeSingle();
  if (!agent || agent.owner_id !== userId) return json({ error: 'forbidden' }, 403);

  const limit = await checkRateLimit(sb, 'agent_test_turn', 120, 3600, { userId });
  if (!limit.allowed) return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);

  const runtime = await buildAgentRuntime(sb, { agentId: body.agentId, maxDurationSec: 180 });
  if (!runtime) return json({ error: 'not_found' }, 404);

  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const conversation = history
    .map((h) => `${h.role === 'assistant' ? 'Agent' : 'Caller'}: ${String(h.content ?? '').slice(0, 500)}`)
    .join('\n');

  const reply = await callLlm({
    system: runtime.config.systemPrompt,
    user: [
      conversation ? `Conversation so far:\n${conversation}\n` : '',
      `Caller just said: "${said.slice(0, 1000)}"`,
      '',
      'Reply as the agent, out loud, in one or two short spoken sentences.',
      'Plain words only: nothing that cannot be said aloud.',
    ].filter(Boolean).join('\n'),
    maxTokens: 220,
    timeoutMs: 20_000,
  });

  if (!reply.ok || !reply.text?.trim()) {
    logEvent('comm-agent', 'turn_llm_failed', { reason: reply.error ?? 'empty', status: reply.status ?? null });
    return json({ ok: false, reason: 'ASSISTANT_FAILED' }, 502);
  }
  const text = reply.text.trim().slice(0, 800);

  const voiceId = runtime.config.voiceId;
  if (!voiceId) {
    // The sentence is real even when no voice has been chosen yet.
    return json({ ok: true, text, audioBase64: null, spoken: false });
  }

  const spoken = await synthesizeSpeech({
    voiceId,
    language: runtime.config.primaryLanguage || 'en',
    text,
  });

  if (!spoken.ok || !spoken.data) {
    logEvent('comm-agent', 'turn_tts_failed', {
      code: spoken.error?.code ?? null, status: spoken.error?.providerCode ?? null,
    });
    return json({ ok: true, text, audioBase64: null, voiceId, spoken: false });
  }

  return json({
    ok: true, text,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId,
    spoken: true,
  });
}
