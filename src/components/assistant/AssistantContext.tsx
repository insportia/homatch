// HOMATCH — the assistant's open/closed state, and what page it is looking at.
//
// WHY THIS EXISTS
//
// The floating "Ask Homatch AI" button used to call navigate('/ai'). On a
// marketing page that is merely abrupt. Inside a seven-step agent wizard or a
// campaign builder it is destructive: the route unmounts, every field the
// customer has typed and not yet saved is gone, and the step resets. Asking
// the assistant a question cost you your work, so the rational thing was to
// never press the button — which makes an AI-native product's AI unreachable
// exactly where it would help most.
//
// The assistant now opens OVER the current page. Nothing unmounts, so there is
// nothing to preserve and restore; the form is still mounted underneath,
// holding its own state, because it never went anywhere.
//
// WHAT A PAGE CONTRIBUTES
//
// A page describes itself with useAssistantContext(...). That description is
// passed to the model so "what should I write here?" has an answer, and it is
// also what an Insert action writes back into. It carries field names and the
// current step — never credentials, never another account's data.

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

/** What the assistant can see about the page underneath it. */
export interface AssistantSurface {
  /** Stable id for the surface, e.g. 'agent-builder'. */
  surface: string;
  /** Human-readable, already translated. Shown in the drawer header. */
  title?: string;
  /** Where in a multi-step flow the customer is. */
  step?: string;
  /** Safe, non-sensitive facts: selected channel, chosen agent name, counts. */
  facts?: Record<string, string | number | null | undefined>;
  /**
   * Fields the assistant may offer to fill. The key is shown to the customer;
   * apply() is called only after they press Insert.
   */
  fields?: Array<{ key: string; label: string; apply: (text: string) => void }>;
}

interface AssistantApi {
  open: boolean;
  setOpen: (next: boolean) => void;
  surface: AssistantSurface | null;
  /** Registers the calling page as the current surface until it unmounts. */
  register: (s: AssistantSurface | null) => void;
}

const Ctx = createContext<AssistantApi | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState<AssistantSurface | null>(null);

  const register = useCallback((s: AssistantSurface | null) => setSurface(s), []);

  const value = useMemo<AssistantApi>(
    () => ({ open, setOpen, surface, register }),
    [open, surface, register],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantApi {
  const ctx = useContext(Ctx);
  // The provider wraps the authenticated shell. A page rendered outside it
  // (a test harness, a public route) gets a no-op rather than a crash.
  return ctx ?? { open: false, setOpen: () => {}, surface: null, register: () => {} };
}

/**
 * Describe the current page to the assistant.
 *
 * The description is re-registered whenever it changes and cleared on unmount,
 * so the assistant never reports a step the customer has already left.
 */
export function useAssistantContext(surface: AssistantSurface | null): void {
  const { register } = useAssistant();

  // Registering an object literal every render would loop. The comparison is
  // on the serialisable part; `apply` callbacks are held by reference.
  const signature = JSON.stringify({
    surface: surface?.surface, title: surface?.title, step: surface?.step,
    facts: surface?.facts, fields: surface?.fields?.map((f) => f.key),
  });
  const latest = useRef(surface);
  latest.current = surface;

  useEffect(() => {
    register(latest.current);
    return () => register(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, register]);
}
