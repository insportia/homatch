-- Synthetic wallet boundary for isolated queue/billing concurrency proof; never production.
alter table public.users add column is_admin boolean not null default false;
create function public.is_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select coalesce((select is_admin from public.users where id=public.get_user_id()),false)$$;
create table public.billable_products(code text primary key,name text,billing_mode text,requires_reservation boolean,standard_retail_cents integer,estimate_strategy text,config jsonb);
create table public.credit_accounts(user_id uuid primary key,balance numeric not null);
create table public.fixture_holds(id uuid primary key default gen_random_uuid(),user_id uuid,key text unique,amount numeric,status text default 'RESERVED');
create function public.wallet_reserve(p_user_id uuid,p_product_code text,p_authorized_max_credits numeric,p_idempotency_key text,p_estimate_min_credits numeric default 0,p_estimate_max_credits numeric default 0,p_job_ref text default null,p_metadata jsonb default '{}')
returns table(reservation_id uuid,reserved_credits numeric,balance_after numeric,was_duplicate boolean) language plpgsql as $$
declare h public.fixture_holds; b numeric;begin
 select * into h from public.fixture_holds where key=p_idempotency_key;if found then return query select h.id,h.amount,(select balance from public.credit_accounts where user_id=p_user_id),true;return;end if;
 select balance into b from public.credit_accounts where user_id=p_user_id for update;
 if b<p_authorized_max_credits then raise exception 'INSUFFICIENT_CREDITS';end if;
 update public.credit_accounts set balance=balance-p_authorized_max_credits where user_id=p_user_id;
 insert into public.fixture_holds(user_id,key,amount) values(p_user_id,p_idempotency_key,p_authorized_max_credits) returning * into h;
 return query select h.id,h.amount,b-h.amount,false;
end$$;
create function public.wallet_settle(p_reservation_id uuid,p_actual_credits numeric,p_usage jsonb default '{}',p_outcome text default 'SUCCESS')
returns table(reservation_id uuid,settled_credits numeric,released_credits numeric,balance_after numeric,was_duplicate boolean,clamped boolean) language plpgsql as $$
declare h public.fixture_holds;begin
 select * into h from public.fixture_holds where id=p_reservation_id for update;
 if not found or h.status='RELEASED' then raise exception 'RESERVATION_NOT_SETTLED';end if;
 update public.fixture_holds set status='SETTLED' where id=h.id;
 return query select h.id,p_actual_credits,0::numeric,(select balance from public.credit_accounts where user_id=h.user_id),h.status='SETTLED',false;
end$$;
create function public.wallet_release(p_reservation_id uuid,p_reason text,p_usage jsonb default '{}') returns void language plpgsql as $$
declare h public.fixture_holds;begin
 select * into h from public.fixture_holds where id=p_reservation_id for update;
 if h.status='RESERVED' then update public.credit_accounts set balance=balance+h.amount where user_id=h.user_id;update public.fixture_holds set status='RELEASED' where id=h.id;end if;
end$$;
create function public.wallet_admin_adjust(p_user_id uuid,p_credits numeric,p_reason text,p_reference text) returns jsonb language sql as $$select jsonb_build_object('fixture',true)$$;
