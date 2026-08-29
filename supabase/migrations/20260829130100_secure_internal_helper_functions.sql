alter function public.get_user_id() set search_path = '';
alter function public.user_owns_property(uuid) set search_path = '';
alter function public.increment_source_failure(uuid) set search_path = '';
alter function public.create_credit_account_for_user() set search_path = '';

revoke all on function public.create_credit_account_for_user() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.increment_source_failure(uuid) from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.reject_non_demand_match() from public, anon, authenticated;

grant execute on function public.create_credit_account_for_user() to service_role;
grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.increment_source_failure(uuid) to service_role;
grant execute on function public.reject_non_demand_match() to service_role;

revoke all on function public.get_user_id() from public, anon;
revoke all on function public.user_owns_property(uuid) from public, anon;
grant execute on function public.get_user_id() to authenticated, service_role;
grant execute on function public.user_owns_property(uuid) to authenticated, service_role;
