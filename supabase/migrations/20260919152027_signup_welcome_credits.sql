-- FIFTY CREDITS, ONCE, FOR A REAL NEW ACCOUNT.
--
-- WHERE THE GRANT HAPPENS, AND WHY THERE
--
-- Registration has one canonical funnel and it is in the database, not
-- in the browser: an insert into auth.users fires handle_new_auth_user,
-- which inserts public.users, which fires trg_create_credit_account.
-- Email signup, Google signup, a retried OAuth callback and a
-- concurrent double-submit all converge on that one insert — and only
-- the first of them produces a row, because handle_new_auth_user is
-- ON CONFLICT DO NOTHING. Hanging the grant off public.users therefore
-- inherits every idempotency property the funnel already has, instead
-- of asking six client paths to each remember not to grant twice.
--
-- A grant from the client would also be a grant a client could ask for
-- again.
--
-- WHY IT CANNOT BREAK A SIGNUP
--
-- The trigger runs inside the transaction that creates the account. A
-- promotional credit is not worth failing a registration over, so every
-- failure path is swallowed and logged: worst case somebody signs up
-- successfully and has no welcome credits, which is recoverable. The
-- reverse — a person unable to create an account because a promotion
-- misbehaved — is not.
--
-- WHY IT IS STILL IDEMPOTENT TWICE OVER
--
-- wallet_grant_credits is already idempotent on
-- (user_id, source_type, source_ref), enforced by uidx_credit_lots_source,
-- and returns was_duplicate rather than granting again. So even a manual
-- replay, a restored backup or a future second caller cannot double-grant.
-- The unique index turns a genuine race into an exception, which is
-- caught here and read as "somebody else already did it".
--
-- EXISTING USERS ARE NOT GRANTED. The promotion is for registrations
-- after activation; a trigger on INSERT cannot reach anybody who is
-- already here, which is exactly the required behaviour.

-- ── Business configuration, not code ────────────────────────────────
insert into public.admin_settings (key, value, description) values
  ('signup_welcome_credits_enabled', 'true'::jsonb,
   'Whether a newly registered account receives the one-time welcome credit grant.'),
  ('signup_welcome_credits', '50'::jsonb,
   'Credits granted once per new account at registration. 1 Credit = 1/credits_per_usd USD of service value.')
on conflict (key) do nothing;

create or replace function public.billing_grant_signup_welcome(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_credits numeric;
  v_prev text;
begin
  if p_user_id is null then return; end if;
  if not public.billing_setting_bool('signup_welcome_credits_enabled', true) then return; end if;

  v_credits := public.billing_setting_num('signup_welcome_credits', 0);
  if v_credits is null or v_credits <= 0 then return; end if;

  -- wallet_grant_credits is the only sanctioned way to create credits, and
  -- it insists on being called by the service role. This runs inside a
  -- signup transaction owned by the auth admin, so the claim is set for
  -- the statement and put back afterwards. The elevation is confined to
  -- this function, which no client role may execute.
  v_prev := current_setting('request.jwt.claim.role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  begin
    perform public.wallet_grant_credits(
      p_user_id    => p_user_id,
      p_kind       => 'PROMOTIONAL',
      p_credits    => v_credits,
      p_ledger_type=> 'PROMOTIONAL_GRANT',
      p_source_type=> 'signup_welcome',
      -- One key per account, forever. Stable, derivable, and unique by index.
      p_source_ref => p_user_id::text,
      p_expires_at => null,
      p_plan_code  => null,
      p_payment_id => null,
      p_metadata   => jsonb_build_object('promotion', 'SIGNUP_WELCOME', 'granted_by', 'trigger')
    );
  exception
    when unique_violation then
      -- Two concurrent callers reached the insert. The other one won and
      -- the account has its credits; there is nothing to do.
      null;
    when others then
      raise warning 'signup welcome grant failed for %: %', p_user_id, sqlerrm;
  end;

  perform set_config('request.jwt.claim.role', coalesce(v_prev, ''), true);
end;
$$;

revoke all on function public.billing_grant_signup_welcome(uuid) from public;
revoke all on function public.billing_grant_signup_welcome(uuid) from anon, authenticated;

create or replace function public.trg_grant_signup_welcome()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Never let a promotion fail a registration.
  begin
    perform public.billing_grant_signup_welcome(new.id);
  exception when others then
    raise warning 'signup welcome trigger failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- AFTER, and after the credit account exists: trg_create_credit_account is
-- also an AFTER INSERT trigger and triggers fire in name order, so this one
-- is named to sort later. wallet_grant_credits creates the account itself
-- if it has to, so the ordering is belt and braces rather than a dependency.
drop trigger if exists trg_zz_grant_signup_welcome on public.users;
create trigger trg_zz_grant_signup_welcome
after insert on public.users
for each row execute function public.trg_grant_signup_welcome();
