// Runs the labelled evaluation set through the same deterministic chain the pipeline uses
// (classifyDemand → qualify → buyer-intent gate). No model call, no network, no Actor run:
// it measures the rules, not the optional OpenAI tie-breaker for undecided posts.
import { buildPropertyDna } from '../../findBuyers/propertyDna.ts';
import { classifyDemand } from '../../findBuyers/demandClassifier.ts';
import { qualify } from '../../findBuyers/qualify.ts';
import { classifyBuyerIntent } from '../../findBuyers/buyerIntent.ts';
import { PROPERTIES, CASES } from './findBuyersEvalSet.mjs';

export function judge(c) {
  const dna = buildPropertyDna(PROPERTIES[c.property]);
  const reading = classifyDemand(c.text);
  let q = qualify(reading, dna, { ageDays: c.ageDays ?? 2, duplicate: Boolean(c.duplicate) });
  const intent = classifyBuyerIntent({ text: c.text, kind: 'POST', reading });
  /* pipeline.ts gateIntent: no intent → rejected; an interest signal is never above POTENTIAL. */
  if (intent.resultType === 'EXCLUDED' && q.category !== 'REJECTED') q = { ...q, category: 'REJECTED', reasons: [...q.reasons, 'INTENT_EXCLUDED'] };
  if (intent.resultType === 'INTEREST') {
    const onlyUnclear = q.category === 'REJECTED' && q.reasons.every((r) => r === 'UNCLEAR_INTENT');
    q = { ...q, category: onlyUnclear ? 'WEAK' : q.category === 'STRONG' ? 'POTENTIAL' : q.category, reasons: onlyUnclear ? [] : q.reasons };
  }
  return { ...c, category: q.category, reasons: q.reasons, limitations: q.limitations, role: reading.role, accepted: q.category !== 'REJECTED' };
}

export function evaluate(cases = CASES) {
  const rows = cases.map(judge);
  const tp = rows.filter((r) => r.label === 'accept' && r.accepted).length;
  const fp = rows.filter((r) => r.label === 'reject' && r.accepted).length;
  const fn = rows.filter((r) => r.label === 'accept' && !r.accepted).length;
  const tn = rows.filter((r) => r.label === 'reject' && !r.accepted).length;
  const strong = rows.filter((r) => r.category === 'STRONG');
  const strongWrong = strong.filter((r) => r.label !== 'accept' || r.strongOk === false);
  return {
    size: rows.length, accepts: tp + fn, rejects: fp + tn, tp, fp, fn, tn,
    precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1,
    strong: strong.length, strongPrecision: strong.length ? (strong.length - strongWrong.length) / strong.length : 1,
    misses: rows.filter((r) => (r.label === 'accept') !== r.accepted || (r.category === 'STRONG' && r.strongOk === false)),
    rows,
  };
}
