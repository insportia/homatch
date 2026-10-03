// THE 3D WALKTHROUGH — the server makes it; the page asks and follows.
//
//   design-studio-reconstruct/walkthrough-create  one walkthrough per design (asking twice is the same one)
//   design-studio-reconstruct/walkthrough-status  its real state (and a due step is taken)
//   design-studio-reconstruct/walkthrough-retry   a failed one, resumed from what was already done
//
// Nothing here keeps the work alive: it carries on with the page closed.

import { supabase } from '@/db/supabase';
import type { ProgressStep } from '@/lib/designStudio/walkthrough/lifecycle';

export interface Walkthrough {
  id: string;
  designVersionId: string;
  revision: number;
  state: 'QUEUED' | 'PLANNING' | 'SUBMITTED' | 'RUNNING' | 'PROCESSING_RESULT' | 'READY' | 'FAILED' | 'CANCELLED';
  progress: ProgressStep | 'FAILED' | 'CANCELLED';
  stage: string | null;
  /** The walkable design (a version of this project), once READY. */
  walkVersionId: string | null;
  error: string | null;
  retryable: boolean;
  createdAt: string;
  readyAt: string | null;
}

async function call<T>(route: string, body: Record<string, unknown>): Promise<{ data: T | null; code: string | null }> {
  const { data, error } = await supabase.functions.invoke(`design-studio-reconstruct/${route}`, { body });
  if (!error) return { data: data as T, code: null };
  let code: string | null = null;
  try { code = (await (error as { context?: Response }).context?.json?.())?.error ?? null; } catch { /* no body */ }
  return { data: null, code: code ?? 'NETWORK' };
}

export async function createWalkthrough(input: { designVersionId: string; renderId?: string | null; newRevision?: boolean; name?: string }) {
  const r = await call<{ walkthrough: Walkthrough; created: boolean }>('walkthrough-create', input as unknown as Record<string, unknown>);
  return { walkthrough: r.data?.walkthrough ?? null, error: r.code };
}

export async function walkthroughStatus(input: { walkthroughId?: string; designVersionId?: string }) {
  const r = await call<{ walkthrough: Walkthrough | null; history: Walkthrough[] }>('walkthrough-status', input as Record<string, unknown>);
  return { walkthrough: r.data?.walkthrough ?? null, history: r.data?.history ?? [], error: r.code };
}

export async function retryWalkthrough(walkthroughId: string) {
  const r = await call<{ walkthrough: Walkthrough }>('walkthrough-retry', { walkthroughId });
  return { walkthrough: r.data?.walkthrough ?? null, error: r.code };
}

export const walkthroughHref = (projectId: string, walkVersionId: string) => `/design-studio/${projectId}/walkthrough/${walkVersionId}`;
