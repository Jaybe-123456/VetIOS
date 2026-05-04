-- ─── Tier 4: Counterfactual Multi-Agent Diagnostic Reasoning ─────────────────
-- Connects to: ai_inference_events, treatment_events, multi-agent sessions
--
-- Two tables:
--   counterfactual_diagnostic_sessions — one row per case challenger run
--   cpg_finding_scores                 — one row per finding per diagnosis

-- ── 1. Counterfactual Diagnostic Sessions ────────────────────────────────────
-- Records the full challenger run for a case: which findings were removed,
-- how many differentials were tested, overall stability verdict.
CREATE TABLE IF NOT EXISTS counterfactual_diagnostic_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  case_id                 TEXT NOT NULL,
  inference_event_id      UUID REFERENCES ai_inference_events(id) ON DELETE SET NULL,
  session_id              TEXT NOT NULL,              -- links to multi-agent session

  -- Patient context snapshot
  species                 TEXT NOT NULL,
  breed                   TEXT,
  age_years               FLOAT,

  -- Baseline diagnosis before any finding removal
  baseline_primary        TEXT NOT NULL,
  baseline_confidence     FLOAT NOT NULL,
  baseline_differential_count INTEGER NOT NULL DEFAULT 0,

  -- Challenger results
  findings_challenged     INTEGER NOT NULL DEFAULT 0, -- how many findings were removed
  diagnoses_tested        INTEGER NOT NULL DEFAULT 0, -- how many diagnoses were evaluated
  stability_verdict       TEXT NOT NULL,              -- 'stable'|'unstable'|'fragile'|'indeterminate'
  stability_score         FLOAT NOT NULL DEFAULT 0,   -- 0-1, higher = more stable
  top_load_bearing_finding TEXT,                      -- finding whose removal changes diagnosis most
  reasoning_trace         JSONB DEFAULT '[]',         -- step-by-step challenger log

  -- Performance
  latency_ms              INTEGER,
  computed_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. CPG Finding Scores ─────────────────────────────────────────────────────
-- Counterfactual Probability Gap per finding per diagnosis.
-- "When we remove finding X, how much does the probability of diagnosis D change?"
-- High CPG = finding strongly supports/weakens that diagnosis = load-bearing.
CREATE TABLE IF NOT EXISTS cpg_finding_scores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES counterfactual_diagnostic_sessions(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL,

  -- The finding that was removed
  finding                 TEXT NOT NULL,
  finding_type            TEXT NOT NULL,  -- 'presenting_sign'|'diagnostic_test'|'physical_exam'|'history'

  -- The diagnosis being evaluated
  diagnosis               TEXT NOT NULL,
  diagnosis_rank_baseline INTEGER NOT NULL,  -- rank before removal

  -- The CPG: confidence BEFORE minus confidence AFTER removal
  probability_baseline    FLOAT NOT NULL,
  probability_counterfactual FLOAT NOT NULL,
  cpg                     FLOAT NOT NULL,   -- baseline - counterfactual (positive = finding supports diagnosis)

  -- What happened to rank when this finding was removed
  rank_after_removal      INTEGER,
  rank_delta              INTEGER,          -- positive = dropped in rank, negative = rose
  diagnosis_dropped_out   BOOLEAN DEFAULT FALSE, -- diagnosis left top-5 entirely

  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS cf_sessions_tenant_case_idx
  ON counterfactual_diagnostic_sessions(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS cf_sessions_inference_event_idx
  ON counterfactual_diagnostic_sessions(inference_event_id);
CREATE INDEX IF NOT EXISTS cf_sessions_stability_idx
  ON counterfactual_diagnostic_sessions(stability_verdict, stability_score);
CREATE INDEX IF NOT EXISTS cpg_scores_session_idx
  ON cpg_finding_scores(session_id);
CREATE INDEX IF NOT EXISTS cpg_scores_finding_diagnosis_idx
  ON cpg_finding_scores(finding, diagnosis);
CREATE INDEX IF NOT EXISTS cpg_scores_cpg_idx
  ON cpg_finding_scores(cpg DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE counterfactual_diagnostic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpg_finding_scores                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_cf_sessions"
  ON counterfactual_diagnostic_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_cpg_scores"
  ON cpg_finding_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE counterfactual_diagnostic_sessions IS
  'Tier 4 — one challenger run per case: stability verdict + load-bearing findings';
COMMENT ON TABLE cpg_finding_scores IS
  'Tier 4 — CPG per finding per diagnosis: how much each finding supports each differential';
