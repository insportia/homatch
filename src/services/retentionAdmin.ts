/*
 * Admin → Storage → Data retention: the calls behind the control center.
 * Every change goes through retention_admin_configure, which refuses unsafe
 * combinations on the server (see migration 20261102090000 §9b) — the screen
 * cannot be the only thing standing between a click and a mistake.
 */
import { supabase } from '@/db/supabase';
import { retentionErrorCode } from './retentionView';

export { retentionErrorCode, retentionMode, RETENTION_ERRORS } from './retentionView';

export interface RetentionConfig {
  effective_at: string | null;
  legacy_grace_until: string | null;
  purge_enabled: boolean;
  reminders_enabled: boolean;
  knowledge_enabled: boolean;
  batch_size?: number;
}

export interface RetentionStatus {
  config: RetentionConfig;
  auto_run: boolean;
  records_total: number;
  not_expiring: number;
  dated: number;
  expiring_7d: number;
  expired_waiting: number;
  deleted: number;
  problems: number;
  on_hold: number;
  last_activity: string | null;
}

export interface RetentionRecordRow {
  id: string;
  product: 'VERIFY_REPORT' | 'CONTRACT_DOCUMENT';
  source_id: string;
  state: string;
  expires_at: string | null;
  legal_hold: boolean;
  legal_hold_reason: string | null;
  attempts: number;
  last_error: string | null;
}

export type RetentionPatch = Partial<Omit<RetentionConfig, 'batch_size'>> & { auto_run?: boolean; batch_size?: number };

export async function retentionStatus(): Promise<RetentionStatus | null> {
  const { data, error } = await supabase.rpc('retention_admin_status');
  return error ? null : (data as RetentionStatus);
}

export async function configureRetention(patch: RetentionPatch, reason?: string): Promise<RetentionStatus> {
  const { data, error } = await supabase.rpc('retention_admin_configure', { p_patch: patch, p_reason: reason ?? null });
  if (error) throw new Error(retentionErrorCode(error.message));
  return data as RetentionStatus;
}

export async function retentionRecords(filter: 'PROBLEMS' | 'HOLDS' | 'EXPIRING'): Promise<RetentionRecordRow[]> {
  const { data, error } = await supabase.rpc('retention_admin_records', { p_filter: filter, p_limit: 50 });
  return error || !Array.isArray(data) ? [] : (data as RetentionRecordRow[]);
}

export async function retryRecord(recordId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('retention_admin_requeue', { p_record_id: recordId });
  return !error && data === true;
}

export async function holdSource(sourceId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await supabase.rpc('retention_admin_hold_source', { p_source_id: sourceId, p_hold: hold, p_reason: reason });
  if (error) throw new Error(retentionErrorCode(error.message));
}

/** What deletion would remove right now under the CURRENT settings (read-only). */
export async function previewDeletion(cfg: RetentionConfig): Promise<{ verify: number; contracts: number; bytes: number; protected: number } | null> {
  if (!cfg.effective_at) return { verify: 0, contracts: 0, bytes: 0, protected: 0 };
  const { data, error } = await supabase.rpc('retention_admin_dry_run', {
    p_assume_effective_at: cfg.effective_at, p_assume_legacy_grace: cfg.legacy_grace_until,
  });
  if (error || !data) return null;
  const v = (data as any).verify ?? {};
  const c = (data as any).contracts ?? {};
  return {
    verify: Number(v.would_expire ?? 0) - Number(v.protected_legal_hold ?? 0),
    contracts: Number(c.would_expire ?? 0) - Number(c.protected_legal_hold ?? 0),
    bytes: Number(v.db_payload_bytes ?? 0) + Number(c.db_payload_bytes ?? 0) + Number(c.supabase_bytes ?? 0) + Number(c.r2_bytes ?? 0),
    protected: Number(v.protected_legal_hold ?? 0) + Number(c.protected_legal_hold ?? 0),
  };
}

export async function runNow(): Promise<{ purged: number; failed: number } | null> {
  const { data, error } = await supabase.functions.invoke('storage-retention', { body: { action: 'tick' } });
  if (error || !data) return null;
  return { purged: Number((data as any).purged ?? 0), failed: Number((data as any).failed ?? 0) };
}
