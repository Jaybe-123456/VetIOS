"""
explainability.py — Gradient-based feature attribution for clinical explainability.

Uses tf.GradientTape to compute input gradients, revealing which features
drive risk predictions. This is critical for clinician trust and regulatory
compliance.

Implements:
  - Input gradient attribution (saliency maps)
  - Integrated Gradients for more robust attribution
  - Feature importance ranking

Usage:
    python -m vetios_ml.explainability
"""

import json
import numpy as np
import tensorflow as tf

from vetios_ml.config import ARTIFACTS_DIR, BATCH_SIZE
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)
from vetios_ml.models.risk_model import VetRiskModel


# ── Input Gradient Attribution ────────────────────────────────────────────────

def compute_input_gradients(model: tf.keras.Model, x: np.ndarray) -> np.ndarray:
    """
    Compute gradient of model output w.r.t. input features.
    Higher absolute gradient = more influential feature.

    This is the core autograd pattern from Section 4C of the expert guide:
        tape.watch(x) → model(x) → tape.gradient(score, x)
    """
    x_tensor = tf.cast(tf.constant(x), tf.float32)

    with tf.GradientTape() as tape:
        tape.watch(x_tensor)
        logits = model(x_tensor, training=False)
        score = tf.reduce_sum(tf.nn.sigmoid(logits))

    gradients = tape.gradient(score, x_tensor)
    return gradients.numpy()


# ── Integrated Gradients ──────────────────────────────────────────────────────

def integrated_gradients(
    model: tf.keras.Model,
    x: np.ndarray,
    baseline: np.ndarray = None,
    steps: int = 50,
) -> np.ndarray:
    """
    Integrated Gradients — more robust attribution than raw gradients.

    Accumulates gradients along a path from a baseline (zeros) to the input.
    Satisfies the axioms of completeness and sensitivity.
    """
    if baseline is None:
        baseline = np.zeros_like(x)

    # Generate interpolated inputs: baseline + alpha * (x - baseline)
    alphas = np.linspace(0, 1, steps + 1).reshape(-1, 1, 1) if x.ndim == 2 \
        else np.linspace(0, 1, steps + 1).reshape(-1, 1)

    interpolated = baseline + alphas * (x - baseline)

    # Flatten batch dimension for gradient computation
    if x.ndim == 2:
        interpolated = interpolated.reshape(-1, x.shape[-1])
    else:
        interpolated = interpolated.flatten().reshape(-1, x.shape[-1])

    # Compute gradients for all interpolated inputs
    grads = compute_input_gradients(model, interpolated)

    # Average gradients and scale by input difference
    if x.ndim == 2:
        avg_grads = grads.reshape(steps + 1, x.shape[0], x.shape[-1]).mean(axis=0)
    else:
        avg_grads = grads.reshape(steps + 1, -1).mean(axis=0)

    integrated = (x - baseline) * avg_grads

    return integrated


# ── Feature Importance Report ─────────────────────────────────────────────────

def explain_prediction(
    model: VetRiskModel,
    features: np.ndarray,
    feature_names: list[str],
    method: str = "integrated_gradients",
) -> dict:
    """
    Generate a feature attribution report for a single prediction.

    Returns ranked features with their attribution scores and direction.
    """
    # Get prediction
    logits = model(features, training=False).numpy()
    risk_score = float(tf.nn.sigmoid(logits).numpy()[0][0])

    # Compute attributions
    if method == "integrated_gradients":
        attributions = integrated_gradients(model, features)
    else:
        attributions = compute_input_gradients(model, features)

    attr_flat = attributions.flatten()

    # Rank by absolute attribution
    ranked = sorted(
        zip(feature_names, attr_flat.tolist()),
        key=lambda x: abs(x[1]),
        reverse=True,
    )

    return {
        "risk_score": round(risk_score, 4),
        "method": method,
        "attributions": [
            {
                "feature": name,
                "attribution": round(float(score), 6),
                "direction": "risk_increasing" if score > 0 else "risk_decreasing",
                "abs_importance": round(abs(float(score)), 6),
            }
            for name, score in ranked
        ],
    }


# ── CLI Entrypoint ────────────────────────────────────────────────────────────

def run_explainability() -> dict:
    """
    Run explainability analysis on the trained model.
    """
    print("=" * 60)
    print("VetIOS Feature Attribution — Gradient Explainability")
    print("=" * 60)

    # Load model
    meta_path = ARTIFACTS_DIR / "training_metrics.json"
    weights_path = ARTIFACTS_DIR / "risk_model_v1.weights.h5"

    if not weights_path.exists() or not meta_path.exists():
        print("[explain] No model found. Run training first.")
        return {}

    with open(meta_path) as f:
        meta = json.load(f)

    model = VetRiskModel(input_dim=meta["input_dim"])
    model(np.zeros((1, meta["input_dim"]), dtype=np.float32))
    model.load_weights(weights_path)
    print(f"[explain] Loaded model (features: {meta['feature_cols']})")

    # Sample cases to explain
    test_cases = [
        {"label": "Low risk canine", "decision_count": 1, "override_count": 0, "species": "canine"},
        {"label": "High override equine", "decision_count": 8, "override_count": 4, "species": "equine"},
        {"label": "Complex feline", "decision_count": 12, "override_count": 2, "species": "feline"},
    ]

    species_options = ["avian", "canine", "equine", "feline"]
    results = []

    for case in test_cases:
        species_encoded = [1.0 if case["species"] == s else 0.0 for s in species_options]
        features = np.array(
            [[float(case["decision_count"]), float(case["override_count"])] + species_encoded],
            dtype=np.float32,
        )

        explanation = explain_prediction(model, features, meta["feature_cols"])
        explanation["case_label"] = case["label"]
        explanation["input"] = {k: v for k, v in case.items() if k != "label"}
        results.append(explanation)

        print(f"\n[explain] {case['label']} — Risk: {explanation['risk_score']:.4f}")
        for attr in explanation["attributions"][:3]:
            arrow = "↑" if attr["direction"] == "risk_increasing" else "↓"
            print(f"  {arrow} {attr['feature']}: {attr['attribution']:.6f}")

    # Save report
    report = {"explanations": results}
    report_path = ARTIFACTS_DIR / "explainability_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n[explain] Report saved → {report_path}")
    return report


if __name__ == "__main__":
    run_explainability()
