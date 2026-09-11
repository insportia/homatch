// HOMATCH — the one way to read a Verify result.
//
// Every screen that shows a verification goes through here: the Verification
// Centre, the case page, the job centre's "open result" link. They used to
// each call verify-synthesis directly and interpret the answer themselves,
// which is how two of them ended up interpreting it differently and one of
// them crashed (see verify/resultNormalizer.ts for the full account).
//
// What this adds on top of the normaliser is the JOB, which the payload alone
// cannot tell you about. A synthesis that returns nothing means one thing if
// the research finished and something completely different if it is still
// running — and the difference decides whether the customer sees "no source
// could be reached" or a progress bar.

import { supabase } from '@/db/supabase';
import {
  normalizeVerifyResult,
  type NormalizedVerifyResult,
} from '@/verify/resultNormalizer';
import { reportError } from '@/lib/errorReporting';

/** What the result screens need about the run itself. */
export interface VerifyJobFacts {
  id: string;
  status: string;
  stage: string;
  cancelledAt: string | null;
  createdAt: string | null;
  completedAt: string | null;
  synthesisState: string;
}

export async function getVerifyJobFacts(jobId: string): Promise<VerifyJobFacts | null> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select('id,status,stage,cancelled_at,created_at,completed_at,synthesis_state')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    status: (data.status as string) ?? '',
    stage: (data.stage as string) ?? '',
    cancelledAt: (data.cancelled_at as string | null) ?? null,
    createdAt: (data.created_at as string | null) ?? null,
    completedAt: (data.completed_at as string | null) ?? null,
    synthesisState: (data.synthesis_state as string) ?? 'NONE',
  };
}

/**
 * Fetch and canonicalise one verification result.
 *
 * Never throws. Every failure path — the job is gone, RLS says it is not
 * theirs, the function 500s, the network drops — comes back as a normalised
 * result carrying a translation key, because the caller is a render path and
 * a render path that has to try/catch is a render path that will forget to.
 *
 * NOTHING HERE CANCELS ANYTHING. `signal` aborts our READ of the result. The
 * verification itself is server-side work that continues regardless (PART C
 * §30, §50) — a component unmounting is the browser losing interest, not the
 * customer changing their mind.
 */
export async function loadVerifyResult(
  jobId: string,
  opts?: { force?: boolean; signal?: AbortSignal }
): Promise<NormalizedVerifyResult> {
  let facts: VerifyJobFacts | null = null;
  try {
    facts = await getVerifyJobFacts(jobId);
  } catch (e) {
    reportError(e, { subjectType: 'RESEARCH_JOB', subjectId: jobId, boundary: 'getVerifyJobFacts' });
  }

  if (opts?.signal?.aborted) {
    return normalizeVerifyResult({ raw: null, jobStatus: facts?.status, cancelledAt: facts?.cancelledAt });
  }

  // A job that has not finished has nothing persisted to read, and asking
  // verify-synthesis for one would make it build a report out of a half-
  // gathered evidence package. The progress screen is the right answer.
  const researchFinished = (facts?.status ?? '').toUpperCase() === 'COMPLETE';
  if (facts && !researchFinished) {
    return normalizeVerifyResult({
      raw: null,
      jobStatus: facts.status,
      cancelledAt: facts.cancelledAt,
    });
  }

  try {
    const { data, error } = await supabase.functions.invoke('verify-synthesis', {
      body: { jobId, ...(opts?.force ? { force: true } : {}) },
    });
    if (error) throw error;
    const normalized = normalizeVerifyResult({
      raw: data,
      jobStatus: facts?.status ?? 'COMPLETE',
      cancelledAt: facts?.cancelledAt,
    });
    // A payload that arrived in an older contract still renders, but it is
    // worth knowing how much of that is still out there.
    if (normalized.payloadVersion === 'V1' || normalized.payloadVersion === 'V2') {
      reportError(new Error(`legacy verify payload ${normalized.payloadVersion}`), {
        subjectType: 'RESEARCH_JOB',
        subjectId: jobId,
        payloadVersion: normalized.payloadVersion,
        stage: facts?.stage ?? null,
      });
    }
    return normalized;
  } catch (e) {
    reportError(e, {
      subjectType: 'RESEARCH_JOB',
      subjectId: jobId,
      stage: facts?.stage ?? null,
      boundary: 'verify-synthesis',
    });
    return normalizeVerifyResult({
      raw: null,
      jobStatus: facts?.status ?? 'COMPLETE',
      cancelledAt: facts?.cancelledAt,
      fetchFailed: true,
      technicalDetail: e instanceof Error ? e.message : String(e),
    });
  }
}
