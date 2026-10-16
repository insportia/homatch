/*
 * Admin → Storage → Storage retention: the calls behind the control center.
 *
 * Object-level retention (migration 20261105090000): only allowlisted,
 * disposable storage objects are ever deleted. Every change goes through a
 * server function that validates it and writes the audit log; the screen is
 * never the only thing between a click and a mistake.
 */
import { supabase } from '@/db/supabase';
import { retentionErrorCode } from './retentionView';

export { retentionErrorCode, artifactsMode, ttlParts, RETENTION_ERRORS } from './retentionView';

export interface ArtifactSettings {
  paused: boolean;
  notifications_enabled: boolean;
  batch_size: number;
  max_attempts: number;
}

export interface ArtifactCategory {
  key: string;
  label: string;
  kind: 'REGENERABLE_CACHE' | 'TEMPORARY_ARTIFACT' | 'SELFTEST';
  provider: 'SUPABASE_STORAGE' | 'R2';
  bucket: string;
  ttl_seconds: number;
  notify_owner: boolean;
  enabled: boolean;
  active_since: string | null;
  tracked: number;
  tracked_bytes: number;
  expiring_7d: number;
  due: number;
  deleted: number;
  reclaimed_bytes: number;
  problems: number;
}

export interface ArtifactStatus {
  settings: ArtifactSettings;
  auto_run: boolean;
  categories: ArtifactCategory[];
  notices: { queued: number; failed: number };
  protected: Array<{ area: string; what: string }>;
  last_tick: { at: string; detail: Record<string, unknown> } | null;
  last_change: { at: string; detail: Record<string, unknown> } | null;
}

export interface ArtifactRow {
  id: string;
  category: string;
  label: string | null;
  provider: string;
  bucket: string;
  object_key: string;
  owner_user_id: string | null;
  byte_size: number | null;
  object_created_at: string;
  expires_at: string;
  state: string;
  attempts: number;
  last_error: string | null;
  notice_7d_at: string | null;
  notice_1d_at: string | null;
  notice_error: string | null;
  notification_id: string | null;
  notification_read: boolean | null;
  notification_pushed_at: string | null;
  deleted_at: string | null;
  reclaimed_bytes: number | null;
}

export interface ArtifactEvent {
  id: number;
  artifact_id: string | null;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ArtifactPreview {
  paused: boolean;
  count: number;
  bytes: number;
  awaiting_notice: number;
  items: Array<{ id: string; category: string; label: string | null; object_key: string; bytes: number | null; expires_at: string; needs_regeneration_check: boolean }>;
}

export type ArtifactFilter = 'PENDING' | 'PROBLEMS' | 'DELETED' | 'NOTICES' | 'ALL';
export type ArtifactPatch = Partial<Pick<ArtifactSettings, 'paused' | 'notifications_enabled' | 'batch_size'>> & { auto_run?: boolean };

/** null = the migration is not applied in this environment. */
export async function artifactStatus(): Promise<ArtifactStatus | null> {
  const { data, error } = await supabase.rpc('retention_artifacts_status');
  return error ? null : (data as ArtifactStatus);
}

export async function configureArtifacts(patch: ArtifactPatch, reason?: string): Promise<ArtifactStatus> {
  const { data, error } = await supabase.rpc('retention_artifacts_configure', { p_patch: patch, p_reason: reason ?? null });
  if (error) throw new Error(retentionErrorCode(error.message));
  return data as ArtifactStatus;
}

export async function setCategory(key: string, enabled: boolean, reason?: string): Promise<ArtifactStatus> {
  const { data, error } = await supabase.rpc('retention_category_set', { p_key: key, p_enabled: enabled, p_reason: reason ?? null });
  if (error) throw new Error(retentionErrorCode(error.message));
  return data as ArtifactStatus;
}

export async function artifactList(filter: ArtifactFilter, limit = 50): Promise<ArtifactRow[]> {
  const { data, error } = await supabase.rpc('retention_artifacts_list', { p_filter: filter, p_limit: limit });
  return error || !Array.isArray(data) ? [] : (data as ArtifactRow[]);
}

/** What the next run would delete under the CURRENT settings (read-only). */
export async function artifactPreview(): Promise<ArtifactPreview | null> {
  const { data, error } = await supabase.rpc('retention_artifacts_preview');
  return error || !data ? null : (data as ArtifactPreview);
}

export async function retryArtifact(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('retention_artifacts_requeue', { p_artifact_id: id });
  return !error && data === true;
}

export async function artifactEvents(limit = 50): Promise<ArtifactEvent[]> {
  const { data, error } = await supabase.rpc('retention_artifacts_events', { p_limit: limit });
  return error || !Array.isArray(data) ? [] : (data as ArtifactEvent[]);
}

export interface TickResult { registered: number; claimed: number; deleted: number; alreadyGone: number; kept: number; failed: number }

/** One run right now (the same as the scheduled run). Deletes nothing while paused. */
export async function runNow(): Promise<TickResult | null> {
  const { data, error } = await supabase.functions.invoke('storage-retention', { body: { action: 'tick' } });
  if (error || !data) return null;
  return data as TickResult;
}

/** Creates two disposable test files with a two-minute life; a later run deletes them. */
export async function runSelftest(): Promise<{ id: string; expiresInSeconds: number } | null> {
  const { data, error } = await supabase.functions.invoke('storage-retention', { body: { action: 'selftest' } });
  if (error || !data || !(data as { ok?: boolean }).ok) return null;
  return data as { id: string; expiresInSeconds: number };
}
