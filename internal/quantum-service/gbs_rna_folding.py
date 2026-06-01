"""
GBS-based RNA secondary-structure prediction over a WFSG.
"""

import hashlib
from time import time
from typing import Dict, Optional, Set, Tuple

import numpy as np

from gbs_differential import PAPER_DOI, run_gbs_clique_search
from wfsg_constructor import Stem, build_wfsg, mcc_score


def predict_rna_structure(
    sequence: str,
    pathogen_label: str,
    region: Optional[str] = None,
    reference_structure: Optional[str] = None,
    n_samples: int = 300,
    n_iterations: int = 100,
) -> Dict:
    start = time()
    normalized = _normalize_rna(sequence)
    sequence_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    stems, matrix = build_wfsg(normalized, min_stem_length=2)
    gbs_result = run_gbs_clique_search(
        node_ids=[f"stem_{stem.id}" for stem in stems],
        adjacency_matrix=matrix,
        n_samples=n_samples,
        n_iterations=n_iterations,
        top_k=3,
    )

    selected = _selected_stems(gbs_result["ranked_node_ids"], stems)
    predicted_pairs = _stems_to_pairs(selected)
    secondary_structure = _pairs_to_dot_bracket(predicted_pairs, len(normalized))
    mcc = None
    if reference_structure:
        mcc = mcc_score(predicted_pairs, _dot_bracket_to_pairs(reference_structure), len(normalized))

    return {
        "sequence_hash": sequence_hash,
        "sequence_length": len(normalized),
        "pathogen_label": pathogen_label,
        "region": region,
        "wfsg_node_count": len(stems),
        "wfsg_edge_count": int((np.count_nonzero(matrix) - len(stems)) / 2),
        "predicted_stems": [
            {"start5": stem.start5, "start3": stem.start3, "length": stem.length}
            for stem in selected
        ],
        "secondary_structure": secondary_structure,
        "max_clique_weight": float(gbs_result["max_clique_weight"]),
        "mcc_score": mcc,
        "gbs_backend": gbs_result["backend"],
        "quantum_advantage": float(gbs_result["quantum_advantage"]),
        "algorithm_version": "tang2023_wfsg_yu2023_gbs",
        "paper_doi": PAPER_DOI,
        "latency_ms": int((time() - start) * 1000),
    }


def _normalize_rna(sequence: str) -> str:
    seq = "".join(line.strip() for line in sequence.splitlines() if not line.startswith(">")).upper()
    seq = seq.replace("T", "U")
    if not seq or any(base not in {"A", "U", "G", "C"} for base in seq):
        raise ValueError("RNA sequence must contain only A, U, G, C bases")
    return seq


def _selected_stems(node_ids, stems) -> list:
    stem_by_id = {f"stem_{stem.id}": stem for stem in stems}
    return [stem_by_id[node_id] for node_id in node_ids if node_id in stem_by_id]


def _stems_to_pairs(stems: list[Stem]) -> Set[Tuple[int, int]]:
    pairs: Set[Tuple[int, int]] = set()
    for stem in stems:
        for offset in range(stem.length):
            pairs.add((stem.start5 + offset, stem.start3 - offset))
    return pairs


def _pairs_to_dot_bracket(pairs: Set[Tuple[int, int]], length: int) -> str:
    result = ["."] * length
    for left, right in pairs:
        if 0 <= left < right < length:
            result[left] = "("
            result[right] = ")"
    return "".join(result)


def _dot_bracket_to_pairs(structure: str) -> Set[Tuple[int, int]]:
    stack = []
    pairs: Set[Tuple[int, int]] = set()
    for index, char in enumerate(structure):
        if char == "(":
            stack.append(index)
        elif char == ")" and stack:
            pairs.add((stack.pop(), index))
    return pairs
