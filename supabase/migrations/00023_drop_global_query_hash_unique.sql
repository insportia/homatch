-- Drop the old global unique constraint on query_hash (replaced by job-scoped one)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qp_query_hash_unique'
      AND conrelid = 'public.query_packs'::regclass
  ) THEN
    ALTER TABLE public.query_packs DROP CONSTRAINT qp_query_hash_unique;
  END IF;
END $$;