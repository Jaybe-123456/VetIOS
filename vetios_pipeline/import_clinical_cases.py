import argparse
import csv
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    from prepare_dataset import (
        ALLOWED_USAGE_CLASSES,
        DATE_PATTERN,
        DIRECT_IDENTIFIER_PATTERNS,
        REVIEWED_STATUSES,
    )
except ImportError:  # pragma: no cover - supports package-style execution
    from vetios_pipeline.prepare_dataset import (
        ALLOWED_USAGE_CLASSES,
        DATE_PATTERN,
        DIRECT_IDENTIFIER_PATTERNS,
        REVIEWED_STATUSES,
    )

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

NULL_VALUES = {"", "na", "n/a", "none", "null", "unknown", "not recorded"}

ALIASES = {
    "case_id": ["case_id", "id", "encounter_id", "visit_id", "record_id", "deidentified_case_id"],
    "source": ["source", "dataset_source", "registry", "export_source"],
    "usage_class": ["usage_class", "data_usage_class", "consent_class"],
    "review_status": ["review_status", "label_status", "curation_status"],
    "split": ["split", "dataset_split"],
    "species": ["species", "animal_species"],
    "breed": ["breed"],
    "age_years": ["age_years", "age_yrs", "age"],
    "age_months": ["age_months", "age_mos"],
    "sex": ["sex", "patient_sex"],
    "weight_kg": ["weight_kg", "body_weight_kg", "weight"],
    "region": ["region", "geography", "state", "country"],
    "presenting_signs": ["presenting_signs", "signs", "symptoms", "chief_complaint"],
    "history": ["history", "case_history", "narrative", "subjective", "clinical_note"],
    "physical_exam": ["physical_exam", "exam", "objective", "physical_findings"],
    "diagnostics": ["diagnostics", "diagnostic_summary", "tests"],
    "labs": ["labs", "lab_results", "laboratory"],
    "imaging": ["imaging", "radiology", "ultrasound", "radiographs"],
    "medications": ["medications", "current_medications", "treatments"],
    "constraints": ["constraints", "budget_constraints", "care_constraints"],
    "validated_output": ["validated_output", "target_json", "label_json", "assistant_output"],
    "confirmed_diagnosis": ["confirmed_diagnosis", "final_diagnosis", "diagnosis", "outcome_diagnosis"],
    "top_differentials": ["top_differentials", "differentials", "differential_diagnoses"],
    "missing_tests": ["missing_tests", "recommended_tests", "next_tests", "confirmatory_tests"],
    "safety_flags": ["safety_flags", "red_flags", "emergency_flags"],
    "contraindications": ["contraindications", "treatment_contraindications"],
    "outcome": ["outcome", "clinical_outcome", "case_outcome"],
}


def normalized_key_map(row: Dict[str, Any]) -> Dict[str, str]:
    return {str(key).strip().lower(): key for key in row.keys()}


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in NULL_VALUES
    return False


def clean_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def pick(row: Dict[str, Any], field: str, default: Any = "") -> Any:
    key_map = normalized_key_map(row)
    for alias in ALIASES[field]:
        actual = key_map.get(alias.lower())
        if actual is not None and not is_empty(row[actual]):
            return row[actual]
    return default


