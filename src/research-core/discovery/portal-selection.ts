// PHASE 2 — which live portals a FIND PROPERTY run may plan.
//
// A portal job names an adapter, and supply-discovery's `portal-job` mode
// executes it by finding THAT id in the portal runtime's registry
// (`runtime.registry.all()`), after checking the source registry holds it
// LIVE_TESTED/PRODUCTIVE and active. So the ids a run may plan are exactly the
// runtime's adapter ids, intersected with what the source registry has live.
//
// They are NOT the ids of PORTAL_SOURCES. That list describes every source in
// one shape for the registry and the admin area, and for home.ss.ge it says
// `home-ss-ge` -- while the adapter that actually reads ss.ge (ss-ge.ts, kept
// as it was verified) is `ss-ge`, which is also what source_registry and every
// stored observation say. Selecting against PORTAL_SOURCES silently dropped
// ss.ge from every Find Property run. The runtime is the one place that both
// names and executes an adapter, so it is the one list consulted here.

import { createPortalRuntime } from '../market/runtime.ts';

let cachedIds: string[] | null = null;

/** The adapter ids the portal runtime can execute. Building it touches no network. */
export function runtimePortalAdapterIds(): string[] {
  if (!cachedIds) cachedIds = createPortalRuntime().registry.all().map((adapter) => adapter.id);
  return [...cachedIds];
}

/**
 * The live portals a run may plan: registry ids (in the registry's priority
 * order, first occurrence kept) that the runtime can execute. Forum and
 * Telegram rows of the same registry are other source classes and drop out.
 */
export function livePortalAdaptersFor(
  registryAdapterIds: readonly (string | null | undefined)[],
  executable: readonly string[] = runtimePortalAdapterIds(),
): string[] {
  const known = new Set(executable);
  const picked: string[] = [];
  for (const raw of registryAdapterIds) {
    const id = String(raw ?? '');
    if (id && known.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
