import argparse
import hashlib
import json
import logging
import random
from pathlib import Path
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_SEED_FILE = "vetios_pipeline/knowledge/global_veterinary_case_seed.json"
DEFAULT_OUTPUT = "vetios_pipeline/datasets/synthetic_global_cases.jsonl"


def load_seed(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sample_range(rng: random.Random, bounds: List[float], decimals: int = 1) -> float:
    return round(rng.uniform(float(bounds[0]), float(bounds[1])), decimals)


def choose_some(rng: random.Random, values: List[str], minimum: int, maximum: int) -> List[str]:
    if not values:
        return []
    count = min(len(values), rng.randint(minimum, min(maximum, len(values))))
    return rng.sample(values, count)


def stable_case_id(seed: int, index: int, condition: str, species: str) -> str:
    digest = hashlib.sha256(f"{seed}:{index}:{condition}:{species}".encode("utf-8")).hexdigest()[:12]
    return f"synthetic-global-{index:07d}-{digest}"


def split_for_index(rng: random.Random, eval_ratio: float, test_ratio: float) -> str:
    roll = rng.random()
    if roll < test_ratio:
        return "test"
    if roll < test_ratio + eval_ratio:
        return "eval"
    return "train"


def source_refs(template: Dict[str, Any], registry: Dict[str, Any]) -> List[Dict[str, str]]:
    refs: List[Dict[str, str]] = []
    for source_id in template.get("source_ids", []):
        source = registry.get(source_id)
        if source:
            refs.append(
                {
                    "id": source_id,
                    "name": source["name"],
                    "url": source["url"],
                    "scope": source["scope"],
                }
            )
    return refs


def build_case(
    *,
    rng: random.Random,
    index: int,
    seed: int,
    template: Dict[str, Any],
    profiles: Dict[str, Any],
    noise: Dict[str, List[str]],
    registry: Dict[str, Any],
    eval_ratio: float,
    test_ratio: float,
    source_label: str,
) -> Dict[str, Any]:
    species = rng.choice(template["species"])
    profile = profiles[species]
    signs = choose_some(rng, template["presenting_signs"], 3, 5)
    noise_signs = choose_some(rng, noise.get(species, []), 0, 2)
    presenting_signs = signs + [item for item in noise_signs if item not in signs]
    exam_findings = choose_some(rng, template.get("exam_findings", []), 2, 4)
    diagnostics_performed = choose_some(rng, template.get("diagnostics", []), 1, 3)
    severity = rng.choice(["low", "moderate", "high", "critical"] if template.get("notifiable") else ["low", "moderate", "high"])

    structured_case = {
        "species": species,
        "breed": rng.choice(profile["breeds"]),
        "age_years": sample_range(rng, profile["age_years"]),
        "sex": rng.choice(profile["sexes"]),
        "weight_kg": sample_range(rng, profile["weight_kg"]),
        "region": rng.choice(profile["regions"]),
        "presenting_signs": presenting_signs,
        "history": (
            "Synthetic reference-derived case for model training. "
            f"Pattern emphasizes {template['system']} reasoning and uncertainty management."
        ),
        "physical_exam": {f"finding_{i + 1}": finding for i, finding in enumerate(exam_findings)},
        "diagnostics": {f"item_{i + 1}": f"{diagnostic} pending or requires interpretation" for i, diagnostic in enumerate(diagnostics_performed)},
        "constraints": rng.sample(
            [
                "limited diagnostics available initially",
                "requires clinician review",
                "owner/producer reports incomplete timeline",
                "regional disease prevalence may alter differential ranking",
                "treatment details intentionally omitted from training label",
            ],
            k=2,
        ),
    }

    alt_differentials = choose_some(rng, template.get("differentials", []), 2, 4)
    top_differentials = [
        {
            "condition": template["condition"],
            "probability_bin": severity,
            "supporting_evidence": presenting_signs[:4],
            "contradicting_evidence": ["synthetic case requires real clinician confirmation"],
        }
    ]
    for rank, differential in enumerate(alt_differentials, start=2):
        top_differentials.append(
            {
                "condition": differential,
                "probability_bin": "possible",
                "supporting_evidence": ["overlapping clinical signs"],
                "contradicting_evidence": ["less directly supported than top pattern"],
                "rank": rank,
            }
        )

    safety_flags = list(template.get("safety_flags", []))
    if template.get("notifiable"):
        safety_flags.insert(0, "possible notifiable disease: follow local reporting law and official authority guidance")

    validated_output = {
        "mode": "diagnostic_decision_support",
        "top_differentials": top_differentials,
        "missing_tests": template.get("missing_tests", []),
        "safety_flags": safety_flags,
        "contraindications": template.get("contraindications", []),
        "notifiable_disease_suspicion": bool(template.get("notifiable")),
        "source_references": source_refs(template, registry),
        "abstain_reason": None,
    }

    return {
        "case_id": stable_case_id(seed, index, template["condition"], species),
        "source": f"{source_label}:{template['condition']}",
        "usage_class": "synthetic_reference_derived",
        "review_status": "guideline_derived",
        "split": split_for_index(rng, eval_ratio, test_ratio),
        "structured_case": structured_case,
        "validated_output": validated_output,
        "synthetic_generation": {
            "generator": "vetios_pipeline/generate_synthetic_cases.py",
            "seed": seed,
            "condition": template["condition"],
            "species": species,
            "warning": "Synthetic/reference-derived case. Do not represent as real patient data or outcome-confirmed clinical evidence.",
        },
    }


def generate_cases(args: argparse.Namespace) -> None:
    seed_path = Path(args.seed_file)
    seed_data = load_seed(seed_path)
    registry = seed_data["source_registry"]
    profiles = seed_data["species_profiles"]
    noise = seed_data["common_noise_signs"]
    conditions = seed_data["conditions"]

    if args.species:
        requested_species = set(args.species)
        conditions = [
            condition
            for condition in conditions
            if requested_species.intersection(set(condition["species"]))
        ]
        if not conditions:
            raise ValueError(f"no condition templates match species filter: {sorted(requested_species)}")

    rng = random.Random(args.seed)
    output_rows: List[Dict[str, Any]] = []
    for index in range(1, args.count + 1):
        template = rng.choice(conditions)
        output_rows.append(
            build_case(
                rng=rng,
                index=index,
                seed=args.seed,
                template=template,
                profiles=profiles,
                noise=noise,
                registry=registry,
                eval_ratio=args.eval_ratio,
                test_ratio=args.test_ratio,
                source_label=args.source_label,
            )
        )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for row in output_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    manifest = {
        "output": str(output_path),
        "seed_file": str(seed_path),
        "count": len(output_rows),
        "seed": args.seed,
        "usage_class": "synthetic_reference_derived",
        "review_status": "guideline_derived",
        "condition_templates": len(conditions),
        "species_filter": args.species or "all",
        "warning": "Synthetic/reference-derived data for augmentation and robustness testing only.",
    }
    manifest_path = output_path.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info("wrote %s synthetic cases to %s", len(output_rows), output_path)
    logger.info("wrote manifest to %s", manifest_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate large synthetic/reference-derived veterinary SFT cases."
    )
    parser.add_argument("--seed-file", default=DEFAULT_SEED_FILE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--count", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--eval-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    parser.add_argument("--species", action="append", choices=["dog", "cat", "horse", "cattle", "sheep", "goat", "pig", "poultry", "rabbit"])
    parser.add_argument("--source-label", default="synthetic_reference_global_veterinary_sources")
    return parser


if __name__ == "__main__":
    generate_cases(build_parser().parse_args())
