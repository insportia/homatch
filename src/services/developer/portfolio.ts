import { listProjects, listUnits } from './inventory';
import type { DevProject, UnitStatus } from './types';

/**
 * THE PORTFOLIO, COUNTED ONCE.
 *
 * Home and Projects were each deriving their own totals from their own query,
 * which is how two screens in the same product end up disagreeing about how
 * many apartments are left. They now ask the same function, so the bar on a
 * project card and the bar on the Home page are the same bar.
 *
 * ONE ROUND TRIP FOR THE WHOLE WORKSPACE, not one per project: a developer
 * with six towers should not pay six queries to draw a list of six cards.
 */

export interface ProjectRollup {
  total: number;
  available: number;
  on_hold: number;
  negotiation: number;
  reserved: number;
  contract_pending: number;
  sold: number;
  /** Asking value of what is still AVAILABLE, in the project's own currency. */
  value_available: number;
  /** Asking value of everything, sold included — the size of the development. */
  value_total: number;
  area_available: number;
  currency: string | null;
  /** Sold plus contracted, over total. The number a board asks for. */
  soldPct: number;
}

export interface Portfolio {
  projects: DevProject[];
  byProject: Map<string, ProjectRollup>;
  /** Every project added together, for the workspace-level headline. */
  totals: ProjectRollup;
}

const empty = (): ProjectRollup => ({
  total: 0, available: 0, on_hold: 0, negotiation: 0, reserved: 0,
  contract_pending: 0, sold: 0, value_available: 0, value_total: 0,
  area_available: 0, currency: null, soldPct: 0,
});

type CountKey = 'available' | 'on_hold' | 'negotiation' | 'reserved'
  | 'contract_pending' | 'sold';

const BUCKET: Record<UnitStatus, CountKey | null> = {
  AVAILABLE: 'available',
  ON_HOLD: 'on_hold',
  NEGOTIATION: 'negotiation',
  RESERVED: 'reserved',
  CONTRACT_PENDING: 'contract_pending',
  SOLD: 'sold',
  // A hidden apartment is not on the market and is not counted as one. It is
  // still inventory, so it lands in the total and nowhere else.
  HIDDEN: null,
};

function finish(r: ProjectRollup): ProjectRollup {
  const done = r.sold + r.contract_pending;
  r.soldPct = r.total > 0 ? Math.round((done / r.total) * 100) : 0;
  return r;
}

export async function loadPortfolio(workspaceId: string): Promise<Portfolio> {
  const projects = await listProjects(workspaceId);
  const byProject = new Map<string, ProjectRollup>();
  const totals = empty();

  if (projects.length === 0) return { projects, byProject, totals: finish(totals) };

  const all = await listUnits(workspaceId, { limit: 5000, orderBy: 'unit_number' });
  for (const project of projects) byProject.set(project.id, empty());

  for (const unit of all.rows) {
    const rollup = byProject.get(unit.project_id);
    if (!rollup) continue;
    const price = Number(unit.price ?? 0);
    const bucket = BUCKET[unit.status];

    for (const target of [rollup, totals]) {
      target.total += 1;
      if (bucket) target[bucket] += 1;
      target.value_total += price;
      if (unit.status === 'AVAILABLE') {
        target.value_available += price;
        target.area_available += Number(unit.area_total ?? 0);
      }
      // First currency wins and mixed currencies are NOT converted — the same
      // rule the rest of the product states out loud rather than guessing a
      // rate nobody supplied.
      if (!target.currency) target.currency = unit.currency ?? null;
    }
  }

  for (const rollup of byProject.values()) finish(rollup);
  return { projects, byProject, totals: finish(totals) };
}
