// HOMATCH — rendering the final AI due-diligence summary.
//
// THE DIVISION OF LABOUR
// ----------------------
//   The deterministic plan decides WHAT IS TRUE.
//   The language model decides only HOW IT READS.
//
// The model is handed a closed set of point keys and may cite nothing else.
// Everything it writes is then validated back against the plan by
// validateRendering(); if it invented a fact, cited a key that does not
// exist, dropped a conflict, or leaked internal vocabulary, the rendering is
// DISCARDED and the deterministic rendering below is shown instead.
//
// That is the important property: there is no failure mode in which invented
// content reaches a customer. The worst case is prose that reads a little
// flatter than it could have — which is a cost worth paying, because the
// alternative is a confident sentence about someone's property that no
// evidence supports.

import { validateRendering } from '../planning/synthesis.ts';
import type { SynthesisPlan, SectionKey, SynthesisPoint } from '../planning/synthesis.ts';

export interface RenderedSection {
  sectionKey: SectionKey;
  text: string;
  usedPointKeys: string[];
}

export interface FinalRendering {
  sections: RenderedSection[];
  /** DETERMINISTIC when the model output was rejected or never obtained. */
  mode: 'MODEL' | 'DETERMINISTIC';
  /** Why the model output was rejected, kept for diagnostics. Never shown. */
  rejectedBecause: string[];
  verdict: SynthesisPlan['verdict'];
  verdictReasons: string[];
}

/* ------------------------------------------------------------------ *
 * The prompt                                                          *
 * ------------------------------------------------------------------ */

/**
 * Builds the model contract.
 *
 * Note what is NOT in here: no database rows, no result_json, no source URLs,
 * no internal identifiers. The model sees a list of already-decided
 * statements and is asked to join them into readable Georgian. It cannot
 * research, because it is given nothing to research with.
 */
export function buildRenderPrompt(plan: SynthesisPlan): { system: string; user: string } {
  const system = [
    'You are writing for Homatch, a Georgian property due-diligence product.',
    'You are NOT deciding facts. Every statement you may use is supplied below.',
    'You may not add, infer, soften or strengthen any fact.',
    '',
    'Rules:',
    ...plan.renderContract.rules.map((r) => `- ${r}`),
    '',
    'Return STRICT JSON, no markdown fence, of the form:',
    '{"sections":[{"sectionKey":"<KEY>","text":"<Georgian prose>","usedPointKeys":["<key>", ...]}]}',
    '',
    'usedPointKeys must list exactly the supplied point keys your text draws on.',
    'You may only use these point keys:',
    plan.renderContract.allowedPointKeys.join(', '),
  ].join('\n');

  const sections = plan.sections.map((s) => ({
    sectionKey: s.key,
    title: s.title,
    points: s.points.map(pointForModel),
  }));

  const user = JSON.stringify(
    {
      propertyType: plan.propertyType,
      language: plan.renderContract.language,
      sections,
      // Conflicts are passed separately AND must be cited; validateRendering()
      // fails the rendering if any is omitted, so the model cannot quietly
      // drop the most important thing a buyer needs to hear.
      conflictsThatMustBeMentioned: plan.conflicts.map(pointForModel),
      thingsWorthConfirming: plan.toConfirm.map(pointForModel),
      verdict: plan.verdict,
      verdictReasons: plan.verdictReasons,
    },
    null,
    1
  );

  return { system, user };
}

const pointForModel = (p: SynthesisPoint) => ({ key: p.key, statement: p.statement });

/* ------------------------------------------------------------------ *
 * Parsing model output                                                *
 * ------------------------------------------------------------------ */

/**
 * Parses whatever the model returned, defensively.
 *
 * Returns null rather than throwing on anything malformed: a parse failure is
 * just another reason to fall back, and it must never surface as a 500 to a
 * customer who was only trying to read their report.
 */
export function parseRendering(raw: string | null | undefined): RenderedSection[] | null {
  if (!raw || typeof raw !== 'string') return null;

  // Models wrap JSON in ```json fences with some regularity.
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }

  const sections = (parsed as { sections?: unknown })?.sections;
  if (!Array.isArray(sections)) return null;

  const out: RenderedSection[] = [];
  for (const s of sections) {
    const sec = s as Record<string, unknown>;
    const key = typeof sec.sectionKey === 'string' ? sec.sectionKey : null;
    const text = typeof sec.text === 'string' ? sec.text.trim() : '';
    if (!key || !text) continue;
    const used = Array.isArray(sec.usedPointKeys)
      ? sec.usedPointKeys.filter((k): k is string => typeof k === 'string')
      : [];
    out.push({ sectionKey: key as SectionKey, text, usedPointKeys: used });
  }
  return out.length ? out : null;
}

/* ------------------------------------------------------------------ *
 * The deterministic rendering                                         *
 * ------------------------------------------------------------------ */

/**
 * Renders the plan without a model at all.
 *
 * This is the safety net, so it is built to pass validateRendering() by
 * construction: it only ever emits planned sections, only ever cites planned
 * point keys, and only ever prints statements the plan already contains. It
 * reads plainly rather than beautifully — which is the correct trade when the
 * alternative is unverified prose.
 */
export function renderDeterministic(plan: SynthesisPlan): RenderedSection[] {
  const sections: RenderedSection[] = [];

  for (const s of plan.sections) {
    if (!s.points.length) continue;
    sections.push({
      sectionKey: s.key,
      // Statements are already customer-language sentences produced by the
      // synthesis engine, so joining them is safe; nothing is reworded.
      text: s.points.map((p) => p.statement).join(' '),
      usedPointKeys: s.points.map((p) => p.key),
    });
  }

  // Conflicts must appear somewhere or validation fails. If the plan did not
  // already place them in a section, attach them to the section that exists
  // for exactly this purpose.
  const cited = new Set(sections.flatMap((s) => s.usedPointKeys));
  const missing = plan.conflicts.filter((c) => !cited.has(c.key));
  if (missing.length) {
    const target = sections.find((s) => s.sectionKey === 'OWNERSHIP') ?? sections[0];
    if (target) {
      target.text = `${target.text} ${missing.map((c) => c.statement).join(' ')}`.trim();
      target.usedPointKeys = [...target.usedPointKeys, ...missing.map((c) => c.key)];
    } else {
      sections.push({
        sectionKey: plan.sections[0]?.key ?? 'INTRO',
        text: missing.map((c) => c.statement).join(' '),
        usedPointKeys: missing.map((c) => c.key),
      });
    }
  }

  return sections;
}

/* ------------------------------------------------------------------ *
 * The gate                                                            *
 * ------------------------------------------------------------------ */

/**
 * Turns raw model output into something safe to show.
 *
 * Called with `raw = null` when no model was available at all, which yields
 * the deterministic rendering — so the report always exists, with or without
 * an LLM, and an outage degrades the prose rather than the product.
 */
export function finalizeRendering(plan: SynthesisPlan, raw: string | null | undefined): FinalRendering {
  const base = {
    verdict: plan.verdict,
    verdictReasons: plan.verdictReasons,
  };

  const parsed = parseRendering(raw);
  if (!parsed) {
    return {
      ...base,
      sections: renderDeterministic(plan),
      mode: 'DETERMINISTIC',
      rejectedBecause: raw ? ['model output was not parseable JSON'] : [],
    };
  }

  const check = validateRendering(plan, parsed);
  if (!check.ok) {
    return { ...base, sections: renderDeterministic(plan), mode: 'DETERMINISTIC', rejectedBecause: check.problems };
  }

  return { ...base, sections: parsed, mode: 'MODEL', rejectedBecause: [] };
}
