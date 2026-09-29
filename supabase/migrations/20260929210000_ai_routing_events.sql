-- HOMATCH AI — routing telemetry. One compact row per assistant turn:
-- the validated routing self-report (intent label + web mode), what
-- internal context was actually available, how many web searches really
-- ran, which native actions went back, latency, and whether internal
-- retrieval FAILED (which is a different fact from "no internal data
-- exists"). No message content beyond the short intent label, no secrets.
-- Written only by the edge function (service_role); read only by Admin.

CREATE TABLE IF NOT EXISTS public.ai_routing_events (
  id bigserial PRIMARY KEY,
  user_id uuid,
  conversation_id uuid,
  locale text,
  intent text,
  web_mode text NOT NULL DEFAULT 'NO_WEB' CHECK (web_mode IN
    ('NO_WEB','SUPPLEMENTAL_WEB','REQUIRED_LIVE_WEB','SPECIALIZED_HOMATCH_WORKFLOW')),
  internal_used boolean NOT NULL DEFAULT false,
  internal_failed boolean NOT NULL DEFAULT false,
  web_calls integer NOT NULL DEFAULT 0,
  internal_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_ids text[] NOT NULL DEFAULT '{}',
  reply_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_routing_events_created
  ON public.ai_routing_events(created_at DESC);
ALTER TABLE public.ai_routing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_routing_events_admin ON public.ai_routing_events
  FOR SELECT USING (public.is_admin());
CREATE POLICY ai_routing_events_service ON public.ai_routing_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
