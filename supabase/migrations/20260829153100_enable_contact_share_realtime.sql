DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid=pr.prpubid
    JOIN pg_class c ON c.oid=pr.prrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE p.pubname='supabase_realtime'
      AND n.nspname='public'
      AND c.relname='conversation_contact_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_contact_shares;
  END IF;
END $$;
