// HOMATCH Communications — who is answering this conversation.
//
// §36: "Never allow race conditions where AI and human both reply
// simultaneously." That is not achievable with a boolean and good intentions.
// It needs an explicit state machine with legal transitions, a recorded actor
// and reason for every move, and — the part that actually enforces it — a
// conditional write on the server that only succeeds from the state the client
// believed it was in.
//
// This file is the machine. The conditional write lives in the send path,
// which refuses to let the AI speak unless the conversation is still
// AI_ACTIVE at the moment of writing.

import type { ConversationMode } from './vocabulary.ts';

export type HandoffActor = 'AI' | 'HUMAN' | 'SYSTEM';

export interface HandoffTransition {
  from: ConversationMode;
  to: ConversationMode;
  by: HandoffActor;
  reason?: string;
}

/**
 * Legal moves, and who may make them.
 *
 * The asymmetry is deliberate and is the whole safety property: a HUMAN can
 * take over from the AI at any moment, and the AI can never take over from a
 * human. Returning a conversation to the AI is an explicit human act (§36),
 * which is why AI is not in the actor list for HUMAN_ACTIVE -> AI_ACTIVE.
 */
const LEGAL: Array<{ from: ConversationMode; to: ConversationMode; actors: HandoffActor[] }> = [
  { from: 'AI_ACTIVE',      to: 'HUMAN_ACTIVE',   actors: ['HUMAN'] },
  { from: 'AI_ACTIVE',      to: 'PENDING_HANDOFF', actors: ['AI', 'SYSTEM'] },
  { from: 'AI_ACTIVE',      to: 'PAUSED',         actors: ['HUMAN', 'SYSTEM'] },
  { from: 'AI_ACTIVE',      to: 'CLOSED',         actors: ['HUMAN', 'SYSTEM'] },

  // A human claiming a handoff the AI asked for is the normal path.
  { from: 'PENDING_HANDOFF', to: 'HUMAN_ACTIVE',  actors: ['HUMAN'] },
  // Nobody claimed it. A supervisor, or a timeout, can hand it back.
  { from: 'PENDING_HANDOFF', to: 'AI_ACTIVE',     actors: ['HUMAN', 'SYSTEM'] },
  { from: 'PENDING_HANDOFF', to: 'PAUSED',        actors: ['HUMAN', 'SYSTEM'] },
  { from: 'PENDING_HANDOFF', to: 'CLOSED',        actors: ['HUMAN'] },

  { from: 'HUMAN_ACTIVE',   to: 'AI_ACTIVE',      actors: ['HUMAN'] },
  { from: 'HUMAN_ACTIVE',   to: 'PAUSED',         actors: ['HUMAN', 'SYSTEM'] },
  { from: 'HUMAN_ACTIVE',   to: 'CLOSED',         actors: ['HUMAN'] },

  { from: 'PAUSED',         to: 'AI_ACTIVE',      actors: ['HUMAN'] },
  { from: 'PAUSED',         to: 'HUMAN_ACTIVE',   actors: ['HUMAN'] },
  { from: 'PAUSED',         to: 'CLOSED',         actors: ['HUMAN', 'SYSTEM'] },

  // A closed conversation re-opens when the contact writes again. Only the
  // system does this, and only to HUMAN_ACTIVE is wrong — a new inbound on a
  // closed thread should reach the AI first, as it would for a new thread.
  { from: 'CLOSED',         to: 'AI_ACTIVE',      actors: ['HUMAN', 'SYSTEM'] },
  { from: 'CLOSED',         to: 'HUMAN_ACTIVE',   actors: ['HUMAN'] },
];

export function canTransition(from: ConversationMode, to: ConversationMode, by: HandoffActor): boolean {
  if (from === to) return false;
  return LEGAL.some((r) => r.from === from && r.to === to && r.actors.includes(by));
}

export interface TransitionResult {
  ok: boolean;
  mode: ConversationMode;
  error?: 'ILLEGAL_TRANSITION' | 'NO_CHANGE';
}

export function applyTransition(current: ConversationMode, t: Omit<HandoffTransition, 'from'>): TransitionResult {
  if (current === t.to) return { ok: false, mode: current, error: 'NO_CHANGE' };
  if (!canTransition(current, t.to, t.by)) return { ok: false, mode: current, error: 'ILLEGAL_TRANSITION' };
  return { ok: true, mode: t.to };
}

