#!/usr/bin/env node
/*
 * EDGE BOOT SMOKE: DID EVERY CRITICAL FUNCTION'S MODULE ACTUALLY BOOT?
 *
 * Production 2026-10-29: verify-synthesis was deployed, proven byte-exact
 * (PROVEN_EXACT), and could not boot: it imported an export that did not
 * exist, so every call answered 503 BOOT_ERROR and the report of job 674df06e
 * was never written. The artifact proof asks "is production running this
 * revision?"; this asks the other question, "does that revision start?".
 *
 * One CORS preflight (OPTIONS) per function, with the public anon key so the
 * gateway's JWT check lets the request reach the worker. Every critical
 * function answers OPTIONS before it reads a body, a user or a secret, so this
 * is free and has no side effects: no paid call, no write, no notification.
 * A function without a preflight branch (a webhook) answers 405, which is
 * just as good: the module booted and ran its handler.
 *
 *   BOOTED        any status below 500 that is not the gateway's own 401
 *   BOOT_ERROR    5xx whose body names a boot failure (BOOT_ERROR, "failed to
 *                 boot", InvalidWorkerCreation, a missing export)
 *   SERVER_ERROR  any other 5xx, after retries
 *   NOT_DEPLOYED  404 (no such function)
 *   UNPROVEN      the gateway refused before the worker (no / invalid key)
 *   UNREACHABLE   network failure or timeout, after retries
 *
 * Exit 1 unless every function is BOOTED. Writes a table to
 * $GITHUB_STEP_SUMMARY when set. Usage:
 *   node scripts/release/edgeBootSmoke.mjs [fn ...]
 *   env SUPABASE_PROJECT_REF, SUPABASE_ANON_KEY (public anon key)
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Functions a customer or the money path cannot live without. */
export const CRITICAL_FUNCTIONS = [
  'verify-synthesis',
  'research-agent',
  'homatch-ai',
  'saas-checkout',
  'saas-payments-webhook',
  'marketplace-search',
  'deal-room-document-analyze',
  'jobs-worker',
  'atomic-unlock',
  'homi-voice-transcribe',
];

const BOOT_FAILURE = /BOOT_ERROR|worker failed to boot|failed to boot|InvalidWorkerCreation|does not provide an export|Uncaught SyntaxError|Module not found/i;
const GATEWAY_401 = /Missing authorization header|Invalid JWT|invalid claim|JWSError|No API key found/i;

/** One answer, classified. Pure. */
export function classifyBoot(status, body = '') {
  const text = String(body ?? '');
  if (!Number.isFinite(status) || status <= 0) return 'UNREACHABLE';
  if (status >= 500) return BOOT_FAILURE.test(text) ? 'BOOT_ERROR' : 'SERVER_ERROR';
  if (status === 404) return 'NOT_DEPLOYED';
  if (status === 401 && GATEWAY_401.test(text)) return 'UNPROVEN';
  return 'BOOTED';
}

/** Worth asking again: a cold start or a transient platform error, never a boot failure. */
export const retryable = (verdict) => verdict === 'SERVER_ERROR' || verdict === 'UNREACHABLE';

export async function probe(url, fn, { anonKey, attempts = 3, spacingMs = 5000, timeoutMs = 20000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = { fn, verdict: 'UNREACHABLE', status: 0, body: '', tries: 0 };
  for (let i = 1; i <= attempts; i++) {
    let status = 0;
    let body = '';
    try {
      const headers = { Origin: 'https://homatch.live', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,apikey' };
      if (anonKey) Object.assign(headers, { apikey: anonKey, Authorization: `Bearer ${anonKey}` });
      const res = await fetchImpl(`${url}/functions/v1/${fn}`, { method: 'OPTIONS', headers, signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      body = (await res.text().catch(() => '')).slice(0, 300);
    } catch (e) {
      body = String(e?.message ?? e).slice(0, 300);
    }
    const verdict = classifyBoot(status, body);
    last = { fn, verdict, status, body, tries: i };
    if (!retryable(verdict)) return last;
    if (i < attempts) await sleep(spacingMs);
  }
  return last;
}

export function summaryMarkdown(results) {
  const bad = results.filter((r) => r.verdict !== 'BOOTED');
  const lines = [
    `### Edge boot smoke: ${bad.length ? `FAILED (${bad.length} of ${results.length} did not boot)` : `all ${results.length} booted`}`,
    '',
    '| Function | Verdict | HTTP | Tries | Body |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| \`${r.fn}\` | ${r.verdict === 'BOOTED' ? 'BOOTED' : `**${r.verdict}**`} | ${r.status || '—'} | ${r.tries} | ${r.verdict === 'BOOTED' ? '' : String(r.body).replace(/[|\n\r]/g, ' ').slice(0, 120)} |`),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF || 'ptxajsjhobhvsfhmutjn';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const fns = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = fns.length ? fns : CRITICAL_FUNCTIONS;
  if (!anonKey) console.log('::warning::SUPABASE_ANON_KEY is not set: JWT-verified functions will be UNPROVEN (the gateway answers before the worker).');
  const url = `https://${ref}.supabase.co`;
  const results = [];
  for (const fn of list) {
    const r = await probe(url, fn, { anonKey });
    console.log(`${r.verdict.padEnd(12)} ${String(r.status).padStart(3)}  ${fn}${r.verdict === 'BOOTED' ? '' : `  ${r.body.slice(0, 160)}`}`);
    results.push(r);
  }
  const md = summaryMarkdown(results);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  const bad = results.filter((r) => r.verdict !== 'BOOTED');
  for (const r of bad) console.log(`::error::Edge function ${r.fn} did not boot: ${r.verdict} (HTTP ${r.status || 'none'}) ${r.body.slice(0, 160)}`);
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  await main();
}
