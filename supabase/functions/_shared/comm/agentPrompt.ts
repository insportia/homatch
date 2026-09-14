// HOMATCH Communications — turning a saved agent into something that can talk.
//
// One place assembles the system prompt, and every voice provider is handed
// the result. Two reasons that matters:
//
//   §115 forbids the agent fabricating availability, price, legal status, ROI,
//   scarcity, mortgage approval or any contract fact. That instruction has to
//   be in EVERY prompt, not in whichever ones the author remembered.
//
//   §114 requires lawful AI disclosure to be configurable and honest. Building
//   the opening line here means the disclosure cannot be dropped by a provider
//   adapter that happens to override firstMessage.
//
// THE SNAPSHOT RULE
//
// This reads comm_agent_versions, never comm_agents. A call must always be
// explainable by the exact instructions it ran under, and the mutable agent
// row is by definition not those instructions once anyone edits it (§11).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { AgentRuntimeConfig } from './contracts.ts';
import { DEFAULT_ENDPOINTING, DEFAULT_BARGE_IN } from './generated/transcript.ts';

export interface AgentRuntime {
  config: AgentRuntimeConfig;
  versionId: string;
  recordingEnabled: boolean;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew',
};

/**
 * Load a frozen agent version and build everything a provider needs.
 *
 * `agentVersionId` is preferred. `agentId` is a fallback that resolves to the
 * CURRENT version and is only for paths that legitimately have no frozen
 * version yet — a Voice Studio test of an unpublished draft. A campaign always
 * has a version, because launching pins one.
 */
