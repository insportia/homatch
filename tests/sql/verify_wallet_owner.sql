-- Verify resolves the wallet the way production keys it (20261027090000):
-- credit_accounts.user_id = public.users.id, while research_jobs.user_id and
-- auth.uid() are public.users.auth_id. The ids differ, as they do in production.
-- Before the fix every start here failed as INSUFFICIENT_CREDITS and the launch
-- quote showed 0 available credits.
do $$
declare
  owner_auth uuid := '00000000-0000-4000-8000-0000000000f1';
  owner_row  uuid := '00000000-0000-4000-8000-0000000000f2';
  other_auth uuid := '00000000-0000-4000-8000-0000000000f3';
  other_row  uuid := '00000000-0000-4000-8000-0000000000f4';
  orphan_auth uuid := '00000000-0000-4000-8000-0000000000f5';
  j1 uuid; j2 uuid; j3 uuid; j4 uuid;
  r jsonb; q jsonb; bal numeric; other_bal numeric; n integer; wallets integer;
begin
  insert into public.users (id, auth_id, is_admin) values (owner_row, owner_auth, true), (other_row, other_auth, false);
  insert into public.credit_accounts (user_id, balance) values (owner_row, 300), (other_row, 40);
  insert into public.credit_lots (user_id, kind, credits_granted, source_type)
  values (owner_row, 'PURCHASED', 300, 'TOPUP'), (other_row, 'PURCHASED', 40, 'TOPUP');
  select count(*) into wallets from public.credit_accounts;
  insert into public.research_jobs (user_id) values (owner_auth) returning id into j1;
  insert into public.research_jobs (user_id) values (other_auth) returning id into j2;
  insert into public.research_jobs (user_id) values (orphan_auth) returning id into j3;
  insert into public.research_jobs (user_id) values (owner_auth) returning id into j4;

  -- W1. The wallet owner is public.users.id, found by auth_id; nothing else resolves.
  if public.verify_wallet_user(owner_auth) is distinct from owner_row then raise exception 'W1: owner'; end if;
  if public.verify_wallet_user(owner_row) is not null then raise exception 'W1: users.id must not resolve as an auth id'; end if;
  if public.verify_wallet_user(orphan_auth) is not null then raise exception 'W1: orphan'; end if;

  -- W2. A start reserves 25 from the job owner's existing wallet — no top-up, no new wallet.
  r := public.verify_billing_open(j1, owner_auth, 'verify:wallet-owner:j1:s1');
  if not (r->>'ok')::boolean or (r->>'reservedCredits')::numeric <> 25 then raise exception 'W2: %', r; end if;
  select balance into bal from public.credit_accounts where user_id = owner_row;
  if bal <> 275 then raise exception 'W2: owner balance %', bal; end if;
  if (select count(*) from public.credit_accounts) <> wallets then raise exception 'W2: a wallet was created'; end if;
  if (select user_id from public.usage_reservations where id = (r->>'reservationId')::uuid) <> owner_row then
    raise exception 'W2: reservation not on the owner wallet';
  end if;

  -- W3. Another customer is charged from THEIR wallet only; the owner's is untouched.
  r := public.verify_billing_open(j2, other_auth, 'verify:wallet-owner:j2:s1');
  if not (r->>'ok')::boolean then raise exception 'W3: %', r; end if;
  select balance into other_bal from public.credit_accounts where user_id = other_row;
  if other_bal <> 15 then raise exception 'W3: other balance %', other_bal; end if;
  if (select balance from public.credit_accounts where user_id = owner_row) <> 275 then raise exception 'W3: owner moved'; end if;

  -- W4. Nobody can start a job they do not own, admin or not: the server checks the job owner.
  begin
    perform public.verify_billing_open(j2, owner_auth, 'verify:wallet-owner:j2:steal');
    raise exception 'W4: owner opened another user''s job';
  exception when others then
    if sqlerrm not like '%JOB_NOT_OWNED%' then raise; end if;
  end;

  -- W5. No public.users row → no wallet, reported as such; nothing is created.
  r := public.verify_billing_open(j3, orphan_auth, 'verify:wallet-owner:j3:s1');
  if (r->>'ok')::boolean or r->>'reason' <> 'INSUFFICIENT_CREDITS' or (r->>'availableCredits')::numeric <> 0 then
    raise exception 'W5: %', r;
  end if;
  if (select count(*) from public.credit_accounts) <> wallets or exists (select 1 from public.verify_billing where job_id = j3) then
    raise exception 'W5: side effects';
  end if;

  -- W6. Settlement and release land on the owner wallet; balance + reserved stays whole.
  r := public.verify_billing_close(j1, 'SYSTEM_FAILED');
  if (select balance + reserved from public.credit_accounts where user_id = owner_row) <> 300 then
    raise exception 'W6: system failure must refund in full: %', r;
  end if;

  -- W7. The launch quote shows the signed-in user's REAL balance (auth.uid() is the auth id).
  perform set_config('request.jwt.claim.sub', owner_auth::text, true);
  q := public.verify_launch_quote();
  if (q->>'availableCredits')::numeric <> 300 then raise exception 'W7: owner quote %', q; end if;
  perform set_config('request.jwt.claim.sub', other_auth::text, true);
  if (public.verify_launch_quote()->>'availableCredits')::numeric <> 15 then raise exception 'W7: other quote'; end if;
  perform set_config('request.jwt.claim.sub', orphan_auth::text, true);
  if (public.verify_launch_quote()->>'availableCredits')::numeric <> 0 then raise exception 'W7: orphan quote'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if public.verify_launch_quote()->>'availableCredits' is not null then raise exception 'W7: anonymous quote'; end if;

  -- W8. Being admin buys nothing: the owner's run goes through the same 25-credit authorization.
  r := public.verify_billing_open(j4, owner_auth, 'verify:wallet-owner:j4:s1');
  if (r->>'reservedCredits')::numeric <> 25 or (r->>'authorizedTotal')::numeric <> 25 then raise exception 'W8: %', r; end if;
  select count(*) into n from public.verify_billing_authorizations where job_id = j4;
  if n <> 1 then raise exception 'W8: authorizations %', n; end if;

  -- W9. Surface: the auth-id → wallet mapping is service-only; the quote is signed-in only.
  if has_function_privilege('anon', 'public.verify_wallet_user(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.verify_wallet_user(uuid)', 'execute') then
    raise exception 'W9: verify_wallet_user exposed to clients';
  end if;
  if has_function_privilege('anon', 'public.verify_billing_open(uuid, uuid, text, boolean, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.verify_billing_open(uuid, uuid, text, boolean, integer)', 'execute') then
    raise exception 'W9: verify_billing_open exposed to clients';
  end if;
  if has_function_privilege('anon', 'public.verify_launch_quote()', 'execute')
     or not has_function_privilege('authenticated', 'public.verify_launch_quote()', 'execute') then
    raise exception 'W9: verify_launch_quote grants';
  end if;

  raise notice 'verify wallet owner: all checks passed';
end;
$$;
