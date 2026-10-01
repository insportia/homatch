// ADMIN — WHO OWNS IT. The HOMATCH person behind a Meta Ads user id: name,
// username, email, their Meta connection and selected ad accounts. Resolved
// by meta-ads-api admin_meta_people (admin-only; users is own-row-only under
// RLS), batched across every chip on screen and cached for the session, so a
// list of 500 campaigns costs one request, not 500.
import React, { useEffect, useState } from 'react';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { IdChip } from '@/components/admin/control/AdminKit';

export interface MetaPerson {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  suspended: boolean;
  connection: { status: string; instantFormsMissing: string[] } | null;
  adAccounts: Array<{ id: string; name: string | null; selected: boolean }>;
}

const UUID = /^[0-9a-f-]{36}$/i;
const cache = new Map<string, MetaPerson | null>();
const queued = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = [...queued].slice(0, 500);
  for (const id of batch) queued.delete(id);
  if (!batch.length) return;
  try {
    const { data, error } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_meta_people', userIds: batch } });
    if (error) throw error;
    const people = (data?.people ?? {}) as Record<string, MetaPerson>;
    for (const id of batch) cache.set(id, people[id] ?? null);
  } catch {
    for (const id of batch) cache.set(id, null);
  }
  for (const l of listeners) l();
  if (queued.size) timer = setTimeout(() => void flush(), 0);
}

function request(ids: Iterable<string>) {
  let added = false;
  for (const id of ids) {
    if (!id || !UUID.test(id) || cache.has(id) || queued.has(id)) continue;
    queued.add(id); added = true;
  }
  if (added && !timer) timer = setTimeout(() => void flush(), 25);
}

/** The people behind these ids (undefined while loading, null if unknown). */
export function usePeople(ids: Array<string | null | undefined>): Record<string, MetaPerson | null | undefined> {
  const [, bump] = useState(0);
  const key = [...new Set(ids.filter(Boolean) as string[])].sort().join(',');
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    request(key ? key.split(',') : []);
    return () => { listeners.delete(l); };
  }, [key]);
  const out: Record<string, MetaPerson | null | undefined> = {};
  // An id that cannot be a HOMATCH user is never looked up: it reads as unknown, not as loading.
  for (const id of key ? key.split(',') : []) out[id] = !UUID.test(id) ? null : cache.has(id) ? cache.get(id) : undefined;
  return out;
}

/** Name · email · id — the owner of a campaign, connection, lead or ledger row. */
export function Owner({ id, person, compact }: { id: string | null | undefined; person?: MetaPerson | null; compact?: boolean }) {
  const { t } = useLanguage();
  const map = usePeople(person === undefined ? [id] : []);
  const p = person !== undefined ? person : id ? map[id] : null;
  if (!id) return <span className="text-muted-foreground">—</span>;
  const label = p?.name || (p?.username ? `@${p.username}` : null);
  return (
    <span data-mm-owner={id} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {p === undefined ? <span className="text-muted-foreground">…</span> : (
        <>
          <b className="min-w-0 break-words text-foreground">{label ?? t('mm_a_owner_unknown')}</b>
          {p?.email && <span className="min-w-0 break-all text-muted-foreground" dir="ltr">{p.email}</span>}
          {p?.suspended && <span className="rounded bg-destructive/10 px-1 text-2xs font-semibold text-destructive">{t('mm_a_owner_suspended')}</span>}
        </>
      )}
      {!compact && <IdChip id={id} />}
    </span>
  );
}