/**
 * The single question the outbound path asks before letting the AI speak.
 *
 * Checked again inside the UPDATE on the server, not only here: between this
 * returning true and the message being written, a human can have pressed Take
 * over, and a check that is not part of the write is a check with a race in it.
 */
export function mayAiReply(mode: ConversationMode): boolean {
  return mode === 'AI_ACTIVE';
}

export function mayHumanReply(mode: ConversationMode): boolean {
  return mode === 'HUMAN_ACTIVE' || mode === 'PENDING_HANDOFF' || mode === 'AI_ACTIVE';
}

// ── When the AI must stand down ─────────────────────────────────────────────

/**
 * §113. "Give me a real person" is not a sentiment to be handled gracefully by
 * continuing to sound helpful — it is an instruction, and §114 forbids
 * pretending to be human. The agent acknowledges, stops, and the conversation
 * moves to PENDING_HANDOFF.
 *
 * Matched deterministically because this must work when the LLM is having a
 * bad day, and because it must work identically in all six locales.
 */
const HUMAN_REQUEST_PATTERNS = [
  // Georgian
  'ადამიან', 'ნამდვილ ადამიან', 'ოპერატორ', 'მენეჯერ', 'რეალურ ადამიან', 'ცოცხალ ადამიან',
  'რობოტი ხარ', 'ბოტი ხარ', 'აგენტთან',
  // Russian
  'человек', 'оператор', 'менеджер', 'living person', 'живой человек', 'ты робот', 'ты бот',
  // English
  'real person', 'real human', 'speak to a human', 'talk to a human', 'human agent',
  'are you a robot', 'are you a bot', 'are you real', 'let me speak to someone',
  'put me through', 'transfer me', 'speak to an agent', 'speak to someone',
  // Turkish
  'gerçek insan', 'operatör', 'yetkili', 'robot musun',
  // Arabic / Hebrew
  'شخص حقيقي', 'موظف', 'انسان حقيقي', 'בן אדם', 'נציג אנושי',
];

export interface HumanRequestResult {
  requested: boolean;
  matched?: string;
}

export function detectsHumanRequest(text: string): HumanRequestResult {
  const t = String(text ?? '').toLowerCase().normalize('NFKC');
  if (!t.trim()) return { requested: false };
  for (const p of HUMAN_REQUEST_PATTERNS) {
    if (t.includes(p.toLowerCase())) return { requested: true, matched: p };
  }
  return { requested: false };
}

/**
 * Opt-out, which is a harder stop than a handoff: it ends outbound contact on
 * that channel entirely and can never be undone by an import (§14 step 5).
 */
const OPT_OUT_PATTERNS = [
  'stop', 'unsubscribe', 'remove me', 'do not contact', "don't contact", 'opt out', 'optout',
  'აღარ დამირეკო', 'აღარ მომწერო', 'გამომრიცხე', 'შეწყვიტე',
  'отпишите', 'отписаться', 'не звоните', 'не пишите', 'удалите меня', 'стоп',
  'abone iptal', 'aramayın', 'çıkar beni',
  'الغاء الاشتراك', 'لا تتصل', 'הסר אותי', 'תפסיקו',
];

export function detectsOptOut(text: string): boolean {
  const t = String(text ?? '').trim().toLowerCase().normalize('NFKC');
  if (!t) return false;
  // A bare "stop" is an opt-out. "stop by the office on Tuesday" is not, so a
  // single-word match is required for the short, ambiguous tokens.
  const words = t.split(/\s+/);
  // Unicode-aware stripping. \W is ASCII-only, so it reduced "стоп" to an
  // empty string and this branch could never fire for a non-Latin word — which
  // meant a Russian-speaking contact could type STOP and keep being called.
  const firstWord = words[0].replace(/[^\p{L}\p{N}]/gu, '');
  if (words.length <= 2 && ['stop', 'стоп', 'unsubscribe', 'optout', 'შეწყვიტე'].includes(firstWord)) {
    return true;
  }
  return OPT_OUT_PATTERNS.some((p) => p.length > 5 && t.includes(p));
}
