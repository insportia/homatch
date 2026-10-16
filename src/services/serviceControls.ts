// Admin → Service Control Center: the browser side of the service-control function.
// Every call is checked on the server (is_admin on the caller's token).
import { supabase } from '@/db/supabase';
import type { ServiceKey } from '@/lib/serviceControls/core';

export type Effective = 'PAUSED' | 'BACKEND_ONLY' | 'LIVE' | 'DEGRADED';

export interface ServiceHistoryEntry {
  at: string; by: string | null; action: string; result: string | null; reason: string | null; requestId: string | null;
  before: { frontend?: boolean; backend?: boolean; version?: number } | null;
  after: { frontend?: boolean; backend?: boolean; version?: number } | null;
  missing: string[] | null;
}

export interface ServiceCard {
  key: ServiceKey;
  frontend: boolean;
  backend: boolean;
  version: number | null;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  effective: Effective;
  readiness: { ready: boolean; missing: string[]; notes: string[] };
  running: Record<string, number | null>;
  history: ServiceHistoryEntry[];
}

export interface ServiceOverview { services: ServiceCard[]; checkedAt: string; propagationSeconds: number }

export class ServiceControlError extends Error {
  constructor(public code: string, public detail: { missing?: string[]; notes?: string[]; control?: unknown } = {}) { super(code); }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('service-control', { body: { action, ...params } });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) as Record<string, any> | null : null;
    throw new ServiceControlError(String(body?.code || 'NETWORK_ERROR'), { missing: body?.missing, notes: body?.notes, control: body?.control });
  }
  if (data && typeof data === 'object' && 'code' in data) throw new ServiceControlError(String((data as any).code));
  return data as T;
}

const requestId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const serviceOverview = () => call<ServiceOverview>('overview');

export const setService = (service: ServiceKey, frontend: boolean, backend: boolean, expectedVersion: number, reason: string) =>
  call<{ result: 'CHANGED' | 'UNCHANGED'; control: unknown }>('set', { service, frontend, backend, expectedVersion, reason, requestId: requestId() });

export const pauseAllServices = (reason: string) =>
  call<{ result: 'CHANGED' | 'UNCHANGED'; changed: ServiceKey[] }>('pause_all', { reason, requestId: requestId() });
