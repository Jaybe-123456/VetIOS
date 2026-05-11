import argparse
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_INPUT = Path("vetios_pipeline/datasets/clinical_cases.jsonl")
DEFAULT_OUTPUT_DIR = Path("vetios_pipeline/datasets/prepared")

SYSTEM_PROMPT = (
    "You are VetIOS, a veterinary clinical decision-support model. "
    "Return structured JSON only. Rank differential diagnoses with evidence, uncertainty, "
    "missing confirmatory tests, contraindications, and emergency referral criteria. "
    "Do not present a definitive diagnosis when the evidence is insufficient."
)

ALLOWED_USAGE_CLASSES = {
    "public_open",
    "public_restricted",
    "credentialed_deidentified",
    "internal_deidentified",
    "consented_research",
}

REVIEWED_STATUSES = {
    "clinician_reviewed",
    "expert_curated",
    "guideline_derived",
    "outcome_confirmed",
}

DIRECT_IDENTIFIER_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "phone": re.compile(r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "street_address": re.compile(
        r"\b\d{1,6}\s+[A-Za-z0-9 .'-]+"
        r"\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|blvd|boulevard)\b",
        re.IGNORECASE,
    ),
    "owner_or_client_label": re.compile(r"\b(?:owner|client|guardian)\s*[:=]\s*[A-Z][A-Za-z'.-]+", re.IGNORECASE),
}

DATE_PATTERN = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b"
)


def iter_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
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


def collect_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from collect_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from collect_strings(child)


def find_identifier_hits(row: Dict[str, Any], strict_dates: bool) -> List[str]:
    text = "\n".join(collect_strings(row))
    hits = [name for name, pattern in DIRECT_IDENTIFIER_PATTERNS.items() if pattern.search(text)]
    if strict_dates and DATE_PATTERN.search(text):
        hits.append("date")
    return hits


def stable_bucket(case_id: str) -> float:
    digest = hashlib.sha256(case_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def normalize_output(value: Any, allow_text_output: bool) -> str:
    if isinstance(value, dict) or isinstance(value, list):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, str) and allow_text_output:
        return value.strip()
    raise ValueError("validated_output must be a JSON object/list unless --allow-text-output is set")


def normalize_case(
    row: Dict[str, Any],
    *,
    allow_synthetic: bool,
    allow_unreviewed: bool,
    allow_credentialed: bool,
    allow_text_output: bool,
    strict_dates: bool,
) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    missing = [
        key
        for key in ("case_id", "source", "usage_class", "structured_case", "validated_output")
        if key not in row
    ]
    if missing:
        raise ValueError(f"missing required fields: {', '.join(missing)}")

    case_id = str(row["case_id"]).strip()
    if not case_id:
        raise ValueError("case_id is empty")

    usage_class = str(row["usage_class"]).strip()
    if usage_class not in ALLOWED_USAGE_CLASSES:
        if allow_synthetic and usage_class.startswith("synthetic"):
            warnings.append("synthetic row accepted by override")
        else:
            raise ValueError(
                f"usage_class={usage_class!r} is not allowed for real clinical training"
            )

    if usage_class == "credentialed_deidentified" and not allow_credentialed:
        raise ValueError(
            "credentialed_deidentified rows require --allow-credentialed after confirming the data terms"
        )

    review_status = str(row.get("review_status", "")).strip()
    if review_status not in REVIEWED_STATUSES and not allow_unreviewed:
        raise ValueError(
            "review_status must be one of "
            f"{sorted(REVIEWED_STATUSES)} or pass --allow-unreviewed"
        )

    identifier_hits = find_identifier_hits(row, strict_dates=strict_dates)
    if identifier_hits:
        raise ValueError(f"possible direct identifiers found: {', '.join(identifier_hits)}")

    source = str(row["source"]).strip()
    if re.search(r"\b(mimic|physionet|n2c2|i2b2)\b", source, re.IGNORECASE):
        warnings.append("restricted clinical source detected; verify DUA/cloud-use terms before Colab")

    structured_case = row["structured_case"]
    if not isinstance(structured_case, dict):
        raise ValueError("structured_case must be a JSON object")

    assistant_output = normalize_output(row["validated_output"], allow_text_output=allow_text_output)
    user_content = (
        "Analyze this veterinary clinical case. Return only the validated structured JSON format.\n\n"
        "Case JSON:\n"
        f"{json.dumps(structured_case, ensure_ascii=False, sort_keys=True)}"
    )

    metadata = {
        "case_id": case_id,
        "source": source,
        "usage_class": usage_class,
        "review_status": review_status,
        "dataset_version": row.get("dataset_version"),
    }

    output_row = {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": assistant_output},
        ],
        "metadata": metadata,
    }
    return output_row, warnings


