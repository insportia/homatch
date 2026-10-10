/*
 * THE REGISTER FROM THE BUYER'S OWN EARLIER CHECK.
 *
 * Job 220ed087's Service 176 task was cancelled (the NUL-byte bug, since
 * fixed), so its own result holds no extract — while two earlier jobs of the
 * SAME user for the SAME exact cadastral code hold the unit's extract. The
 * report then asked the buyer to fetch a document Verify already had.
 *
 * When the job's own register is empty, the newest earlier COMPLETE job of
 * the same user and the same exact code that yields a register is used, and
 * the report says so ("based on the registry extract retrieved on <date> in
 * your earlier check"). The caller bounds and scopes the query (same user_id,
 * ≤ 5 candidates, never cross-user); this module only chooses and merges, and
 * re-checks the code exactly against the extract's own search.
 */

import { buildPropertyRegister, type PropertyRegister } from './propertyRegister.ts';

export interface RegisterSource {
  /** The earlier job of the same user whose extract is used. */
  jobId: string;
  /** Date the extract was issued (the moment it describes). */
  asOf: string | null;
  reused: true;
}

export interface RegisterCandidate {
  id: string;
  completedAt: string | null;
  browserOfficial: unknown;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
export const normCode = (v: unknown): string => String(v ?? '').replace(/\s+/g, '').trim();

/** The exact unit code a job was about. */
export function targetCadastralCode(resultJson: unknown, query?: string | null): string | null {
  const r = obj(resultJson);
  const code = normCode(obj(r.exactUnit).code ?? obj(r.exactUnit).cadastralCode ?? query);
  return /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}\.\d{2}\.\d{3})?$/.test(code) ? code : null;
}

/** True when the job's own result already yields a register with an extract. */
export function hasOwnRegister(resultJson: unknown): boolean {
  try {
    return !!buildPropertyRegister(obj(resultJson).browserOfficial)?.latest;
  } catch {
    return false;
  }
}

/**
 * The newest candidate whose register is for exactly `code`, merged into the
 * job's result (its own mygov results replaced), or null.
 */
export function reuseEarlierRegister(
  resultJson: unknown,
  code: string | null,
  candidates: RegisterCandidate[],
): { resultJson: Record<string, any>; register: PropertyRegister; registerSource: RegisterSource } | null {
  if (!code) return null;
  const sorted = [...candidates].sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''))).slice(0, 5);
  for (const c of sorted) {
    let reg: PropertyRegister | null = null;
    try {
      reg = buildPropertyRegister(c.browserOfficial);
    } catch {
      reg = null;
    }
    if (!reg?.latest || normCode(reg.cadastralCode) !== normCode(code)) continue;
    const r = obj(resultJson);
    const own = obj(r.browserOfficial);
    const ownResults = Array.isArray(own.results) ? own.results : [];
    const theirs = (Array.isArray(obj(c.browserOfficial).results) ? obj(c.browserOfficial).results : []).filter((x: any) => x?.source === 'mygov');
    return {
      resultJson: { ...r, browserOfficial: { ...own, results: [...ownResults.filter((x: any) => x?.source !== 'mygov'), ...theirs] } },
      register: reg,
      registerSource: { jobId: c.id, asOf: reg.latest.issuedAt ? reg.latest.issuedAt.slice(0, 10) : null, reused: true },
    };
  }
  return null;
}
