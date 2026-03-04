"""
drift.py — Feature and label drift detection for VetIOS models.

Implements:
  - Population Stability Index (PSI) for feature drift
  - Chi-squared test for label distribution drift
  - Drift report generation + artifact logging

Usage:
    python -m vetios_ml.drift
"""

import json
import numpy as np
from scipy import stats

from vetios_ml.config import ARTIFACTS_DIR
from vetios_ml.data.dataset_builder import _generate_synthetic_encounter_data


# ── Population Stability Index (Feature Drift) ───────────────────────────────

def compute_psi(reference: np.ndarray, current: np.ndarray, n_bins: int = 10) -> float:
    """
    Population Stability Index (PSI) measures distribution shift.

    PSI < 0.1  → No significant drift
    PSI 0.1-0.25 → Moderate drift (monitor)
    PSI > 0.25 → Significant drift (alert)
    """
    # Create bins from reference distribution
    breakpoints = np.percentile(reference, np.linspace(0, 100, n_bins + 1))
    breakpoints = np.unique(breakpoints)

    # Compute bin proportions
    ref_counts = np.histogram(reference, bins=breakpoints)[0]
    cur_counts = np.histogram(current, bins=breakpoints)[0]

    # Add smoothing to avoid log(0)
    ref_pct = (ref_counts + 1) / (len(reference) + len(breakpoints))
    cur_pct = (cur_counts + 1) / (len(current) + len(breakpoints))

    psi = np.sum((cur_pct - ref_pct) * np.log(cur_pct / ref_pct))
    return float(psi)


def interpret_psi(psi: float) -> str:
    """Human-readable PSI interpretation."""
    if psi < 0.1:
        return "stable"
    elif psi < 0.25:
        return "moderate_drift"
    else:
        return "significant_drift"


# ── Label Drift (Chi-Squared Test) ────────────────────────────────────────────

def compute_label_drift(
    reference_labels: np.ndarray,
    current_labels: np.ndarray,
    significance: float = 0.05,
) -> dict:
    """
    Chi-squared test for label distribution shift.
    Compares the frequency of each class between reference and current.
    """
    ref_unique, ref_counts = np.unique(reference_labels, return_counts=True)
    cur_unique, cur_counts = np.unique(current_labels, return_counts=True)

    # Align categories
    all_labels = np.union1d(ref_unique, cur_unique)
    ref_freq = np.array([ref_counts[ref_unique == l][0] if l in ref_unique else 0 for l in all_labels])
    cur_freq = np.array([cur_counts[cur_unique == l][0] if l in cur_unique else 0 for l in all_labels])

    # Normalize to proportions
    ref_prop = ref_freq / ref_freq.sum()
    cur_prop = cur_freq / cur_freq.sum()

    # Chi-squared test (expected = reference proportions scaled to current sample size)
    expected = ref_prop * cur_freq.sum()
    expected = np.maximum(expected, 1)  # Avoid division by zero

    chi2, p_value = stats.chisquare(cur_freq, f_exp=expected)

    return {
        "chi2_statistic": round(float(chi2), 4),
        "p_value": round(float(p_value), 4),
        "drift_detected": bool(p_value < significance),
        "significance_level": significance,
        "reference_distribution": {str(l): round(float(p), 4) for l, p in zip(all_labels, ref_prop)},
        "current_distribution": {str(l): round(float(p), 4) for l, p in zip(all_labels, cur_prop)},
    }


# ── Full Drift Report ────────────────────────────────────────────────────────

def generate_drift_report(
    reference_df=None,
    current_df=None,
    feature_cols=None,
    label_col: str = "adverse_outcome_label",
) -> dict:
    """
    Generate a comprehensive drift report comparing reference and current data.
    """
    # Default: use synthetic data with different seeds to simulate drift
    if reference_df is None:
        reference_df = _generate_synthetic_encounter_data(n=300)
    if current_df is None:
        # Simulate drifted data with slightly different distribution
        rng = np.random.default_rng(99)
        current_df = _generate_synthetic_encounter_data(n=200)
        # Inject mild drift: shift decision_count distribution
        current_df["decision_count"] = (current_df["decision_count"] + rng.integers(0, 3, size=len(current_df))).astype(int)

    if feature_cols is None:
        feature_cols = ["decision_count", "override_count"]

    # Feature drift (PSI per feature)
    feature_drift = {}
    for col in feature_cols:
        if col not in reference_df.columns or col not in current_df.columns:
            continue
        ref_vals = reference_df[col].values.astype(float)
        cur_vals = current_df[col].values.astype(float)
        psi = compute_psi(ref_vals, cur_vals)
        feature_drift[col] = {
            "psi": round(psi, 4),
            "status": interpret_psi(psi),
            "ref_mean": round(float(ref_vals.mean()), 4),
            "cur_mean": round(float(cur_vals.mean()), 4),
            "ref_std": round(float(ref_vals.std()), 4),
            "cur_std": round(float(cur_vals.std()), 4),
        }

    # Label drift
    label_drift = compute_label_drift(
        reference_df[label_col].values,
        current_df[label_col].values,
    )

    # Overall assessment
    any_feature_drift = any(d["status"] != "stable" for d in feature_drift.values())
    overall_status = "drift_detected" if (any_feature_drift or label_drift["drift_detected"]) else "stable"

    report = {
        "overall_status": overall_status,
        "reference_samples": int(len(reference_df)),
        "current_samples": int(len(current_df)),
        "feature_drift": feature_drift,
        "label_drift": label_drift,
    }

    return report


# ── CLI Entrypoint ────────────────────────────────────────────────────────────

def detect_drift() -> dict:
    """Run drift detection and save report."""
    print("=" * 60)
    print("VetIOS Drift Detection")
    print("=" * 60)

    report = generate_drift_report()

    print(f"\n[drift] Overall status: {report['overall_status'].upper()}")
    print(f"[drift] Reference: {report['reference_samples']} samples")
    print(f"[drift] Current:   {report['current_samples']} samples")

    print("\n[drift] Feature Drift (PSI):")
    for name, data in report["feature_drift"].items():
        status_icon = "✓" if data["status"] == "stable" else "⚠" if data["status"] == "moderate_drift" else "✗"
        print(f"  {status_icon} {name}: PSI={data['psi']:.4f} ({data['status']})")

    print(f"\n[drift] Label Drift:")
    ld = report["label_drift"]
    drift_icon = "✗ DRIFT" if ld["drift_detected"] else "✓ STABLE"
    print(f"  {drift_icon} — chi²={ld['chi2_statistic']:.4f}, p={ld['p_value']:.4f}")

    # Save report
    drift_path = ARTIFACTS_DIR / "drift_report.json"
    with open(drift_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n[drift] Report saved → {drift_path}")
    return report


if __name__ == "__main__":
    detect_drift()
