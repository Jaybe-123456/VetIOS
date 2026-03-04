"""
simulation_sampler.py — Pull edge simulation data for training augmentation.

Queries the edge_simulation_events table and generates synthetic
adversarial cases for rare disease patterns.

Usage:
    from vetios_ml.data.simulation_sampler import sample_simulation_cases
"""

import numpy as np
import pandas as pd

from vetios_ml.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


SIMULATION_QUERY = """
SELECT
    se.id,
    se.tenant_id,
    se.simulation_type,
    se.input_scenario,
    se.output_result,
    se.degradation_score,
    se.created_at

FROM public.edge_simulation_events se
WHERE se.degradation_score IS NOT NULL

ORDER BY se.created_at DESC
LIMIT 500
"""


def sample_simulation_cases(client=None) -> pd.DataFrame:
    """
    Pull simulation cases from Supabase for training augmentation.
    Falls back to synthetic adversarial data if unavailable.
    """
    if client:
        try:
            response = client.rpc("exec_sql", {"query": SIMULATION_QUERY}).execute()
            if response.data:
                df = pd.DataFrame(response.data)
                print(f"[simulation_sampler] Pulled {len(df)} simulation cases from Supabase")
                return df
        except Exception as e:
            print(f"[simulation_sampler] Supabase query failed: {e}")

    return _generate_synthetic_simulations()


def _generate_synthetic_simulations(n: int = 200) -> pd.DataFrame:
    """
    Generate synthetic adversarial encounter scenarios.
    These represent edge cases with higher adverse outcome rates.
    """
    rng = np.random.default_rng(77)

    # Adversarial cases: higher override counts, more complex scenarios
    decision_count = rng.integers(3, 15, size=n)  # Higher complexity
    override_count = rng.integers(1, 5, size=n)    # More clinician corrections
    species = rng.choice(["canine", "feline", "equine", "avian"], size=n, p=[0.3, 0.3, 0.2, 0.2])

    # Higher adverse rate for adversarial cases (30% vs 15% in regular data)
    complexity_signal = (decision_count / 15.0) + (override_count / 5.0)
    adverse = (rng.random(n) < (0.15 + 0.20 * complexity_signal / 2)).astype(int)

    # Difficulty score: how hard the case is (for curriculum learning)
    difficulty = np.clip(complexity_signal / 2.0, 0, 1)

    return pd.DataFrame({
        "decision_count": decision_count,
        "override_count": override_count,
        "species": species,
        "adverse_outcome_label": adverse,
        "difficulty_score": difficulty.round(3),
        "source": "simulation",
    })


def sample_with_curriculum(df: pd.DataFrame, epoch: int, total_epochs: int) -> pd.DataFrame:
    """
    Curriculum learning: gradually increase difficulty over training.

    Early epochs: mostly easy cases (difficulty < 0.5)
    Late epochs: include all cases including hardest adversarial ones
    """
    if "difficulty_score" not in df.columns:
        return df

    # Linear schedule: threshold decreases from 0.7 → 0.0 over training
    difficulty_threshold = max(0.0, 0.7 * (1 - epoch / total_epochs))

    # Always include some hard cases (minimum 20%)
    easy_mask = df["difficulty_score"] <= difficulty_threshold
    hard_mask = ~easy_mask

    easy_cases = df[easy_mask]
    hard_cases = df[hard_mask]

    # Sample at least 20% hard cases
    n_hard = max(int(len(df) * 0.2), len(hard_cases))
    if len(hard_cases) > 0:
        hard_sample = hard_cases.sample(n=min(n_hard, len(hard_cases)), replace=True, random_state=epoch)
        return pd.concat([easy_cases, hard_sample], ignore_index=True)

    return df
