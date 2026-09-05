-- CRM / transaction-case persistence, with mandatory versioning.
--
-- A "transaction case" is the record a user opens once they move past
-- due-diligence research and start actually pursuing a property (an offer,
-- a contract, closing) — it is deliberately separate from `research_jobs`
-- (the Verify due-diligence report itself) and from `properties` (the raw
-- listing/import), and can reference either or both once they exist.
--
-- Versioning is enforced in the database, not trusted from the client: a
-- trigger snapshots the full row into transaction_case_versions on every
-- INSERT (version 1) and on every UPDATE that actually changes a
-- version-worthy column (version N+1). A client can never skip, forge, or
-- overwrite a version — it can only cause one to be created, by writing to
-- the case row itself. This mirrors the evidence-ledger discipline already
-- used elsewhere in this schema (research_jobs.evidence_bundle,
-- credit_ledger): the source of truth is an append-only log, not a mutable
-- "current state" field alone.

CREATE TABLE public.transaction_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  research_job_id uuid REFERENCES public.research_jobs(id) ON DELETE SET NULL,
  title text NOT NULL,
  stage text NOT NULL DEFAULT 'DUE_DILIGENCE'
    CHECK (stage IN ('DUE_DILIGENCE','OFFER_MADE','UNDER_CONTRACT','CLOSING','CLOSED','ABANDONED')),
  counterparty_name text,
  counterparty_contact text,
  offer_amount numeric,
  offer_currency text,
  target_closing_date date,
  notes text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

COMMENT ON TABLE public.transaction_cases IS
  'CRM case a user opens to track pursuing a specific property (offer -> contract -> closing). Every row change is versioned into transaction_case_versions by trigger — current_version always matches the latest row in that table for this case.';

CREATE INDEX idx_transaction_cases_user ON public.transaction_cases(user_id);
CREATE INDEX idx_transaction_cases_property ON public.transaction_cases(property_id) WHERE property_id IS NOT NULL;
CREATE INDEX idx_transaction_cases_research_job ON public.transaction_cases(research_job_id) WHERE research_job_id IS NOT NULL;
CREATE INDEX idx_transaction_cases_stage ON public.transaction_cases(stage);

CREATE TABLE public.transaction_case_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

COMMENT ON TABLE public.transaction_case_versions IS
  'Append-only full-row snapshots of transaction_cases. Populated only by trg_transaction_case_versioning — never written to directly by the client (no INSERT/UPDATE/DELETE policy grants this to authenticated).';

CREATE INDEX idx_transaction_case_versions_case ON public.transaction_case_versions(case_id, version DESC);

CREATE TABLE public.transaction_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transaction_case_events IS
  'Free-form timeline for a transaction case (stage changes, notes added, documents attached, reminders). Distinct from transaction_case_versions: this is a human-readable activity log, not a state snapshot.';

CREATE INDEX idx_transaction_case_events_case ON public.transaction_case_events(case_id, created_at DESC);

-- ── ownership helper (mirrors user_owns_property) ────────────────────────────
CREATE OR REPLACE FUNCTION public.user_owns_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_cases
    WHERE id = p_case_id AND user_id = public.get_user_id()
  );
$function$;

REVOKE ALL ON FUNCTION public.user_owns_case(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.user_owns_case(uuid) TO authenticated, service_role;

-- ── versioning triggers ───────────────────────────────────────────────────────
-- Split into a BEFORE trigger (computes current_version/updated_at/closed_at
-- on NEW — the only place these can be mutated) and an AFTER trigger (writes
-- the version snapshot row). This split is required, not stylistic: a BEFORE
-- INSERT trigger sees NEW.id already assigned, but the row itself has not
-- actually been written to transaction_cases yet, so an INSERT into
-- transaction_case_versions from a BEFORE trigger fails its FK constraint
-- (confirmed the hard way — see git history). By the time the AFTER trigger
-- runs, the row is guaranteed to exist.
CREATE OR REPLACE FUNCTION public.transaction_case_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.current_version := 1;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.updated_at := now();
  IF NEW.stage = 'CLOSED' AND OLD.stage IS DISTINCT FROM 'CLOSED' THEN
    NEW.closed_at := now();
  ELSIF NEW.stage <> 'CLOSED' THEN
    NEW.closed_at := NULL;
  END IF;

  -- No new version if nothing outside the bookkeeping columns actually changed.
  IF to_jsonb(NEW) - 'current_version' - 'updated_at' - 'closed_at' IS NOT DISTINCT FROM
     to_jsonb(OLD) - 'current_version' - 'updated_at' - 'closed_at' THEN
    RETURN NEW; -- current_version stays as-is; the AFTER trigger reads this to skip
  END IF;

  NEW.current_version := OLD.current_version + 1;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_transaction_case_before_write
  BEFORE INSERT OR UPDATE ON public.transaction_cases
  FOR EACH ROW EXECUTE FUNCTION public.transaction_case_before_write();

CREATE OR REPLACE FUNCTION public.transaction_case_version_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.current_version = OLD.current_version THEN
    RETURN NEW; -- transaction_case_before_write() decided this update wasn't version-worthy
  END IF;

  v_actor := public.get_user_id();
  INSERT INTO public.transaction_case_versions (case_id, version, snapshot, created_by)
  VALUES (NEW.id, NEW.current_version, to_jsonb(NEW), COALESCE(v_actor, NEW.user_id));
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.transaction_case_version_snapshot() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_case_version_snapshot() TO service_role;

CREATE TRIGGER trg_transaction_case_version_snapshot
  AFTER INSERT OR UPDATE ON public.transaction_cases
  FOR EACH ROW EXECUTE FUNCTION public.transaction_case_version_snapshot();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.transaction_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_case_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_case_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tc_select_own ON public.transaction_cases
  FOR SELECT TO authenticated USING (user_id = public.get_user_id());
CREATE POLICY tc_insert_own ON public.transaction_cases
  FOR INSERT TO authenticated WITH CHECK (user_id = public.get_user_id());
CREATE POLICY tc_update_own ON public.transaction_cases
  FOR UPDATE TO authenticated USING (user_id = public.get_user_id()) WITH CHECK (user_id = public.get_user_id());
CREATE POLICY tc_delete_own ON public.transaction_cases
  FOR DELETE TO authenticated USING (user_id = public.get_user_id());
CREATE POLICY tc_service_all ON public.transaction_cases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Versions are read-only to the client (created solely by the trigger,
-- which runs as SECURITY DEFINER and therefore bypasses RLS on its own
-- INSERT regardless of these policies).
CREATE POLICY tcv_select_own ON public.transaction_case_versions
  FOR SELECT TO authenticated USING (public.user_owns_case(case_id));
CREATE POLICY tcv_service_all ON public.transaction_case_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY tce_select_own ON public.transaction_case_events
  FOR SELECT TO authenticated USING (public.user_owns_case(case_id));
CREATE POLICY tce_insert_own ON public.transaction_case_events
  FOR INSERT TO authenticated WITH CHECK (public.user_owns_case(case_id));
CREATE POLICY tce_service_all ON public.transaction_case_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
