-- VetIOS self-protection event ledger.
-- Stores clone-defense and abuse-risk signals without raw IPs or secrets.

CREATE TABLE IF NOT EXISTS public.vetios_security_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text,
    request_id text NOT NULL,
    event_type text NOT NULL,
    severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
    clone_suspected boolean NOT NULL DEFAULT false,
    blocked boolean NOT NULL DEFAULT false,
    origin text,
    host text,
    endpoint text NOT NULL,
    method text NOT NULL,
    ip_hash text,
    user_agent_hash text,
    fingerprint text,
    signals jsonb NOT NULL DEFAULT '[]'::jsonb,
    actions text[] NOT NULL DEFAULT '{}',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vetios_security_events_tenant_created
    ON public.vetios_security_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vetios_security_events_clone
    ON public.vetios_security_events (clone_suspected, created_at DESC)
    WHERE clone_suspected = true;

CREATE INDEX IF NOT EXISTS idx_vetios_security_events_blocked
    ON public.vetios_security_events (blocked, created_at DESC)
    WHERE blocked = true;

CREATE INDEX IF NOT EXISTS idx_vetios_security_events_fingerprint
    ON public.vetios_security_events (fingerprint)
    WHERE fingerprint IS NOT NULL;

ALTER TABLE public.vetios_security_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'vetios_security_events'
          AND policyname = 'service_role_only_vetios_security_events'
    ) THEN
        CREATE POLICY "service_role_only_vetios_security_events"
            ON public.vetios_security_events
            USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_vetios_security_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.vetios_security_events
    WHERE created_at < now() - interval '180 days';
END;
$$;

COMMENT ON TABLE public.vetios_security_events IS
    'VetIOS self-protection ledger for origin, clone-defense, attestation, abuse-risk, and block events.';
