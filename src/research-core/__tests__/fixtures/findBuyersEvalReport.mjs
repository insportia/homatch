#!/usr/bin/env node
// Prints the Find Buyers offline evaluation: precision / recall on the labelled set and the
// VILLION production baseline. Rules only — no model call, no network, no Actor run, no cost.
import { readFileSync } from 'node:fs';
import { evaluate } from './findBuyersEvalRunner.mjs';
import { buildPropertyDna } from '../../findBuyers/propertyDna.ts';
import { requalifyLeads } from '../../findBuyers/requalify.ts';

const r = evaluate();
console.log(`Labelled set: ${r.size} posts (${r.accepts} accept / ${r.rejects} reject)`);
console.log(`  precision ${r.precision.toFixed(3)}  recall ${r.recall.toFixed(3)}  TP ${r.tp} FP ${r.fp} FN ${r.fn} TN ${r.tn}`);
console.log(`  STRONG ${r.strong}, precision ${r.strongPrecision.toFixed(3)}`);
for (const m of r.misses) console.log(`  MISS ${m.label} ${m.property}: ${m.text} → ${m.category} ${m.reasons.join(',')}`);

const fx = JSON.parse(readFileSync(new URL('./villionCampaignLeads.json', import.meta.url), 'utf8'));
const rows = requalifyLeads(fx.leads.map((l) => ({ id: String(l.n), text: l.text, publishedAt: l.at, url: l.url, author: l.author ?? null })), buildPropertyDna(fx.property), { now: Date.parse(fx.campaign.evaluatedAt) });
const byN = new Map(rows.map((x) => [Number(x.id), x]));
const agree = fx.leads.filter((l) => byN.get(l.n)?.qualification.category === l.expected.category).length;
console.log(`VILLION production baseline: ${agree}/${fx.leads.length} posts match their hand label`);
