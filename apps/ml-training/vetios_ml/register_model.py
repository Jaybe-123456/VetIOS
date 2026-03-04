"""
register_model.py — Model versioning and registration into Supabase.

Usage:
    python -m vetios_ml.register_model

Reads the latest training metrics and evaluation results,
then logs a model_evaluation_event into Supabase for the
Experiment Tracking and Model Registry UI to display.
"""

import json
import uuid
from datetime import datetime, timezone

from vetios_ml.config import ARTIFACTS_DIR, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


def register() -> dict:
    """
    Register the latest trained model by logging its metrics
    into the model_evaluation_events table.
    """
    print("=" * 60)
    print("VetIOS Model Registration")
    print("=" * 60)

    # ── Load training metrics ─────────────────────────────────────────────
    metrics_path = ARTIFACTS_DIR / "training_metrics.json"
    eval_path = ARTIFACTS_DIR / "evaluation_results.json"

    if not metrics_path.exists():
        print("[register] No training_metrics.json found. Run `python -m vetios_ml.train` first.")
        return {}

    with open(metrics_path) as f:
        training_metrics = json.load(f)

    eval_metrics = {}
    if eval_path.exists():
        with open(eval_path) as f:
            eval_metrics = json.load(f)

    # ── Build registration record ─────────────────────────────────────────
    model_name = "vet-risk-scorer"
    model_version = f"v1.0.{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}"

    registration = {
        "id": str(uuid.uuid4()),
        "model_name": model_name,
        "model_version": model_version,
        "trigger_type": "inference",
        "calibration_error": eval_metrics.get("calibration", {}).get("ece"),
        "drift_score": 0.0,  # Baseline: no drift on first model
        "evaluation_payload": {
            "training": {
                "final_loss": training_metrics.get("final_loss"),
                "final_accuracy": training_metrics.get("final_accuracy"),
                "epochs": training_metrics.get("epochs_completed"),
                "duration_s": training_metrics.get("duration_seconds"),
            },
            "evaluation": eval_metrics,
        },
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }

    # ── Save registration locally ─────────────────────────────────────────
    reg_path = ARTIFACTS_DIR / "model_registration.json"
    with open(reg_path, "w") as f:
        json.dump(registration, f, indent=2)

    print(f"\n[register] Model: {model_name} @ {model_version}")
    print(f"[register] Calibration error: {registration['calibration_error']}")
    print(f"[register] Registration saved → {reg_path}")

    # ── Push to Supabase (if credentials available) ───────────────────────
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            from supabase import create_client
            client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

            insert_data = {
                "tenant_id": "system",
                "model_name": model_name,
                "model_version": model_version,
                "trigger_type": "inference",
                "calibration_error": registration["calibration_error"],
                "drift_score": registration["drift_score"],
                "evaluation_payload": registration["evaluation_payload"],
            }

            result = client.table("model_evaluation_events").insert(insert_data).execute()
            print(f"[register] Pushed to Supabase model_evaluation_events ✓")
        except Exception as e:
            print(f"[register] Supabase push failed (non-fatal): {e}")
    else:
        print("[register] No Supabase credentials — skipping remote registration.")

    return registration


# ── CLI entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    register()
