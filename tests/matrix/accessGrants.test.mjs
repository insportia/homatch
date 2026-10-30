// OWNER UNLIMITED + ADMIN ACCESS GRANTS (20261208110000 / 110100): UI states from the server's
// answer, the resolver's precedence in SQL, the edge wiring, the Admin page and its exact Georgian
// labels. The real-database behaviour is tests/sql/saas/accessGrants.realdb.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { featureAccessText, grantExpiry, hasUnlimitedAccess, isAccessForbidden, isUnlimitedSource } from '../../src/subscriptions/access.ts';
import { STAB_ACCESS_STRINGS } from '../../scripts/stab-access-i18n-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const feature = (o) => ({ feature: 'VERIFY', kind: 'QUOTA', included: false, unlimited: false, limit: null, used: 0, remaining: 0,
  trialEnabled: true, trialState: 'UNUSED', trialAvailable: false, ...o });
const status = (o = {}) => ({ plan: 'FREE', subscription: null, features: [], accountEligibleForTrials: true, legacyBalance: 0, hasLegacyBalance: false, ...o });

test('unlimited is read from the server answer only', () => {
  assert.equal(hasUnlimitedAccess(null), false);
  assert.equal(hasUnlimitedAccess(status()), false, 'an older server without `access` is an ordinary account');
  assert.equal(hasUnlimitedAccess(status({ access: { owner: true, unlimited: true, source: 'OWNER', grants: [] } })), true);
  assert.equal(hasUnlimitedAccess(status({ access: { owner: false, unlimited: false, source: 'GRANT', grants: [{}] } })), false);
});

test('entry-point text follows the resolver precedence and never shows a balance to an unlimited account', () => {
  const owner = status({ hasLegacyBalance: true, legacyBalance: 99178, access: { owner: true, unlimited: true, source: 'OWNER', grants: [] } });
  assert.equal(featureAccessText(owner, feature({ source: 'OWNER', included: true, unlimited: true, trialAvailable: false }), t), 'acc_unlimited');
  assert.equal(featureAccessText(owner, feature({ source: 'NONE' }), t), null, 'no legacy-balance text for an unlimited account');
  const s = status();
  assert.equal(featureAccessText(s, feature({ source: 'GRANT', included: true, unlimited: true }), t), 'acc_unlimited');
  assert.equal(featureAccessText(s, feature({ source: 'GRANT', included: true, limit: 3, used: 1, remaining: 2, trialAvailable: true }), t),
    'acc_grant_remaining:{"remaining":"2"}', 'a grant is used before the trial');
  assert.equal(featureAccessText(s, feature({ source: 'TRIAL', trialAvailable: true }), t), 'sub_badge_first_free_verify');
  assert.equal(featureAccessText(s, feature({ source: 'PLAN', included: true, limit: 5, remaining: 4 }), t), 'sub_badge_included:{"remaining":"4"}');
  assert.equal(featureAccessText(status({ hasLegacyBalance: true }), feature({ source: 'LEGACY_CREDITS' }), t), 'sub_badge_legacy');
  assert.equal(isUnlimitedSource(feature({ source: 'PLAN', unlimited: true })), false, 'an Unlimited PLAN is a plan, not owner access');
});

test('grant expiry: durations, end of a Tbilisi day, never a silent permanent', () => {
  const now = Date.parse('2026-10-30T10:00:00Z');
  assert.equal(grantExpiry('PERMANENT', null, now), null);
  assert.equal(grantExpiry('7', null, now), '2026-11-06T10:00:00.000Z');
  assert.equal(grantExpiry('90', null, now), '2027-01-28T10:00:00.000Z');
  assert.equal(grantExpiry('CUSTOM', '2026-12-31', now), '2026-12-31T19:59:59.000Z');
  assert.throws(() => grantExpiry('CUSTOM', null, now), /INVALID_EXPIRY/);
  assert.throws(() => grantExpiry('CUSTOM', '31/12/2026', now), /INVALID_EXPIRY/);
  for (const c of ['FORBIDDEN', 'FORBIDDEN_SELF', 'OWNER_ONLY', 'OWNER_PROTECTED']) assert.equal(isAccessForbidden(`ERROR: ${c}`), true);
  assert.equal(isAccessForbidden('INVALID_LIMIT'), false);
});