def parse_json_like(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return None
    if text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def parse_number(value: Any) -> Optional[float]:
    if is_empty(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    if not match:
        return None
    return float(match.group(0))


def parse_list(value: Any) -> List[str]:
    parsed = parse_json_like(value)
    if is_empty(parsed):
        return []
    if isinstance(parsed, list):
        return [clean_string(item) for item in parsed if not is_empty(item)]
    if isinstance(parsed, dict):
        return [clean_string(item) for item in parsed.values() if not is_empty(item)]
    text = clean_string(parsed)
    if not text:
        return []
    delimiter_pattern = r"\s*(?:;|\||\n)\s*" if re.search(r";|\||\n", text) else r"\s*,\s*"
    parts = re.split(delimiter_pattern, text)
    return [part for part in (clean_string(part) for part in parts) if part]


def parse_mapping(value: Any) -> Dict[str, Any]:
    parsed = parse_json_like(value)
    if is_empty(parsed):
        return {}
    if isinstance(parsed, dict):
        return {clean_string(key): val for key, val in parsed.items() if not is_empty(val)}
    if isinstance(parsed, list):
        return {"items": [item for item in parsed if not is_empty(item)]}

    text = clean_string(parsed)
    pairs: Dict[str, Any] = {}
    for part in re.split(r"\s*(?:;|\n|\|)\s*", text):
        if ":" not in part:
            continue
        key, value_part = part.split(":", 1)
        key = clean_string(key)
        value_part = clean_string(value_part)
        if key and value_part:
            pairs[key] = value_part
    return pairs if pairs else {"summary": text}


def parse_differentials(value: Any, confirmed_diagnosis: str) -> List[Dict[str, Any]]:
    parsed = parse_json_like(value)
    differentials: List[Dict[str, Any]] = []

    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict):
                condition = clean_string(item.get("condition") or item.get("diagnosis") or item.get("name"))
                if condition:
                    normalized = dict(item)
                    normalized["condition"] = condition
                    differentials.append(normalized)
            elif not is_empty(item):
                differentials.append({"condition": clean_string(item), "probability_bin": "possible"})
    elif isinstance(parsed, dict):
        for condition, score in parsed.items():
            item: Dict[str, Any] = {"condition": clean_string(condition)}
            if not is_empty(score):
                item["probability_or_rank"] = score
            differentials.append(item)
    else:
        for item in parse_list(parsed):
            differentials.append({"condition": item, "probability_bin": "possible"})

    confirmed = clean_string(confirmed_diagnosis)
    if confirmed and not any(d["condition"].lower() == confirmed.lower() for d in differentials):
        differentials.insert(
            0,
            {
                "condition": confirmed,
                "probability_bin": "confirmed_outcome",
                "supporting_evidence": ["confirmed diagnosis label"],
                "contradicting_evidence": [],
            },
        )
    return differentials


def row_text(row: Dict[str, Any]) -> str:
    return "\n".join(clean_string(value) for value in row.values() if not is_empty(value))


def find_identifier_hits(row: Dict[str, Any], strict_dates: bool) -> List[str]:
    text = row_text(row)
    hits = [name for name, pattern in DIRECT_IDENTIFIER_PATTERNS.items() if pattern.search(text)]
    if strict_dates and DATE_PATTERN.search(text):
        hits.append("date")
    return hits


def redact_flat_row(row: Dict[str, Any]) -> Dict[str, Any]:
    redacted = dict(row)
    for key, value in row.items():
        if not isinstance(value, str):
            continue
        updated = value
        for name, pattern in DIRECT_IDENTIFIER_PATTERNS.items():
            updated = pattern.sub(f"[REDACTED_{name.upper()}]", updated)
        redacted[key] = updated
    return redacted


def stable_generated_id(row: Dict[str, Any], source: str) -> str:
    digest = hashlib.sha256()
    digest.update(source.encode("utf-8"))
    digest.update(json.dumps(row, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return f"generated-{digest.hexdigest()[:16]}"


def read_rows(path: Path, input_format: str) -> Iterable[Dict[str, Any]]:
    detected = input_format
    if detected == "auto":
        detected = "csv" if path.suffix.lower() == ".csv" else "jsonl"

    if detected == "csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield dict(row)
        return

    if detected == "jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path}:{line_no} is not valid JSON: {exc}") from exc
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_no} must be a JSON object")
                yield value
        return

    raise ValueError(f"unsupported input format: {input_format}")


def build_structured_case(row: Dict[str, Any]) -> Dict[str, Any]:
    existing = parse_json_like(row.get("structured_case"))
    if isinstance(existing, dict):
        return existing

    structured: Dict[str, Any] = {}
    for field in ("species", "breed", "sex", "region"):
        value = clean_string(pick(row, field))
        if value:
            structured[field] = value

    for field in ("age_years", "age_months", "weight_kg"):
        number = parse_number(pick(row, field))
        if number is not None:
            structured[field] = number

    presenting_signs = parse_list(pick(row, "presenting_signs"))
    if presenting_signs:
        structured["presenting_signs"] = presenting_signs

    history = clean_string(pick(row, "history"))
    if history:
        structured["history"] = history

    exam = parse_mapping(pick(row, "physical_exam"))
    if exam:
        structured["physical_exam"] = exam

    diagnostics = parse_mapping(pick(row, "diagnostics"))
    labs = parse_mapping(pick(row, "labs"))
    imaging = parse_mapping(pick(row, "imaging"))
    if labs:
        diagnostics["labs"] = labs
    if imaging:
        diagnostics["imaging"] = imaging
    if diagnostics:
        structured["diagnostics"] = diagnostics

    medications = parse_list(pick(row, "medications"))
    if medications:
        structured["medications"] = medications

    constraints = parse_list(pick(row, "constraints"))
    if constraints:
        structured["constraints"] = constraints

    return structured


def build_validated_output(row: Dict[str, Any], allow_unlabeled: bool) -> Dict[str, Any]:
    existing = parse_json_like(pick(row, "validated_output"))
    if isinstance(existing, dict):
        return existing

    confirmed = clean_string(pick(row, "confirmed_diagnosis"))
    differentials = parse_differentials(pick(row, "top_differentials"), confirmed)
    missing_tests = parse_list(pick(row, "missing_tests"))
    safety_flags = parse_list(pick(row, "safety_flags"))
    contraindications = parse_list(pick(row, "contraindications"))
    outcome = clean_string(pick(row, "outcome"))

    if not differentials and not allow_unlabeled:
        raise ValueError("missing validated_output, confirmed_diagnosis, or top_differentials")

    return {
        "mode": "diagnostic_decision_support",
        "top_differentials": differentials,
        "confirmed_diagnosis": confirmed or None,
        "missing_tests": missing_tests,
        "safety_flags": safety_flags,
        "contraindications": contraindications,
        "outcome": outcome or None,
        "abstain_reason": None if differentials else "unlabeled row requires clinician review",
    }


def transform_row(row: Dict[str, Any], args: argparse.Namespace) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    warnings: List[str] = []
    working_row = dict(row)

    hits = find_identifier_hits(working_row, strict_dates=args.strict_dates)
    if hits and args.redact_direct_identifiers and "date" not in hits:
        working_row = redact_flat_row(working_row)
        warnings.append(f"redacted direct identifiers: {', '.join(hits)}")
    elif hits:
        raise ValueError(f"possible direct identifiers found: {', '.join(hits)}")

    source = clean_string(pick(working_row, "source") or args.source)
    usage_class = clean_string(pick(working_row, "usage_class") or args.usage_class)
    review_status = clean_string(pick(working_row, "review_status") or args.review_status)
    split = clean_string(pick(working_row, "split") or args.default_split)
    case_id = clean_string(pick(working_row, "case_id"))

    if not source:
        raise ValueError("source is required, either as a column or --source")
    if usage_class not in ALLOWED_USAGE_CLASSES:
        raise ValueError(f"usage_class must be one of {sorted(ALLOWED_USAGE_CLASSES)}")
    if review_status not in REVIEWED_STATUSES and not args.allow_unreviewed:
        raise ValueError(f"review_status must be one of {sorted(REVIEWED_STATUSES)}")
    if not case_id:
        if not args.generate_case_id:
            raise ValueError("case_id is required, or pass --generate-case-id")
        case_id = stable_generated_id(working_row, source)
        warnings.append("generated case_id")

    structured_case = build_structured_case(working_row)
    if not structured_case:
        raise ValueError("structured_case is empty after import")

    try:
        validated_output = build_validated_output(working_row, allow_unlabeled=args.allow_unlabeled)
    except ValueError:
        if args.skip_unlabeled:
            return None, ["skipped unlabeled row"]
        raise

    return (
        {
            "case_id": case_id,
            "source": source,
            "usage_class": usage_class,
            "review_status": review_status,
            "split": split or "train",
            "structured_case": structured_case,
            "validated_output": validated_output,
        },
        warnings,
    )


def write_jsonl(path: Path, rows: List[Dict[str, Any]], append: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if append else "w"
    with path.open(mode, encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def import_cases(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_path = Path(args.output)
    imported: List[Dict[str, Any]] = []
    seen_case_ids = set()
    warning_count = 0
    skipped_count = 0

    for index, row in enumerate(read_rows(input_path, args.format), start=1):
        try:
            transformed, warnings = transform_row(row, args)
        except ValueError as exc:
            raise ValueError(f"row {index} failed import: {exc}") from exc

        if warnings:
            warning_count += len(warnings)
            logger.warning("row %s: %s", index, "; ".join(warnings))

        if transformed is None:
            skipped_count += 1
            continue

        case_id = transformed["case_id"]
        if case_id in seen_case_ids and not args.allow_duplicate_case_id:
            raise ValueError(f"row {index} duplicate case_id: {case_id}")
        seen_case_ids.add(case_id)
        imported.append(transformed)

    if not imported:
        raise ValueError("no rows imported")

    if args.dry_run:
        logger.info(
            "dry run complete: %s importable rows, %s skipped rows, %s warnings",
            len(imported),
            skipped_count,
            warning_count,
        )
        return

    write_jsonl(output_path, imported, append=args.append)
    logger.info("wrote %s rows to %s", len(imported), output_path)
    if skipped_count:
        logger.info("skipped %s rows", skipped_count)
    if warning_count:
        logger.info("completed with %s warnings", warning_count)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import CSV/JSONL clinical exports into VetIOS clinical_cases.jsonl."
    )
    parser.add_argument("--input", required=True, help="CSV or JSONL clinical export")
    parser.add_argument("--output", default="vetios_pipeline/datasets/clinical_cases.jsonl")
    parser.add_argument("--format", choices=["auto", "csv", "jsonl"], default="auto")
    parser.add_argument("--source", default="", help="Default source name when source column is absent")
    parser.add_argument(
        "--usage-class",
        default="internal_deidentified",
        choices=sorted(ALLOWED_USAGE_CLASSES),
        help="Default usage class when usage_class column is absent",
    )
    parser.add_argument(
        "--review-status",
        default="clinician_reviewed",
        help="Default review status when review_status column is absent",
    )
    parser.add_argument("--default-split", default="train", choices=["train", "eval", "validation", "test"])
    parser.add_argument("--strict-dates", action="store_true", help="Reject exact dates")
    parser.add_argument(
        "--redact-direct-identifiers",
        action="store_true",
        help="Redact direct identifiers detected in flat CSV fields. Dates are still rejected with --strict-dates.",
    )
    parser.add_argument("--generate-case-id", action="store_true")
    parser.add_argument("--allow-unreviewed", action="store_true")
    parser.add_argument("--allow-unlabeled", action="store_true")
    parser.add_argument("--skip-unlabeled", action="store_true")
    parser.add_argument("--allow-duplicate-case-id", action="store_true")
    parser.add_argument("--append", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


if __name__ == "__main__":
    import_cases(build_parser().parse_args())
