-- Final schema alignment for Adversarial Simulation Hub

-- 1. Align Simulations table
ALTER TABLE public.simulations 
ADD COLUMN IF NOT EXISTS results jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS started_at timestamptz,
ADD COLUMN IF NOT EXISTS completed_at timestamptz,
ADD COLUMN IF NOT EXISTS created_by text;

-- 2. Align Adversarial Prompts table
ALTER TABLE public.adversarial_prompts
ADD COLUMN IF NOT EXISTS severity text DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS created_by text;

-- 3. Update Adversarial Prompts check constraint
ALTER TABLE public.adversarial_prompts DROP CONSTRAINT IF EXISTS adversarial_prompts_category_check;
ALTER TABLE public.adversarial_prompts ADD CONSTRAINT adversarial_prompts_category_check 
CHECK (category IN ('jailbreak', 'injection', 'gibberish', 'extreme_length', 'multilingual', 'sensitive_topic', 'rare_species', 'conflicting_inputs'));

-- 4. Create Simulation Events table
CREATE TABLE IF NOT EXISTS public.simulation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id uuid NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Create Regression Replays table
CREATE TABLE IF NOT EXISTS public.regression_replays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id uuid NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
    tenant_id text NOT NULL,
    original_event_id uuid NOT NULL,
    original_score numeric,
    candidate_score numeric,
    delta numeric,
    is_regression boolean DEFAULT false,
    is_improvement boolean DEFAULT false,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Align Model Registry for blocking
ALTER TABLE public.model_registry
ADD COLUMN IF NOT EXISTS blocked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS block_reason text,
ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
ADD COLUMN IF NOT EXISTS blocked_by_simulation_id uuid;

-- 7. Add Indexes
CREATE INDEX IF NOT EXISTS idx_simulation_events_simulation_id ON public.simulation_events(simulation_id);
CREATE INDEX IF NOT EXISTS idx_regression_replays_simulation_id ON public.regression_replays(simulation_id);
CREATE INDEX IF NOT EXISTS idx_simulations_tenant_status ON public.simulations(tenant_id, status);

-- 8. Enable RLS
ALTER TABLE public.simulation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regression_replays ENABLE ROW LEVEL SECURITY;

-- 9. Basic RLS Policies (Simplified for alignment, matching existing patterns)
DROP POLICY IF EXISTS simulation_events_all_scope ON public.simulation_events;
CREATE POLICY simulation_events_all_scope ON public.simulation_events
    FOR ALL USING (true); -- Tenant isolation trigger handles the rest in this project

DROP POLICY IF EXISTS regression_replays_all_scope ON public.regression_replays;
CREATE POLICY regression_replays_all_scope ON public.regression_replays
    FOR ALL USING (true);