test('the owner\'s exact Georgian labels', () => {
  const ka = Object.fromEntries(Object.entries(STAB_ACCESS_STRINGS).map(([k, v]) => [k, v[1]]));
  const want = {
    acc_title: 'მომხმარებლების წვდომები', admin_nav_access: 'მომხმარებლების წვდომები', acc_access_type: 'წვდომის ტიპი',
    acc_unlimited: 'შეუზღუდავი წვდომა', acc_grant_unlimited: 'შეუზღუდავი წვდომის მინიჭება', acc_custom_limits: 'ინდივიდუალური ლიმიტები',
    acc_temporary: 'დროებითი წვდომა', acc_permanent: 'მუდმივი წვდომა', acc_expiry: 'მოქმედების ვადა', acc_usage_history: 'გამოყენების ისტორია',
    acc_remaining: 'დარჩენილი ლიმიტი', acc_grant: 'წვდომის მინიჭება', acc_revoke: 'წვდომის გაუქმება', acc_save: 'ცვლილებების შენახვა',
    acc_owner_notice: 'თქვენ გაქვთ შეუზღუდავი წვდომა HOMATCH-ის შიდა სერვისებზე.', acc_updated: 'მომხმარებლის წვდომა წარმატებით განახლდა.',
    acc_forbidden: 'ამ მოქმედების შესრულების უფლება არ გაქვთ.', acc_sub_active_no_purchase: 'თქვენი წვდომა აქტიურია. გამოწერის შეძენა არ გჭირდებათ.',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(ka[k], v, k);
  const bundle = read('src/i18n/translations.ts');
  for (const v of Object.values(want)) assert.ok(bundle.includes(`'${v}'`), `bundle carries ${v}`);
  for (const [k, vals] of Object.entries(STAB_ACCESS_STRINGS)) {
    assert.equal(vals.length, 6, k);
    const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of vals) assert.equal(ph(v), ph(vals[0]), `${k} placeholders`);
  }
});

