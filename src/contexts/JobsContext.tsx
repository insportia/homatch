// HOMATCH — the job centre's brain, mounted above the router.
//
// WHY IT LIVES ABOVE THE ROUTES
//
// A component that owns a job dies when the customer navigates. Every product
// here used to do exactly that: VerifyPage held the poll timer, the case page
// held the document analysis promise, and leaving the page took the only
// thing watching the work with it. The work itself survived — research-agent
// has a pg_cron driver — but nothing could tell the customer so, which from
// their side is indistinguishable from it having stopped.
//
// This provider sits outside <Routes>. It is mounted once, for the life of
// the session, and it is the only thing in the application that watches jobs.
// Pages read from it. Navigating changes which page is rendered and nothing
// else.
//
// WHAT UNMOUNTING MEANS
//
// Nothing, to the backend. The cleanup below closes a realtime channel and
// clears a timer — it is the browser losing interest, never a cancellation
// (§30, §50). The one call in this file that stops anything is cancelJob(),
// which the customer has to press a button for, and which the server is free
// to refuse.
//
// REALTIME, WITH POLLING UNDERNEATH
//
// Supabase Realtime delivers state changes without polling. It is also a
// websocket, and websockets drop. So there is always a slow poll running
// underneath, and losing realtime degrades the refresh rate and nothing else
// (§46). Neither is load-bearing for the job: both are ways of LOOKING at a
// row that Postgres owns.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  listMyJobs, cancelJob as cancelJobRpc, getJob,
  type BackgroundJob, type CancelOutcome,
} from '@/services/backgroundJobs';
import { isTerminal } from '@/jobs/jobState';
import { reportError } from '@/lib/errorReporting';

/** Fast enough that a fifteen-second countdown stays honest. */
const ACTIVE_POLL_MS = 4000;
/** Nothing running: just enough to notice work started in another tab. */
const IDLE_POLL_MS = 30000;

export interface JobCompletion {
  job: BackgroundJob;
  /** Consumed once. A notification must not reappear on every re-render. */
  seenAt: number;
}

interface JobsContextValue {
  jobs: BackgroundJob[];
  activeJobs: BackgroundJob[];
  loading: boolean;
  /** Newly finished since this session started watching, newest first. */
  completions: JobCompletion[];
  dismissCompletion: (jobId: string) => void;
  refresh: () => Promise<void>;
  cancel: (jobId: string) => Promise<CancelOutcome>;
  /** Pull one job forward without waiting for the next tick. */
  track: (jobId: string) => Promise<void>;
  jobFor: (subjectType: string, subjectId: string) => BackgroundJob | null;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export const useJobs = (): JobsContextValue => {
  const ctx = useContext(JobsContext);
  if (!ctx) {
    // A hook that silently returns nothing outside its provider produces a UI
    // that is quietly always empty, which is far harder to find than a throw.
    throw new Error('useJobs must be used inside <JobsProvider>');
  }
  return ctx;
};

export const JobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // supaUser is the auth.users row; background_jobs.user_id is auth.uid(),
  // NOT public.users.id, so homatchUser would be the wrong key here.
  const { supaUser } = useAuth();
  const user = supaUser;
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [completions, setCompletions] = useState<JobCompletion[]>([]);
  const [open, setOpen] = useState(false);

  /** Jobs seen as non-terminal at least once, so a completion can be noticed
   *  exactly once. A job that was already finished on the first load is
   *  history, not news — announcing it would greet the customer with a toast
   *  for something they read yesterday. */
  const watched = useRef<Map<string, string>>(new Map());
  const firstLoadDone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const ingest = useCallback((next: BackgroundJob[]) => {
    setJobs(next);

    const newlyDone: BackgroundJob[] = [];
    for (const job of next) {
      const prev = watched.current.get(job.id);
      if (!isTerminal(job.state)) {
        watched.current.set(job.id, job.state);
        continue;
      }
      // Terminal now. News only if we had previously seen it running, or if
      // it appeared mid-session already finished (started in another tab).
      const wasRunning = prev !== undefined && !isTerminal(prev as BackgroundJob['state']);
      const appearedAfterFirstLoad = prev === undefined && firstLoadDone.current;
      if (wasRunning || appearedAfterFirstLoad) newlyDone.push(job);
      watched.current.set(job.id, job.state);
    }

    if (newlyDone.length) {
      setCompletions((cur) => {
        const known = new Set(cur.map((c) => c.job.id));
        const add = newlyDone.filter((j) => !known.has(j.id)).map((j) => ({ job: j, seenAt: Date.now() }));
        return add.length ? [...add, ...cur].slice(0, 20) : cur;
      });
    }

    firstLoadDone.current = true;
  }, []);

