// PUBLIC SHARE LINKS — the owner's side.
//
// A link is a database row (ds_shares) pointing at a frozen snapshot of one
// design version. The token is made by the database, returned ONCE here,
// and stored only as a hash: HOMATCH itself cannot show an old link again.
// The owner copies it when it is created, or makes another one — links are
// free and unlimited, and each can be revoked on its own.

import { supabase } from '@/db/supabase';
import { DesignStudioError } from './projects';

export type ShareType = 'WALKTHROUGH' | 'DESIGN';
export type ShareStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ShareRecord {
  id: string;
  token_hint: string;
  share_type: ShareType;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
  view_count: number;
  published: { version_id: string | null; created_at: string } | null;
}

export function shareStatus(s: Pick<ShareRecord, 'revoked_at' | 'expires_at'>, now = Date.now()): ShareStatus {
  if (s.revoked_at) return 'REVOKED';
  if (s.expires_at && Date.parse(s.expires_at) <= now) return 'EXPIRED';
  return 'ACTIVE';
}

/** The public address of a link: a walkthrough at /w/<token>, a design presentation at /d/<token>. */
export function shareUrl(token: string, type: ShareType = 'WALKTHROUGH', origin = window.location.origin): string {
  return `${origin}/${type === 'DESIGN' ? 'd' : 'w'}/${token}`;
}

export async function listShares(projectId: string): Promise<ShareRecord[]> {
  const { data, error } = await supabase
    .from('ds_shares')
    .select('id, token_hint, share_type, label, expires_at, revoked_at, created_at, last_viewed_at, view_count, published:ds_published_designs(version_id, created_at)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
  return (data ?? []) as unknown as ShareRecord[];
}

export async function createShare(input: {
  versionId: string; type: ShareType; label?: string | null; expiresAt?: string | null;
}): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase.rpc('ds_create_share', {
    p_version_id: input.versionId,
    p_share_type: input.type,
    p_label: input.label ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) {
    const code = error.message.match(/\bDS_[A-Z_]+\b/)?.[0] ?? 'DS_REQUEST_FAILED';
    throw new DesignStudioError(code, error.message);
  }
  const r = data as { id?: string; token?: string } | null;
  if (!r?.id || !r.token) throw new DesignStudioError('DS_REQUEST_FAILED');
  return { id: r.id, token: r.token };
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase.rpc('ds_revoke_share', { p_share_id: shareId });
  if (error) throw new DesignStudioError('DS_REQUEST_FAILED', error.message);
}
