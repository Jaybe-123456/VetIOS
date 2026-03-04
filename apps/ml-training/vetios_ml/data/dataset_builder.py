"""
Dataset builder: extracts training data from Supabase and converts to TF-ready tensors.

Usage:
    python -m vetios_ml.data.dataset_builder
"""

import json
import numpy as np
import pandas as pd
import tensorflow as tf
from supabase import create_client

from vetios_ml.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ARTIFACTS_DIR
from vetios_ml.data.feature_views import (
    INFERENCE_OUTCOME_VIEW,
    ENCOUNTER_RISK_VIEW,
)


def get_supabase_client():
    """Create an authenticated Supabase client using the service role key."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "Copy .env.example → .env and fill in your credentials."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _execute_sql(client, query: str) -> list[dict]:
    """Execute raw SQL via Supabase RPC and return rows as dicts."""
    response = client.rpc("exec_sql", {"query": query}).execute()
    return response.data if response.data else []


def extract_inference_outcome_dataset(client) -> pd.DataFrame:
    """
    Extract inference→outcome pairs for supervised training.
    Each row is a (predicted_output, actual_outcome) pair.
    """
    rows = _execute_sql(client, INFERENCE_OUTCOME_VIEW)

    if not rows:
        print("[dataset_builder] No inference→outcome pairs found. Using synthetic data.")
        return _generate_synthetic_inference_data()

    df = pd.DataFrame(rows)
    print(f"[dataset_builder] Extracted {len(df)} inference→outcome pairs.")
    return df


def extract_encounter_risk_dataset(client) -> pd.DataFrame:
    """
    Extract encounter-level features for risk scoring.
    Label: adverse_outcome_label (binary).
    """
    rows = _execute_sql(client, ENCOUNTER_RISK_VIEW)

    if not rows:
        print("[dataset_builder] No encounter data found. Using synthetic data.")
        return _generate_synthetic_encounter_data()

    df = pd.DataFrame(rows)
    print(f"[dataset_builder] Extracted {len(df)} encounter records.")
    return df


# ── Synthetic data generators (for bootstrapping before real data exists) ─────

def _generate_synthetic_inference_data(n: int = 500) -> pd.DataFrame:
    """Generate synthetic inference→outcome pairs for initial pipeline testing."""
    rng = np.random.default_rng(42)

    confidence = rng.beta(5, 2, size=n)  # Right-skewed confidence
    correctness = (rng.random(n) < confidence).astype(float)  # Correlated labels
    latency = rng.integers(50, 800, size=n)

    return pd.DataFrame({
        "predicted_confidence": confidence,
        "actual_correctness": correctness,
        "inference_latency_ms": latency,
        "hours_to_outcome": rng.exponential(24, size=n),
    })


def _generate_synthetic_encounter_data(n: int = 300) -> pd.DataFrame:
    """Generate synthetic encounter features for risk model bootstrapping."""
    rng = np.random.default_rng(42)

    species = rng.choice(["canine", "feline", "equine", "avian"], size=n)
    decision_count = rng.integers(0, 10, size=n)
    override_count = rng.integers(0, 3, size=n)
    adverse = (rng.random(n) < 0.15).astype(int)  # ~15% adverse event rate

    return pd.DataFrame({
        "species": species,
        "decision_count": decision_count,
        "override_count": override_count,
        "adverse_outcome_label": adverse,
    })


def build_tf_dataset(
    df: pd.DataFrame,
    feature_cols: list[str],
    label_col: str,
    batch_size: int = 32,
) -> tf.data.Dataset:
    """
    Convert a Pandas DataFrame into a batched, shuffled tf.data.Dataset.
    Handles categorical encoding for string columns.
    """
    df_encoded = df.copy()

    # One-hot encode string columns
    for col in feature_cols:
        if df_encoded[col].dtype == object:
            dummies = pd.get_dummies(df_encoded[col], prefix=col)
            df_encoded = pd.concat([df_encoded, dummies], axis=1)
            df_encoded.drop(columns=[col], inplace=True)
            feature_cols = [c for c in feature_cols if c != col] + list(dummies.columns)

    features = df_encoded[feature_cols].values.astype(np.float32)
    labels = df_encoded[label_col].values.astype(np.float32).reshape(-1, 1)

    dataset = tf.data.Dataset.from_tensor_slices((features, labels))
    dataset = dataset.shuffle(buffer_size=len(df)).batch(batch_size).prefetch(tf.data.AUTOTUNE)

    return dataset, feature_cols


# ── CLI entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("VetIOS Dataset Builder")
    print("=" * 60)

    try:
        client = get_supabase_client()
        df_inference = extract_inference_outcome_dataset(client)
        df_encounters = extract_encounter_risk_dataset(client)
    except EnvironmentError:
        print("[dataset_builder] No Supabase credentials. Generating synthetic data.")
        df_inference = _generate_synthetic_inference_data()
        df_encounters = _generate_synthetic_encounter_data()

    # Save to CSV for inspection
    inference_path = ARTIFACTS_DIR / "inference_outcome_dataset.csv"
    encounter_path = ARTIFACTS_DIR / "encounter_risk_dataset.csv"

    df_inference.to_csv(inference_path, index=False)
    df_encounters.to_csv(encounter_path, index=False)

    print(f"\n[dataset_builder] Saved {len(df_inference)} inference rows → {inference_path}")
    print(f"[dataset_builder] Saved {len(df_encounters)} encounter rows → {encounter_path}")
    print("[dataset_builder] Done.")
