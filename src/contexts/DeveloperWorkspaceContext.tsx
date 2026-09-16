import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listMyWorkspaces, claimPendingInvites, isStudioStaff, type MembershipSummary,
} from '@/services/developer/workspace';
import { roleCan } from '@/services/developer/types';
import type { DevWorkspace, DevRole, DevCapability } from '@/services/developer/types';

/**
 * WHICH COMPANY AM I LOOKING AT, AND WHAT AM I ALLOWED TO DO IN IT.
 *
 * Two things live here because every screen in Homatch for Developers needs
 * both on its first render, and fetching them per page would mean a sales
 * agent's own permissions arriving after the buttons they are supposed to
 * hide.
 *
 * `can()` DECIDES NOTHING. It is the same capability matrix as public.dev_can,
 * kept here so the interface does not offer a person an action the server
 * will refuse — a dead button with an error behind it is worse than no
 * button. The server is still the only thing that enforces it; if these two
 * ever disagree, the database wins and the person sees a clear refusal.
 *
 * The selected workspace is remembered per device in localStorage, because
 * somebody who runs two developers should not have to re-pick every morning.
 * It is validated against the memberships actually returned before being used,
 * so a stale id from a workspace they were removed from cannot select
 * anything.
 */

const STORAGE_KEY = 'homatch-developer-workspace';

interface DeveloperWorkspaceValue {
  loading: boolean;
  error: string | null;
  memberships: MembershipSummary[];
  workspace: DevWorkspace | null;
  role: DevRole | null;
  can: (capability: DevCapability) => boolean;
  /**
   * Homatch staff, not a developer role.
   *
   * The 3D twin is built and published by Homatch; a developer maintains
   * prices and availability. This flag decides whether the interface OFFERS
   * those technical controls at all — the server refuses them regardless
   * (dev_is_studio()), so this only stops us showing a button that would
   * fail.
   */
  isStudio: boolean;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
  /** True when the account is signed in and belongs to no workspace at all. */
  needsOnboarding: boolean;
}

const DeveloperWorkspaceContext = createContext<DeveloperWorkspaceValue | null>(null);

export function DeveloperWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { homatchUser, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<MembershipSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studio, setStudio] = useState(false);

  const load = useCallback(async () => {
    if (!homatchUser) {
      setMemberships([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // An invitation may have been sent after this person already had an
      // account, so claiming cannot happen only at sign-up. It is a no-op
      // when there is nothing pending.
      await claimPendingInvites();
      // Scoped to THIS account's own membership rows — see listMyWorkspaces.
      const rows = await listMyWorkspaces(homatchUser.id);
      setStudio(await isStudioStaff());
      setMemberships(rows);

      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        // Private browsing. The first workspace is selected instead, which is
        // the same thing that happens on a new device.
        stored = null;
      }
      const valid = rows.some((m) => m.workspace.id === stored);
      setSelectedId(valid ? stored : (rows[0]?.workspace.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const selectWorkspace = useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Remembering the choice is a convenience; failing to remember it must
      // not stop the person from making it.
    }
  }, []);

  const current = useMemo(
    () => memberships.find((m) => m.workspace.id === selectedId) ?? null,
    [memberships, selectedId],
  );

  const can = useCallback(
    (capability: DevCapability) => roleCan(current?.role ?? null, capability),
    [current],
  );

  const value = useMemo<DeveloperWorkspaceValue>(() => ({
    loading: loading || authLoading,
    error,
    memberships,
    workspace: current?.workspace ?? null,
    role: current?.role ?? null,
    can,
    isStudio: studio,
    selectWorkspace,
    refresh: load,
    needsOnboarding: !authLoading && !loading && Boolean(homatchUser) && memberships.length === 0,
  }), [loading, authLoading, error, memberships, current, can, studio, selectWorkspace, load, homatchUser]);

  return (
    <DeveloperWorkspaceContext.Provider value={value}>
      {children}
    </DeveloperWorkspaceContext.Provider>
  );
}

export function useDeveloperWorkspace(): DeveloperWorkspaceValue {
  const ctx = useContext(DeveloperWorkspaceContext);
  if (!ctx) {
    throw new Error('useDeveloperWorkspace must be used inside DeveloperWorkspaceProvider');
  }
  return ctx;
}

/**
 * The workspace id, for the many screens that cannot render without one.
 * Returns null while loading rather than throwing, so a page can show its
 * skeleton instead of an error boundary.
 */
export function useWorkspaceId(): string | null {
  return useDeveloperWorkspace().workspace?.id ?? null;
}
