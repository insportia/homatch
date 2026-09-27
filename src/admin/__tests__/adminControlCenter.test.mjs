// THE ADMIN CONTROL CENTRE — what must stay true, checked on every commit.
//
// Most of the control centre is SQL, and the authorisation lives there. These
// tests read the migrations and the pages and fail when:
//
//   * an admin_* function can be reached without an is_admin() check, is
//     callable by anon, or runs without a pinned search_path;
//   * an admin read starts returning somebody's words — a message body, a
//     notification body, the text a signal was extracted from;
//   * a destination drops out of the navigation or loses adminOnly;
//   * "Log in as user" stops being read-only in the browser, stops showing
//     its banner in the CUSTOMER shell, or touches the admin's own session;
//   * a string is missing a language.
//
// The SQL itself was also executed against a local Postgres 16 stub of the
// production catalog (applied twice; every admin_ function refused a
// non-admin with 42501 and anon with "permission denied"). That run needs a
// database; this file does not, so it guards every commit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  IMPERSONATION_ALLOWED_FUNCTIONS,
  installReadOnlyGuards,
  isImpersonationBlockedFunction,
  isImpersonationBlockedRpc,
} from '../../lib/impersonation.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

const MIGRATIONS = readdirSync('supabase/migrations')
  .filter((f) => f >= '20260928200000' && f < '20260928300000')
  .sort();
const SQL = MIGRATIONS.map((f) => read(`supabase/migrations/${f}`)).join('\n');

/** Every `create or replace function public.<name>(...) ... $$ ... $$;` block. */
function functions() {
  const out = [];
  const re = /create or replace function public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?as \$\$([\s\S]*?)\$\$;/gi;
  for (const m of SQL.matchAll(re)) {
    const header = SQL.slice(m.index, m.index + m[0].indexOf('as $$'));
    /* Comments removed: a sentence that SAYS "messages are not read" must
       not satisfy, or fail, a check on what the SQL does. */
    const body = m[3].replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    out.push({ name: m[1], header, body });
  }
  return out;
}

test('the control-centre migrations are in the reserved version range', () => {
  assert.ok(MIGRATIONS.length >= 4, `expected the four control-centre migrations, found ${MIGRATIONS.join(', ')}`);
  for (const f of MIGRATIONS) assert.match(f, /^202609282\d{5}_[a-z0-9_]+\.sql$/);
});

test('every admin_* function checks is_admin() in SQL, is SECURITY DEFINER and pins search_path', () => {
  const admin = functions().filter((f) => f.name.startsWith('admin_'));
  assert.ok(admin.length >= 17, `only ${admin.length} admin functions found — the parser is broken`);
  for (const f of admin) {
    assert.match(f.header, /security definer/i, `${f.name} is not SECURITY DEFINER`);
    assert.match(f.header, /set search_path\s*=\s*public,\s*pg_temp/i, `${f.name} does not pin search_path`);
    /* The guard is the FIRST statement of the body, not somewhere later. */
    const firstStatement = f.body.slice(f.body.indexOf('begin') + 5).trim();
    assert.match(
      firstStatement,
      /^if not public\.is_admin\(\) then\s+raise exception 'FORBIDDEN: admin only' using errcode = '42501';/,
      `${f.name} does not open with the is_admin() guard`,
    );
  }
});

test('every admin_* function is revoked from PUBLIC and anon and granted to authenticated only', () => {
  const admin = functions().filter((f) => f.name.startsWith('admin_'));
  for (const f of admin) {
    assert.match(SQL, new RegExp(`revoke all on function public\\.${f.name}\\([^)]*\\) from public, anon;`),
      `${f.name} is not revoked from anon`);
    assert.match(SQL, new RegExp(`grant execute on function public\\.${f.name}\\([^)]*\\) to authenticated;`),
      `${f.name} is not granted to authenticated`);
    assert.doesNotMatch(SQL, new RegExp(`grant execute on function public\\.${f.name}\\([^)]*\\) to [^;]*anon`),
      `${f.name} is granted to anon`);
  }
});

test('internal helpers are not callable by any client role', () => {
  for (const f of functions().filter((x) => x.name.startsWith('homatch_'))) {
    assert.match(SQL, new RegExp(`revoke all on function public\\.${f.name}\\([^)]*\\) from public, anon, authenticated;`),
      `${f.name} is reachable by a client`);
  }
});

