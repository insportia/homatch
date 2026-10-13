import { recoveryDecision, retryAt } from './policy.mjs';

/** Store methods MUST fence every write with job + lease token and enforce atomic distributed limits. */
export class PublishingEngine {
  constructor({ store, adapters, workerId, leaseMs = 120_000, now = Date.now }) {
    Object.assign(this, { store, adapters, workerId, leaseMs, now });
  }
  async tick(signal) {
    signal?.throwIfAborted();
    const job = await this.store.claim({ workerId: this.workerId, leaseMs: this.leaseMs });
    if (!job) return false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const fence = { jobId: job.id, leaseToken: job.leaseToken };
    let leaseLost = false;
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || leaseLost) return;
      heartbeatBusy = true;
      try {
        if (!await this.store.heartbeat(fence, this.leaseMs)) { leaseLost = true; controller.abort(); }
      } catch { leaseLost = true; controller.abort(); }
      finally { heartbeatBusy = false; }
    }, Math.max(1000, Math.floor(this.leaseMs / 3)));
    let submissionStarted = job.submissionStarted;
    const event = async phase => {
      controller.signal.throwIfAborted();
      // Persist intent BEFORE the irreversible browser action. Crash here must trigger reconciliation.
      if (!await this.store.event(fence, { phase, submissionStarted: submissionStarted || phase === 'submitting' })) {
        leaseLost = true;
        controller.abort();
        throw new Error('LEASE_LOST');
      }
      if (phase === 'submitting') submissionStarted = true;
    };
    try {
      const adapter = this.adapters.get(job.portalId);
      if (!adapter || !await this.store.allowed(fence, job.portalId)) {
        await this.store.finish(fence, { state: 'action_required', code: 'PORTAL_DISABLED' });
        return true;
      }
      const capabilities = adapter.getCapabilities();
      if (capabilities.permission !== 'verified' || !capabilities.operations[job.operation]) {
        await this.store.finish(fence, { state: 'action_required', code: 'UNSUPPORTED_CAPABILITY' });
        return true;
      }
      const context = await this.store.context(fence);
      if (context.userId !== job.userId || context.accountId !== job.accountId || context.listing.ownerId !== job.userId) throw new Error('OWNERSHIP_MISMATCH');
      Object.assign(context, { signal: controller.signal, event });
      if (submissionStarted && job.operation !== 'status') {
        await event('reconciling');
        const reconciled = await adapter.reconcile(context);
        const decision = recoveryDecision({ ...job, submissionStarted, reconcileResult: reconciled.state });
        if (decision === 'complete_from_reconciliation') {
          await this.store.finish(fence, { state: 'succeeded', result: reconciled.result });
          return true;
        }
        if (decision !== 'retry') {
          await this.store.finish(fence, { state: decision, code: 'AMBIGUOUS_SUBMISSION' });
          return true;
        }
      }
      if (['update', 'remove'].includes(job.operation) && (!context.externalId || !context.expectedExternalVersion)) {
        await this.store.finish(fence, { state: 'action_required', code: 'CONFLICT' });
        return true;
      }
      await event('validating');
      if (['publish', 'update'].includes(job.operation) && (await adapter.validateListing(context.listing)).length) {
        await this.store.finish(fence, { state: 'action_required', code: 'VALIDATION_FAILED' });
        return true;
      }
      const method = { publish: 'publish', update: 'update', remove: 'remove', status: 'getStatus' }[job.operation];
      if (!method) throw new Error('UNSUPPORTED_CAPABILITY');
      // Protect against an adapter forgetting to mark a potentially accepted mutation.
      if (job.operation !== 'status') await event('submitting');
      const result = await adapter[method](context);
      controller.signal.throwIfAborted();
      if (!result?.externalId || !result.externalUrl || !['published', 'awaiting_moderation', 'removed', 'inactive'].includes(result.status)) throw new Error('INVALID_PORTAL_RESULT');
      await this.store.finish(fence, { state: 'succeeded', result });
    } catch (error) {
      if (!leaseLost) {
        const decision = recoveryDecision({ ...job, submissionStarted });
        // Do not persist arbitrary portal errors: they can contain a phone, password, URL token or OTP.
        await this.store.finish(fence, { state: decision, code: submissionStarted ? 'RECONCILIATION_REQUIRED' : 'EXECUTION_FAILED', availableAt: decision === 'retry' ? new Date(retryAt(job.attempts, this.now())).toISOString() : undefined });
      }
    } finally {
      clearInterval(heartbeat);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
    return true;
  }
}