export async function buildAgentRuntime(
  sb: SupabaseClient,
  params: {
    agentVersionId?: string | null;
    agentId?: string | null;
    language?: string | null;
    maxDurationSec?: number;
  },
): Promise<AgentRuntime | null> {
  let snapshot: Record<string, unknown> | null = null;
  let versionId: string | null = null;

  if (params.agentVersionId) {
    const { data } = await sb.from('comm_agent_versions')
      .select('id, snapshot').eq('id', params.agentVersionId).maybeSingle();
    if (data) { snapshot = data.snapshot as Record<string, unknown>; versionId = data.id; }
  }

  if (!snapshot && params.agentId) {
    const { data } = await sb.from('comm_agent_versions')
      .select('id, snapshot').eq('agent_id', params.agentId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    if (data) { snapshot = data.snapshot as Record<string, unknown>; versionId = data.id; }
    else {
      // An unpublished draft. Usable for a live test, never for a campaign —
      // the launch gate already refuses an agent with no current_version.
      const { data: draft } = await sb.from('comm_agents')
        .select('*').eq('id', params.agentId).maybeSingle();
      if (draft) { snapshot = draft as Record<string, unknown>; versionId = null; }
    }
  }

  if (!snapshot) return null;

  const languages = asArray(snapshot.languages, ['ka']);
  // The contact's own language leads when Homatch knows it AND the agent
  // speaks it. Opening in Georgian to someone whose record says they speak
  // Russian is a worse first impression than the agent's default.
  const primary = params.language && languages.includes(params.language)
    ? params.language
    : (languages[0] ?? 'ka');

  const tuning = await loadVoiceTuning(sb);
  const maxDurationSec = Math.min(
    Number(params.maxDurationSec ?? 300),
    Number(tuning.maxCallDurationSec ?? 600),
  );

  return {
    versionId: versionId ?? '',
    recordingEnabled: tuning.recordingDefault,
    config: {
      agentVersionId: versionId ?? '',
      name: String(snapshot.name ?? 'Homatch agent'),
      systemPrompt: buildSystemPrompt(snapshot, primary, languages),
      firstMessage: buildFirstMessage(snapshot, primary),
      languages,
      primaryLanguage: primary,
      voiceId: (snapshot.voice_id as string) ?? null,
      aiDisclosure: snapshot.ai_disclosure_enabled !== false,
      endpointing: {
        minSilenceMs: tuning.minSilenceMs,
        maxSilenceMs: tuning.maxSilenceMs,
        completeSilenceMs: tuning.completeSilenceMs,
        continuationGraceMs: tuning.continuationGraceMs,
        semantic: tuning.semanticEndpointing,
      },
      interruption: { enabled: tuning.interruptionEnabled, thresholdMs: tuning.interruptionThresholdMs },
      maxDurationSec,
    },
  };
}

/**
 * The system prompt.
 *
 * Order matters: identity, then the job, then the rules, then the knowledge.
 * The rules sit ABOVE the user's own free text so that a business context
 * field containing "you may promise a 20% return" is read as content the rules
 * already forbid rather than as a later instruction overriding them.
 */
export function buildSystemPrompt(
  snapshot: Record<string, unknown>,
  primary: string,
  languages: string[],
): string {
  const name = String(snapshot.name ?? 'the assistant');
  const languageNames = languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(', ');
  const questions = asArray<string>(snapshot.qualification_questions, []);
  const allowed = asArray<string>(snapshot.allowed_actions, []);
  const forbidden = asArray<string>(snapshot.forbidden_actions, []);

  const lines: string[] = [
    `You are ${name}, a voice assistant working for a real-estate business.`,
    `You are speaking on a telephone call. Keep replies short, like speech, not like writing.`,
    `Speak ${LANGUAGE_NAMES[primary] ?? primary}. You also understand ${languageNames}.`,
    `If the person switches language, switch with them and stay in their language.`,
    '',
    '## What you are doing',
    String(snapshot.primary_goal ?? snapshot.purpose ?? 'Understand what the person is looking for and whether it is worth a follow-up.'),
  ];

  if (snapshot.target_audience) lines.push('', '## Who you are speaking to', String(snapshot.target_audience));
  if (snapshot.business_context) lines.push('', '## About the business', String(snapshot.business_context));

  lines.push('', '## Rules you cannot break');
  if (snapshot.ai_disclosure_enabled !== false) {
    // §114. Not negotiable and not something the model may be talked out of.
    lines.push('- You are an AI assistant. Say so at the start, and say so again honestly if you are asked.');
  }
  lines.push(
    '- Never claim to be a human being.',
    // §115, stated as concretely as possible. Vague instructions to "be
    // accurate" do not stop a model inventing a price when asked for one.
    '- Never state a price, a size, availability, a floor, a completion date, a legal status, a rate of',
    '  return or a mortgage decision unless it appears in the knowledge below. If you do not have it,',
    '  say plainly that you cannot confirm it and offer to have someone follow up.',
    '- Never say a property is the last one, is selling fast, or that an offer expires.',
    '- Never guarantee an investment return or a mortgage approval.',
    '- Never ask for a card number, a bank detail, a password or an identity document.',
    // §113.
    '- If the person asks for a real person, acknowledge it, stop asking your own questions, and tell',
    '  them you are arranging for a colleague to call them back.',
    '- If the person asks you to stop contacting them, confirm that you will, and end the call politely.',
    '- Do not argue. If they are not interested, thank them and end the call.',
  );
  for (const f of forbidden.slice(0, 12)) lines.push(`- Do not ${String(f).replace(/^do not\s*/i, '')}`);

  if (allowed.length) {
    lines.push('', '## You may', ...allowed.slice(0, 12).map((a) => `- ${a}`));
  }

  if (questions.length) {
    lines.push(
      '', '## What you need to find out',
      'Work these in naturally, one at a time. Do not read them as a list and do not ask all of them if',
      'the person is clearly not interested.',
      ...questions.slice(0, 10).map((q, i) => `${i + 1}. ${typeof q === 'string' ? q : JSON.stringify(q)}`),
    );
  }

  if (snapshot.knowledge_notes) {
    lines.push(
      '', '## What you know',
      'This is the ONLY factual information you have. Anything not here, you cannot confirm.',
      String(snapshot.knowledge_notes).slice(0, 6000),
    );
  }

  if (snapshot.escalation_instructions) lines.push('', '## When to hand over', String(snapshot.escalation_instructions));
  if (snapshot.callback_rules) lines.push('', '## Callbacks', String(snapshot.callback_rules));

  lines.push(
    '', '## How to speak',
    `Tone: ${String(snapshot.tone ?? 'PROFESSIONAL').toLowerCase()}.`,
    'One or two sentences per turn. Ask one question at a time, then stop and listen.',
    // The conversational failure §24 is about, stated to the model as well as
    // enforced in the endpointing config.
    'People pause in the middle of a thought. If someone stops mid-sentence, wait rather than answering.',
    'Never talk over the person. If they start speaking, stop immediately.',
  );

  return lines.join('\n');
}

/**
 * What the assistant opens with.
 *
 * SHORT, BECAUSE THE FIRST FEW SECONDS DECIDE EVERYTHING.
 *
 * A caller forms their opinion of whether this is worth talking to before
 * the second sentence. An opening that explains the product is a monologue
 * they did not ask for, and it is the part most likely to be interrupted --
 * so it names who is speaking and asks one question, and that is all.
 *
 * WRITTEN PER LANGUAGE, NOT TRANSLATED.
 *
 * Each line below was written in its own language rather than rendered out of
 * the English one. A greeting translated word by word is grammatical and
 * instantly recognisable as translated, which is exactly the impression the
 * first sentence must not make.
 *
 * An agent's own `introduction` still wins: this is what a misconfigured
 * agent says to a real person, and that is the only reason it has to be good.
 */
export function buildFirstMessage(snapshot: Record<string, unknown>, primary: string): string {
  const written = String(snapshot.introduction ?? '').trim();
  if (written) return written;

  const fallbacks: Record<string, string> = {
    ka: 'გამარჯობა, მე მარიამი ვარ, Homatch-ის AI ასისტენტი. რით შემიძლია დაგეხმაროთ?',
    en: 'Hello, I am Mariam, the Homatch AI assistant. How can I help?',
    ru: 'Здравствуйте, я Мариам, AI-ассистент Homatch. Чем могу помочь?',
    tr: 'Merhaba, ben Mariam, Homatch yapay zekâ asistanı. Nasıl yardımcı olabilirim?',
    ar: 'مرحبًا، أنا مريم، مساعدة Homatch الذكية. كيف أساعدك؟',
    he: 'שלום, אני מרים, עוזרת ה-AI של Homatch. איך אפשר לעזור?',
  };
  return fallbacks[primary] ?? fallbacks.en;
}

export interface VoiceTuning {
  minSilenceMs: number;
  maxSilenceMs: number;
  completeSilenceMs: number;
  continuationGraceMs: number;
  semanticEndpointing: boolean;
  interruptionEnabled: boolean;
  interruptionThresholdMs: number;
  maxCallDurationSec: number;
  recordingDefault: boolean;
  georgianLockThreshold: number;
}

/**
 * Admin voice tuning (§55), with the shipped defaults as the floor.
 *
 * Read from admin_settings so an operator can adjust endpointing without a
 * deploy, and defaulted from transcript.ts so a missing settings row produces
 * the tuned behaviour rather than a provider's own generic one.
 */
export async function loadVoiceTuning(sb: SupabaseClient): Promise<VoiceTuning> {
  const { data } = await sb.from('admin_settings')
    .select('value').eq('key', 'comm_voice_tuning').maybeSingle();

  const v = (data?.value ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number) => {
    const n = Number(v[key]);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    minSilenceMs: num('min_silence_ms', DEFAULT_ENDPOINTING.minSilenceMs),
    maxSilenceMs: num('max_silence_ms', DEFAULT_ENDPOINTING.maxSilenceMs),
    completeSilenceMs: num('complete_silence_ms', DEFAULT_ENDPOINTING.completeSilenceMs),
    continuationGraceMs: num('continuation_grace_ms', DEFAULT_ENDPOINTING.continuationGraceMs),
    semanticEndpointing: v.semantic_endpointing !== false,
    interruptionEnabled: v.interruption_enabled !== false,
    interruptionThresholdMs: num('interruption_threshold_ms', DEFAULT_BARGE_IN.sustainMs),
    maxCallDurationSec: num('max_call_duration_sec', 600),
    // Recording is off unless an operator turns it on. §73: a recording is a
    // privacy decision, and a default that records every call is the wrong
    // default to ship.
    recordingDefault: v.recording_default === true,
    georgianLockThreshold: num('georgian_lock_threshold', 0.72),
  };
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  return fallback;
}
