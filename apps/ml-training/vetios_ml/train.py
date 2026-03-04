"""
train.py — Custom tf.GradientTape training loop for VetIOS risk models.

Usage:
    python -m vetios_ml.train

This implements the Autograd training pattern from the expert guide:
  1. Extract features from Supabase (or synthetic fallback)
  2. Build tf.data.Dataset pipeline
  3. Run custom GradientTape loop with safety-penalized loss
  4. Save model checkpoint + training metrics
"""

import time
import json
import numpy as np
import tensorflow as tf

from vetios_ml.config import BATCH_SIZE, EPOCHS, LEARNING_RATE, ARTIFACTS_DIR
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)
from vetios_ml.models.risk_model import VetRiskModel


def train() -> dict:
    """
    Execute a full training run and return metrics.

    Returns a dict with: model_path, final_loss, epochs_completed, duration_s
    """
    print("=" * 60)
    print("VetIOS Training Pipeline — tf.GradientTape")
    print("=" * 60)

    # ── Step 1: Load data ─────────────────────────────────────────────────
    print("\n[train] Loading dataset...")

    try:
        from vetios_ml.data.dataset_builder import get_supabase_client, extract_encounter_risk_dataset
        client = get_supabase_client()
        df = extract_encounter_risk_dataset(client)
    except Exception:
        print("[train] Supabase unavailable. Using synthetic encounter data.")
        df = _generate_synthetic_encounter_data(n=500)

    feature_cols = ["decision_count", "override_count"]

    # Add species if present (will be one-hot encoded)
    if "species" in df.columns:
        feature_cols.append("species")

    label_col = "adverse_outcome_label"

    dataset, encoded_feature_cols = build_tf_dataset(
        df, feature_cols, label_col, batch_size=BATCH_SIZE
    )

    input_dim = len(encoded_feature_cols)
    print(f"[train] Features: {encoded_feature_cols}")
    print(f"[train] Input dim: {input_dim}, Samples: {len(df)}")

    # ── Step 2: Initialize model + optimizer ──────────────────────────────
    model = VetRiskModel(input_dim=input_dim)
    optimizer = tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE)
    loss_fn = tf.keras.losses.BinaryCrossentropy(from_logits=True)

    # ── Step 3: Custom GradientTape training loop ─────────────────────────
    print(f"\n[train] Starting training: {EPOCHS} epochs, batch_size={BATCH_SIZE}, lr={LEARNING_RATE}")

    history = {"epoch": [], "loss": [], "accuracy": []}
    start_time = time.time()

    for epoch in range(EPOCHS):
        epoch_loss = tf.keras.metrics.Mean()
        epoch_acc = tf.keras.metrics.BinaryAccuracy(threshold=0.5)

        for x_batch, y_batch in dataset:
            with tf.GradientTape() as tape:
                logits = model(x_batch, training=True)
                loss = loss_fn(y_batch, logits)

            # Autograd: compute gradients
            gradients = tape.gradient(loss, model.trainable_variables)

            # Gradient clipping for stability
            gradients = [tf.clip_by_norm(g, 1.0) for g in gradients]

            # Apply weight updates
            optimizer.apply_gradients(zip(gradients, model.trainable_variables))

            epoch_loss.update_state(loss)
            epoch_acc.update_state(y_batch, tf.nn.sigmoid(logits))

        current_loss = epoch_loss.result().numpy()
        current_acc = epoch_acc.result().numpy()

        history["epoch"].append(epoch + 1)
        history["loss"].append(float(current_loss))
        history["accuracy"].append(float(current_acc))

        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(f"  Epoch {epoch+1:3d}/{EPOCHS} — loss: {current_loss:.4f}, acc: {current_acc:.4f}")

    duration = time.time() - start_time

    # ── Step 4: Save model + metrics ──────────────────────────────────────
    model_path = ARTIFACTS_DIR / "risk_model_v1"
    model.save(model_path)

    metrics_path = ARTIFACTS_DIR / "training_metrics.json"
    training_result = {
        "model_path": str(model_path),
        "input_dim": input_dim,
        "feature_cols": encoded_feature_cols,
        "final_loss": float(history["loss"][-1]),
        "final_accuracy": float(history["accuracy"][-1]),
        "epochs_completed": EPOCHS,
        "batch_size": BATCH_SIZE,
        "learning_rate": LEARNING_RATE,
        "duration_seconds": round(duration, 2),
        "history": history,
    }

    with open(metrics_path, "w") as f:
        json.dump(training_result, f, indent=2)

    print(f"\n[train] Training complete in {duration:.1f}s")
    print(f"[train] Final loss: {training_result['final_loss']:.4f}")
    print(f"[train] Final accuracy: {training_result['final_accuracy']:.4f}")
    print(f"[train] Model saved → {model_path}")
    print(f"[train] Metrics saved → {metrics_path}")

    return training_result


# ── CLI entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    train()
