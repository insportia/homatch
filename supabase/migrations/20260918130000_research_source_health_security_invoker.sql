/* ══════════════════════════════════════════════════════════════════════
 * research_source_health must answer as the caller, not as its owner.
 *
 * The view was created without security_invoker, which in Postgres means it
 * reads its base tables with the OWNER's privileges and the OWNER's RLS.
 * For source_registry that changes nothing — auth_read_source_registry is
 * `USING (true)` for authenticated, so a signed-in user could already read
 * every row directly.
 *
 * But the view also carries a pending_access_requests subquery over
 * research_access_requests, and THAT table is admin-only by design. With
 * owner semantics the subquery ran as the owner, so any signed-in account
 * could read the view and learn how many access requests are outstanding for
 * each source — the shape of the operator's queue, from a table whose RLS
 * says authenticated may read nothing.
 *
 * Measured before this migration, as role `authenticated` with no admin
 * claim: six rows returned a non-zero pending_access_requests. It should
 * have been zero.
 *
 * security_invoker = on makes every base-table read use the caller's own
 * identity and policies. An admin still sees the true counts because
 * is_admin() passes for them; the service role still sees everything; a
 * signed-in non-admin now sees 0, which is what the RLS on
 * research_access_requests always said they should see.
 *
 * No column, name, type or row of the view changes. Only who it answers as.
 * ══════════════════════════════════════════════════════════════════════ */

alter view public.research_source_health set (security_invoker = on);

comment on view public.research_source_health is
  'Operator view of the source graph: what exists, how it is reached, when it '
  'was last scanned, and what it has actually produced. useful_rate is NULL '
  'when nothing has been scanned, never 0. Runs with security_invoker, so '
  'pending_access_requests obeys the admin-only RLS on '
  'research_access_requests rather than the view owner''s privileges.';
