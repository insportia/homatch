// THE LIVE DESIGN: state, history and saving, for one version.
//
// Every change arrives as operations, goes through the one validator, is
// applied deterministically, lands on the undo stack as one step, and is
// saved — debounced, conflict-checked against the database revision, and
// retried when the connection comes back. Camera movement never reaches
// here; only design changes are persisted.

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeDesignState, type DesignState } from '@/lib/designStudio/designState';
import { emptyHistory, record, redo as redoStep, undo as undoStep, type HistoryStacks } from '@/lib/designStudio/history';
import { applyTransaction, type Operation, type OperationContext, type Rejection, type Transaction } from '@/lib/designStudio/operations';
import { appendVersionEvents, saveVersionState } from '@/services/designStudio/projects';

export type SaveStatus = 'SAVED' | 'UNSAVED' | 'SAVING' | 'OFFLINE' | 'FAILED' | 'CONFLICT';

const AUTOSAVE_DELAY_MS = 1200;
const RETRY_MS = 10000;

export interface DesignSession {
  state: DesignState;
  status: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  lastLabel: string | null;
  apply: (ops: Operation[], label: string, origin?: Transaction['origin']) => { ok: true } | { ok: false; rejection: Rejection; index: number };
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
}

export function useDesignSession(input: {
  versionId: string;
  userId: string;
  initialState: unknown;
  initialRevision: number;
  ctx: OperationContext;
  onApplied?: (state: DesignState) => void;
}): DesignSession {
  const [state, setState] = useState<DesignState>(() => normalizeDesignState(input.initialState));
  const [history, setHistoryState] = useState<HistoryStacks>(emptyHistory);
  // Updaters must stay pure (React may call them twice), so the stacks also
  // live in a ref that the handlers read and write synchronously.
  const historyRef = useRef<HistoryStacks>(history);
  const setHistory = (next: HistoryStacks) => { historyRef.current = next; setHistoryState(next); };
  const [status, setStatus] = useState<SaveStatus>('SAVED');
  const [lastLabel, setLastLabel] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const revisionRef = useRef(input.initialRevision);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingEvents = useRef<Array<{ origin: Transaction['origin']; ops: Operation[] }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef(input.ctx);
  ctxRef.current = input.ctx;

  const save = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus('SAVING');
    const snapshot = stateRef.current;
    const events = pendingEvents.current;
    const result = await saveVersionState(input.versionId, snapshot as unknown as Record<string, unknown>, revisionRef.current);
    savingRef.current = false;
    if (result.ok) {
      revisionRef.current = result.revision;
      if (stateRef.current === snapshot) dirtyRef.current = false;
      pendingEvents.current = pendingEvents.current.slice(events.length);
      // The audit trail is best-effort: a failed append never loses the design itself.
      appendVersionEvents(events.map((e) => ({
        versionId: input.versionId, userId: input.userId, revision: result.revision, origin: e.origin, ops: e.ops,
      }))).catch(() => { /* reported by the next save attempt's status, never blocking the design */ });
      setStatus(dirtyRef.current ? 'UNSAVED' : 'SAVED');
      if (dirtyRef.current) schedule();
      return;
    }
    setStatus(result.reason);
    if (result.reason === 'OFFLINE' || result.reason === 'FAILED') {
      timer.current = setTimeout(() => { void save(); }, RETRY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.versionId, input.userId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, AUTOSAVE_DELAY_MS);
  }, [save]);

  const markChanged = useCallback((next: DesignState, origin: Transaction['origin'], ops: Operation[]) => {
    setState(next);
    stateRef.current = next;
    dirtyRef.current = true;
    pendingEvents.current.push({ origin, ops });
    setStatus((s) => (s === 'CONFLICT' ? s : 'UNSAVED'));
    schedule();
    input.onApplied?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  const apply = useCallback<DesignSession['apply']>((ops, label, origin = 'USER') => {
    const result = applyTransaction(stateRef.current, ops, ctxRef.current, {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, label, origin,
    });
    if (!result.ok) return { ok: false, rejection: result.rejection, index: result.index };
    setHistory(record(historyRef.current, result.transaction));
    setLastLabel(label);
    markChanged(result.state, origin, ops);
    return { ok: true };
  }, [markChanged]);

  const undo = useCallback(() => {
    const step = undoStep(historyRef.current, stateRef.current);
    if (!step) return;
    setHistory(step.history);
    setLastLabel(step.tx.label);
    markChanged(step.state, 'USER', step.tx.inverse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markChanged]);

  const redo = useCallback(() => {
    const step = redoStep(historyRef.current, stateRef.current);
    if (!step) return;
    setHistory(step.history);
    setLastLabel(step.tx.label);
    markChanged(step.state, step.tx.origin, step.tx.ops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markChanged]);

  // Back online: save what is waiting.
  useEffect(() => {
    const online = () => { if (dirtyRef.current) void save(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [save]);

  // Leaving with unsaved work: the browser asks first.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  // Unmount (switching version, leaving): flush once.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirtyRef.current) void save();
  }, [save]);

  return {
    state,
    status,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    lastLabel,
    apply,
    undo,
    redo,
    saveNow: save,
  };
}