  const refresh = useCallback(async () => {
    if (!user || inFlight.current) return;
    inFlight.current = true;
    try {
      ingest(await listMyJobs());
    } catch (e) {
      // A failed read is a failed read. It says nothing about the jobs, so
      // the list is left exactly as it was rather than blanked.
      reportError(e, { boundary: 'JobsProvider.refresh' });
    } finally {
      inFlight.current = false;
    }
  }, [user, ingest]);

  /*
   * THE ONLY LOOP.
   *
   * Rescheduled from its own completion rather than set on an interval, so a
   * slow response cannot stack requests behind it. The cadence follows what
   * is actually running: four seconds while a countdown is on screen, thirty
   * when there is nothing to watch.
   */
  useEffect(() => {
    if (!user) {
      setJobs([]);
      setCompletions([]);
      watched.current.clear();
      firstLoadDone.current = false;
      return;
    }

    let alive = true;
    setLoading(true);

    const tick = async () => {
      if (!alive) return;
      await refresh();
      if (!alive) return;
      setLoading(false);
      const anyActive = jobsRef.current.some((j) => !isTerminal(j.state));
      timer.current = setTimeout(tick, anyActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };

    void tick();

    return () => {
      // Stops US watching. Stops nothing server-side.
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [user, refresh]);

  // Read inside the timer without making the timer depend on the list.
  const jobsRef = useRef<BackgroundJob[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  /*
   * REALTIME.
   *
   * An accelerator, never the mechanism. RLS applies to the stream, so this
   * subscription can only ever deliver the customer's own rows; the filter is
   * belt and braces and a smaller payload.
   */
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`background_jobs:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'background_jobs', filter: `user_id=eq.${user.id}` },
        () => {
          // Re-read rather than trusting the payload: `state` and `canCancel`
          // are derived from the clock by background_job_public(), and a raw
          // row does not carry either.
          void refresh();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  const cancel = useCallback(async (jobId: string): Promise<CancelOutcome> => {
    try {
      const outcome = await cancelJobRpc(jobId);
      await refresh();
      return outcome;
    } catch (e) {
      reportError(e, { subjectType: 'BACKGROUND_JOB', subjectId: jobId, boundary: 'cancelJob' });
      return { ok: false, reason: 'NOT_FOUND' };
    }
  }, [refresh]);

  const track = useCallback(async (jobId: string) => {
    try {
      const job = await getJob(jobId);
      if (!job) return;
      setJobs((cur) => {
        const i = cur.findIndex((j) => j.id === job.id);
        if (i === -1) return [job, ...cur];
        const next = [...cur];
        next[i] = job;
        return next;
      });
      watched.current.set(job.id, job.state);
    } catch (e) {
      reportError(e, { subjectType: 'BACKGROUND_JOB', subjectId: jobId, boundary: 'trackJob' });
    }
  }, []);

  const dismissCompletion = useCallback((jobId: string) => {
    setCompletions((cur) => cur.filter((c) => c.job.id !== jobId));
  }, []);

  const jobFor = useCallback(
    (subjectType: string, subjectId: string): BackgroundJob | null =>
      jobs.find((j) => j.subjectType === subjectType && j.subjectId === subjectId) ?? null,
    [jobs]
  );

  const activeJobs = useMemo(() => jobs.filter((j) => !isTerminal(j.state)), [jobs]);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs, activeJobs, loading, completions, dismissCompletion,
      refresh, cancel, track, jobFor, open, setOpen,
    }),
    [jobs, activeJobs, loading, completions, dismissCompletion, refresh, cancel, track, jobFor, open]
  );

  // This provider holds state and renders no text of its own — every sentence
  // the customer reads belongs to the job centre.

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
};