def split_name(row: Dict[str, Any], holdout: float) -> str:
    explicit = row.get("split")
    if explicit in {"train", "validation", "eval", "test"}:
        return "eval" if explicit in {"validation", "eval"} else explicit
    case_id = str(row["case_id"])
    return "eval" if stable_bucket(case_id) < holdout else "train"


def write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def digest_rows(rows: List[Dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps(row, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def prepare_dataset(args: argparse.Namespace) -> None:
    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(
            f"{input_path} does not exist. Create it from real de-identified clinical cases first."
        )

    train_rows: List[Dict[str, Any]] = []
    eval_rows: List[Dict[str, Any]] = []
    test_rows: List[Dict[str, Any]] = []
    warning_count = 0

    for index, source_row in enumerate(iter_jsonl(input_path), start=1):
        try:
            normalized, warnings = normalize_case(
                source_row,
                allow_synthetic=args.allow_synthetic,
                allow_unreviewed=args.allow_unreviewed,
                allow_credentialed=args.allow_credentialed,
                allow_text_output=args.allow_text_output,
                strict_dates=args.strict_dates,
            )
        except ValueError as exc:
            raise ValueError(f"row {index} failed validation: {exc}") from exc

        if warnings:
            warning_count += len(warnings)
            logger.warning("row %s: %s", index, "; ".join(warnings))

        target = split_name(source_row, args.holdout)
        if target == "train":
            train_rows.append(normalized)
        elif target == "test":
            test_rows.append(normalized)
        else:
            eval_rows.append(normalized)

    if not train_rows:
        raise ValueError("no training rows produced")
    if not eval_rows:
        logger.warning("no eval rows produced; use --holdout or explicit split=eval rows")

    output_dir = Path(args.output_dir)
    train_path = output_dir / "train.jsonl"
    eval_path = output_dir / "eval.jsonl"
    test_path = output_dir / "test.jsonl"
    manifest_path = output_dir / "manifest.json"

    write_jsonl(train_path, train_rows)
    write_jsonl(eval_path, eval_rows)
    if test_rows:
        write_jsonl(test_path, test_rows)

    all_rows = train_rows + eval_rows + test_rows
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_path": str(input_path),
        "train_rows": len(train_rows),
        "eval_rows": len(eval_rows),
        "test_rows": len(test_rows),
        "warning_count": warning_count,
        "sha256": digest_rows(all_rows),
        "system_prompt": SYSTEM_PROMPT,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info("prepared train file: %s (%s rows)", train_path, len(train_rows))
    logger.info("prepared eval file: %s (%s rows)", eval_path, len(eval_rows))
    if test_rows:
        logger.info("prepared test file: %s (%s rows)", test_path, len(test_rows))
    logger.info("wrote manifest: %s", manifest_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare real de-identified clinical cases for VetIOS Qwen SFT."
    )
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Source clinical_cases.jsonl path")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Prepared dataset directory")
    parser.add_argument("--holdout", type=float, default=0.1, help="Eval split ratio when split is absent")
    parser.add_argument("--allow-synthetic", action="store_true", help="Allow synthetic_* usage classes")
    parser.add_argument("--allow-unreviewed", action="store_true", help="Allow rows without clinical review status")
    parser.add_argument(
        "--allow-credentialed",
        action="store_true",
        help="Allow credentialed/restricted de-identified sources after confirming data terms",
    )
    parser.add_argument(
        "--allow-text-output",
        action="store_true",
        help="Allow string validated_output instead of structured JSON",
    )
    parser.add_argument(
        "--strict-dates",
        action="store_true",
        help="Reject exact dates in addition to direct identifiers",
    )
    return parser


if __name__ == "__main__":
    prepare_dataset(build_parser().parse_args())
