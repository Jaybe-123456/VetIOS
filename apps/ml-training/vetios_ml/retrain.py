"""
retrain.py — Scheduled retraining runner for VetIOS models.

Orchestrates the full pipeline: data extraction → training → evaluation →
calibration → drift detection → shadow evaluation → optional promotion.

Usage:
    python -m vetios_ml.retrain              # Full pipeline
    python -m vetios_ml.retrain --dry-run    # Evaluate only, no promotion
"""

import argparse
import json
import time
from datetime import datetime, timezone

from vetios_ml.config import ARTIFACTS_DIR


def run_retraining_pipeline(dry_run: bool = False) -> dict:
    """
    Execute the full retraining pipeline in sequence:
      1. Train baseline model
      2. Train augmented model (simulation-enriched)
      3. Calibrate
      4. Evaluate
      5. Detect drift
      6. Run shadow evaluation
      7. Check safety gates → promote or hold
    """
    print("=" * 60)
    print(f"VetIOS Scheduled Retraining Pipeline")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")
    print(f"Mode: {'DRY RUN' if dry_run else 'FULL PIPELINE'}")
    print("=" * 60)

    pipeline_start = time.time()
    results = {"stages": {}, "started_at": datetime.now(timezone.utc).isoformat()}

    # ── Stage 1: Baseline Training ────────────────────────────────────────
    print("\n[1/6] BASELINE TRAINING...")
    try:
        from vetios_ml.train import train
        results["stages"]["baseline_training"] = {"status": "success", **train()}
    except Exception as e:
        print(f"[1/6] FAILED: {e}")
        results["stages"]["baseline_training"] = {"status": "error", "error": str(e)}

    # ── Stage 2: Augmented Training ───────────────────────────────────────
    print("\n[2/6] AUGMENTED TRAINING...")
    try:
        from vetios_ml.augmented_train import augmented_train
        results["stages"]["augmented_training"] = {"status": "success", **augmented_train()}
    except Exception as e:
        print(f"[2/6] FAILED: {e}")
        results["stages"]["augmented_training"] = {"status": "error", "error": str(e)}

    # ── Stage 3: Calibration ──────────────────────────────────────────────
    print("\n[3/6] CALIBRATION...")
    try:
        from vetios_ml.calibration import calibrate
        results["stages"]["calibration"] = {"status": "success", **calibrate()}
    except Exception as e:
        print(f"[3/6] FAILED: {e}")
        results["stages"]["calibration"] = {"status": "error", "error": str(e)}

    # ── Stage 4: Drift Detection ──────────────────────────────────────────
    print("\n[4/6] DRIFT DETECTION...")
    try:
        from vetios_ml.drift import detect_drift
        results["stages"]["drift_detection"] = {"status": "success", **detect_drift()}
    except Exception as e:
        print(f"[4/6] FAILED: {e}")
        results["stages"]["drift_detection"] = {"status": "error", "error": str(e)}

    # ── Stage 5: Shadow Evaluation ────────────────────────────────────────
    print("\n[5/6] SHADOW EVALUATION...")
    try:
        from vetios_ml.shadow_mode import run_shadow_evaluation
        shadow_result = run_shadow_evaluation()
        results["stages"]["shadow_evaluation"] = {"status": "success", **shadow_result}
    except Exception as e:
        print(f"[5/6] FAILED: {e}")
        results["stages"]["shadow_evaluation"] = {"status": "error", "error": str(e)}

    # ── Stage 6: Explainability ───────────────────────────────────────────
    print("\n[6/6] EXPLAINABILITY...")
    try:
        from vetios_ml.explainability import run_explainability
        results["stages"]["explainability"] = {"status": "success", **run_explainability()}
    except Exception as e:
        print(f"[6/6] FAILED: {e}")
        results["stages"]["explainability"] = {"status": "error", "error": str(e)}

    # ── Pipeline Summary ──────────────────────────────────────────────────
    duration = time.time() - pipeline_start
    results["completed_at"] = datetime.now(timezone.utc).isoformat()
    results["duration_seconds"] = round(duration, 2)

    # Check promotion readiness
    shadow = results["stages"].get("shadow_evaluation", {})
    promotion = shadow.get("promotion_recommendation", False) if shadow.get("status") == "success" else False
    results["promotion_recommendation"] = promotion

    stages_passed = sum(1 for s in results["stages"].values() if s.get("status") == "success")
    stages_total = len(results["stages"])
    results["stages_passed"] = f"{stages_passed}/{stages_total}"

    # Save pipeline report
    report_path = ARTIFACTS_DIR / "retraining_pipeline_report.json"
    # Filter out non-serializable items
    with open(report_path, "w") as f:
        json.dump({
            "started_at": results["started_at"],
            "completed_at": results["completed_at"],
            "duration_seconds": results["duration_seconds"],
            "stages_passed": results["stages_passed"],
            "promotion_recommendation": results["promotion_recommendation"],
            "dry_run": dry_run,
        }, f, indent=2)

    print("\n" + "=" * 60)
    print("PIPELINE SUMMARY")
    print("=" * 60)
    print(f"  Duration: {duration:.1f}s")
    print(f"  Stages:   {results['stages_passed']}")
    print(f"  Promote:  {'✓ GO' if promotion else '✗ NO-GO'}")
    print(f"  Report:   {report_path}")
    print("=" * 60)

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VetIOS Scheduled Retraining Pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Evaluate only, no promotion")
    args = parser.parse_args()

    run_retraining_pipeline(dry_run=args.dry_run)
