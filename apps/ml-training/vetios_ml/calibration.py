"""
calibration.py — Post-hoc probability calibration for the VetIOS risk model.

Implements:
  - Temperature scaling (learns a single T to divide logits)
  - Isotonic regression (non-parametric monotonic mapping)
  - Reliability diagram data generation from calibration curves

Usage:
    python -m vetios_ml.calibration
"""

import json
import numpy as np
import tensorflow as tf
from sklearn.isotonic import IsotonicRegression
from scipy.optimize import minimize_scalar

from vetios_ml.config import ARTIFACTS_DIR, BATCH_SIZE
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)
from vetios_ml.models.risk_model import VetRiskModel


# ── Temperature Scaling ───────────────────────────────────────────────────────

class TemperatureScaler:
    """
    Learns a single scalar T that divides logits before sigmoid.
    Minimizes NLL on a held-out calibration set.

    calibrated_prob = sigmoid(logit / T)
    """

    def __init__(self):
        self.temperature: float = 1.0

    def fit(self, logits: np.ndarray, labels: np.ndarray) -> float:
        """Find optimal temperature T by minimizing negative log-likelihood."""

        def nll(T):
            scaled = logits / T
            probs = 1.0 / (1.0 + np.exp(-scaled))
            probs = np.clip(probs, 1e-7, 1 - 1e-7)
            return -np.mean(labels * np.log(probs) + (1 - labels) * np.log(1 - probs))

        result = minimize_scalar(nll, bounds=(0.1, 10.0), method="bounded")
        self.temperature = result.x
        return self.temperature

    def calibrate(self, logits: np.ndarray) -> np.ndarray:
        """Apply temperature scaling to raw logits."""
        scaled = logits / self.temperature
        return 1.0 / (1.0 + np.exp(-scaled))

    def to_dict(self) -> dict:
        return {"method": "temperature_scaling", "temperature": self.temperature}


# ── Isotonic Regression ───────────────────────────────────────────────────────

class IsotonicCalibrator:
    """
    Non-parametric monotonic calibration via isotonic regression.
    Maps uncalibrated probabilities → calibrated probabilities.
    """

    def __init__(self):
        self.iso = IsotonicRegression(out_of_bounds="clip")
        self._fitted = False

    def fit(self, probs: np.ndarray, labels: np.ndarray):
        """Fit isotonic regression on uncalibrated probs vs true labels."""
        self.iso.fit(probs.flatten(), labels.flatten())
        self._fitted = True

    def calibrate(self, probs: np.ndarray) -> np.ndarray:
        """Apply isotonic mapping."""
        if not self._fitted:
            return probs
        return self.iso.predict(probs.flatten()).reshape(probs.shape)

    def to_dict(self) -> dict:
        return {"method": "isotonic_regression", "fitted": self._fitted}


# ── Reliability Diagram Data ──────────────────────────────────────────────────

