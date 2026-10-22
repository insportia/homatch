// THE UNLOCKED CONTACT LIBRARY — one read of every contact this account can
// already see (my_contact_library, SECURITY INVOKER: each branch stays bounded
// by its own table's RLS), plus the HOMATCH members whose demand fits one of the
// owner's properties (listNativeMatches). Nothing here unlocks, buys or reveals
// anything: a contact appears only after the existing unlock, import or match
// flow already made it the caller's to see.
import { supabase } from '@/db/supabase';
import { listNativeMatches, type NativeKind, type NativeMatchRow } from '@/services/nativeMatches';

export type ContactKind = 'UNLOCKED_MATCH' | 'CAMPAIGN_LEAD' | 'OUTREACH_CONTACT' | 'HOMATCH_MEMBER';

/** How a contact can actually be reached. Never implied: each comes from a stored field. */
export type Channel = 'EMAIL' | 'PHONE' | 'PROFILE' | 'HOMATCH_CHAT';

export interface LibraryContact {
  key: string;
  kind: ContactKind;
  name: string | null;
  email: string | null;
  phone: string | null;
  profileUrl: string | null;
  sourceUrl: string | null;
  source: string | null;
  language: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  campaignJobId: string | null;
  acquiredAt: string | null;
  /** True only for an imported contact with a valid, never-opted-out address. */
  emailSendable: boolean;
  outreachContactId: string | null;
  /** HOMATCH members: the native match or relationship the conversation belongs to. */
  native?: { kind: NativeKind; id: string } | null;
}

export function channelsOf(c: LibraryContact): Channel[] {
  const out: Channel[] = [];
  if (c.email && c.emailSendable) out.push('EMAIL');
  if (c.phone) out.push('PHONE');
  if (c.profileUrl) out.push('PROFILE');
  if (c.kind === 'HOMATCH_MEMBER') out.push('HOMATCH_CHAT');
  return out;
}

interface Row {
  contact_key: string; kind: Exclude<ContactKind, 'HOMATCH_MEMBER'>; display_name: string | null; email: string | null;
  phone: string | null; profile_url: string | null; source_url: string | null; source: string | null; language: string | null;
  property_id: string | null; property_title: string | null; campaign_job_id: string | null; acquired_at: string | null;
  email_sendable: boolean | null; outreach_contact_id: string | null;
}

export async function listLibraryContacts(): Promise<LibraryContact[]> {
  const [{ data, error }, native] = await Promise.all([
    supabase.rpc('my_contact_library'),
    listNativeMatches(null).catch((): NativeMatchRow[] => []),
  ]);
  if (error) throw new Error(error.message);
  const rows: LibraryContact[] = ((data ?? []) as Row[]).map((r) => ({
    key: r.contact_key,
    kind: r.kind,
    name: r.display_name,
    email: r.email,
    phone: r.phone,
    profileUrl: r.profile_url,
    sourceUrl: r.source_url,
    source: r.source,
    language: r.language,
    propertyId: r.property_id,
    propertyTitle: r.property_title,
    campaignJobId: r.campaign_job_id,
    acquiredAt: r.acquired_at,
    emailSendable: Boolean(r.email_sendable),
    outreachContactId: r.outreach_contact_id,
  }));
  /* HOMATCH members: the name they chose to show and a conversation, nothing else. */
  for (const m of native) {
    if (m.role !== 'OWNER') continue;
    rows.push({
      key: `member:${m.kind}:${m.id}`,
      kind: 'HOMATCH_MEMBER',
      name: m.counterparty_name,
      email: null, phone: null, profileUrl: null, sourceUrl: null,
      source: 'HOMATCH', language: null,
      propertyId: m.property_id,
      propertyTitle: m.property_title,
      campaignJobId: null,
      acquiredAt: m.updated_at,
      emailSendable: false, outreachContactId: null,
      native: { kind: m.kind, id: m.id },
    });
  }
  return rows;
}

export interface LibraryFilter {
  q?: string;
  kind?: ContactKind | 'ALL';
  channel?: Channel | 'ANY';
  propertyId?: string | 'ALL';
  campaignJobId?: string | 'ALL';
}

/** Client-side narrowing of the owner's own, already-authorised list. */
export function filterContacts(all: LibraryContact[], f: LibraryFilter): LibraryContact[] {
  const q = (f.q ?? '').trim().toLocaleLowerCase();
  return all.filter((c) => {
    if (f.kind && f.kind !== 'ALL' && c.kind !== f.kind) return false;
    if (f.channel && f.channel !== 'ANY' && !channelsOf(c).includes(f.channel)) return false;
    if (f.propertyId && f.propertyId !== 'ALL' && c.propertyId !== f.propertyId) return false;
    if (f.campaignJobId && f.campaignJobId !== 'ALL' && c.campaignJobId !== f.campaignJobId) return false;
    if (!q) return true;
    return [c.name, c.email, c.phone, c.source, c.propertyTitle, c.profileUrl, c.language]
      .some((v) => typeof v === 'string' && v.toLocaleLowerCase().includes(q));
  });
}
