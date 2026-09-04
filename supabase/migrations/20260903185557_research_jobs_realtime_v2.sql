do $$ begin
  alter publication supabase_realtime add table public.research_jobs;
exception when duplicate_object then null;
end $$;
