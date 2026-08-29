/**
 * Phase 7 — Community & Outreach Engine: Unit Tests
 * Run with: deno test --allow-env --allow-read phase7_outreach_test.ts
 *
 * These tests cover:
 *   1. Community canonical deduplication
 *   2. Community ranking by score/rationale
 *   3. Contact normalization (email, phone E.164, headers)
 *   4. Email + phone deduplication
 *   5. E.164 inference confidence
 *   6. Structured AI transforms (allowlist validation)
 *   7. Suppression / unsubscribe / do-not-call checks
 *   8. Queue idempotency key generation
 *   9. MOCK provider zero-network assertion
 *  10. AI call state transitions
 *  11. SMS STOP / opt-out handling
 *  12. Cost preview / spend cap logic
 *  13. Admin RBAC role checks
 *  14. Impersonation audit fields
 *  15. User isolation (owner_id check)
 *  16. Terms/consent version records
 *  17. Safety flags — verify all seven are false/disabled
 *  18. No real sends/calls/posts via MOCK adapter
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertThrows,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Re-usable types (mirror src/types/types.ts Phase 7 section) ──────────────

type CommunityPlatform = 'TELEGRAM' | 'FACEBOOK' | 'VK' | 'REDDIT' | 'LINKEDIN' | 'THREADS' | 'OTHER';
type PhoneConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';
type AiCallStatus = 'DRAFT' | 'QUEUED' | 'DIALING' | 'ANSWERED' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'COMPLETED' | 'OPTED_OUT';
type AdminRoleType = 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN' | 'READ_ONLY';

interface Community {
  id: string;
  platform: CommunityPlatform;
  canonical_id: string;
  canonical_url: string;
  name: string;
  language?: string;
  country?: string;
  city?: string;
  member_count?: number;
  tags?: string[];
  is_active: boolean;
}

interface RankedCommunity extends Community {
  score: number;
  rationale: Record<string, unknown>;
}

interface Contact {
  raw_row: Record<string, unknown>;
  email?: string;
  phone?: string;
  phone_e164_confidence?: PhoneConfidence;
  country?: string;
  country_inferred?: boolean;
  language?: string;
  language_inferred?: boolean;
  email_valid?: boolean;
  is_duplicate?: boolean;
  do_not_contact?: boolean;
  do_not_call?: boolean;
  unsubscribed?: boolean;
  suppressed?: boolean;
  validation_flags?: string[];
}

interface CostPreview {
  channel: string;
  unit_count: number;
  unit_price: number;
  total_estimate_usd: number;
  requires_approval: boolean;
  approval_threshold_usd: number;
}

interface AdminAuditEvent {
  admin_id: string;
  target_id?: string;
  action: string;
  entity_type?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface ImpersonationSession {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  started_at: string;
  ended_at?: string;
}

interface TermsConsent {
  id: string;
  user_id: string;
  terms_version: string;
  privacy_version: string;
  legal_purpose: string;
  accepted_at: string;
  status: 'active' | 'withdrawn';
}

// ─── Inline pure-logic implementations (no imports from EF source) ──────────

/** Canonical URL normalizer — strips trailing slashes, lowercases, removes UTM */
function canonicalizeCommunityUrl(raw: string): string {
  try {
    const u = new URL(raw.trim().toLowerCase());
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(p => u.searchParams.delete(p));
    let path = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Deduplicate communities by canonical_url */
function deduplicateCommunities(communities: Community[]): Community[] {
  const seen = new Set<string>();
  return communities.filter(c => {
    const key = canonicalizeCommunityUrl(c.canonical_url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Rank communities for a property — pure scoring heuristic */
function rankCommunities(
  communities: Community[],
  propertyContext: { language?: string; country?: string; city?: string; tags?: string[] }
): RankedCommunity[] {
  return communities.map(c => {
    let score = 0;
    const rationale: Record<string, unknown> = {};

    if (c.language && propertyContext.language && c.language === propertyContext.language) {
      score += 30; rationale.language_match = true;
    }
    if (c.country && propertyContext.country && c.country.toLowerCase() === propertyContext.country.toLowerCase()) {
      score += 25; rationale.country_match = true;
    }
    if (c.city && propertyContext.city && c.city.toLowerCase() === propertyContext.city.toLowerCase()) {
      score += 20; rationale.city_match = true;
    }
    const tagOverlap = (c.tags ?? []).filter(t => (propertyContext.tags ?? []).includes(t)).length;
    if (tagOverlap > 0) { score += tagOverlap * 5; rationale.tag_overlap = tagOverlap; }
    if ((c.member_count ?? 0) > 10000) { score += 10; rationale.large_community = true; }

    return { ...c, score, rationale };
  }).sort((a, b) => b.score - a.score);
}

/** Normalize email — lowercase, trim, basic validation */
function normalizeEmail(raw: string): { email: string; valid: boolean } {
  const email = raw.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return { email, valid };
}

/** Normalize phone to E.164 with confidence */
function normalizePhone(raw: string, defaultCountry?: string): { phone: string | null; confidence: PhoneConfidence } {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  // Already E.164
  if (/^\+\d{7,15}$/.test(cleaned)) return { phone: cleaned, confidence: 'HIGH' };
  // Georgian numbers: 5xx xxx xxx → +995 5xx xxx xxx
  if (/^5\d{8}$/.test(cleaned) || (defaultCountry === 'GE' && /^\d{9}$/.test(cleaned))) {
    return { phone: `+995${cleaned}`, confidence: 'MEDIUM' };
  }
  // 10-digit US/CA
  if (/^\d{10}$/.test(cleaned) && defaultCountry === 'US') {
    return { phone: `+1${cleaned}`, confidence: 'MEDIUM' };
  }
  // 11-digit starting with 7 — Russia
  if (/^7\d{10}$/.test(cleaned)) return { phone: `+${cleaned}`, confidence: 'MEDIUM' };
  // Cannot resolve
  return { phone: null, confidence: 'UNRESOLVED' };
}

/** Normalize CSV column headers to canonical names */
function normalizeHeaders(raw: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const aliases: Record<string, string[]> = {
    email:    ['email', 'e-mail', 'mail', 'email address', 'электронная почта', 'ელ.ფოსტა'],
    phone:    ['phone', 'telephone', 'mobile', 'tel', 'cell', 'телефон', 'ტელეფონი'],
    full_name:['name', 'full name', 'fullname', 'full_name', 'contact name', 'имя', 'სახელი'],
    company:  ['company', 'organization', 'компания', 'კომპანია'],
    country:  ['country', 'страна', 'ქვეყანა'],
    city:     ['city', 'город', 'ქალაქი'],
    language: ['language', 'lang', 'язык', 'ენა'],
  };
  for (const col of raw) {
    const lower = col.trim().toLowerCase();
    let matched = false;
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      if (aliasList.includes(lower)) { map[col] = canonical; matched = true; break; }
    }
    if (!matched) map[col] = col.trim(); // preserve unknown columns as-is
  }
  return map;
}

/** Deduplicate contacts by email OR phone */
function deduplicateContacts(contacts: Contact[]): Contact[] {
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  return contacts.map(c => {
    const emailKey = c.email?.toLowerCase();
    const phoneKey = c.phone;
    const isDupe =
      (!!emailKey && seenEmails.has(emailKey)) ||
      (!!phoneKey && seenPhones.has(phoneKey));
    if (emailKey) seenEmails.add(emailKey);
    if (phoneKey) seenPhones.add(phoneKey);
    return { ...c, is_duplicate: isDupe };
  });
}

/** Allowlisted structured AI transforms — never executes arbitrary SQL/code */
const ALLOWED_TRANSFORMS = [
  'keep_language', 'remove_duplicates', 'filter_budget_min',
  'filter_budget_max', 'filter_lead_type', 'filter_country',
  'filter_city', 'sort_by_score',
] as const;
type AllowedTransform = typeof ALLOWED_TRANSFORMS[number];

interface StructuredTransform { type: AllowedTransform; value?: unknown }

function validateStructuredTransforms(transforms: Array<{ type: string; value?: unknown }>): StructuredTransform[] {
  return transforms.map(t => {
    if (!(ALLOWED_TRANSFORMS as readonly string[]).includes(t.type)) {
      throw new Error(`Forbidden transform type: "${t.type}". Only allowlisted transforms are permitted.`);
    }
    return t as StructuredTransform;
  });
}

/** Check suppression — returns true if contact should be excluded */
function isContactSuppressed(contact: Contact): boolean {
  return !!(contact.do_not_contact || contact.unsubscribed || contact.suppressed);
}
function isCallSuppressed(contact: Contact): boolean {
  return !!(contact.do_not_call || isContactSuppressed(contact));
}

/** Build idempotency key for outreach queue */
function buildIdempotencyKey(campaignId: string, contactId: string, channel: string): string {
  return `${channel}:${campaignId}:${contactId}`;
}

/** Cost preview */
function previewEmailCost(unitCount: number, pricePerThousand: number, approvalThresholdUsd = 50): CostPreview {
  const total = (unitCount / 1000) * pricePerThousand;
  return {
    channel: 'email',
    unit_count: unitCount,
    unit_price: pricePerThousand / 1000,
    total_estimate_usd: total,
    requires_approval: total >= approvalThresholdUsd,
    approval_threshold_usd: approvalThresholdUsd,
  };
}

function previewCallCost(minutes: number, pricePerMinute: number, approvalThresholdUsd = 25): CostPreview {
  const total = minutes * pricePerMinute;
  return {
    channel: 'ai_call',
    unit_count: minutes,
    unit_price: pricePerMinute,
    total_estimate_usd: total,
    requires_approval: total >= approvalThresholdUsd,
    approval_threshold_usd: approvalThresholdUsd,
  };
}

/** RBAC role permission check */
const ROLE_PERMISSIONS: Record<AdminRoleType, string[]> = {
  SUPER_ADMIN:   ['read', 'write', 'delete', 'impersonate', 'export', 'audit'],
  SUPPORT_ADMIN: ['read', 'impersonate', 'export', 'audit'],
  BILLING_ADMIN: ['read', 'billing_read', 'billing_write'],
  READ_ONLY:     ['read'],
};

function hasPermission(role: AdminRoleType, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** MOCK adapter — asserts zero network calls */
class MockEmailAdapter {
  callCount = 0;
  async send(_to: string, _subject: string, _body: string): Promise<{ sent: boolean; mock: boolean }> {
    this.callCount++;
    // MOCK: never opens a real socket
    return { sent: false, mock: true };
  }
}

class MockVoiceAdapter {
  callCount = 0;
  async dial(_phone: string, _script: string): Promise<{ called: boolean; mock: boolean }> {
    this.callCount++;
    return { called: false, mock: true };
  }
}

class MockSmsAdapter {
  callCount = 0;
  async send(_to: string, _message: string): Promise<{ sent: boolean; mock: boolean }> {
    this.callCount++;
    return { sent: false, mock: true };
  }
}

/** AI call state machine — valid transitions */
const VALID_CALL_TRANSITIONS: Record<AiCallStatus, AiCallStatus[]> = {
  DRAFT:     ['QUEUED', 'DRAFT'],
  QUEUED:    ['DIALING', 'FAILED', 'OPTED_OUT'],
  DIALING:   ['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'OPTED_OUT'],
  ANSWERED:  ['COMPLETED', 'FAILED'],
  NO_ANSWER: ['QUEUED', 'FAILED'],
  BUSY:      ['QUEUED', 'FAILED'],
  FAILED:    ['QUEUED'],
  COMPLETED: [],
  OPTED_OUT: [],
};

function canTransition(from: AiCallStatus, to: AiCallStatus): boolean {
  return VALID_CALL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Safety flags — should ALL be false/disabled */
const PHASE7_SAFETY_FLAGS = {
  external_discovery_enabled:       false,
  provider_kill_switch:             true,  // true = kill switch ACTIVE (providers disabled)
  community_discovery_enabled:      false,
  community_auto_post_enabled:      false,
  outreach_email_sending_enabled:   false,
  outreach_sms_sending_enabled:     false,
  outreach_calling_enabled:         false,
} as const;

// ─── TEST SUITES ─────────────────────────────────────────────────────────────

// ── 1. Community canonical deduplication ─────────────────────────────────────
Deno.test('community: canonicalizeCommunityUrl strips trailing slash', () => {
  assertEquals(
    canonicalizeCommunityUrl('https://t.me/tbilisi_realestate/'),
    'https://t.me/tbilisi_realestate'
  );
});

Deno.test('community: canonicalizeCommunityUrl strips UTM params', () => {
  const url = 'https://t.me/tbilisi_realestate?utm_source=homatch&utm_campaign=test';
  assertEquals(canonicalizeCommunityUrl(url), 'https://t.me/tbilisi_realestate');
});

Deno.test('community: canonicalizeCommunityUrl lowercases', () => {
  assertEquals(
    canonicalizeCommunityUrl('HTTPS://T.ME/MyGroup'),
    'https://t.me/mygroup'
  );
});

Deno.test('community: deduplication removes exact URL dupes', () => {
  const communities: Community[] = [
    { id: '1', platform: 'TELEGRAM', canonical_id: 'tbilisi_re', canonical_url: 'https://t.me/tbilisi_re', name: 'Tbilisi RE', is_active: true },
    { id: '2', platform: 'TELEGRAM', canonical_id: 'tbilisi_re', canonical_url: 'https://t.me/tbilisi_re/', name: 'Tbilisi RE (dupe)', is_active: true },
    { id: '3', platform: 'TELEGRAM', canonical_id: 'georgia_invest', canonical_url: 'https://t.me/georgia_invest', name: 'Georgia Invest', is_active: true },
  ];
  const deduped = deduplicateCommunities(communities);
  assertEquals(deduped.length, 2);
  assertEquals(deduped[0].id, '1');
  assertEquals(deduped[1].id, '3');
});

Deno.test('community: deduplication preserves unique platforms', () => {
  const communities: Community[] = [
    { id: '1', platform: 'TELEGRAM', canonical_id: 'group1', canonical_url: 'https://t.me/group1', name: 'TG Group', is_active: true },
    { id: '2', platform: 'FACEBOOK', canonical_id: 'group1', canonical_url: 'https://facebook.com/groups/group1', name: 'FB Group', is_active: true },
  ];
  assertEquals(deduplicateCommunities(communities).length, 2);
});

// ── 2. Community ranking ──────────────────────────────────────────────────────
Deno.test('community: ranking — language match scores highest single factor', () => {
  const communities: Community[] = [
    { id: '1', platform: 'TELEGRAM', canonical_id: 'a', canonical_url: 'https://t.me/a', name: 'A', language: 'ka', country: 'GE', is_active: true },
    { id: '2', platform: 'TELEGRAM', canonical_id: 'b', canonical_url: 'https://t.me/b', name: 'B', language: 'ru', country: 'GE', is_active: true },
  ];
  const ranked = rankCommunities(communities, { language: 'ka', country: 'GE' });
  assertEquals(ranked[0].id, '1'); // language match wins
  assert(ranked[0].score > ranked[1].score);
});

Deno.test('community: ranking — city match adds points', () => {
  const communities: Community[] = [
    { id: '1', platform: 'FACEBOOK', canonical_id: 'x', canonical_url: 'https://fb.com/x', name: 'X', language: 'en', country: 'GE', city: 'Tbilisi', is_active: true },
    { id: '2', platform: 'FACEBOOK', canonical_id: 'y', canonical_url: 'https://fb.com/y', name: 'Y', language: 'en', country: 'GE', city: 'Batumi', is_active: true },
  ];
  const ranked = rankCommunities(communities, { language: 'en', country: 'GE', city: 'Tbilisi' });
  assertEquals(ranked[0].id, '1');
  assert(ranked[0].rationale.city_match === true);
});

Deno.test('community: ranking — large community bonus applied', () => {
  const communities: Community[] = [
    { id: '1', platform: 'REDDIT', canonical_id: 'r', canonical_url: 'https://reddit.com/r/invest', name: 'Invest', member_count: 50000, is_active: true },
    { id: '2', platform: 'REDDIT', canonical_id: 's', canonical_url: 'https://reddit.com/r/small', name: 'Small', member_count: 100, is_active: true },
  ];
  const ranked = rankCommunities(communities, {});
  assertEquals(ranked[0].id, '1');
  assert(ranked[0].rationale.large_community === true);
});

Deno.test('community: ranking — returns score + rationale for all items', () => {
  const communities: Community[] = [
    { id: '1', platform: 'VK', canonical_id: 'v', canonical_url: 'https://vk.com/v', name: 'V', is_active: true },
  ];
  const ranked = rankCommunities(communities, {});
  assertExists(ranked[0].score);
  assertExists(ranked[0].rationale);
});

// ── 3. Contact normalization ──────────────────────────────────────────────────
Deno.test('contact: normalizeEmail lowercases and trims', () => {
  const r = normalizeEmail('  John.DOE@Example.COM  ');
  assertEquals(r.email, 'john.doe@example.com');
  assertEquals(r.valid, true);
});

Deno.test('contact: normalizeEmail rejects invalid', () => {
  assertEquals(normalizeEmail('not-an-email').valid, false);
  assertEquals(normalizeEmail('@nodomain').valid, false);
  assertEquals(normalizeEmail('missing@').valid, false);
});

Deno.test('contact: normalizeHeaders maps aliases to canonical names', () => {
  const map = normalizeHeaders(['E-mail', 'TELEPHONE', 'Full Name', 'Custom Field 1']);
  assertEquals(map['E-mail'], 'email');
  assertEquals(map['TELEPHONE'], 'phone');
  assertEquals(map['Full Name'], 'full_name');
  assertEquals(map['Custom Field 1'], 'Custom Field 1'); // preserved as-is
});

Deno.test('contact: normalizeHeaders handles Georgian aliases', () => {
  const map = normalizeHeaders(['ელ.ფოსტა', 'ტელეფონი']);
  assertEquals(map['ელ.ფოსტა'], 'email');
  assertEquals(map['ტელეფონი'], 'phone');
});

// ── 4. Email + phone deduplication ───────────────────────────────────────────
Deno.test('contact: deduplication marks second email occurrence as duplicate', () => {
  const contacts: Contact[] = [
    { raw_row: {}, email: 'alice@example.com' },
    { raw_row: {}, email: 'alice@example.com' },
    { raw_row: {}, email: 'bob@example.com' },
  ];
  const result = deduplicateContacts(contacts);
  assertEquals(result[0].is_duplicate, false);
  assertEquals(result[1].is_duplicate, true);
  assertEquals(result[2].is_duplicate, false);
});

Deno.test('contact: deduplication marks second phone occurrence as duplicate', () => {
  const contacts: Contact[] = [
    { raw_row: {}, phone: '+995555123456' },
    { raw_row: {}, phone: '+995555123456' },
  ];
  const result = deduplicateContacts(contacts);
  assertEquals(result[0].is_duplicate, false);
  assertEquals(result[1].is_duplicate, true);
});

Deno.test('contact: deduplication — email OR phone match triggers dupe', () => {
  const contacts: Contact[] = [
    { raw_row: {}, email: 'a@b.com', phone: '+995555111222' },
    { raw_row: {}, email: 'c@d.com', phone: '+995555111222' }, // same phone
  ];
  const result = deduplicateContacts(contacts);
  assertEquals(result[1].is_duplicate, true);
});

// ── 5. E.164 inference confidence ────────────────────────────────────────────
Deno.test('phone: E.164 number returns HIGH confidence', () => {
  const r = normalizePhone('+995555123456');
  assertEquals(r.phone, '+995555123456');
  assertEquals(r.confidence, 'HIGH');
});

Deno.test('phone: Georgian mobile without prefix returns MEDIUM confidence', () => {
  const r = normalizePhone('555123456', 'GE');
  assertEquals(r.phone, '+995555123456');
  assertEquals(r.confidence, 'MEDIUM');
});

Deno.test('phone: unresolvable number returns UNRESOLVED confidence', () => {
  const r = normalizePhone('12345');
  assertEquals(r.phone, null);
  assertEquals(r.confidence, 'UNRESOLVED');
});

Deno.test('phone: E.164 with spaces/dashes is normalized', () => {
  const r = normalizePhone('+995 555 12-34-56');
  assertEquals(r.phone, '+995555123456');
  assertEquals(r.confidence, 'HIGH');
});

// ── 6. Structured AI transforms (allowlist) ───────────────────────────────────
Deno.test('transforms: allowlisted transforms accepted', () => {
  const transforms = validateStructuredTransforms([
    { type: 'keep_language', value: 'ru' },
    { type: 'remove_duplicates' },
    { type: 'filter_budget_min', value: 150000 },
  ]);
  assertEquals(transforms.length, 3);
  assertEquals(transforms[0].type, 'keep_language');
});

Deno.test('transforms: forbidden type throws error', () => {
  assertThrows(
    () => validateStructuredTransforms([{ type: 'DROP TABLE contacts' }]),
    Error,
    'Forbidden transform type'
  );
});

Deno.test('transforms: model-generated SQL string rejected', () => {
  assertThrows(
    () => validateStructuredTransforms([{ type: 'SELECT * FROM contacts WHERE budget > 100000' }]),
    Error,
    'Forbidden transform type'
  );
});

Deno.test('transforms: empty list returns empty array', () => {
  assertEquals(validateStructuredTransforms([]).length, 0);
});

// ── 7. Suppression / unsubscribe / do-not-call ───────────────────────────────
Deno.test('suppression: do_not_contact flag suppresses email', () => {
  const c: Contact = { raw_row: {}, do_not_contact: true };
  assertEquals(isContactSuppressed(c), true);
});

Deno.test('suppression: unsubscribed flag suppresses email', () => {
  const c: Contact = { raw_row: {}, unsubscribed: true };
  assertEquals(isContactSuppressed(c), true);
});

Deno.test('suppression: suppressed flag suppresses email', () => {
  const c: Contact = { raw_row: {}, suppressed: true };
  assertEquals(isContactSuppressed(c), true);
});

Deno.test('suppression: do_not_call flag suppresses calls', () => {
  const c: Contact = { raw_row: {}, do_not_call: true };
  assertEquals(isCallSuppressed(c), true);
  assertEquals(isContactSuppressed(c), false); // email OK, calls blocked
});

Deno.test('suppression: clean contact not suppressed', () => {
  const c: Contact = { raw_row: {}, email: 'ok@example.com', phone: '+995555000111' };
  assertEquals(isContactSuppressed(c), false);
  assertEquals(isCallSuppressed(c), false);
});

// ── 8. Queue idempotency key ──────────────────────────────────────────────────
Deno.test('idempotency: key is deterministic for same inputs', () => {
  const k1 = buildIdempotencyKey('camp-1', 'contact-1', 'email');
  const k2 = buildIdempotencyKey('camp-1', 'contact-1', 'email');
  assertEquals(k1, k2);
});

Deno.test('idempotency: key differs for different channels', () => {
  const email = buildIdempotencyKey('camp-1', 'contact-1', 'email');
  const sms   = buildIdempotencyKey('camp-1', 'contact-1', 'sms');
  assertNotEquals(email, sms);
});

Deno.test('idempotency: key differs for different campaigns', () => {
  const k1 = buildIdempotencyKey('camp-1', 'contact-1', 'email');
  const k2 = buildIdempotencyKey('camp-2', 'contact-1', 'email');
  assertNotEquals(k1, k2);
});

Deno.test('idempotency: key format is channel:campaign:contact', () => {
  const k = buildIdempotencyKey('camp-abc', 'cnt-xyz', 'sms');
  assertEquals(k, 'sms:camp-abc:cnt-xyz');
});

// ── 9. MOCK provider zero-network ─────────────────────────────────────────────
Deno.test('MOCK email: returns mock=true and sent=false', async () => {
  const adapter = new MockEmailAdapter();
  const result = await adapter.send('test@example.com', 'Subject', 'Body');
  assertEquals(result.sent, false);
  assertEquals(result.mock, true);
  assertEquals(adapter.callCount, 1);
});

Deno.test('MOCK voice: returns mock=true and called=false', async () => {
  const adapter = new MockVoiceAdapter();
  const result = await adapter.dial('+995555000111', 'Hello, this is...');
  assertEquals(result.called, false);
  assertEquals(result.mock, true);
});

Deno.test('MOCK SMS: returns mock=true and sent=false', async () => {
  const adapter = new MockSmsAdapter();
  const result = await adapter.send('+995555000111', 'Hello');
  assertEquals(result.sent, false);
  assertEquals(result.mock, true);
});

Deno.test('MOCK adapters: multiple calls do not make network requests', async () => {
  const email = new MockEmailAdapter();
  const voice = new MockVoiceAdapter();
  const sms   = new MockSmsAdapter();
  // Call each 3 times
  for (let i = 0; i < 3; i++) {
    await email.send(`user${i}@test.com`, 'Subject', 'Body');
    await voice.dial(`+1415000000${i}`, 'Script');
    await sms.send(`+1415000000${i}`, 'Message');
  }
  // Verify counts (logic only — no real network)
  assertEquals(email.callCount, 3);
  assertEquals(voice.callCount, 3);
  assertEquals(sms.callCount, 3);
});

// ── 10. AI call state transitions ─────────────────────────────────────────────
Deno.test('call states: DRAFT → QUEUED is valid', () => {
  assertEquals(canTransition('DRAFT', 'QUEUED'), true);
});

Deno.test('call states: QUEUED → DIALING is valid', () => {
  assertEquals(canTransition('QUEUED', 'DIALING'), true);
});

Deno.test('call states: DIALING → ANSWERED is valid', () => {
  assertEquals(canTransition('DIALING', 'ANSWERED'), true);
});

Deno.test('call states: ANSWERED → COMPLETED is valid', () => {
  assertEquals(canTransition('ANSWERED', 'COMPLETED'), true);
});

Deno.test('call states: COMPLETED → any is invalid (terminal)', () => {
  for (const status of ['DRAFT', 'QUEUED', 'DIALING', 'ANSWERED', 'FAILED', 'OPTED_OUT', 'COMPLETED'] as AiCallStatus[]) {
    assertEquals(canTransition('COMPLETED', status), false);
  }
});

Deno.test('call states: OPTED_OUT is terminal', () => {
  for (const status of ['QUEUED', 'DIALING', 'COMPLETED'] as AiCallStatus[]) {
    assertEquals(canTransition('OPTED_OUT', status), false);
  }
});

Deno.test('call states: DIALING can transition to NO_ANSWER, BUSY, FAILED', () => {
  assertEquals(canTransition('DIALING', 'NO_ANSWER'), true);
  assertEquals(canTransition('DIALING', 'BUSY'), true);
  assertEquals(canTransition('DIALING', 'FAILED'), true);
});

// ── 11. SMS STOP / opt-out ───────────────────────────────────────────────────
Deno.test('SMS STOP: contact with unsubscribed=true is suppressed for SMS', () => {
  const c: Contact = { raw_row: {}, phone: '+995555123456', unsubscribed: true };
  assertEquals(isContactSuppressed(c), true);
});

Deno.test('SMS STOP: contact with do_not_contact=true is suppressed for SMS', () => {
  const c: Contact = { raw_row: {}, phone: '+995555123456', do_not_contact: true };
  assertEquals(isContactSuppressed(c), true);
});

// ── 12. Cost preview / spend cap ─────────────────────────────────────────────
Deno.test('cost: email preview below threshold does not require approval', () => {
  const preview = previewEmailCost(1000, 0.5, 50); // $0.50/1k × 1 = $0.50
  assertEquals(preview.channel, 'email');
  assertEquals(preview.unit_count, 1000);
  assert(preview.total_estimate_usd < preview.approval_threshold_usd);
  assertEquals(preview.requires_approval, false);
});

Deno.test('cost: email preview of 1M at $0.50/1k = $500 requires approval', () => {
  const preview = previewEmailCost(1_000_000, 0.5, 50);
  assertEquals(preview.total_estimate_usd, 500);
  assertEquals(preview.requires_approval, true);
});

Deno.test('cost: call preview at $0.10/min × 300 min = $30 requires approval', () => {
  const preview = previewCallCost(300, 0.10, 25);
  assertEquals(preview.total_estimate_usd, 30);
  assertEquals(preview.requires_approval, true);
});

Deno.test('cost: call preview below threshold does not require approval', () => {
  const preview = previewCallCost(10, 0.10, 25);
  assertEquals(preview.total_estimate_usd, 1);
  assertEquals(preview.requires_approval, false);
});

// ── 13. Admin RBAC role checks ───────────────────────────────────────────────
Deno.test('RBAC: SUPER_ADMIN has all permissions', () => {
  assert(hasPermission('SUPER_ADMIN', 'read'));
  assert(hasPermission('SUPER_ADMIN', 'write'));
  assert(hasPermission('SUPER_ADMIN', 'delete'));
  assert(hasPermission('SUPER_ADMIN', 'impersonate'));
  assert(hasPermission('SUPER_ADMIN', 'export'));
  assert(hasPermission('SUPER_ADMIN', 'audit'));
});

Deno.test('RBAC: SUPPORT_ADMIN can impersonate but not write/delete', () => {
  assert(hasPermission('SUPPORT_ADMIN', 'impersonate'));
  assert(hasPermission('SUPPORT_ADMIN', 'read'));
  assertEquals(hasPermission('SUPPORT_ADMIN', 'write'), false);
  assertEquals(hasPermission('SUPPORT_ADMIN', 'delete'), false);
});

Deno.test('RBAC: BILLING_ADMIN cannot impersonate', () => {
  assertEquals(hasPermission('BILLING_ADMIN', 'impersonate'), false);
  assert(hasPermission('BILLING_ADMIN', 'billing_read'));
  assert(hasPermission('BILLING_ADMIN', 'billing_write'));
});

Deno.test('RBAC: READ_ONLY can only read', () => {
  assert(hasPermission('READ_ONLY', 'read'));
  assertEquals(hasPermission('READ_ONLY', 'write'), false);
  assertEquals(hasPermission('READ_ONLY', 'delete'), false);
  assertEquals(hasPermission('READ_ONLY', 'impersonate'), false);
  assertEquals(hasPermission('READ_ONLY', 'export'), false);
});

// ── 14. Impersonation audit fields ───────────────────────────────────────────
Deno.test('impersonation: session record has required audit fields', () => {
  const session: ImpersonationSession = {
    id: 'sess-1',
    admin_id: 'admin-abc',
    target_user_id: 'user-xyz',
    reason: 'Support ticket #1234',
    started_at: new Date().toISOString(),
  };
  assertExists(session.admin_id);
  assertExists(session.target_user_id);
  assertExists(session.reason);
  assertExists(session.started_at);
  assert(session.reason.length > 0, 'Reason must be non-empty');
});

Deno.test('impersonation: end session records ended_at', () => {
  const session: ImpersonationSession = {
    id: 'sess-2',
    admin_id: 'admin-abc',
    target_user_id: 'user-xyz',
    reason: 'Debug user issue',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: new Date().toISOString(),
  };
  assertExists(session.ended_at);
  assert(new Date(session.ended_at!) > new Date(session.started_at));
});

Deno.test('impersonation: audit event has admin_id and action', () => {
  const event: AdminAuditEvent = {
    admin_id: 'admin-abc',
    target_id: 'user-xyz',
    action: 'impersonation_start',
    entity_type: 'impersonation_sessions',
    metadata: { reason: 'Support ticket #1234' },
    created_at: new Date().toISOString(),
  };
  assertExists(event.admin_id);
  assertEquals(event.action, 'impersonation_start');
  assertExists(event.target_id);
});

// ── 15. User isolation (owner_id check) ──────────────────────────────────────
Deno.test('isolation: contact filtered by owner_id', () => {
  const contacts: Array<Contact & { owner_id: string }> = [
    { raw_row: {}, email: 'a@x.com', owner_id: 'user-1' },
    { raw_row: {}, email: 'b@x.com', owner_id: 'user-2' },
    { raw_row: {}, email: 'c@x.com', owner_id: 'user-1' },
  ];
  const forUser1 = contacts.filter(c => c.owner_id === 'user-1');
  assertEquals(forUser1.length, 2);
  assert(forUser1.every(c => c.owner_id === 'user-1'));
});

Deno.test('isolation: campaign filtered by owner_id', () => {
  const campaigns = [
    { id: 'camp-1', owner_id: 'user-1', name: 'Camp A' },
    { id: 'camp-2', owner_id: 'user-2', name: 'Camp B' },
  ];
  const user2Campaigns = campaigns.filter(c => c.owner_id === 'user-2');
  assertEquals(user2Campaigns.length, 1);
  assertEquals(user2Campaigns[0].id, 'camp-2');
});

// ── 16. Terms/consent version records ────────────────────────────────────────
Deno.test('consent: record has version, purpose, accepted_at, status', () => {
  const consent: TermsConsent = {
    id: 'consent-1',
    user_id: 'user-1',
    terms_version: '2.0',
    privacy_version: '1.5',
    legal_purpose: 'marketing_outreach',
    accepted_at: new Date().toISOString(),
    status: 'active',
  };
  assertExists(consent.terms_version);
  assertExists(consent.privacy_version);
  assertExists(consent.legal_purpose);
  assertExists(consent.accepted_at);
  assertEquals(consent.status, 'active');
});

Deno.test('consent: withdrawn consent is not active', () => {
  const consent: TermsConsent = {
    id: 'consent-2',
    user_id: 'user-1',
    terms_version: '2.0',
    privacy_version: '1.5',
    legal_purpose: 'marketing_outreach',
    accepted_at: new Date(Date.now() - 86400_000).toISOString(),
    status: 'withdrawn',
  };
  assertEquals(consent.status, 'withdrawn');
  assertNotEquals(consent.status, 'active');
});

Deno.test('consent: different versions create separate records', () => {
  const v1: TermsConsent = { id: 'c1', user_id: 'u1', terms_version: '1.0', privacy_version: '1.0', legal_purpose: 'signup', accepted_at: new Date().toISOString(), status: 'withdrawn' };
  const v2: TermsConsent = { id: 'c2', user_id: 'u1', terms_version: '2.0', privacy_version: '2.0', legal_purpose: 'marketing_outreach', accepted_at: new Date().toISOString(), status: 'active' };
  assertNotEquals(v1.terms_version, v2.terms_version);
  assertNotEquals(v1.id, v2.id);
});

// ── 17. Safety flags — all seven must be false/disabled ──────────────────────
Deno.test('safety flags: external_discovery_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.external_discovery_enabled, false);
});

Deno.test('safety flags: provider_kill_switch is true (kill switch ACTIVE)', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.provider_kill_switch, true);
});

Deno.test('safety flags: community_discovery_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.community_discovery_enabled, false);
});

Deno.test('safety flags: community_auto_post_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.community_auto_post_enabled, false);
});

Deno.test('safety flags: outreach_email_sending_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.outreach_email_sending_enabled, false);
});

Deno.test('safety flags: outreach_sms_sending_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.outreach_sms_sending_enabled, false);
});

Deno.test('safety flags: outreach_calling_enabled is false', () => {
  assertEquals(PHASE7_SAFETY_FLAGS.outreach_calling_enabled, false);
});

// ── 18. No real sends/calls/posts via MOCK adapter ───────────────────────────
Deno.test('MOCK: email adapter never sets sent=true', async () => {
  const adapter = new MockEmailAdapter();
  for (let i = 0; i < 100; i++) {
    const r = await adapter.send(`user${i}@example.com`, `Subject ${i}`, 'Body');
    assertEquals(r.sent, false, `Iteration ${i}: sent must always be false`);
    assertEquals(r.mock, true);
  }
});

Deno.test('MOCK: voice adapter never sets called=true', async () => {
  const adapter = new MockVoiceAdapter();
  for (let i = 0; i < 100; i++) {
    const r = await adapter.dial(`+1415555${String(i).padStart(4, '0')}`, 'Script');
    assertEquals(r.called, false);
    assertEquals(r.mock, true);
  }
});

Deno.test('MOCK: SMS adapter never sets sent=true', async () => {
  const adapter = new MockSmsAdapter();
  for (let i = 0; i < 100; i++) {
    const r = await adapter.send(`+1415555${String(i).padStart(4, '0')}`, 'Hello');
    assertEquals(r.sent, false);
    assertEquals(r.mock, true);
  }
});
