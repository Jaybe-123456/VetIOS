import argparse
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List

try:
    from ingest_drive_sources import ingest_sources
except ImportError:  # pragma: no cover - supports package-style execution
    from vetios_pipeline.ingest_drive_sources import ingest_sources

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_OUTPUT_DIR = "vetios_pipeline/datasets/drive_audit"
DEFAULT_CLINICAL_OUTPUT = "vetios_pipeline/datasets/clinical_cases.jsonl"


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


def count_jsonl(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for _ in iter_jsonl(path))


def validate_chunks(chunks_path: Path) -> List[str]:
    errors: List[str] = []
    for index, chunk in enumerate(iter_jsonl(chunks_path), start=1):
        if not chunk.get("source_path"):
            errors.append(f"chunk {index}: missing source_path")
        if not chunk.get("source_name"):
            errors.append(f"chunk {index}: missing source_name")
        text = chunk.get("text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"chunk {index}: missing text")
        if len(errors) >= 20:
            break
    return errors


def build_summary(output_dir: Path, clinical_output: Path) -> Dict[str, Any]:
    inventory_path = output_dir / "drive_inventory.json"
    chunks_path = output_dir / "source_document_chunks.jsonl"

    if not inventory_path.exists():
        raise FileNotFoundError(
            f"missing {inventory_path}; run ingestion before building the RAG index"
        )

    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    if not isinstance(inventory, list):
        raise ValueError(f"{inventory_path} must contain a JSON array")

    kind_status = Counter((item.get("kind", "unknown"), item.get("status", "unknown")) for item in inventory)
    statuses = Counter(item.get("status", "unknown") for item in inventory)

    chunk_count = count_jsonl(chunks_path)
    chunk_source_count = 0
    chunk_validation_errors: List[str] = []
    if chunks_path.exists():
        chunk_validation_errors = validate_chunks(chunks_path)
        chunk_source_count = len({chunk.get("source_path") for chunk in iter_jsonl(chunks_path)})

    return {
        "output_dir": str(output_dir),
        "inventory_path": str(inventory_path),
        "chunks_path": str(chunks_path),
        "clinical_output": str(clinical_output),
        "inventory_files": len(inventory),
        "document_chunks": chunk_count,
        "document_chunk_sources": chunk_source_count,
        "clinical_rows": count_jsonl(clinical_output),
        "status_counts": dict(statuses),
        "kind_status_counts": {f"{kind}:{status}": count for (kind, status), count in kind_status.items()},
        "flagged_possible_phi": statuses.get("flagged_possible_phi", 0),
        "failed_files": statuses.get("failed", 0),
        "chunk_validation_errors": chunk_validation_errors,
    }


def ensure_rag_ready(summary: Dict[str, Any], allow_empty_rag: bool) -> None:
    if summary["chunk_validation_errors"]:
        raise ValueError(
            "RAG document chunks failed validation: "
            + "; ".join(summary["chunk_validation_errors"][:5])
        )
    if summary["document_chunks"] == 0 and not allow_empty_rag:
        raise ValueError(
            "No RAG document chunks were produced. Check --root paths, install pypdf/openpyxl, "
            "or pass --include-flagged-documents only after reviewing PHI risk."
        )


def rebuild(args: argparse.Namespace) -> Dict[str, Any]:
    roots = [Path(root) for root in args.root]
    missing_roots = [str(root) for root in roots if not root.exists()]
    if missing_roots:
        raise FileNotFoundError(f"source roots not found: {', '.join(missing_roots)}")

    ingestion_args = argparse.Namespace(
        root=args.root,
        output_dir=args.output_dir,
        clinical_output=args.clinical_output,
        source=args.source,
        source_prefix=args.source_prefix,
        usage_class=args.usage_class,
        review_status=args.review_status,
        default_split=args.default_split,
        strict_dates=args.strict_dates,
        redact_direct_identifiers=args.redact_direct_identifiers,
        generate_case_id=args.generate_case_id,
        allow_unreviewed=args.allow_unreviewed,
        allow_unlabeled=args.allow_unlabeled,
        skip_unlabeled=args.skip_unlabeled,
        allow_duplicate_case_id=args.allow_duplicate_case_id,
        append_clinical=args.append_clinical,
        include_flagged_documents=args.include_flagged_documents,
        max_text_chars=args.max_text_chars,
        chunk_chars=args.chunk_chars,
    )

    logger.info("rebuilding knowledge base from %s root(s)", len(args.root))
    ingest_sources(ingestion_args)

    output_dir = Path(args.output_dir)
    clinical_output = Path(args.clinical_output)
    summary = build_summary(output_dir, clinical_output)
    ensure_rag_ready(summary, allow_empty_rag=args.allow_empty_rag)

    summary_path = Path(args.summary_output) if args.summary_output else output_dir / "rag_rebuild_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info("RAG rebuild summary written: %s", summary_path)
    logger.info("inventory files: %s", summary["inventory_files"])
    logger.info("document chunks: %s", summary["document_chunks"])
    logger.info("clinical rows: %s", summary["clinical_rows"])
    if summary["flagged_possible_phi"]:
        logger.warning("possible PHI flagged in %s file(s); review inventory before indexing", summary["flagged_possible_phi"])
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild and validate VetIOS local document chunks for the RAG knowledge base."
    )
    parser.add_argument("--root", action="append", required=True, help="Source document/case folder path")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--clinical-output", default=DEFAULT_CLINICAL_OUTPUT)
    parser.add_argument("--summary-output", default="")
    parser.add_argument("--source", default="")
    parser.add_argument("--source-prefix", default="drive")
    parser.add_argument(
        "--usage-class",
        default="internal_deidentified",
        choices=[
            "public_open",
            "public_restricted",
            "credentialed_deidentified",
            "internal_deidentified",
            "consented_research",
        ],
    )
    parser.add_argument("--review-status", default="clinician_reviewed")
    parser.add_argument("--default-split", default="train", choices=["train", "eval", "validation", "test"])
    parser.add_argument("--strict-dates", action="store_true")
    parser.add_argument("--redact-direct-identifiers", action="store_true")
    parser.add_argument("--generate-case-id", action="store_true")
    parser.add_argument("--allow-unreviewed", action="store_true")
    parser.add_argument("--allow-unlabeled", action="store_true")
    parser.add_argument("--skip-unlabeled", action="store_true")
    parser.add_argument("--allow-duplicate-case-id", action="store_true")
    parser.add_argument("--append-clinical", action="store_true")
    parser.add_argument("--include-flagged-documents", action="store_true")
    parser.add_argument("--allow-empty-rag", action="store_true")
    parser.add_argument("--max-text-chars", type=int, default=250000)
    parser.add_argument("--chunk-chars", type=int, default=2500)
    return parser


if __name__ == "__main__":
    rebuild(build_parser().parse_args())
