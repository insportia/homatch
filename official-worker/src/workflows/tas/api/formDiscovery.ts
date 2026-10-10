// formDiscovery.ts — best-effort, read-only capture of a priority case's
// public APPLICATION FORM (application fields, named professionals,
// technical indicators, status text).
//
// NOT VERIFIED LIVE (see CONTRACT.md). The detail call this worker relies on
// (UserMethods.getUserDocumentLastMotion) returned no form fields in
// production (job 220ed087). The public case page is
// /architect/public.html?docId=<id>; it loads DWR interface scripts
// (/architect/dwr/interface/*.js) that declare which remote methods exist.
// This module reads that page and those scripts, records the method names,
// and — only if a method whose NAME clearly reads one document / form /
// values by id exists — calls it once with the documentId.
//
// Strict bounds: ≤ 3 HTTP requests per priority case (no retries; page and
// scripts are fetched once per run and shared), the client's politeness gap
// and timeouts, and every failure is a status, never an exception.

import { createHash } from 'node:crypto';
import { TasApiClient, TasDeadline, publicDocumentUrl } from './TasApiClient.js';
import { dwr, toPlain } from './dwr.js';
import { bytesToBuffer, extractLabelValuePairs, type TasValue } from './tasModel.js';
import { findInterfaceScripts, parseDwrInterface, parseUrl, pickFormMethod, type DwrMethodInfo } from './priority.js';
import { sanitizeGraph } from './privacy.js';

export const FORM_REQUESTS_PER_CASE = 3;

export type FormStatus = 'CAPTURED' | 'NOT_AVAILABLE' | 'FAILED' | 'DISABLED';

export interface FormCapture {
  status: FormStatus;
  fields: TasValue[];
  fieldsDiscovered: number;
  /** `Script.method` that was called, or null. */
  method: string | null;
  /** sha256 of the sanitized raw reply (stored as evidence by the queue executor). */
  rawSha256?: string;
  reason: string | null;
  requests: number;
}

/** Shared across the priority cases of ONE run. */
export interface FormDiscoveryState {
  enabled: boolean;
  pageUrl: string | null;
  pageStatus: number | null;
  pageError: string | null;
  interfaceScripts: string[];
  scriptsFetched: string[];
  methods: DwrMethodInfo[];
  chosen: string | null;
  requests: number;
}

export function newFormDiscoveryState(enabled: boolean): FormDiscoveryState {
  return { enabled, pageUrl: null, pageStatus: null, pageError: null, interfaceScripts: [], scriptsFetched: [], methods: [], chosen: null, requests: 0 };
}

/** Diagnostics for the result: method NAMES only. */
export function formDiscoveryDiagnostics(s: FormDiscoveryState) {
  return {
    enabled: s.enabled,
    pageUrl: s.pageUrl,
    pageStatus: s.pageStatus,
    pageError: s.pageError,
    interfaceScripts: s.interfaceScripts.map((u) => parseUrl(u).pathname),
    scriptsFetched: s.scriptsFetched.map((u) => parseUrl(u).pathname),
    methods: s.methods.map((m) => `${m.script}.${m.method}/${m.arity}`).slice(0, 200),
    chosen: s.chosen,
    requests: s.requests,
    verified: false as const,
  };
}

const scriptRank = (u: string) => {
  const n = parseUrl(u).pathname.split('/').pop() ?? '';
  return /public/i.test(n) ? 0 : /doc/i.test(n) ? 1 : /form/i.test(n) ? 2 : /UserMethods/i.test(n) ? 4 : 3;
};

/**
 * One priority case's form capture. Never throws. `raw` is the sanitized
 * reply (personal ids masked, phones/e-mails removed) for evidence storage.
 */
export async function captureCaseForm(client: TasApiClient, documentId: string, s: FormDiscoveryState): Promise<FormCapture & { raw?: { sha256: string; json: string } }> {
  const base = { fields: [] as TasValue[], fieldsDiscovered: 0, method: null as string | null, reason: null as string | null, requests: 0 };
  if (!s.enabled) return { ...base, status: 'DISABLED', reason: 'TAS_FORM_DISCOVERY=false' };
  let budget = FORM_REQUESTS_PER_CASE;
  const spend = () => {
    budget--;
    base.requests++;
    s.requests++;
  };
  try {
    if (s.pageUrl === null) {
      s.pageUrl = publicDocumentUrl(documentId);
      spend();
      const r = await client.request(s.pageUrl, { headers: { Accept: 'text/html' } }, { retries: 0 });
      s.pageStatus = r.status;
      if (r.status < 200 || r.status >= 300) s.pageError = `PAGE_HTTP_${r.status}`;
      else s.interfaceScripts = findInterfaceScripts(bytesToBuffer(r.bytes).toString('utf8'), s.pageUrl).sort((a, b) => scriptRank(a) - scriptRank(b) || a.localeCompare(b));
    }
    if (s.pageError) return { ...base, status: 'FAILED', reason: s.pageError };
    let chosen: DwrMethodInfo | null = pickFormMethod(s.methods);
    while (!chosen && budget > 1) {
      const next = s.interfaceScripts.find((u) => !s.scriptsFetched.includes(u));
      if (!next) break;
      s.scriptsFetched.push(next);
      spend();
      const r = await client.request(next, { headers: { Accept: 'application/javascript' } }, { retries: 0 });
      if (r.status >= 200 && r.status < 300) {
        const hint = (parseUrl(next).pathname.split('/').pop() ?? '').replace(/\.js$/, '');
        for (const m of parseDwrInterface(bytesToBuffer(r.bytes).toString('utf8'), hint))
          if (!s.methods.some((x) => x.script === m.script && x.method === m.method)) s.methods.push(m);
      }
      chosen = pickFormMethod(s.methods);
    }
    if (!chosen) {
      const pending = s.interfaceScripts.some((u) => !s.scriptsFetched.includes(u));
      return { ...base, status: 'NOT_AVAILABLE', reason: !s.interfaceScripts.length ? 'NO_INTERFACE_SCRIPTS' : pending ? 'DISCOVERY_BUDGET_EXHAUSTED' : 'NO_READ_METHOD' };
    }
    s.chosen = `${chosen.script}.${chosen.method}`;
    spend();
    const reply = await client.dwrCall(
      `/architect/dwr/call/plaincall/${chosen.script}.${chosen.method}.dwr`, chosen.script, chosen.method,
      [dwr.str(String(documentId))], `/architect/public.html?docId=${documentId}`, { retries: 0 },
    );
    const pairs = extractLabelValuePairs(reply.data, 'form');
    const json = JSON.stringify(sanitizeGraph(toPlain(reply.data)));
    const sha = createHash('sha256').update(json).digest('hex');
    return {
      ...base,
      method: s.chosen,
      status: pairs.values.length ? 'CAPTURED' : 'NOT_AVAILABLE',
      reason: pairs.values.length ? null : 'NO_FIELDS_IN_REPLY',
      fields: pairs.values,
      fieldsDiscovered: pairs.discovered,
      rawSha256: sha,
      raw: json.length <= 2_000_000 ? { sha256: sha, json } : undefined,
    };
  } catch (e) {
    return { ...base, method: s.chosen, status: 'FAILED', reason: e instanceof TasDeadline ? 'RUN_DEADLINE' : String((e as Error)?.message ?? e).slice(0, 160) };
  }
}