test('no admin read returns message bodies or the text a signal came from', () => {
  const byName = Object.fromEntries(functions().map((f) => [f.name, f.body]));
  const intel = byName.admin_intent_signals + byName.admin_user_effective_demand;
  assert.doesNotMatch(intel, /\bmessages\b|live_chat_messages|original_text|translated_text|raw_signals/,
    'the intelligence reads touch a table or column that holds somebody\'s words');
  assert.match(byName.admin_intent_signals, /'constraints', public\.homatch_safe_constraints\(s\.constraints\)/,
    'constraints leave the database unfiltered');
  assert.doesNotMatch(byName.admin_intent_signals, /'constraints', s\.constraints/);
  assert.match(byName.admin_user_effective_demand, /'criteria', public\.homatch_safe_constraints\(s\.search_criteria\)/);

  /* Notifications: the body is never selected, and a message notification
     does not even show its title. */
  const notif = byName.admin_notifications_list;
  assert.doesNotMatch(notif, /n\.body/, 'the notification reader selects the body');
  assert.match(notif, /'title', case when n\.type::text = 'NEW_MESSAGE' then null else n\.title end/);

  /* The lookup finds a conversation by who is in it and never reads messages. */
  assert.doesNotMatch(byName.admin_lookup, /\bmessages\b/);

  /* Constraints that name text, and long strings, are dropped. */
  const safe = byName.homatch_safe_constraints;
  assert.match(safe, /text\|quote\|message\|body\|raw\|excerpt\|snippet\|original/);
  assert.match(safe, /length\(v #>> '\{\}'\) <= 64/);
});

test('the typed search text is a value, not query syntax', () => {
  const byName = Object.fromEntries(functions().map((f) => [f.name, f.body]));
  for (const name of ['admin_search_users', 'admin_properties_search', 'admin_intent_signals', 'admin_supply_matches', 'admin_notifications_list', 'admin_campaigns_list']) {
    const body = byName[name];
    for (const like of body.match(/\slike\s[^\n]*/g) ?? []) {
      if (/v_like|homatch_ilike_escape|v_digits/.test(like)) continue;
      assert.fail(`${name} builds a LIKE pattern without escaping: ${like}`);
    }
    assert.doesNotMatch(body, /execute\s+format|execute\s+'/i, `${name} builds dynamic SQL`);
  }
  assert.match(byName.homatch_ilike_escape, /replace\(replace\(replace\(coalesce\(p, ''\), '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/);
});

test('revealing a contact number requires a reason and is audited before it returns', () => {
  const body = functions().find((f) => f.name === 'admin_property_reveal_contact').body;
  assert.match(body, /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 5/);
  const audit = body.indexOf("'CONTACT_PHONE_REVEALED'");
  const ret = body.indexOf("'listing_phone'");
  assert.ok(audit > 0 && ret > audit, 'the audit row is not written before the number is returned');
  /* The number itself never goes into the audit metadata. */
  assert.doesNotMatch(body.slice(audit, ret), /contact_phone|v_owner_phone/);
});

test('announcement mutations are audited and publishing stays idempotent', () => {
  const byName = Object.fromEntries(functions().map((f) => [f.name, f.body]));
  assert.match(byName.admin_announcement_save, /'ANNOUNCEMENT_CREATED'/);
  assert.match(byName.admin_announcement_save, /'ANNOUNCEMENT_UPDATED'/);
  assert.match(byName.admin_announcement_save, /SLUG_FROZEN_AFTER_PUBLISH/);
  assert.match(byName.admin_announcement_save, /DEEP_LINK_MUST_BE_APP_PATH/);
  assert.match(byName.admin_announcement_publish, /public\.publish_announcement\(a\.slug\)/);
  assert.match(byName.admin_announcement_publish, /'ANNOUNCEMENT_PUBLISHED'/);
  assert.match(byName.admin_announcement_set_archived, /'ANNOUNCEMENT_ARCHIVED'/);
  assert.match(SQL, /for select using \(published_at is not null and published_at <= now\(\) and archived_at is null\)/,
    'an archived announcement is still readable by customers');
});

test('an impersonation session is read-only in Postgres, and stays so after Exit', () => {
  assert.match(SQL, /create or replace function public\.is_impersonated_session\(\)/);
  /* Keyed on the session id alone — NOT on ended_at — so a token that
     outlives Exit is still refused. */
  const body = functions().find((f) => f.name === 'is_impersonated_session').body;
  assert.match(body, /i\.auth_session_id = v_sid::uuid/);
  assert.doesNotMatch(body, /ended_at/);
  for (const table of ['messages', 'properties', 'payments', 'push_subscriptions', 'users']) {
    assert.ok(SQL.includes(`'${table}'`), `${table} is not covered by the read-only policies`);
  }
  assert.match(SQL, /as restrictive for insert to authenticated/);
  for (const table of ['credit_ledger', 'usage_reservations', 'payments', 'messages']) {
    assert.ok(SQL.includes(`'${table}'`), `${table} has no read-only trigger`);
  }
  assert.match(SQL, /before insert or update or delete on public\.%I/);
});

test('the browser half of impersonation refuses writes before any request is made', async () => {
  assert.deepEqual([...IMPERSONATION_ALLOWED_FUNCTIONS].sort(), ['impersonate-user', 'storage-sign']);
  assert.equal(isImpersonationBlockedFunction('credits-topup'), true);
  assert.equal(isImpersonationBlockedFunction('billing'), true);
  assert.equal(isImpersonationBlockedFunction('admin-user360'), true);
  assert.equal(isImpersonationBlockedFunction('impersonate-user', { action: 'start' }), true);
  assert.equal(isImpersonationBlockedFunction('impersonate-user', { action: 'end_self' }), false);
  assert.equal(isImpersonationBlockedFunction('storage-sign'), false);
  assert.equal(isImpersonationBlockedRpc('admin_overview_counts'), true);
  assert.equal(isImpersonationBlockedRpc('background_job_start'), true);
  assert.equal(isImpersonationBlockedRpc('some_rpc_added_next_year'), true, 'a new RPC must default to blocked');
  assert.equal(isImpersonationBlockedRpc('background_jobs_mine'), false);

  const calls = [];
  const builder = { select: () => builder, eq: () => builder };
  const client = {
    from: () => ({ ...builder, insert: () => calls.push('insert'), update: () => calls.push('update') }),
    rpc: (fn) => { calls.push(`rpc:${fn}`); return Promise.resolve({ data: 1, error: null }); },
    functions: { invoke: async (name) => { calls.push(`fn:${name}`); return { data: 1, error: null }; } },
    auth: {
      signOut: async (opts) => { calls.push(`signOut:${opts?.scope}`); return { error: null }; },
      updateUser: async () => { calls.push('updateUser'); return { error: null }; },
    },
    storage: { from: () => ({ upload: async () => { calls.push('upload'); return {}; }, createSignedUrl: async () => ({}) }) },
  };
  installReadOnlyGuards(client);

  const insert = await client.from('messages').insert({ body: 'x' }).select().single();
  assert.equal(insert.error.code, 'READ_ONLY_IMPERSONATION');
  const topup = await client.functions.invoke('credits-topup', { body: {} });
  assert.equal(topup.error.code, 'READ_ONLY_IMPERSONATION');
  const rpc = await client.rpc('admin_overview_counts');
  assert.equal(rpc.error.code, 'READ_ONLY_IMPERSONATION');
  const upload = await client.storage.from('photos').upload('a', 'b');
  assert.equal(upload.error.code, 'READ_ONLY_IMPERSONATION');
  const pw = await client.auth.updateUser({ password: 'x' });
  assert.equal(pw.error.code, 'READ_ONLY_IMPERSONATION');
  await client.auth.signOut();
  await client.functions.invoke('impersonate-user', { body: { action: 'end_self' } });
  await client.rpc('background_jobs_mine');

  /* Nothing reached the network except Exit, a read, and a LOCAL sign-out:
     a default (global) sign-out would log the customer out of every device. */
  assert.deepEqual(calls, ['signOut:local', 'fn:impersonate-user', 'rpc:background_jobs_mine']);
});

test('the banner is in the CUSTOMER shell, and the admin session is never touched', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<LanguageProvider><ImpersonationBanner\/><AuthProvider>/,
    'the banner is not mounted above both shells');
  const layout = read('src/components/layouts/AdminLayout.tsx');
  assert.doesNotMatch(layout, /ImpersonationBannerBar/, 'the old admin-only banner is back');

  const client = read('src/db/supabase.ts');
  assert.match(client, /storageKey: IMPERSONATION_AUTH_KEY/);
  assert.match(client, /storage: impersonationAuthStorage\(impersonation\)/);
  assert.match(client, /autoRefreshToken: false/);
  assert.match(client, /installReadOnlyGuards\(createClient/);

  const lib = read('src/lib/impersonation.ts');
  assert.match(lib, /window\.sessionStorage/, 'the marker must be per tab');
  assert.doesNotMatch(lib.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), /localStorage/, 'impersonation must not read or write the admin session in localStorage');
  assert.match(lib, /refresh_token: ''/, 'a refresh token is being stored');

  const auth = read('src/contexts/AuthContext.tsx');
  assert.match(auth, /if \(isImpersonating\(\)\) return;[\s\S]{0,2000}?void claimAnonymousWork\(\)/,
    'anonymous work would be handed to the impersonated account');
  assert.match(auth, /homatch:impersonation-exit/, 'sign-out while impersonating does not mean Exit');

  const push = read('src/lib/push.ts');
  assert.match(push, /if \(isImpersonating\(\)\) return false;/, 'this browser could subscribe to the customer\'s pushes');

  const banner = read('src/components/impersonation/ImpersonationBanner.tsx');
  assert.match(banner, /action: 'end_self'/);
  assert.match(banner, /clearImpersonation\(\)/);
  assert.match(banner, /data-testid="impersonation-banner"/);
});

test('the new destinations are in the navigation, routed and admin-only', () => {
  const nav = read('src/admin/navigation.ts');
  const routes = read('src/routes.tsx');
  for (const path of ['/admin/supply-matches', '/admin/intelligence', '/admin/notifications', '/admin/announcements', '/admin/audit-log']) {
    assert.ok(nav.includes(`path: '${path}'`), `${path} is not in the navigation`);
    const line = routes.split('\n').find((l) => l.includes(`path: '${path}'`));
    assert.ok(line, `${path} has no route`);
    assert.match(line, /adminWrap\(/, `${path} is not wrapped in the admin shell`);
    assert.match(line, /adminOnly: true/, `${path} is not adminOnly`);
  }
  assert.ok(nav.includes("path: '/admin/matches', labelKey: 'admin_cc_nav_legacy_matches'"), 'the legacy matches page is not labelled as legacy');
});

test('every control-centre string exists in all six languages', async () => {
  const { ADMIN_CONTROL_STRINGS, ADMIN_CONTROL_STRINGS_2, ADMIN_CONTROL_STRINGS_3 } = await import('../../../scripts/admin-control-i18n-data.mjs');
  const all = { ...ADMIN_CONTROL_STRINGS, ...ADMIN_CONTROL_STRINGS_2, ...ADMIN_CONTROL_STRINGS_3 };
  const i18n = read('src/i18n/translations.ts');
  const missing = [];
  for (const key of Object.keys(all)) {
    const rows = i18n.match(new RegExp(`^  ${key}: ['"]`, 'gm')) ?? [];
    if (rows.length !== 6) missing.push(`${key} (${rows.length}/6)`);
  }
  assert.deepEqual(missing, [], `strings not applied — run node scripts/admin-control-i18n-apply.mjs:\n  ${missing.join('\n  ')}`);

  /* And every key a control-centre file uses is one of them (or pre-existing). */
  const files = [
    'src/pages/admin/AdminIntelligencePage.tsx', 'src/pages/admin/AdminSupplyMatchesPage.tsx',
    'src/pages/admin/AdminNotificationsPage.tsx', 'src/pages/admin/AdminAnnouncementsPage.tsx',
    'src/pages/admin/AdminAuditLogPage.tsx', 'src/pages/admin/AdminPropertiesPage.tsx',
    'src/pages/admin/AdminCampaignsPage.tsx', 'src/components/admin/control/AdminKit.tsx',
    'src/components/admin/control/BackgroundWorkPanel.tsx', 'src/components/impersonation/ImpersonationBanner.tsx',
    'src/admin/labels.ts',
  ];
  const unknown = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/'((?:admin_cc|admin_imp)_[a-z0-9_]+)'/g)) {
      if (!new RegExp(`^  ${m[1]}: `, 'm').test(i18n)) unknown.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(unknown, []);
});
