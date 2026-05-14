"""
Daily VetIOS flywheel export.

Pulls closed, confirmed outcomes from consenting tenants, anonymizes clinic
identity, and writes a JSONL dataset suitable for domain fine-tuning.

Usage:
    python -m vetios_ml.flywheel.aggregate
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from supabase import create_client

from vetios_ml.config import ARTIFACTS_DIR, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

TRAINING_BUCKET = os.getenv("VETIOS_TRAINING_BUCKET", "vetios-training-data")
PLATFORM_TENANT_ID = os.getenv("VETIOS_PLATFORM_TENANT_ID", "")
EXPORT_LIMIT = int(os.getenv("VETIOS_FLYWHEEL_EXPORT_LIMIT", "50000"))

MILESTONES = [1000, 5000, 10000, 50000, 100000]


def get_supabase_client():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise EnvironmentError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def run_export() -> dict[str, Any]:
    if not PLATFORM_TENANT_ID:
        raise EnvironmentError("VETIOS_PLATFORM_TENANT_ID must be set to own flywheel export events.")

    client = get_supabase_client()
    tenant_policies = load_consenting_tenants(client)
    tenant_ids = sorted(tenant_policies)
    if not tenant_ids:
        return write_export_event(client, [], tenant_policies, None, None)

    outcomes = fetch_confirmed_outcomes(client, tenant_ids)
    inference_by_id = fetch_inference_events(
        client,
        [row["inference_event_id"] for row in outcomes if row.get("inference_event_id")],
    )
    case_by_id = fetch_clinical_cases(
        client,
        [row["case_id"] for row in outcomes if row.get("case_id")],
    )

    records = []
    for outcome in outcomes:
        inference = inference_by_id.get(str(outcome.get("inference_event_id")))
        case = case_by_id.get(str(outcome.get("case_id")))
        record = build_training_record(outcome, inference, case, tenant_policies)
        if record:
            records.append(record)

    export_path = write_jsonl(records)
    digest = sha256_file(export_path)
    return write_export_event(client, records, tenant_policies, export_path, digest)


def load_consenting_tenants(client) -> dict[str, dict[str, Any]]:
    policies: dict[str, dict[str, Any]] = {}

    consent_rows = client.table("tenant_learning_consents") \
        .select("tenant_id, consent_scope, status, policy_snapshot, updated_at") \
        .in_("consent_scope", ["deidentified_training", "network_learning"]) \
        .eq("status", "granted") \
        .execute().data or []

    for row in consent_rows:
        tenant_id = str(row["tenant_id"])
        snapshot = as_dict(row.get("policy_snapshot"))
        policies[tenant_id] = {
            "source": "tenant_learning_consents",
            "anonymization_level": snapshot.get("anonymization_level", "full_anon"),
            "updated_at": row.get("updated_at"),
        }

    tenant_rows = client.table("tenants") \
        .select("id, data_sharing_consent, data_sharing_anonymization_level, data_sharing_consented_at") \
        .eq("data_sharing_consent", True) \
        .execute().data or []

    for row in tenant_rows:
        tenant_id = str(row["id"])
        policies.setdefault(tenant_id, {
            "source": "tenants.data_sharing_consent",
            "anonymization_level": row.get("data_sharing_anonymization_level") or "full_anon",
            "updated_at": row.get("data_sharing_consented_at"),
        })

    return policies


def fetch_confirmed_outcomes(client, tenant_ids: list[str]) -> list[dict[str, Any]]:
    rows = client.table("clinical_outcome_events") \
        .select("id, tenant_id, case_id, inference_event_id, outcome_payload, actual_label, actual_confidence, calibration_delta, created_at") \
        .in_("tenant_id", tenant_ids) \
        .not_.is_("actual_label", "null") \
        .order("created_at", desc=True) \
        .limit(EXPORT_LIMIT) \
        .execute().data or []

    return [row for row in rows if diagnosis_from_outcome(row)]


def fetch_inference_events(client, inference_ids: list[Any]) -> dict[str, dict[str, Any]]:
    ids = unique_text(inference_ids)
    if not ids:
        return {}

    rows = []
    for chunk in chunks(ids, 200):
        rows.extend(client.table("ai_inference_events")
            .select("id, input_signature, output_payload, confidence_score, model_name, model_version")
            .in_("id", chunk)
            .execute().data or [])
    return {str(row["id"]): row for row in rows}


def fetch_clinical_cases(client, case_ids: list[Any]) -> dict[str, dict[str, Any]]:
    ids = unique_text(case_ids)
    if not ids:
        return {}

    rows = []
    for chunk in chunks(ids, 200):
        rows.extend(client.table("clinical_cases")
            .select("id, tenant_id, species_display, species_canonical, breed, symptoms_normalized, patient_metadata, latest_input_signature, top_diagnosis, predicted_diagnosis, confirmed_diagnosis, diagnosis_confidence")
            .in_("id", chunk)
            .execute().data or [])
    return {str(row["id"]): row for row in rows}


def build_training_record(
    outcome: dict[str, Any],
    inference: dict[str, Any] | None,
    case: dict[str, Any] | None,
    tenant_policies: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    tenant_id = str(outcome.get("tenant_id") or "")
    if tenant_id not in tenant_policies:
        return None

    input_signature = as_dict((inference or {}).get("input_signature"))
    metadata = as_dict(input_signature.get("metadata"))
    case_metadata = as_dict((case or {}).get("patient_metadata"))
    labs = first_dict(metadata.get("labs"), input_signature.get("lab_results"), case_metadata.get("labs"))
    physical_exam = first_dict(metadata.get("physical_exam"), input_signature.get("physical_exam"), case_metadata.get("physical_exam"))
    vitals = first_dict(metadata.get("vitals"), case_metadata.get("vitals"))
    species = text((case or {}).get("species_display")) or text(input_signature.get("species")) or "unknown"
    breed = text((case or {}).get("breed")) or text(input_signature.get("breed"))
    policy = tenant_policies[tenant_id]

    if policy.get("anonymization_level") in {"full_anon", "species_only"}:
        breed = None

    return {
        "id": str(outcome["id"]),
        "input": clean_dict({
            "species": species.lower(),
            "breed": breed.lower() if breed else None,
            "symptoms": symptoms_from(case, input_signature),
            "vitals": vitals,
            "physical_exam": physical_exam,
            "labs": labs,
        }),
        "model_prediction": prediction_from(inference, case),
        "ground_truth": {
            "confirmed_diagnosis": diagnosis_from_outcome(outcome),
            "diagnosis_method": diagnosis_method_from(outcome),
        },
        "calibration_delta": number(outcome.get("calibration_delta")),
        "tenant_id_hash": sha256_text(tenant_id),
        "source": {
            "outcome_event_id": str(outcome["id"]),
            "inference_event_id": text(outcome.get("inference_event_id")),
            "case_id": text(outcome.get("case_id")),
            "exported_at": datetime.now(UTC).isoformat(),
        },
    }


def prediction_from(inference: dict[str, Any] | None, case: dict[str, Any] | None) -> dict[str, Any]:
    output = as_dict((inference or {}).get("output_payload"))
    diagnosis = as_dict(output.get("diagnosis"))
    raw_differentials = diagnosis.get("top_differentials") or output.get("differentials") or []
    differentials = []
    if isinstance(raw_differentials, list):
        for entry in raw_differentials[:7]:
            item = as_dict(entry)
            label = text(item.get("condition")) or text(item.get("name")) or text(item.get("label"))
            confidence = number(item.get("probability")) or number(item.get("p")) or number(item.get("confidence_score"))
            if label:
                differentials.append({"label": label, "confidence": confidence})

    top = text((case or {}).get("top_diagnosis")) or text((case or {}).get("predicted_diagnosis"))
    if not top and differentials:
        top = differentials[0]["label"]

    return {
        "differentials": differentials,
        "top_differential": top,
        "model_name": text((inference or {}).get("model_name")),
        "model_version": text((inference or {}).get("model_version")),
    }


def write_jsonl(records: list[dict[str, Any]]) -> Path:
    export_dir = ARTIFACTS_DIR / "flywheel"
    export_dir.mkdir(parents=True, exist_ok=True)
    path = export_dir / f"flywheel-{date.today().isoformat()}.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    return path


def write_export_event(
    client,
    records: list[dict[str, Any]],
    tenant_policies: dict[str, dict[str, Any]],
    export_path: Path | None,
    digest: str | None,
) -> dict[str, Any]:
    storage_path = f"flywheel/{export_path.name}" if export_path else f"flywheel/flywheel-{date.today().isoformat()}.jsonl"
    if export_path:
        upload_to_storage(client, export_path, storage_path)

    milestone = latest_milestone(len(records))
    payload = {
        "tenant_id": PLATFORM_TENANT_ID,
        "export_path": storage_path,
        "storage_bucket": TRAINING_BUCKET,
        "row_count": len(records),
        "consenting_tenant_count": len(tenant_policies),
        "content_sha256": digest or sha256_text(""),
        "milestone": milestone,
        "export_metadata": {
            "milestone_trigger": bool(milestone),
            "generated_at": datetime.now(UTC).isoformat(),
            "policy_sources": sorted({str(policy.get("source")) for policy in tenant_policies.values()}),
        },
    }
    response = client.table("flywheel_export_events").insert(payload).execute()
    return {"event": (response.data or [payload])[0], "records": len(records), "export_path": storage_path}


def upload_to_storage(client, local_path: Path, storage_path: str) -> None:
    with local_path.open("rb") as handle:
        client.storage.from_(TRAINING_BUCKET).upload(
            storage_path,
            handle.read(),
            file_options={"content-type": "application/jsonl", "upsert": "true"},
        )


def diagnosis_from_outcome(outcome: dict[str, Any]) -> str | None:
    payload = as_dict(outcome.get("outcome_payload"))
    return text(payload.get("confirmed_diagnosis")) or text(payload.get("actual_diagnosis")) or text(outcome.get("actual_label"))


def diagnosis_method_from(outcome: dict[str, Any]) -> str | None:
    return text(as_dict(outcome.get("outcome_payload")).get("diagnosis_method"))


def symptoms_from(case: dict[str, Any] | None, signature: dict[str, Any]) -> list[str]:
    case_symptoms = (case or {}).get("symptoms_normalized")
    if isinstance(case_symptoms, list) and case_symptoms:
        return [str(item) for item in case_symptoms if item]
    signature_symptoms = signature.get("symptoms")
    if isinstance(signature_symptoms, list):
        return [str(item) for item in signature_symptoms if item]
    return []


def latest_milestone(row_count: int) -> str | None:
    crossed = [value for value in MILESTONES if row_count >= value]
    return f"{crossed[-1]}_confirmed_cases" if crossed else None


def first_dict(*values: Any) -> dict[str, Any]:
    for value in values:
        record = as_dict(value)
        if record:
            return record
    return {}


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def clean_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: entry for key, entry in value.items() if entry not in (None, "", [], {})}


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


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


if __name__ == "__main__":
    print(json.dumps(run_export(), indent=2, sort_keys=True))
