// NavigationStack.ts — reliable parent/child traversal bookkeeping
// (mandate Section 8). Ported unchanged in behavior from the pre-refactor
// src/lib/navigationStack.js (already pure, already unit-tested — 8 tests
// in test/navigationStack.test.mjs, kept passing by test/navigationStack.test.ts
// below) into the new architecture's browser/ module, per Section 27's
// "migrate sound existing logic rather than rewriting it from scratch."
//
// Owns none of the actual browser navigation (that lives in the *Page.ts
// Page Objects, which need real Playwright pages/frames) — this is only the
// "what have we already visited, what is the current parent/child path"
// bookkeeping that makes exhaustive-but-non-looping traversal possible:
// TAS_RESULTS -> RESULT #7 -> DOCUMENT #1 -> (back) -> DOCUMENT #2 ->
// (back) -> (back to TAS_RESULTS) -> RESULT #8 -> ...
//
// Loop prevention (mandate Section 8: "via normalized item IDs/URLs/content
// identifiers, not blind browser history"): normalizeKey() strips
// whitespace/case and drops the most common tracking/session query params
// so two links that are the same underlying resource (differing only by a
// cache-busting or session parameter) are correctly treated as
// already-visited, while two genuinely different result rows/documents are
// not accidentally collapsed together.

const VOLATILE_PARAMS = new Set(['t', 'ts', '_', 'sid', 'sessionid', 'session_id', 'cachebust', 'rnd', 'random']);

export function normalizeKey(idOrUrl: string | null | undefined): string {
  const raw = String(idOrUrl || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    for (const p of [...u.searchParams.keys()]) if (VOLATILE_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().toLowerCase();
  } catch {
    // Not a URL (e.g. a synthetic "grid-row-7" id) — just normalize
    // whitespace/case so trivially-different-looking ids that mean the
    // same thing still collide on purpose only when byte-identical.
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }
}

export interface NavLogEntry {
  action: 'ENTER' | 'BACK' | 'BACK_AT_ROOT' | 'SKIP_ALREADY_VISITED';
  label?: string;
  key?: string;
  depth?: number;
  from?: string;
  to?: string;
}

export class NavigationStack {
  private visited = new Set<string>();
  private path: { label: string; key: string }[];
  private log: NavLogEntry[] = [];

  constructor(rootLabel = 'ROOT') {
    this.path = [{ label: rootLabel, key: normalizeKey(rootLabel) }];
  }

  /** True if this id/url has already been visited anywhere in this job
   * (not just under the current parent) — the global loop guard. */
  hasVisited(idOrUrl: string): boolean {
    return this.visited.has(normalizeKey(idOrUrl));
  }

  /** Enter a child node (a result row, a document, a page). Records it as
   * visited and pushes it onto the current path. Returns false without
   * changing state if this exact node was already visited (caller should
   * skip it instead of re-entering — the loop guard). */
  enter(label: string, idOrUrl?: string): boolean {
    const key = normalizeKey(idOrUrl ?? label);
    if (this.visited.has(key)) {
      this.log.push({ action: 'SKIP_ALREADY_VISITED', label, key });
      return false;
    }
    this.visited.add(key);
    this.path.push({ label, key });
    this.log.push({ action: 'ENTER', label, key, depth: this.path.length - 1 });
    return true;
  }

  /** Leave the current node, returning to its parent. No-ops (and logs)
   * if already at the root — never throws on an unbalanced back(). */
  back(): void {
    if (this.path.length <= 1) {
      this.log.push({ action: 'BACK_AT_ROOT' });
      return;
    }
    const left = this.path.pop()!;
    this.log.push({ action: 'BACK', from: left.label, to: this.path[this.path.length - 1].label, depth: this.path.length - 1 });
  }

  /** The current parent/child breadcrumb, e.g.
   * ["TAS_RESULTS","RESULT #7","DOCUMENT #1"]. */
  currentPath(): string[] {
    return this.path.map((p) => p.label);
  }

  visitedCount(): number {
    return this.visited.size;
  }

  /** Full ordered ENTER/BACK/SKIP trace — exposed per-source for human
   * audit, same spirit as BrowserTrace. */
  trace(): NavLogEntry[] {
    return this.log.slice();
  }
}
