"""
augmented_train.py — Simulation-augmented training with safety penalties.

Mixes real encounter data with simulation-generated adversarial cases.
Implements curriculum scheduling and multi-objective loss.

Usage:
    python -m vetios_ml.augmented_train
"""

import time
import json
import numpy as np
import pandas as pd
import tensorflow as tf

from vetios_ml.config import BATCH_SIZE, EPOCHS, LEARNING_RATE, ARTIFACTS_DIR
from vetios_ml.data.dataset_builder import (
    _generate_synthetic_encounter_data,
    build_tf_dataset,
)
from vetios_ml.data.simulation_sampler import (
    _generate_synthetic_simulations,
    sample_with_curriculum,
)
from vetios_ml.models.risk_model import VetRiskModel


def augmented_train(simulation_weight: float = 0.3, lambda_safety: float = 0.5) -> dict:
    """
    Training loop mixing real encounter data with adversarial simulations.

    Args:
        simulation_weight: fraction of each batch from simulation data (0-1)
        lambda_safety: weight for safety penalty on high-override cases
    """
    print("=" * 60)
    print("VetIOS Augmented Training — Simulation + Safety Penalties")
    print("=" * 60)

    # ── Load real encounter data ──────────────────────────────────────────
    print("\n[augmented_train] Loading datasets...")

    try:
        from vetios_ml.data.dataset_builder import get_supabase_client, extract_encounter_risk_dataset
        client = get_supabase_client()
        real_df = extract_encounter_risk_dataset(client)
    except Exception:
        real_df = _generate_synthetic_encounter_data(n=500)
        print("[augmented_train] Using synthetic real data")

    # ── Load simulation data ──────────────────────────────────────────────
    sim_df = _generate_synthetic_simulations(n=300)
    print(f"[augmented_train] Real data: {len(real_df)} samples")
    print(f"[augmented_train] Adversarial sims: {len(sim_df)} samples")
    print(f"[augmented_train] Sim weight: {simulation_weight}, Safety λ: {lambda_safety}")

    feature_cols = ["decision_count", "override_count"]
    if "species" in real_df.columns:
        feature_cols.append("species")

    label_col = "adverse_outcome_label"

    # Build initial dataset to determine input_dim
    combined_df = pd.concat([real_df[feature_cols + [label_col]], sim_df[feature_cols + [label_col]]], ignore_index=True)
    _, encoded_cols = build_tf_dataset(combined_df, feature_cols, label_col, batch_size=BATCH_SIZE)

    input_dim = len(encoded_cols)
    print(f"[augmented_train] Features: {encoded_cols}")
    print(f"[augmented_train] Input dim: {input_dim}")

    # ── Initialize model ──────────────────────────────────────────────────
    model = VetRiskModel(input_dim=input_dim)
    optimizer = tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE)
    bce = tf.keras.losses.BinaryCrossentropy(from_logits=True)

    # ── Augmented training loop ───────────────────────────────────────────
    epochs = EPOCHS
    print(f"\n[augmented_train] Starting {epochs} epochs with curriculum scheduling")

    history = {"epoch": [], "total_loss": [], "task_loss": [], "safety_loss": [], "accuracy": []}
    start_time = time.time()

    for epoch in range(epochs):
        # Curriculum: increase simulation difficulty over training
        cur_sim_df = sample_with_curriculum(sim_df, epoch, epochs)

        # Mix real + simulation data
        n_sim = int(len(real_df) * simulation_weight)
        sim_sample = cur_sim_df.sample(n=min(n_sim, len(cur_sim_df)), replace=True, random_state=epoch)
        epoch_df = pd.concat([
            real_df[feature_cols + [label_col]],
            sim_sample[feature_cols + [label_col]],
        ], ignore_index=True)

        dataset, _ = build_tf_dataset(epoch_df, feature_cols, label_col, batch_size=BATCH_SIZE)

        epoch_total = tf.keras.metrics.Mean()
        epoch_task = tf.keras.metrics.Mean()
        epoch_safety = tf.keras.metrics.Mean()
        epoch_acc = tf.keras.metrics.BinaryAccuracy(threshold=0.5)

        for x_batch, y_batch in dataset:
            with tf.GradientTape() as tape:
                logits = model(x_batch, training=True)

                # Task loss: binary cross-entropy
                task_loss = bce(y_batch, logits)

                # Safety penalty: penalize overconfident wrong predictions
                pred_proba = tf.nn.sigmoid(logits)
                safety_penalty = tf.reduce_mean(
                    tf.square(pred_proba) * tf.cast(y_batch, tf.float32)
                )

                total_loss = task_loss + lambda_safety * safety_penalty

            gradients = tape.gradient(total_loss, model.trainable_variables)
            gradients = [tf.clip_by_norm(g, 1.0) for g in gradients]
            optimizer.apply_gradients(zip(gradients, model.trainable_variables))

            epoch_total.update_state(total_loss)
            epoch_task.update_state(task_loss)
            epoch_safety.update_state(safety_penalty)
            epoch_acc.update_state(y_batch, pred_proba)

        cur_total = epoch_total.result().numpy()
        cur_task = epoch_task.result().numpy()
        cur_safety = epoch_safety.result().numpy()
        cur_acc = epoch_acc.result().numpy()

        history["epoch"].append(epoch + 1)
        history["total_loss"].append(float(cur_total))
        history["task_loss"].append(float(cur_task))
        history["safety_loss"].append(float(cur_safety))
        history["accuracy"].append(float(cur_acc))

        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(
                f"  Epoch {epoch+1:3d}/{epochs} — "
                f"total: {cur_total:.4f}, task: {cur_task:.4f}, "
                f"safety: {cur_safety:.4f}, acc: {cur_acc:.4f}"
            )

    duration = time.time() - start_time

    # ── Save model + metrics ──────────────────────────────────────────────
    model_path = ARTIFACTS_DIR / "risk_model_augmented.weights.h5"
    model.save_weights(model_path)

    metrics_path = ARTIFACTS_DIR / "augmented_training_metrics.json"
    result = {
        "model_path": str(model_path),
        "training_type": "augmented_simulation",
        "input_dim": input_dim,
        "feature_cols": encoded_cols,
        "simulation_weight": simulation_weight,
        "lambda_safety": lambda_safety,
        "real_samples": len(real_df),
        "sim_samples": len(sim_df),
        "final_total_loss": float(history["total_loss"][-1]),
        "final_task_loss": float(history["task_loss"][-1]),
        "final_safety_loss": float(history["safety_loss"][-1]),
        "final_accuracy": float(history["accuracy"][-1]),
        "epochs_completed": epochs,
        "duration_seconds": round(duration, 2),
        "history": history,
    }

    with open(metrics_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n[augmented_train] Training complete in {duration:.1f}s")
    print(f"[augmented_train] Final total loss: {result['final_total_loss']:.4f}")
    print(f"[augmented_train] Final task loss:  {result['final_task_loss']:.4f}")
    print(f"[augmented_train] Final safety:     {result['final_safety_loss']:.4f}")
    print(f"[augmented_train] Final accuracy:   {result['final_accuracy']:.4f}")
    print(f"[augmented_train] Model saved → {model_path}")

    return result


if __name__ == "__main__":
    augmented_train()
