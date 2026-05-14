"""
Outcome calibration drift monitor.

Computes predicted confidence vs actual outcome accuracy by species and symptom
cluster, then writes aggregate drift rows to calibration_drift_reports.

Usage:
    python calibration/drift_monitor.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from supabase import create_client

sys.path.append(str(Path(__file__).resolve().parents[1]))
from vetios_ml.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL  # noqa: E402

PLATFORM_TENANT_ID = os.getenv("VETIOS_PLATFORM_TENANT_ID", "")
WINDOW_DAYS = int(os.getenv("VETIOS_DRIFT_WINDOW_DAYS", "30"))
MIN_ALERT_CASES = int(os.getenv("VETIOS_DRIFT_MIN_ALERT_CASES", "20"))
ALERT_ACCURACY_FLOOR = float(os.getenv("VETIOS_DRIFT_ACCURACY_FLOOR", "0.70"))


def get_supabase_client():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def run_monitor() -> dict[str, Any]:
    if not PLATFORM_TENANT_ID:
        raise EnvironmentError("VETIOS_PLATFORM_TENANT_ID must be set to own drift reports.")

    client = get_supabase_client()
    window_end = datetime.now(UTC)
    window_start = window_end - timedelta(days=WINDOW_DAYS)
    outcomes = fetch_recent_outcomes(client, window_start)
    inference_by_id = fetch_inference_events(client, [row.get("inference_event_id") for row in outcomes])
    case_by_id = fetch_clinical_cases(client, [row.get("case_id") for row in outcomes])

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for outcome in outcomes:
        inference = inference_by_id.get(str(outcome.get("inference_event_id")))
        case = case_by_id.get(str(outcome.get("case_id")))
        sample = build_sample(outcome, inference, case)
        if sample:
            grouped[(sample["species"], sample["symptom_cluster"])].append(sample)

    reports = [
        build_report(species, cluster, samples, window_start, window_end)
        for (species, cluster), samples in grouped.items()
    ]

    if reports:
        client.table("calibration_drift_reports").insert(reports).execute()

    return {
        "reports_written": len(reports),
        "samples": sum(len(samples) for samples in grouped.values()),
        "alerts": sum(1 for report in reports if report["alert"]),
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
    }


def fetch_recent_outcomes(client, window_start: datetime) -> list[dict[str, Any]]:
    return client.table("clinical_outcome_events") \
        .select("id, tenant_id, case_id, inference_event_id, outcome_payload, actual_label, calibration_delta, created_at") \
        .gte("created_at", window_start.isoformat()) \
        .not_.is_("actual_label", "null") \
        .limit(50000) \
        .execute().data or []


def fetch_inference_events(client, ids: list[Any]) -> dict[str, dict[str, Any]]:
    clean_ids = unique_text(ids)
    if not clean_ids:
        return {}
    rows = []
    for chunk in chunks(clean_ids, 200):
        rows.extend(client.table("ai_inference_events")
            .select("id, input_signature, output_payload, confidence_score, top_diagnosis, species")
            .in_("id", chunk)
            .execute().data or [])
    return {str(row["id"]): row for row in rows}


def fetch_clinical_cases(client, ids: list[Any]) -> dict[str, dict[str, Any]]:
    clean_ids = unique_text(ids)
    if not clean_ids:
        return {}
    rows = []
    for chunk in chunks(clean_ids, 200):
        rows.extend(client.table("clinical_cases")
            .select("id, species_display, species_canonical, symptoms_normalized, top_diagnosis, predicted_diagnosis, confirmed_diagnosis")
            .in_("id", chunk)
            .execute().data or [])
    return {str(row["id"]): row for row in rows}


def build_sample(
    outcome: dict[str, Any],
    inference: dict[str, Any] | None,
    case: dict[str, Any] | None,
) -> dict[str, Any] | None:
    actual = diagnosis_from_outcome(outcome)
    if not actual:
        return None

    differentials = differentials_from(inference)
    top_label = text((case or {}).get("top_diagnosis")) or text((case or {}).get("predicted_diagnosis"))
    if not top_label and differentials:
        top_label = differentials[0]["label"]
    if not top_label:
        return None

    top_confidence = differentials[0]["confidence"] if differentials else number((inference or {}).get("confidence_score")) or 0.0
    top1_correct = labels_match(top_label, actual)
    top3_correct = any(labels_match(item["label"], actual) for item in differentials[:3])
    predicted_probability = probability_for_label(differentials, actual) if top3_correct else (top_confidence if top1_correct else 0.0)

    return {
        "species": species_from(inference, case),
        "symptom_cluster": symptom_cluster_from(inference, case),
        "top1_correct": top1_correct,
        "top3_correct": top3_correct,
        "predicted_probability": max(0.0, min(1.0, predicted_probability)),
        "actual": actual,
        "top_label": top_label,
        "outcome_id": str(outcome["id"]),
    }


def build_report(
    species: str,
    cluster: str,
    samples: list[dict[str, Any]],
    window_start: datetime,
    window_end: datetime,
) -> dict[str, Any]:
    count = len(samples)
    top1_accuracy = sum(1 for sample in samples if sample["top1_correct"]) / count
    top3_recall = sum(1 for sample in samples if sample["top3_correct"]) / count
    brier = sum((sample["predicted_probability"] - 1.0) ** 2 for sample in samples if sample["top3_correct"])
    brier += sum(sample["predicted_probability"] ** 2 for sample in samples if not sample["top3_correct"])
    brier_score = brier / count
    alert = count >= MIN_ALERT_CASES and top1_accuracy < ALERT_ACCURACY_FLOOR

    return {
        "tenant_id": PLATFORM_TENANT_ID,
        "species": species,
        "symptom_cluster": cluster,
        "report_window_start": window_start.isoformat(),
        "report_window_end": window_end.isoformat(),
        "case_count": count,
        "top1_accuracy": round(top1_accuracy, 4),
        "top3_recall": round(top3_recall, 4),
        "brier_score": round(brier_score, 4),
        "alert": alert,
        "report_payload": {
            "accuracy_floor": ALERT_ACCURACY_FLOOR,
            "min_alert_cases": MIN_ALERT_CASES,
            "false_positive_count": sum(1 for sample in samples if not sample["top1_correct"]),
            "recall_failure_count": sum(1 for sample in samples if not sample["top3_correct"]),
            "sample_outcome_ids": [sample["outcome_id"] for sample in samples[:25]],
        },
    }


def differentials_from(inference: dict[str, Any] | None) -> list[dict[str, Any]]:
    output = as_dict((inference or {}).get("output_payload"))
    diagnosis = as_dict(output.get("diagnosis"))
    raw = diagnosis.get("top_differentials") or output.get("differentials") or []
    if not isinstance(raw, list):
        return []

    items = []
    for entry in raw[:7]:
        item = as_dict(entry)
        label = text(item.get("condition")) or text(item.get("name")) or text(item.get("label"))
        confidence = number(item.get("probability")) or number(item.get("p")) or number(item.get("confidence_score")) or 0.0
        if label:
            items.append({"label": label, "confidence": max(0.0, min(1.0, confidence))})
    return items


def species_from(inference: dict[str, Any] | None, case: dict[str, Any] | None) -> str:
    signature = as_dict((inference or {}).get("input_signature"))
    return (
        text((case or {}).get("species_display"))
        or text((case or {}).get("species_canonical"))
        or text((inference or {}).get("species"))
        or text(signature.get("species"))
        or "unknown"
    ).lower()


def symptom_cluster_from(inference: dict[str, Any] | None, case: dict[str, Any] | None) -> str:
    symptoms = (case or {}).get("symptoms_normalized")
    if not isinstance(symptoms, list) or not symptoms:
        symptoms = as_dict((inference or {}).get("input_signature")).get("symptoms")
    if not isinstance(symptoms, list) or not symptoms:
        return "unclustered"
    return "+".join(sorted(str(symptom).lower() for symptom in symptoms if symptom)[:3])


def probability_for_label(differentials: list[dict[str, Any]], label: str) -> float:
    for item in differentials:
        if labels_match(item["label"], label):
            return float(item["confidence"])
    return 0.0


def diagnosis_from_outcome(outcome: dict[str, Any]) -> str | None:
    payload = as_dict(outcome.get("outcome_payload"))
    return text(payload.get("confirmed_diagnosis")) or text(payload.get("actual_diagnosis")) or text(outcome.get("actual_label"))


def labels_match(left: str, right: str) -> bool:
    return normalize_label(left) == normalize_label(right)


def normalize_label(value: str) -> str:
    return "".join(char.lower() if char.isalnum() else "_" for char in value).strip("_")


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def unique_text(values: list[Any]) -> list[str]:
    return sorted({str(value) for value in values if value})


def chunks(values: list[str], size: int):
    for index in range(0, len(values), size):
        yield values[index:index + size]


if __name__ == "__main__":
    print(json.dumps(run_monitor(), indent=2, sort_keys=True))
