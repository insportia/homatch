// HOMI in Email Studio — the model call (prompt and output guard: src/emailMarketing/copilot.ts).
// Free to the customer like the rest of Email Studio's AI; the provider cost is recorded in
// cost_events. Bounded: 40 requests an hour per account, one call each, 30 s, JSON only.

import { json, checkRateLimit, logEvent, redact } from '../comm/auth.ts';
import { callLlm, llmAvailable } from '../comm/llm.ts';
import { estimatedProviderCost } from '../providerCost.ts';
import type { Owner } from './core.ts';
import {
  buildUserPayload, COPILOT_SYSTEM_PROMPT, COPILOT_TASKS, type CopilotRequest, type CopilotTask, parseProposal, textBlocksOf,
} from '../../../../src/emailMarketing/copilot.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function handleCopilot(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const task = String(body.task ?? '') as CopilotTask;
  if (!COPILOT_TASKS.includes(task)) return json({ ok: false, error: 'INVALID_TASK' }, 400);
  if (!llmAvailable()) return json({ ok: false, error: 'COPILOT_UNAVAILABLE' }, 503);
  const limit = await checkRateLimit(sb, 'email_studio_copilot', 40, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);

  const c = (body.campaign && typeof body.campaign === 'object' ? body.campaign : {}) as Record<string, unknown>;
  const language = LANGS.includes(String(body.language)) ? String(body.language) : 'en';
  const target = LANGS.includes(String(body.targetLanguage)) ? String(body.targetLanguage) : null;
  if (task === 'translate' && !target) return json({ ok: false, error: 'TARGET_LANGUAGE_REQUIRED' }, 400);
  const req: CopilotRequest = {
    task, instruction: str(body.instruction, 1500), language, targetLanguage: target,
    campaign: { name: str(c.name, 160), objective: str(c.objective, 300), subject: str(c.subject, 200), preview_text: str(c.preview_text, 200), audience: str(c.audience, 300) },
    blocks: textBlocksOf(body.design),
    facts: str(body.facts, 3000),
    findings: Array.isArray(body.findings) ? (body.findings as Array<Record<string, unknown>>).slice(0, 30).map((f) => ({ code: str(f.code, 60), severity: str(f.severity, 10), detail: str(f.detail, 200) })) : [],
  };
  const uiLanguage = LANGS.includes(String(body.uiLanguage)) ? String(body.uiLanguage) : language;

  const result = await callLlm({ system: COPILOT_SYSTEM_PROMPT, user: buildUserPayload(req, uiLanguage), json: true, maxTokens: 1600, timeoutMs: 30_000 });
  if (result.ok || result.inputTokens > 0) {
    const inCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: result.inputTokens, model: result.model });
    const outCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: result.outputTokens, model: result.model });
    const raw = inCost != null && outCost != null ? inCost + outCost : null;
    const { error } = await sb.from('cost_events').insert({
      source: 'email-marketing:copilot', provider: 'OPENAI', operation_type: 'email_studio_copilot', units: result.inputTokens + result.outputTokens,
      cost_usd: raw ?? 0, success: result.ok, pricing_state: raw == null ? 'UNPRICED' : 'ESTIMATED', cache_hit: false,
    });
    if (error) logEvent('email-studio', 'copilot_cost_record_failed', { error: redact(error.message) });
  }
  if (!result.ok) return json({ ok: false, error: 'COPILOT_FAILED' }, 502);
  const proposal = parseProposal(result.parsed, req);
  if (!proposal) return json({ ok: false, error: 'COPILOT_EMPTY' }, 502);
  if (!proposal.message && proposal.warnings.some((w) => w.severity === 'BLOCK')) {
    logEvent('email-studio', 'copilot_proposal_blocked', { task, codes: proposal.warnings.map((w) => w.code).join(',') });
    return json({ ok: false, error: 'COPILOT_BLOCKED', warnings: proposal.warnings }, 422);
  }
  logEvent('email-studio', 'copilot_ok', { task, warnings: proposal.warnings.length });
  return json({ ok: true, proposal });
}