test('Admin navigation and route: /admin/access next to Plans and entitlements, admin only', () => {
  const nav = read('src/admin/navigation.ts');
  const plans = nav.indexOf("path: '/admin/plans'");
  const access = nav.indexOf("path: '/admin/access', labelKey: 'admin_nav_access'");
  assert.ok(plans > 0 && access > plans && access - plans < 400, 'directly after Plans');
  assert.match(read('src/routes.tsx'), /path: '\/admin\/access',\s+element: adminWrap\(<AdminAccessPage \/>\),\s+adminOnly: true/);
  const page = read('src/pages/admin/AdminAccessPage.tsx');
  for (const fn of ['adminAccessGrant', 'adminAccessUpdate', 'adminAccessRevoke', 'adminAccessReset']) assert.ok(page.includes(`${fn}(`), fn);
  assert.ok(page.includes('setPending({ label, run })') && page.includes("t('acc_confirm')"), 'every write asks for confirmation');
  assert.ok(!/supabase\.from\(/.test(page), 'no direct table writes');
});

test('customer surfaces hide credits for unlimited accounts from entitlement_status_for_me, never a role check', () => {
  const shell = read('src/components/layouts/HomatchShell.tsx');
  assert.match(shell, /const unlimitedAccess = hasUnlimitedAccess\(entitlements\.status\)/);
  assert.match(shell, /credits !== null && credits > 0 && !unlimitedAccess/);
  assert.match(shell, /unlimitedAccess \? \(\s*<UnlimitedAccessBadge/);
  const sub = read('src/pages/MySubscriptionPage.tsx');
  assert.ok(sub.includes("t('acc_sub_active_no_purchase')") && sub.includes('live && plans && !unlimited') && sub.includes('status.hasLegacyBalance && !unlimited'));
  assert.ok(sub.includes("g.permanent ? t('acc_permanent')"), 'a permanent grant shows no renewal date');
  assert.ok(read('src/pages/CreditsPage.tsx').includes('actions={unlimitedAccess ? undefined'));
  assert.ok(read('src/pages/ProfilePage.tsx').includes('{unlimitedAccess ? ('));
  for (const f of ['src/components/layouts/HomatchShell.tsx', 'src/pages/MySubscriptionPage.tsx', 'src/pages/CreditsPage.tsx', 'src/pages/ProfilePage.tsx', 'src/subscriptions/access.ts', 'src/subscriptions/components.tsx']) {
    assert.ok(!/is_admin|isAdmin|isOwner/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), `${f}: no client-side role check`);
  }
  const vb = read('src/components/verify/VerifyBudget.tsx');
  assert.match(vb, /funding === 'OWNER' \|\| funding === 'GRANT' \|\| funding === 'TRIAL' \|\| funding === 'PLAN'/);
});

test('SQL: one resolver, owner then grant then trial then plan then legacy; owner protected; seeded by id', () => {
  const core = read('supabase/migrations/20261208110000_owner_access_grants_core.sql');
  const body = core.slice(core.indexOf('create or replace function public.saas_access_resolve'), core.indexOf('-- ── 6.'));
  const order = ["'OWNER'", "'GRANT'", "'TRIAL'", "'PLAN'", "'LEGACY_CREDITS'"].map((x) => body.indexOf(`'funding', ${x}`));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `precedence ${order}`);
  for (const fn of ['saas_usage_preview', 'saas_user_has_feature', 'saas_usage_begin', 'saas_entitlement_status']) {
    const at = core.indexOf(`create or replace function public.${fn}(`);
    const next = core.indexOf('create or replace function', at + 10);
    assert.ok(core.slice(at, next).includes('saas_access_resolve('), `${fn} reads the resolver`);
  }
  assert.match(core, /verify_billing_open[\s\S]*v_begin->>'funding' in \('OWNER', 'GRANT', 'TRIAL', 'PLAN'\)/);
  assert.match(core, /check \(funding in \('TRIAL', 'PLAN', 'OWNER', 'GRANT'\)\)/);
  assert.match(core, /before update or delete on public\.platform_owner/);
  assert.match(core, /before truncate on public\.platform_owner/);
  assert.match(core, /'5157044e-9158-437a-86a2-e34d5ada82f7'::uuid and u\.is_admin/);
  assert.ok(!/@gmail|@homatch|email\s*=\s*'/.test(core), 'owner is never identified by email');
  assert.match(core, /update public\.saas_features set internal_included = false where feature = 'PREMIUM_DISCOVERY'/);
  const admin = read('supabase/migrations/20261208110100_owner_access_grants_admin.sql');
  assert.match(admin, /if p_actor = p_target then raise exception 'FORBIDDEN_SELF'/);
  assert.match(admin, /if public\.saas_is_owner\(p_target\) then raise exception 'OWNER_PROTECTED'/);
  assert.match(admin, /coalesce\(p_confirm, ''\) <> 'REVOKE'/);
  const writers = ['admin_access_grant(', 'admin_access_grant_update(', 'admin_access_grant_revoke(', 'admin_access_allowance_reset('];
  for (const w of writers) {
    const at = admin.indexOf(`create or replace function public.${w}`);
    const fnBody = admin.slice(at, admin.indexOf('end $$;', at));
    for (const need of ['saas_admin_actor()', 'saas_require_reason(', 'saas_access_guard(', 'saas_access_log(']) assert.ok(fnBody.includes(need), `${w} ${need}`);
  }
  assert.ok(!/grant (insert|update|delete)[^;]*saas_access/i.test(core + admin), 'no client writes');
});

test('edge: OWNER / GRANT are included uses; HOMI bypass excludes the paid property analysis', () => {
  const ent = read('supabase/functions/_shared/entitlements.ts');
  assert.match(ent, /new Set\(\['OWNER', 'GRANT', 'TRIAL', 'PLAN'\]\)/);
  assert.match(ent, /export async function includedAccess/);
  const ai = read('supabase/functions/homatch-ai/index.ts');
  assert.match(ai, /billableSurface && !marketplaceScope\s*\n\s*\? await includedAccess\(sb, uid, 'HOMI_UNLIMITED'\)/);
  assert.match(ai, /if \(uid && billingEnabled && interactionId && billableSurface && !homiIncluded\)/);
});
