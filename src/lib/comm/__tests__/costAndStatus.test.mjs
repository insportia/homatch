// Money, and the words providers use for it.
//
// §44's double-count guard is the expensive one: Vapi reports a total AND its
// parts, and summing everything it returns overstates every call by roughly a
// factor of two — in the direction that looks healthy on a margin report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCogs, computePrice, estimateCampaignCost, reservationForCampaign,
  canDispatchWithinCap, isBetterCostSource,
} from '../cost.ts';
import {
  mapMetaMessageStatus, mapMetaMessageKind, isPermanentMetaFailure, isMetaOptOutSignal,
  mapVapiCallStatus, mapVapiEndedReason, deriveCallOutcome, isForwardCallTransition,
  mapRetellCallStatus, requiresTemplate, isWithinServiceWindow, serviceWindowExpiry,
} from '../statusMap.ts';
import { isForwardMessageTransition, customerFacingComplianceLabel } from '../vocabulary.ts';

// ── Double counting ─────────────────────────────────────────────────────────

test('a bundled component is dropped when the line that contains it is present', () => {
  const result = computeCogs([
    { component: 'ORCHESTRATION', provider: 'VAPI', cents: 100, source: 'PROVIDER_ACTUAL' },
    { component: 'STT', provider: 'VAPI', cents: 20, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION' },
    { component: 'LLM', provider: 'VAPI', cents: 30, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION' },
    { component: 'TTS', provider: 'VAPI', cents: 25, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION' },
  ]);
  // 100, not 175.
  assert.equal(result.totalCents, 100);
  assert.equal(result.suppressed.length, 3);
  // The suppressed lines keep their reason, so a margin report can explain a
  // total smaller than the sum of the provider's own line items.
  assert.ok(result.suppressed.every((c) => c.suppressedBecause.includes('ORCHESTRATION')));
});

test('the parts ARE counted when the bundle line is missing', () => {
  const result = computeCogs([
    { component: 'STT', provider: 'CARTESIA', cents: 20, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION' },
    { component: 'TTS', provider: 'CARTESIA', cents: 25, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION' },
  ]);
  assert.equal(result.totalCents, 45);
  assert.equal(result.suppressed.length, 0);
});

test('the same provider request charged twice is charged once', () => {
  const result = computeCogs([
    { component: 'MESSAGING', provider: 'META', cents: 5, source: 'PROVIDER_ACTUAL', providerRequestId: 'wamid.1' },
    { component: 'MESSAGING', provider: 'META', cents: 5, source: 'PROVIDER_ACTUAL', providerRequestId: 'wamid.1' },
  ]);
  assert.equal(result.totalCents, 5);
});

test('a total is only as good as its weakest source', () => {
  const result = computeCogs([
    { component: 'ORCHESTRATION', provider: 'VAPI', cents: 100, source: 'PROVIDER_ACTUAL' },
    { component: 'TELEPHONY', provider: 'TWILIO', cents: 10, source: 'FALLBACK_ESTIMATE' },
  ]);
  assert.equal(result.source, 'FALLBACK_ESTIMATE');
});

test('the source hierarchy §44 requires is the order used', () => {
  assert.equal(isBetterCostSource('PROVIDER_INVOICE', 'PROVIDER_ACTUAL'), true);
  assert.equal(isBetterCostSource('PROVIDER_ACTUAL', 'CONFIGURED_PRICE'), true);
  assert.equal(isBetterCostSource('CONFIGURED_PRICE', 'FALLBACK_ESTIMATE'), true);
  // An estimate never overwrites a measured actual.
  assert.equal(isBetterCostSource('FALLBACK_ESTIMATE', 'PROVIDER_ACTUAL'), false);
  assert.equal(isBetterCostSource('FALLBACK_ESTIMATE', null), true);
});

// ── Price ───────────────────────────────────────────────────────────────────

test('tax is charged on the net, not on the margin as well', () => {
  // VAT is a tax on the price Homatch charges. Applying markup to tax would
  // inflate the bill and misstate the liability.
  const result = computePrice({ cogsCents: 100, markupBps: 3000, taxBps: 1800 });
  assert.equal(result.netCents, 130);
  assert.equal(Math.round(result.taxCents * 100) / 100, 23.4);
  assert.equal(Math.round(result.grossCents * 100) / 100, 153.4);
});

test('nothing in the engine assumes 18%', () => {
  // §45: VAT must be configurable. A zero rate must produce a zero tax line.
  assert.equal(computePrice({ cogsCents: 100, markupBps: 3000, taxBps: 0 }).taxCents, 0);
  const twenty = computePrice({ cogsCents: 100, markupBps: 0, taxBps: 2000 });
  assert.equal(twenty.netCents, 100);
  assert.equal(twenty.taxCents, 20);
});

test('the margin floor stops a product quietly selling at a loss', () => {
  const result = computePrice({ cogsCents: 100, markupBps: 500, taxBps: 0, minGrossMarginBps: 3000 });
  assert.equal(result.marginFloorApplied, true);
  assert.ok(result.netCents > 105);
  assert.ok(result.realisedMarginBps >= 2999);
});

test('a fixed retail price ignores markup but still pays tax', () => {
  const result = computePrice({ cogsCents: 100, markupBps: 9000, taxBps: 1800, fixedRetailCents: 150 });
  assert.equal(result.netCents, 150);
  assert.equal(result.grossCents, 177);
});

// ── Estimates ───────────────────────────────────────────────────────────────

test('a call estimate is a range and says what it assumed', () => {
  // §110: Homatch does not know how long a stranger stays on the phone, and a
  // single confident figure there becomes an invoice dispute.
  const result = estimateCampaignCost({
    channel: 'AI_CALL', reachableRecipients: 100, unitNetCents: 20,
    taxBps: 1800, expectedAnswerRate: 0.25, durationRangeSec: [45, 180],
  });
  assert.equal(result.isRange, true);
  assert.ok(result.maxGrossCents > result.minGrossCents);
  assert.ok(result.basis.includes('25%'));
});

test('a WhatsApp estimate is a single figure, because the recipient count is known', () => {
  const result = estimateCampaignCost({
    channel: 'WHATSAPP', reachableRecipients: 100, unitNetCents: 5, taxBps: 1800,
  });
  assert.equal(result.isRange, false);
  assert.equal(result.minGrossCents, result.maxGrossCents);
  assert.equal(result.maxGrossCents, 590);
});

test('a reservation holds the maximum, not the expectation', () => {
  // §46: a hold that only covers the likely cost runs out mid-campaign.
  const estimate = { minGrossCents: 100, maxGrossCents: 500, isRange: true, basis: '' };
  assert.equal(reservationForCampaign(estimate, null), 500);
  // The customer's own cap still wins.
  assert.equal(reservationForCampaign(estimate, 300), 300);
});

test('a cap counts what is already on the wire', () => {
  // §111: calls already connected keep costing money, and ignoring that is how
  // a cap is exceeded by exactly the amount already in flight.
  assert.equal(canDispatchWithinCap({ spentCents: 80, inFlightCents: 0, nextUnitMaxCents: 20, capCents: 100 }), true);
  assert.equal(canDispatchWithinCap({ spentCents: 80, inFlightCents: 15, nextUnitMaxCents: 20, capCents: 100 }), false);
  assert.equal(canDispatchWithinCap({ spentCents: 9e9, inFlightCents: 0, nextUnitMaxCents: 1, capCents: null }), true);
});

// ── Meta ────────────────────────────────────────────────────────────────────

test('Meta statuses map onto Homatch vocabulary', () => {
  assert.equal(mapMetaMessageStatus('sent'), 'SENT');
  assert.equal(mapMetaMessageStatus('delivered'), 'DELIVERED');
  assert.equal(mapMetaMessageStatus('read'), 'READ');
  assert.equal(mapMetaMessageStatus('failed'), 'FAILED');
  // Undocumented-but-real values must not fall through to something that looks
  // like a failure.
  assert.equal(mapMetaMessageStatus('accepted'), 'QUEUED');
  assert.equal(mapMetaMessageStatus(undefined), 'QUEUED');
});

test('an inbound type Homatch cannot render is still recorded as something', () => {
  assert.equal(mapMetaMessageKind('text'), 'TEXT');
  assert.equal(mapMetaMessageKind('voice'), 'AUDIO');
  assert.equal(mapMetaMessageKind('contacts'), 'CONTACT');
  // The operator has to see that SOMETHING arrived.
  assert.equal(mapMetaMessageKind('some_new_meta_type'), 'UNSUPPORTED');
});

test('delivery never walks backwards on a reordered callback', () => {
  // Meta delivers `sent` after `read` often enough that it has to be designed
  // for, not patched around.
  assert.equal(isForwardMessageTransition('SENT', 'DELIVERED'), true);
  assert.equal(isForwardMessageTransition('READ', 'SENT'), false);
  assert.equal(isForwardMessageTransition('DELIVERED', 'DELIVERED'), false);
});

test('a number with no WhatsApp account is a permanent failure, not a retry', () => {
  assert.equal(isPermanentMetaFailure(131026), true);
  assert.equal(isPermanentMetaFailure(131050), true);
  // 131047 is "re-engagement required", which a template fixes. Retrying is
  // pointless but the number is not dead.
  assert.equal(isPermanentMetaFailure(131047), false);
  assert.equal(isMetaOptOutSignal(131050), true);
  assert.equal(isMetaOptOutSignal(131026), false);
});

test('the 24-hour window is read from the stored expiry, not recomputed', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const open = new Date('2026-09-12T20:00:00Z').toISOString();
  const closed = new Date('2026-09-12T11:00:00Z').toISOString();
  assert.equal(isWithinServiceWindow(open, now), true);
  assert.equal(requiresTemplate(open, now), false);
  assert.equal(requiresTemplate(closed, now), true);
  // No window at all means a template is required.
  assert.equal(requiresTemplate(null, now), true);
});

test('an inbound message reopens the window by exactly 24 hours', () => {
  const at = new Date('2026-09-12T12:00:00Z');
  assert.equal(serviceWindowExpiry(at).toISOString(), '2026-09-13T12:00:00.000Z');
});

// ── Voice ───────────────────────────────────────────────────────────────────

test('Vapi call statuses map onto the call lifecycle', () => {
  assert.equal(mapVapiCallStatus('queued'), 'QUEUED');
  assert.equal(mapVapiCallStatus('ringing'), 'RINGING');
  assert.equal(mapVapiCallStatus('in-progress'), 'ANSWERED');
});

test('"ended" says nothing on its own; the reason is where the outcome lives', () => {
  // The same value covers a four-minute qualified conversation and a number
  // that does not exist.
  assert.equal(mapVapiCallStatus('ended', 'customer-did-not-answer'), 'NO_ANSWER');
  assert.equal(mapVapiCallStatus('ended', 'customer-busy'), 'BUSY');
  assert.equal(mapVapiCallStatus('ended', 'customer-ended-call'), 'COMPLETED');
  assert.equal(mapVapiEndedReason('pipeline-error-openai'), 'FAILED');
  assert.equal(mapVapiEndedReason('voicemail'), 'NO_ANSWER');
});

test('a terminal call never moves again, whatever arrives late', () => {
  assert.equal(isForwardCallTransition('DIALING', 'ANSWERED'), true);
  assert.equal(isForwardCallTransition('ANSWERED', 'RINGING'), false);
  assert.equal(isForwardCallTransition('COMPLETED', 'ANSWERED'), false);
  assert.equal(isForwardCallTransition('FAILED', 'COMPLETED'), false);
});

test('the outcome is what the call achieved, not what the telephony did', () => {
  assert.equal(deriveCallOutcome({ status: 'NO_ANSWER' }), 'NO_ANSWER');
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', viewingInterest: true }), 'QUALIFIED');
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', callbackRequested: true }), 'CALLBACK');
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', humanHandoff: true }), 'HUMAN_HANDOFF');
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', interestLevel: 'NONE' }), 'NOT_INTERESTED');
  // A five-second connect is not a conversation.
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', durationSec: 3 }), 'NOT_INTERESTED');
  // Answered, ended, nothing extracted: no claim is made.
  assert.equal(deriveCallOutcome({ status: 'COMPLETED', durationSec: 90 }), null);
});

test('historical Retell events still read correctly', () => {
  // §104: historical records must keep working.
  assert.equal(mapRetellCallStatus('call_started'), 'ANSWERED');
  assert.equal(mapRetellCallStatus('call_ended'), 'COMPLETED');
});

test('a customer is told ready, needs review or paused, and nothing more', () => {
  assert.equal(customerFacingComplianceLabel('ALLOW'), 'READY');
  assert.equal(customerFacingComplianceLabel('THROTTLE'), 'READY');
  assert.equal(customerFacingComplianceLabel('REVIEW'), 'NEEDS_REVIEW');
  assert.equal(customerFacingComplianceLabel('BLOCK'), 'PAUSED_FOR_SAFETY');
});
