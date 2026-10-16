/*
 * Saved listings and observed interest for Find Property results.
 *
 * One small shared store of the customer's saved listing keys (RLS returns only
 * their own rows), loaded once and kept in step with every toggle. Views and
 * "opened at source" are telemetry: fire-and-forget, never allowed to break the
 * page, deduplicated server-side (once per listing per hour), skipped when the
 * customer switched recording off. They describe behaviour, never intent.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import type { PropertyView } from '@/services/marketplaceSearch';
import { recordListingInterest, type ListingSnapshot } from '@/services/demandIntelligence';

let saved: Set<string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function load(): Promise<void> {
  if (saved) return Promise.resolve();
  loading ??= Promise.resolve(supabase.from('saved_property_listings').select('listing_key'))
    .then(({ data }) => { saved = new Set(((data ?? []) as Array<{ listing_key: string }>).map((r) => r.listing_key)); emit(); })
    .catch(() => { saved = new Set(); emit(); });
  return loading;
}

export const listingKeyOf = (p: Pick<PropertyView, 'key'>) => `mp:${p.key}`.slice(0, 300);

export function listingSnapshot(p: PropertyView, transaction?: string | null): ListingSnapshot {
  const primary = p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0];
  let host: string | null = null;
  try { host = primary?.exactUrl ? new URL(primary.exactUrl).hostname.replace(/^www\./, '') : null; } catch { host = null; }
  return {
    title: p.title, city: p.facts.city, district: p.facts.district, price: p.facts.priceUsd, currency: p.facts.priceUsd != null ? 'USD' : null,
    transaction: transaction ?? null, areaSqm: p.facts.areaSqm, rooms: p.facts.rooms,
    url: primary?.exactUrl?.startsWith('https://') ? primary.exactUrl : null, sourceHost: host,
    imageUrl: p.images[0]?.startsWith('https://') ? p.images[0] : null,
  };
}

/** Saved state of one listing, and a toggle that reports failure honestly. */
export function useSavedListing(key: string): { saved: boolean; busy: boolean; failed: boolean; toggle: (snapshot: ListingSnapshot) => Promise<void> } {
  const [, force] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    void load();
    return () => { listeners.delete(l); };
  }, []);
  const isSaved = Boolean(saved?.has(key));
  const toggle = async (snapshot: ListingSnapshot) => {
    setBusy(true); setFailed(false);
    try {
      const result = await recordListingInterest(isSaved ? 'UNSAVED' : 'SAVED', key, { snapshot });
      if (!saved) saved = new Set();
      if (result.saved === true) saved.add(key); else if (result.saved === false) saved.delete(key);
      emit();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { saved: isSaved, busy, failed, toggle };
}

/** A view or an open at the source. Never throws, never awaited by the UI. */
export function noteListingInterest(kind: 'VIEWED' | 'RESULT_OPENED', p: PropertyView, ctx: { searchId?: string | null; transaction?: string | null } = {}): void {
  void recordListingInterest(kind, listingKeyOf(p), { searchId: ctx.searchId ?? null, snapshot: listingSnapshot(p, ctx.transaction) })
    .catch(() => undefined);
}

/** For tests and sign-out: forget the cached saved set. */
export function resetSavedListings(): void { saved = null; loading = null; emit(); }
