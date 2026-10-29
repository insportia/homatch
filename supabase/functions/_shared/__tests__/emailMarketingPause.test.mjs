// Email Marketing hidden (owner, 2026-10-29): the pure pause decisions, run for real.
// A paused service refuses new work and never destroys scheduled work.
import test from 'node:test';
import assert from 'node:assert/strict';

const gate = await import('../emailMarketing/pauseGate.ts');

test('email-marketing: every customer action is gated; only the admin usage snapshot stays open', () => {
  for (const action of ['plan_status', 'plan_purchase', 'domains_list', 'domain_add', 'domain_refresh', 'domain_verify',
    'domain_set_sender', 'domain_disconnect', 'inbox_reply', 'campaign_test', 'campaign_save', 'campaign_check',
    'campaign_submit', 'copilot', 'asset_upload', 'asset_delete', 'deliverability_check', 'anything_new']) {
    assert.equal(gate.emailMarketingActionGated(action), true, `${action} is refused while off`);
  }
  assert.equal(gate.emailMarketingActionGated('usage_refresh'), false, 'the read-only admin usage snapshot stays open');
  assert.deepEqual([...gate.EMAIL_MARKETING_OPEN_WHILE_OFF], ['usage_refresh']);
});

test('outreach-send studio actions: all of Email Studio, and only the EMAIL lead draft', () => {
  for (const action of ['studio_render', 'studio_generate', 'studio_review', 'studio_test', 'studio_send', 'studio_send_scheduled']) {
    assert.equal(gate.studioActionNeedsEmailMarketing({ action }), true, action);
  }
  assert.equal(gate.studioActionNeedsEmailMarketing({ action: 'studio_lead_draft', channel: 'EMAIL' }), true);
  for (const channel of ['HOMATCH_CHAT', 'WHATSAPP', 'TELEGRAM', 'SMS', undefined]) {
    assert.equal(gate.studioActionNeedsEmailMarketing({ action: 'studio_lead_draft', channel }), false, `${channel} drafts are not Email Marketing`);
  }
  assert.equal(gate.studioActionNeedsEmailMarketing({ campaign_id: 'x' }), false, 'a plain campaign send is decided by its type, not here');
});

test('a SERVICE_DISABLED reply is recognised; other refusals are not', () => {
  assert.equal(gate.isServiceDisabledReply({ code: 'SERVICE_DISABLED', service: 'email_marketing' }), true);
  for (const body of [null, undefined, {}, { blocked: true, reason: 'QUOTA' }, { error: 'SERVICE_DISABLED' }, 'SERVICE_DISABLED']) {
    assert.equal(gate.isServiceDisabledReply(body), false, JSON.stringify(body));
  }
});

function fakeDb() {
  const writes = [];
  return {
    writes,
    from(table) {
      return {
        update(row) {
          const w = { table, row, filters: [] };
          const chain = { eq(c, v) { w.filters.push([c, v]); if (w.filters.length === 2) { writes.push(w); return Promise.resolve({ error: null }); } return chain; } };
          return chain;
        },
      };
    },
  };
}

test('pause preserves work: a claimed campaign goes back to SCHEDULED, a running one is left alone', async () => {
  const db = fakeDb();
  const now = new Date('2026-10-29T10:00:00Z');
  assert.equal(await gate.rearmPausedCampaign(db, 'c1', false, now), 'RESCHEDULED');
  assert.deepEqual(db.writes, [{
    table: 'outreach_campaigns',
    row: { status: 'SCHEDULED', last_send_error: 'SERVICE_DISABLED', updated_at: now.toISOString() },
    filters: [['id', 'c1'], ['status', 'RUNNING']],
  }], 'back to SCHEDULED, scheduled_at untouched, only if still RUNNING');
  assert.equal('scheduled_at' in db.writes[0].row, false, 'the time is kept');
  assert.notEqual(db.writes[0].row.status, 'FAILED');

  const db2 = fakeDb();
  assert.equal(await gate.rearmPausedCampaign(db2, 'c2', true, now), 'KEPT_RUNNING');
  assert.deepEqual(db2.writes, [], 'a campaign already under way is not touched');
});
