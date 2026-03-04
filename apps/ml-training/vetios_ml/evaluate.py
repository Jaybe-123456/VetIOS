"""
evaluate.py — Model evaluation with clinical-grade metrics.

Usage:
    python -m vetios_ml.evaluate

Metrics computed:
  - AUROC / AUPRC (discrimination)
  - ECE / Brier score (calibration)
  - Abstention rate at configurable threshold
"""

import json
import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    roc_auc_score,
    average_precision_score,
    brier_score_loss,
)

from vetios_ml.config import ARTIFACTS_DIR, BATCH_SIZE
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
    """
    Compute Expected Calibration Error (ECE).
    Measures how well predicted probabilities match actual frequencies.
    """
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0

    for i in range(n_bins):
        mask = (y_prob >= bin_boundaries[i]) & (y_prob < bin_boundaries[i + 1])
        if mask.sum() == 0:
            continue
        bin_acc = y_true[mask].mean()
        bin_conf = y_prob[mask].mean()
        bin_weight = mask.sum() / len(y_true)
        ece += bin_weight * abs(bin_acc - bin_conf)

    return float(ece)


def evaluate() -> dict:
    """
    Load the latest model, run evaluation, and report clinical metrics.
    """
    print("=" * 60)
    print("VetIOS Model Evaluation")
    print("=" * 60)

    # ── Load model ────────────────────────────────────────────────────────
    model_path = ARTIFACTS_DIR / "risk_model_v1"

    if not model_path.exists():
        print(f"[evaluate] No model found at {model_path}. Run `python -m vetios_ml.train` first.")
        return {}

    model = tf.keras.models.load_model(model_path)
    print(f"[evaluate] Loaded model from {model_path}")

    # ── Load evaluation data ──────────────────────────────────────────────
    # Use a held-out synthetic set (in production, use a temporal split)
    df = _generate_synthetic_encounter_data(n=200)

    feature_cols = ["decision_count", "override_count"]
    if "species" in df.columns:
        feature_cols.append("species")

    label_col = "adverse_outcome_label"

    dataset, encoded_feature_cols = build_tf_dataset(
        df, feature_cols, label_col, batch_size=BATCH_SIZE
    )

    # ── Collect predictions ───────────────────────────────────────────────
    all_labels = []
    all_probs = []

    for x_batch, y_batch in dataset:
        logits = model(x_batch, training=False)
        probs = tf.nn.sigmoid(logits).numpy().flatten()
        all_probs.extend(probs)
        all_labels.extend(y_batch.numpy().flatten())

    all_labels = np.array(all_labels)
    all_probs = np.array(all_probs)

    # ── Compute metrics ───────────────────────────────────────────────────
    auroc = roc_auc_score(all_labels, all_probs) if len(np.unique(all_labels)) > 1 else 0.0
    auprc = average_precision_score(all_labels, all_probs) if len(np.unique(all_labels)) > 1 else 0.0
    brier = brier_score_loss(all_labels, all_probs)
    ece = expected_calibration_error(all_labels, all_probs)

    # Abstention rate: % of predictions below confidence threshold
    confidence_threshold = 0.3
    abstention_rate = float((all_probs < confidence_threshold).mean())

    results = {
        "n_samples": len(all_labels),
        "positive_rate": float(all_labels.mean()),
        "discrimination": {
            "auroc": round(auroc, 4),
            "auprc": round(auprc, 4),
        },
        "calibration": {
            "ece": round(ece, 4),
            "brier_score": round(brier, 4),
        },
        "reliability": {
            "abstention_rate": round(abstention_rate, 4),
            "confidence_threshold": confidence_threshold,
        },
    }

    # ── Save results ──────────────────────────────────────────────────────
    eval_path = ARTIFACTS_DIR / "evaluation_results.json"
    with open(eval_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n[evaluate] Samples: {results['n_samples']}")
    print(f"[evaluate] Positive rate: {results['positive_rate']:.2%}")
    print(f"[evaluate] AUROC: {results['discrimination']['auroc']}")
    print(f"[evaluate] AUPRC: {results['discrimination']['auprc']}")
    print(f"[evaluate] ECE: {results['calibration']['ece']}")
    print(f"[evaluate] Brier: {results['calibration']['brier_score']}")
    print(f"[evaluate] Abstention rate: {results['reliability']['abstention_rate']:.2%}")
    print(f"\n[evaluate] Results saved → {eval_path}")

    return results


# ── CLI entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    evaluate()