def reliability_diagram(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> dict:
    """
    Compute reliability diagram bin data for calibration visualization.
    Returns {bins: [{bin_center, accuracy, confidence, count}], ece: float}
    """
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    bins = []
    ece = 0.0

    for i in range(n_bins):
        mask = (y_prob >= bin_boundaries[i]) & (y_prob < bin_boundaries[i + 1])
        count = int(mask.sum())
        if count == 0:
            bins.append({
                "bin_center": round((bin_boundaries[i] + bin_boundaries[i + 1]) / 2, 2),
                "accuracy": 0.0, "confidence": 0.0, "count": 0,
            })
            continue

        acc = float(y_true[mask].mean())
        conf = float(y_prob[mask].mean())
        weight = count / len(y_true)
        ece += weight * abs(acc - conf)

        bins.append({
            "bin_center": round((bin_boundaries[i] + bin_boundaries[i + 1]) / 2, 2),
            "accuracy": round(acc, 4),
            "confidence": round(conf, 4),
            "count": count,
        })

    return {"bins": bins, "ece": round(ece, 4)}


# ── CLI Entrypoint ────────────────────────────────────────────────────────────

def calibrate() -> dict:
    """
    Run calibration pipeline: load model, collect logits, fit calibrators.
    """
    print("=" * 60)
    print("VetIOS Calibration Pipeline")
    print("=" * 60)

    # ── Load model ────────────────────────────────────────────────────────
    weights_path = ARTIFACTS_DIR / "risk_model_v1.weights.h5"
    meta_path = ARTIFACTS_DIR / "training_metrics.json"

    if not weights_path.exists() or not meta_path.exists():
        print("[calibrate] No model found. Run `python -m vetios_ml.train` first.")
        return {}

    with open(meta_path) as f:
        meta = json.load(f)

    model = VetRiskModel(input_dim=meta["input_dim"])
    model(np.zeros((1, meta["input_dim"]), dtype=np.float32))
    model.load_weights(weights_path)
    print(f"[calibrate] Loaded model (input_dim={meta['input_dim']})")

    # ── Generate calibration dataset (held-out) ───────────────────────────
    df = _generate_synthetic_encounter_data(n=300)
    feature_cols = ["decision_count", "override_count"]
    if "species" in df.columns:
        feature_cols.append("species")

    dataset, encoded_cols = build_tf_dataset(df, feature_cols, "adverse_outcome_label", batch_size=BATCH_SIZE)

    # ── Collect logits + labels ───────────────────────────────────────────
    all_logits, all_labels = [], []
    for x_batch, y_batch in dataset:
        logits = model(x_batch, training=False).numpy().flatten()
        all_logits.extend(logits)
        all_labels.extend(y_batch.numpy().flatten())

    logits_arr = np.array(all_logits)
    labels_arr = np.array(all_labels)
    uncalibrated_probs = 1.0 / (1.0 + np.exp(-logits_arr))

    print(f"[calibrate] Collected {len(logits_arr)} samples for calibration")

    # ── Temperature Scaling ───────────────────────────────────────────────
    temp_scaler = TemperatureScaler()
    T = temp_scaler.fit(logits_arr, labels_arr)
    temp_probs = temp_scaler.calibrate(logits_arr)

    print(f"[calibrate] Temperature scaling: T = {T:.4f}")

    # ── Isotonic Regression ───────────────────────────────────────────────
    iso_cal = IsotonicCalibrator()
    iso_cal.fit(uncalibrated_probs, labels_arr)
    iso_probs = iso_cal.calibrate(uncalibrated_probs)

    print("[calibrate] Isotonic regression fitted")

    # ── Reliability diagrams ──────────────────────────────────────────────
    uncal_diagram = reliability_diagram(labels_arr, uncalibrated_probs)
    temp_diagram = reliability_diagram(labels_arr, temp_probs)
    iso_diagram = reliability_diagram(labels_arr, iso_probs)

    print(f"[calibrate] ECE (uncalibrated): {uncal_diagram['ece']:.4f}")
    print(f"[calibrate] ECE (temp scaled):  {temp_diagram['ece']:.4f}")
    print(f"[calibrate] ECE (isotonic):     {iso_diagram['ece']:.4f}")

    # ── Save calibration artifacts ────────────────────────────────────────
    calibration_result = {
        "temperature": T,
        "calibrators": {
            "temperature_scaling": temp_scaler.to_dict(),
            "isotonic_regression": iso_cal.to_dict(),
        },
        "reliability": {
            "uncalibrated": uncal_diagram,
            "temperature_scaled": temp_diagram,
            "isotonic": iso_diagram,
        },
    }

    cal_path = ARTIFACTS_DIR / "calibration_results.json"
    with open(cal_path, "w") as f:
        json.dump(calibration_result, f, indent=2)

    print(f"\n[calibrate] Results saved → {cal_path}")
    return calibration_result


if __name__ == "__main__":
    calibrate()
