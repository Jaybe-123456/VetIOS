-- VetIOS Platform Alerts Foundation
-- Creates the base table for cross-clinic and system-level alerts.

CREATE TABLE IF NOT EXISTS public.platform_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_key TEXT UNIQUE NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.platform_alerts ENABLE ROW LEVEL SECURITY;

-- Base policy: authenticated users can read all alerts
CREATE POLICY "authenticated_view_alerts" ON public.platform_alerts
    FOR SELECT USING (auth.role() = 'authenticated');

-- Cleanup function to update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.platform_alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
