-- research_jobs was the only case-scoped table still granting anon full DML.
--
-- Not currently exploitable, and that was verified at runtime rather than
-- assumed: as anon, SELECT returned 0 rows, UPDATE and DELETE affected 0 rows
-- (they do not error, because a zero-row write is not an error), and INSERT
-- was refused. All three RLS policies on the table are scoped to the
-- `authenticated` role, so RLS default-deny already blocked anon.
--
-- The grants were therefore redundant — but a standing hazard. Every other
-- case-scoped table grants anon NOTHING, and the day someone adds a
-- permissive policy FOR ALL, or one TO public, this table would have handed
-- an anonymous caller full DML while the others stayed shut.
--
-- Owner access is unaffected: it flows from the authenticated grants and the
-- three owner-scoped policies, both left untouched. Re-verified after
-- applying: anon SELECT is now denied at the privilege level, the owner still
-- reads their 53 rows and an owner UPDATE still affects 1 row.
revoke select, insert, update, delete on public.research_jobs from anon;

alter default privileges in schema public revoke all on tables from anon;
