"""
startup.py — Pre-flight check for the VetIOS ML server.

Runs before the FastAPI server starts.
If no trained model weights exist, triggers a training run
using synthetic data so the server starts with a working model.
"""

import sys
from pathlib import Path


def main():
    artifacts_dir = Path("./artifacts")
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    weights_path = artifacts_dir / "risk_model_v1.weights.h5"
    meta_path = artifacts_dir / "training_metrics.json"

    if weights_path.exists() and meta_path.exists():
        print("[startup] ✓ Model weights found — skipping training")
        return

    print("[startup] No model weights found — running initial training...")
    print("[startup] This will use synthetic data (takes ~30 seconds)")

    try:
        from vetios_ml.train import train
        result = train()
        print(f"[startup] ✓ Training complete — accuracy: {result['final_accuracy']:.4f}")
    except Exception as e:
        print(f"[startup] ⚠ Training failed: {e}")
        print("[startup] Server will start without model (/predict returns 503)")


if __name__ == "__main__":
    main()
