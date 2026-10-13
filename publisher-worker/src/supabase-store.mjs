/** PostgREST transport uses worker credentials only. No keys or raw errors are logged. */
export class SupabasePublishingStore {
  constructor({ url, serviceKey, fetchImpl = fetch, timeoutMs = 15_000 }) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(parsed.hostname)
    )
      throw new Error('INSECURE_DATABASE_URL');
    if (!serviceKey) throw new Error('MISSING_WORKER_DATABASE_CREDENTIAL');
    this.url = parsed.origin;
    this.serviceKey = serviceKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  async rpc(name, args) {
    const response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`PUBLISHER_DATABASE_${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async claim({ workerId, leaseMs }) {
    const rows = await this.rpc('publisher_claim', {
      p_worker: workerId,
      p_lease_seconds: Math.ceil(leaseMs / 1000),
    });
    if (!Array.isArray(rows) || rows.length > 1)
      throw new Error('INVALID_CLAIM_RESPONSE');
    if (!rows.length) return null;
    const j = rows[0];
    if (!j.id || !j.lease_token || j.state !== 'running')
      throw new Error('INVALID_CLAIM_RESPONSE');
    return {
      id: j.id,
      userId: j.user_id,
      portalId: j.portal_id,
      accountId: j.account_id,
      operation: j.operation,
      leaseToken: j.lease_token,
      attempts: j.attempts,
      maxAttempts: j.max_attempts,
      submissionStarted: j.submission_started,
    };
  }
  heartbeat(fence, leaseMs) {
    return this.rpc('publisher_heartbeat', {
      p_job: fence.jobId,
      p_token: fence.leaseToken,
      p_lease_seconds: Math.ceil(leaseMs / 1000),
    });
  }
  event(fence, { phase, submissionStarted }) {
    return this.rpc('publisher_event', {
      p_job: fence.jobId,
      p_token: fence.leaseToken,
      p_phase: phase,
      p_submission_started: submissionStarted,
    });
  }
  allowed(fence, portalId) {
    return this.rpc('publisher_allowed', {
      p_job: fence.jobId,
      p_token: fence.leaseToken,
      p_portal: portalId,
    });
  }
  async context(fence) {
    const data = await this.rpc('publisher_context', {
      p_job: fence.jobId,
      p_token: fence.leaseToken,
    });
    if (!data?.listing || !data.userId || !data.accountId)
      throw new Error('PUBLISHER_CONTEXT_UNAVAILABLE');
    return data;
  }
  finish(fence, outcome) {
    // Deliberate field allowlist prevents an exception or session object leaking into JSON.
    return this.rpc('publisher_finish', {
      p_job: fence.jobId,
      p_token: fence.leaseToken,
      p_state: outcome.state,
      p_code: outcome.code ?? null,
      p_available_at: outcome.availableAt ?? null,
      p_result: outcome.result
        ? {
            externalId: outcome.result.externalId,
            externalUrl: outcome.result.externalUrl,
            externalVersion: outcome.result.externalVersion ?? null,
            status: outcome.result.status,
          }
        : null,
    });
  }
  health({ workerId, adapterVersions, activeContexts, rssBytes }) {
    return this.rpc('publisher_worker_health', {
      p_worker: workerId,
      p_adapter_versions: adapterVersions,
      p_active_contexts: activeContexts,
      p_rss_bytes: rssBytes,
    });
  }
}
