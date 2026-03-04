"""
shadow_mode.py — Shadow inference runner for deployment hardening.

Runs the ML model in parallel with the primary pipeline without
affecting clinical output. Captures predictions for comparison analysis.

Usage:
    python -m vetios_ml.shadow_mode
"""

import json
import numpy as np
from datetime import datetime, timezone

from vetios_ml.config import ARTIFACTS_DIR, BATCH_SIZE
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)
from vetios_ml.models.risk_model import VetRiskModel
from vetios_ml.calibration import TemperatureScaler


def run_shadow_evaluation() -> dict:
    """
    Run shadow inference on a held-out dataset and generate a comparison report.

    Compares:
      - Model v1 (baseline) vs Model v2 (augmented)
      - Calibrated vs uncalibrated predictions
      - Agreement rate between models
    """
    print("=" * 60)
    print("VetIOS Shadow Evaluation")
    print("=" * 60)

    # ── Load models ───────────────────────────────────────────────────────
    meta_path = ARTIFACTS_DIR / "training_metrics.json"
    v1_path = ARTIFACTS_DIR / "risk_model_v1.weights.h5"
    v2_path = ARTIFACTS_DIR / "risk_model_augmented.weights.h5"

    if not meta_path.exists() or not v1_path.exists():
        print("[shadow] No baseline model. Run `python -m vetios_ml.train` first.")
        return {}

    with open(meta_path) as f:
        meta = json.load(f)

    input_dim = meta["input_dim"]

    # Load baseline model (v1)
    model_v1 = VetRiskModel(input_dim=input_dim)
    model_v1(np.zeros((1, input_dim), dtype=np.float32))
    model_v1.load_weights(v1_path)
    print("[shadow] Loaded baseline model (v1)")

    # Load augmented model (v2) if available
    model_v2 = None
    if v2_path.exists():
        model_v2 = VetRiskModel(input_dim=input_dim)
        model_v2(np.zeros((1, input_dim), dtype=np.float32))
        model_v2.load_weights(v2_path)
        print("[shadow] Loaded augmented model (v2)")
    else:
        print("[shadow] No augmented model (v2). Comparing v1 only.")

    # ── Load calibration ──────────────────────────────────────────────────
    cal_path = ARTIFACTS_DIR / "calibration_results.json"
    temp_scaler = TemperatureScaler()
    if cal_path.exists():
        with open(cal_path) as f:
            cal_data = json.load(f)
        temp_scaler.temperature = cal_data.get("temperature", 1.0)
        print(f"[shadow] Loaded calibration (T={temp_scaler.temperature:.4f})")

    # ── Generate shadow evaluation dataset ────────────────────────────────
    df = _generate_synthetic_encounter_data(n=200)
    feature_cols = ["decision_count", "override_count"]
    if "species" in df.columns:
        feature_cols.append("species")

    dataset, _ = build_tf_dataset(df, feature_cols, "adverse_outcome_label", batch_size=BATCH_SIZE)

    # ── Collect shadow predictions ────────────────────────────────────────
    v1_logits, v2_logits, labels = [], [], []

    for x_batch, y_batch in dataset:
        v1_out = model_v1(x_batch, training=False).numpy().flatten()
        v1_logits.extend(v1_out)
        labels.extend(y_batch.numpy().flatten())

        if model_v2:
            v2_out = model_v2(x_batch, training=False).numpy().flatten()
            v2_logits.extend(v2_out)

    v1_logits = np.array(v1_logits)
    labels_arr = np.array(labels)

    # Uncalibrated + calibrated predictions
    v1_uncal = 1.0 / (1.0 + np.exp(-v1_logits))
    v1_cal = temp_scaler.calibrate(v1_logits)

    # ── Compute shadow metrics ────────────────────────────────────────────
    from sklearn.metrics import roc_auc_score, brier_score_loss

    has_both_classes = len(np.unique(labels_arr)) > 1

    shadow_report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "n_samples": len(labels_arr),
        "positive_rate": round(float(labels_arr.mean()), 4),
        "v1_baseline": {
            "auroc": round(float(roc_auc_score(labels_arr, v1_uncal)), 4) if has_both_classes else None,
            "brier": round(float(brier_score_loss(labels_arr, v1_uncal)), 4),
            "mean_prediction": round(float(v1_uncal.mean()), 4),
        },
        "v1_calibrated": {
            "auroc": round(float(roc_auc_score(labels_arr, v1_cal)), 4) if has_both_classes else None,
            "brier": round(float(brier_score_loss(labels_arr, v1_cal)), 4),
            "mean_prediction": round(float(v1_cal.mean()), 4),
            "temperature": temp_scaler.temperature,
        },
    }

    if model_v2 and v2_logits:
        v2_logits = np.array(v2_logits)
        v2_probs = 1.0 / (1.0 + np.exp(-v2_logits))
        v2_cal = temp_scaler.calibrate(v2_logits)

        shadow_report["v2_augmented"] = {
            "auroc": round(float(roc_auc_score(labels_arr, v2_probs)), 4) if has_both_classes else None,
            "brier": round(float(brier_score_loss(labels_arr, v2_probs)), 4),
            "mean_prediction": round(float(v2_probs.mean()), 4),
        }

        # Agreement between v1 and v2
        v1_binary = (v1_uncal > 0.5).astype(int)
        v2_binary = (v2_probs > 0.5).astype(int)
        agreement = float((v1_binary == v2_binary).mean())
        shadow_report["model_agreement"] = round(agreement, 4)

    # ── Safety gate check ─────────────────────────────────────────────────
    safety_gates = {
        "calibration_improved": shadow_report["v1_calibrated"]["brier"] <= shadow_report["v1_baseline"]["brier"],
        "auroc_above_threshold": (shadow_report["v1_baseline"]["auroc"] or 0) >= 0.5,
    }

    if "v2_augmented" in shadow_report:
        safety_gates["v2_beats_v1"] = (
            (shadow_report["v2_augmented"]["brier"] or 1) <= (shadow_report["v1_baseline"]["brier"] or 1)
        )

    shadow_report["safety_gates"] = safety_gates
    shadow_report["promotion_recommendation"] = all(safety_gates.values())

    # ── Save report ───────────────────────────────────────────────────────
    report_path = ARTIFACTS_DIR / "shadow_evaluation_report.json"
    with open(report_path, "w") as f:
        json.dump(shadow_report, f, indent=2)

    print(f"\n[shadow] V1 Baseline — AUROC: {shadow_report['v1_baseline']['auroc']}, Brier: {shadow_report['v1_baseline']['brier']}")
    print(f"[shadow] V1 Calibrated — AUROC: {shadow_report['v1_calibrated']['auroc']}, Brier: {shadow_report['v1_calibrated']['brier']}")

    if "v2_augmented" in shadow_report:
        print(f"[shadow] V2 Augmented — AUROC: {shadow_report['v2_augmented']['auroc']}, Brier: {shadow_report['v2_augmented']['brier']}")
        print(f"[shadow] Model agreement: {shadow_report.get('model_agreement', 'n/a')}")

    print(f"\n[shadow] Safety gates: {safety_gates}")
    print(f"[shadow] Promotion: {'✓ GO' if shadow_report['promotion_recommendation'] else '✗ NO-GO'}")
    print(f"[shadow] Report saved → {report_path}")

    return shadow_report


if __name__ == "__main__":
    run_shadow_evaluation()
