-- META LEAD CENTER — new leads appear without polling. Realtime delivers
-- postgres_changes through RLS, so an owner receives only their own rows.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meta_leads') then
    alter publication supabase_realtime add table public.meta_leads;
  end if;
end $$;
