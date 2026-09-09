-- Homatch — make "I looked at this match" actually record.
--
-- WHAT WAS FOUND
--
-- markMatchPreviewed() does:
--
--   supabase.from('matches').update({ status: 'PREVIEWED' })
--     .eq('id', matchId).eq('status', 'NEW')
--
-- public.matches has RLS enabled and exactly three policies: two SELECT for
-- authenticated, and one ALL for service_role. There is no UPDATE policy for
-- a customer at all, so that statement matches zero rows -- and PostgREST
-- answers a zero-row UPDATE with 204 and no error. The call site does not
-- check anything anyway.
--
-- Proven against production before writing this, as the real owner of a real
-- NEW match, inside a transaction that was rolled back:
--
--   PROBE rows_updated=0 status_now=NEW
--
-- So no match has ever left status NEW except by being unlocked. The UI hides
-- it well: MatchesPage sets the row to PREVIEWED in local state immediately
-- after the call, so it looks right until the page is reloaded.
--
-- WHY THAT MATTERS MORE THAN A COSMETIC STATUS
--
-- 20260903174151_run_matching_v2_hard_gates_cleanup deletes bad matches and is
-- deliberately "scoped to status = 'NEW' ONLY. UNLOCKED/PREVIEWED/ARCHIVED
-- rows are user-facing, possibly-paid history and are never touched."
--
-- That protection has never protected anything. A match a customer opened and
-- was considering is still NEW, so the next cleanup sweep can reject the exact
-- row they were looking at. Two admin screens also render a PREVIEWED label
-- for a state the product cannot reach.
--
-- WHY AN RPC RATHER THAN AN UPDATE POLICY
--
-- Because `status` is not the customer's field to write. UNLOCKED is what a
-- customer gets after paying credits, and it is set by atomic-unlock under the
-- service role. Granting UPDATE on matches -- even column-scoped to status --
-- would let a customer write 'UNLOCKED' directly and read the seller's contact
-- details without spending anything. RLS can constrain the new row but cannot
-- express "you may go from NEW to PREVIEWED and nowhere else", so the
-- transition lives in a function instead. This is the same shape the handoff
-- lifecycle already uses.
--
-- The function is deliberately narrow: one source status, one target status,
-- one column. It cannot express any other transition even if called wrongly.

create or replace function public.mark_match_previewed(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid;
  v_visible   boolean;
  v_status    text;
begin
  v_uid := public.get_user_id();
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Visibility mirrors the two SELECT policies on matches: the match is
  -- addressed to this user, or it is a match on a property they own.
  select true, m.status::text
    into v_visible, v_status
    from public.matches m
   where m.id = p_match_id
     and (
       m.user_id = v_uid
       or m.property_id in (select p.id from public.properties p where p.user_id = v_uid)
     );

  if not coalesce(v_visible, false) then
    -- Same answer whether the row does not exist or belongs to someone else.
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- NEW is the only status this may move. Opening an already-unlocked or
  -- already-previewed match is not an error; it simply changes nothing.
  if v_status = 'NEW' then
    update public.matches
       set status = 'PREVIEWED'
     where id = p_match_id
       and status = 'NEW';
    v_status := 'PREVIEWED';
  end if;

  return v_status;
end $$;

comment on function public.mark_match_previewed(uuid) is
  'Moves a match the caller can see from NEW to PREVIEWED. The only status transition a customer may make; UNLOCKED remains service-role only.';

revoke all on function public.mark_match_previewed(uuid) from public, anon;
grant execute on function public.mark_match_previewed(uuid) to authenticated, service_role;
