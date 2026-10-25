// HOMATCH HOME FINANCING — the official rates, and where typed amounts live.
//
// useFxRates(): reads public.mortgage_fx_rates; when the table is empty or
// its newest row is older than six hours, asks the mortgage-fx-rates Edge
// Function to refresh it from the National Bank of Georgia. One request per
// tab, shared by every field. A failure leaves `table` empty and `failed`
// true: conversions then return null and the field says so.
//
// MoneyEntriesContext: the amounts as typed (amount + currency) for the
// scenario's own fields, so a price typed in dollars still reads in dollars
// after a reload. Fields outside the scenario (an offer, the readiness
// questions) keep their entry locally.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { readMortgageFxRates, refreshMortgageFxRates } from '@/services/mortgageFxRates';
import { toTable, type FxTable, type MoneyEntries, type MoneyEntry } from '@/mortgage/fx';

const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

export interface FxState {
  table: FxTable;
  loading: boolean;
  failed: boolean;
}

let shared: Promise<FxTable> | null = null;

async function loadTable(): Promise<FxTable> {
  const { rates, newestFetch } = await readMortgageFxRates();
  const stored = toTable(rates);
  if (rates.length > 0 && Date.now() - newestFetch < REFRESH_AFTER_MS) return stored;
  try {
    const fresh = await refreshMortgageFxRates();
    if (fresh && fresh.length) return toTable(fresh);
  } catch {
    /* The stored rows, however old, are still better than nothing; their date is shown. */
  }
  return stored;
}

export function useFxRates(): FxState {
  const [state, setState] = useState<FxState>({ table: {}, loading: true, failed: false });
  useEffect(() => {
    let live = true;
    shared ??= loadTable().catch(() => ({}));
    shared.then((table) => {
      if (!live) return;
      const empty = Object.keys(table).length === 0;
      if (empty) shared = null; // let a later mount try again
      setState({ table, loading: false, failed: empty });
    });
    return () => { live = false; };
  }, []);
  return state;
}

interface EntriesValue {
  entries: MoneyEntries;
  setEntry: (key: string, entry: MoneyEntry | null) => void;
}

const EntriesContext = createContext<EntriesValue | null>(null);

export function MoneyEntriesProvider({ entries, setEntry, children }: EntriesValue & { children: React.ReactNode }) {
  return <EntriesContext.Provider value={{ entries, setEntry }}>{children}</EntriesContext.Provider>;
}

/** The typed entry for a scenario field (persisted), or local state when there is no key or no provider. */
export function useMoneyEntry(persistKey?: string): [MoneyEntry | null, (entry: MoneyEntry | null) => void] {
  const ctx = useContext(EntriesContext);
  const [local, setLocal] = useState<MoneyEntry | null>(null);
  if (persistKey && ctx) return [ctx.entries[persistKey] ?? null, (e) => ctx.setEntry(persistKey, e)];
  return [local, setLocal];
}
