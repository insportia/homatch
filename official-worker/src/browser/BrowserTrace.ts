// BrowserTrace.ts — per-action diagnostic trace (mandate Section 25).
// ADMIN/DEBUG-ONLY: never shown to the customer (Section 22). Attached to
// every WorkflowResult and surfaced through the existing GET /research/:id
// endpoint, exactly like the old `interactionTrace` array — this is that
// same idea, formalized with the exact field set the mandate specifies.

export interface BrowserTraceEntry {
  timestamp: string;
  source: string;
  stateBefore: string | null;
  action: string;
  target?: string | null;
  expectedOutcome?: string | null;
  actualOutcome?: string | null;
  stateAfter: string | null;
  url?: string | null;
  frame?: string | null;
  screenshotRef?: string | null;
  error?: string | null;
}

export class BrowserTrace {
  private readonly entries: BrowserTraceEntry[] = [];
  constructor(private readonly source: string) {}

  record(entry: Omit<BrowserTraceEntry, 'timestamp' | 'source'>): void {
    this.entries.push({ timestamp: new Date().toISOString(), source: this.source, ...entry });
  }

  get all(): BrowserTraceEntry[] {
    return this.entries.slice();
  }

  toJSON(): BrowserTraceEntry[] {
    return this.all;
  }
}
